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
  let path;
  try { path = new URL(entry.url).pathname; } catch { return; }
  const schema = schemas.get(path) ?? null;
  entry.schema = schema;
  entry.decodedReq = decodeEntry(entry.requestBody,  entry.requestEncoding,  schema?.requestType,  schema?.root);
  entry.decodedRes = decodeEntry(entry.responseBody, entry.responseEncoding, schema?.responseType, schema?.root);
  requests.push(entry);
  appendRow(entry);
};

// ── decoding ─────────────────────────────────────────────────
function tryDecodeFrames(bytes, schemaType, root) {
  const allFrames = decodeFrames(bytes);
  const dataFrames = allFrames.filter(f => !f.isTrailer);
  if (!dataFrames.length) return null;
  const msg = dataFrames[0].data;
  if (schemaType && root) return { kind: 'schema',    value: decodeWithSchema(msg, schemaType, root) };
  return                        { kind: 'heuristic', value: decodeMessage(msg) };
}

function base64ToBytes(str) {
  // Własny dekoder: obsługuje wewnętrzny '=' (gRPC-web-text = 2 bloki base64)
  // oraz URL-safe base64 (-/_)
  const LU = new Uint8Array(256).fill(64);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('').forEach((c, i) => { LU[c.charCodeAt(0)] = i; });
  LU[45] = 62; LU[95] = 63;
  const s = str.replace(/\s/g, '');
  const r = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = LU[s.charCodeAt(i)];
    const b = i + 1 < s.length ? LU[s.charCodeAt(i + 1)] : 64;
    if (a >= 64 || b >= 64) break;
    r.push((a << 2) | (b >> 4));
    if (i + 2 >= s.length || s[i + 2] === '=') continue;
    const c = LU[s.charCodeAt(i + 2)];
    if (c >= 64) break;
    r.push(((b & 15) << 4) | (c >> 2));
    if (i + 3 >= s.length || s[i + 3] === '=') continue;
    const d = LU[s.charCodeAt(i + 3)];
    if (d >= 64) break;
    r.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(r);
}

function decodeEntry(body, encoding, schemaType, root) {
  if (!body) return { kind: 'no-body' };
  try {
    const bytes = bodyToBytes(body, encoding);

    // Iteracyjne próby dekodowania base64 (max 3 warstwy)
    let current = bytes;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = tryDecodeFrames(current, schemaType, root);
      if (r) return r;

      // Jeśli bajty wyglądają jak ASCII — spróbuj traktować je jako base64
      if (!current.length || current[0] < 0x20 || current[0] > 0x7E) break;
      try {
        const str = Array.from(current, b => String.fromCharCode(b)).join('');
        const next = base64ToBytes(str);
        if (next.length >= current.length) break; // brak postępu
        current = next;
      } catch { break; }
    }

    const allFrames = decodeFrames(current);
    const trailerFrames = allFrames.filter(f => f.isTrailer);
    if (trailerFrames.length) {
      const text = new TextDecoder().decode(trailerFrames[0].data);
      return { kind: 'trailer', value: text };
    }

    const hexPreview = Array.from(bytes.slice(0, 24))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    const hexCurrent = Array.from(current.slice(0, 24))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    return { kind: 'no-frames', byteCount: bytes.length, hexPreview,
             currentLen: current.length, hexCurrent };
  } catch (e) {
    return { kind: 'error', value: e.message };
  }
}

// ── request list ─────────────────────────────────────────────
function appendRow(entry) {
  let path, method;
  try {
    path   = new URL(entry.url).pathname;
    method = path.split('/').pop();
  } catch {
    path   = entry.url;
    method = entry.url;
  }
  const row = document.createElement('div');
  row.className = 'req-row';
  row.dataset.id = entry.id;
  const urlSpan = el('span', 'col-url', method);
  urlSpan.title = path;
  row.appendChild(urlSpan);
  row.appendChild(el('span', 'col-status', String(entry.status)));
  row.appendChild(el('span', 'col-time',   String(entry.time)));
  row.addEventListener('click', () => selectEntry(entry.id));
  listBody.appendChild(row);
}

function selectEntry(id) {
  document.querySelectorAll('.req-row').forEach(r =>
    r.classList.toggle('selected', r.dataset.id === id));
  const entry = requests.find(r => r.id === id);
  if (!entry) return;

  let path = entry.url;
  try { path = new URL(entry.url).pathname; } catch {}
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
  if (!decoded || decoded.kind === 'no-body') { container.textContent = '(brak danych)'; return; }
  if (decoded.kind === 'error')     { container.textContent = `Błąd: ${decoded.value}`; return; }
  if (decoded.kind === 'no-frames') {
    container.textContent = [
      `Brak ramek gRPC-web (${decoded.byteCount} B)`,
      `Pierwsze bajty raw:     ${decoded.hexPreview}`,
      `Po dekodowaniu (${decoded.currentLen} B): ${decoded.hexCurrent}`,
    ].join('\n');
    return;
  }
  if (decoded.kind === 'trailer')   {
    const pre = el('pre', 'trailer-text');
    pre.textContent = decoded.value;
    container.appendChild(pre);
    return;
  }
  container.appendChild(renderObj(decoded.value, decoded.kind === 'schema', 0));
}

function renderObj(obj, isSchema, depth) {
  if (obj === null || obj === undefined) return text('null');
  if (typeof obj !== 'object')           return renderPrim(obj);

  const wrap = el('div', depth > 0 ? 'pnested' : '');
  for (const [key, val] of Object.entries(obj)) {
    if (isSchema) {
      const row = el('div', 'pf');
      row.appendChild(el('span', 'pks', key + ': '));
      row.appendChild(typeof val === 'object' && val !== null
        ? renderObj(val, true, depth + 1)
        : renderPrim(val));
      wrap.appendChild(row);
    } else {
      const vals = Array.isArray(val) ? val : [val];
      for (const v of vals) {
        const vRow = el('div', 'pf');
        vRow.appendChild(el('span', 'pk', `"${key}" `));
        vRow.appendChild(el('span', 'pt', `(${v.type})`));
        vRow.appendChild(text(': '));
        vRow.appendChild(v.type === 'message'
          ? renderObj(v.value, false, depth + 1)
          : renderPrim(v.value));
        wrap.appendChild(vRow);
      }
    }
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
  for (const { text: protoText } of await getStoredFiles()) {
    try {
      const { root, urlMap } = parseProtoText(protoText);
      for (const [url, info] of Object.entries(urlMap)) schemas.set(url, { ...info, root });
    } catch {}
  }
})();
