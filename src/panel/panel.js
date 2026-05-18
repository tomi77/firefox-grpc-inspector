import { decodeFrames, bodyToBytes } from '../lib/grpc-web-decoder.js';
import { decodeMessage } from '../lib/proto-decoder.js';
import { parseProtoText, decodeWithSchema } from '../lib/proto-loader.js';

// ── state ───────────────────────────────────────────────────
const requests = [];
const schemas  = new Map(); // pathname → { requestType, responseType, root, serviceName, methodName }

// ── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const listBody     = $('list-body');
const detailEmpty  = $('detail-empty');
const detailContent= $('detail-content');
const detailUrl    = $('detail-url');
const detailMeta   = $('detail-meta');
const schemaHint   = $('schema-hint');
const tabReq       = $('tab-request');
const tabRes       = $('tab-response');
const protoOverlay = $('proto-overlay');
const protoList    = $('proto-list');
const protoError   = $('proto-error');

// ── public API called by devtools.js ────────────────────────
window.receiveRequest = entry => {
  const path = new URL(entry.url).pathname;
  const schema = schemas.get(path) ?? null;
  entry.schema = schema;
  entry.decodedReq = decodeEntry(entry.requestBody,  entry.requestEncoding,  schema?.requestType,  schema?.root);
  entry.decodedRes = decodeEntry(entry.responseBody, entry.responseEncoding, schema?.responseType, schema?.root);
  requests.push(entry);
  appendRow(entry);
};

// ── decoding ─────────────────────────────────────────────────
function decodeEntry(body, encoding, schemaType, root) {
  if (!body) return null;
  try {
    const frames = decodeFrames(bodyToBytes(body, encoding)).filter(f => !f.isTrailer);
    if (!frames.length) return null;
    const msg = frames[0].data;
    if (schemaType && root) return { kind: 'schema',    value: decodeWithSchema(msg, schemaType, root) };
    return                        { kind: 'heuristic', value: decodeMessage(msg) };
  } catch (e) {
    return { kind: 'error', value: e.message };
  }
}

// ── request list ─────────────────────────────────────────────
function appendRow(entry) {
  const path   = new URL(entry.url).pathname;
  const method = path.split('/').pop();
  const row = document.createElement('div');
  row.className = 'req-row';
  row.dataset.id = entry.id;
  row.innerHTML = `<span class="col-url" title="${path}">${method}</span>
    <span class="col-status">${entry.status}</span>
    <span class="col-time">${entry.time}</span>`;
  row.addEventListener('click', () => selectEntry(entry.id));
  listBody.appendChild(row);
}

function selectEntry(id) {
  document.querySelectorAll('.req-row').forEach(r =>
    r.classList.toggle('selected', r.dataset.id === id));
  const entry = requests.find(r => r.id === id);
  if (!entry) return;

  const path = new URL(entry.url).pathname;
  detailEmpty.hidden   = true;
  detailContent.hidden = false;
  detailUrl.textContent  = path;
  detailMeta.textContent = `${entry.status}  ${entry.time}ms`;
  schemaHint.textContent = entry.schema
    ? `✓ Schemat: ${entry.schema.serviceName}.${entry.schema.methodName}`
    : '⚠ Brak schematu — nazwy pól nieznane';

  renderDecoded(tabReq, entry.decodedReq);
  renderDecoded(tabRes, entry.decodedRes);
}

// ── rendering decoded data ────────────────────────────────────
function renderDecoded(container, decoded) {
  container.innerHTML = '';
  if (!decoded)                        { container.textContent = '(brak danych)'; return; }
  if (decoded.kind === 'error')        { container.textContent = `Błąd: ${decoded.value}`; return; }
  container.appendChild(renderObj(decoded.value, decoded.kind === 'schema', 0));
}

function renderObj(obj, isSchema, depth) {
  if (obj === null || obj === undefined) return text('null');
  if (typeof obj !== 'object')           return renderPrim(obj);

  const wrap = el('div', depth > 0 ? 'pnested' : '');
  for (const [key, val] of Object.entries(obj)) {
    const row = el('div', 'pf');
    if (isSchema) {
      row.appendChild(el('span', 'pks', key + ': '));
      row.appendChild(typeof val === 'object' && val !== null
        ? renderObj(val, true, depth + 1)
        : renderPrim(val));
    } else {
      row.appendChild(el('span', 'pk', `"${key}" `));
      row.appendChild(el('span', 'pt', `(${val.type})`));
      row.appendChild(text(': '));
      row.appendChild(val.type === 'message'
        ? renderObj(val.value, false, depth + 1)
        : renderPrim(val.value));
    }
    wrap.appendChild(row);
  }
  return wrap;
}

function renderPrim(val) {
  const cls = typeof val === 'string'  ? 'pv-s'
            : typeof val === 'boolean' ? 'pv-b'
            : typeof val === 'number'  ? 'pv-n' : 'pv-x';
  const display = typeof val === 'string' ? `"${val}"` : String(val);
  return el('span', cls, display);
}

const el   = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const text = s => document.createTextNode(s);

// ── tab switching ─────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tabReq.hidden = btn.dataset.tab !== 'request';
    tabRes.hidden = btn.dataset.tab !== 'response';
  }));

// ── clear ─────────────────────────────────────────────────────
$('btn-clear').addEventListener('click', () => {
  requests.length = 0;
  listBody.innerHTML = '';
  detailEmpty.hidden   = false;
  detailContent.hidden = true;
});

// ── proto overlay ─────────────────────────────────────────────
$('btn-protos').addEventListener('click', () => { protoOverlay.hidden = false; refreshProtoList(); });
$('btn-close-proto').addEventListener('click', () => { protoOverlay.hidden = true; });
protoOverlay.addEventListener('click', e => { if (e.target === protoOverlay) protoOverlay.hidden = true; });
$('btn-add-proto').addEventListener('click', () => $('proto-file-input').click());

$('proto-file-input').addEventListener('change', async e => {
  protoError.textContent = '';
  const stored = await getStoredFiles();
  for (const file of e.target.files) {
    const protoText = await file.text();
    try {
      const { root, urlMap } = parseProtoText(protoText);
      for (const [url, info] of Object.entries(urlMap)) schemas.set(url, { ...info, root });
      if (!stored.find(f => f.name === file.name)) stored.push({ name: file.name, text: protoText });
    } catch (err) {
      protoError.textContent = `Błąd: ${file.name}: ${err.message}`;
    }
  }
  await browser.storage.local.set({ proto_files: stored });
  e.target.value = '';
  refreshProtoList();
});

function refreshProtoList() {
  protoList.innerHTML = '';
  if (!schemas.size) { protoList.textContent = 'Brak wczytanych plików.'; return; }
  for (const [url, info] of schemas.entries()) {
    const row = el('div', 'proto-row');
    row.appendChild(el('span', 'proto-row-name', info.methodName));
    row.appendChild(el('span', 'proto-row-url', url));
    const btn = el('button', '', 'Usuń');
    btn.addEventListener('click', async () => {
      schemas.delete(url);
      await browser.storage.local.set({
        proto_files: (await getStoredFiles()).filter(f => {
          try { const { urlMap } = parseProtoText(f.text); return !urlMap[url]; }
          catch { return true; }
        }),
      });
      refreshProtoList();
    });
    row.appendChild(btn);
    protoList.appendChild(row);
  }
}

async function getStoredFiles() {
  const r = await browser.storage.local.get('proto_files');
  return r.proto_files ?? [];
}

// ── restore saved protos on startup ──────────────────────────
(async () => {
  for (const { text } of await getStoredFiles()) {
    try {
      const { root, urlMap } = parseProtoText(text);
      for (const [url, info] of Object.entries(urlMap)) schemas.set(url, { ...info, root });
    } catch {}
  }
})();
