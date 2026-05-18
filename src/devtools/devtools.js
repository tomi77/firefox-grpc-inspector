const MAX_BUFFER = 500;
const requestBuffer = [];
let panelWindow = null;

browser.devtools.panels.create('gRPC', '', 'panel.html', panel => {
  panel.onShown.addListener(win => {
    panelWindow = win;
    requestBuffer.forEach(r => panelWindow.receiveRequest(r));
    requestBuffer.length = 0;
  });
  panel.onHidden.addListener(() => { panelWindow = null; });
});

browser.devtools.network.onRequestFinished.addListener(harEntry => {
  const ct = (harEntry.response.headers ?? [])
    .find(h => h.name.toLowerCase() === 'content-type')?.value ?? '';
  if (!ct.includes('grpc-web')) return;

  harEntry.getContent((responseBody, responseEncoding) => {
    const post = harEntry.request.postData ?? {};
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: harEntry.request.url,
      status: harEntry.response.status,
      time: Math.round(harEntry.time),
      requestBody: post.text ?? '',
      requestEncoding: post.encoding ?? null,
      responseBody: responseBody ?? '',
      responseEncoding: responseEncoding ?? null,
    };
    panelWindow ? panelWindow.receiveRequest(entry)
                : requestBuffer.length < MAX_BUFFER && requestBuffer.push(entry);
  });
});
