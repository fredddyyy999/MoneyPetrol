/* MoneyPetrol · service worker
   - Funciona sin conexión: guarda la última versión de la app.
   - Intenta primero la red para que lleguen las actualizaciones de GitHub; si la red tarda más de
     3 segundos (mala cobertura), abre la copia guardada y la actualiza por detrás para la próxima vez.
   - Guarda el generador de PDF tras usarlo por primera vez (cierre mensual sin conexión).
   - Al tocar el aviso de fin de mes, abre la app en Balances. */
const CACHE = 'moneypetrol-3.2.1';
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const CORE = ['./', './index.html'];
const NET_TIMEOUT = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Generador de PDF: se guarda la primera vez que se usa, así el cierre mensual también sale sin conexión.
  // La página lo pide con CORS (crossOrigin), por eso la respuesta se puede leer y guardar.
  if (req.method === 'GET' && req.url === PDF_LIB) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Gemini, Supabase y otros: sin tocar

  // Red primero, pero sin quedarse esperando: si hay copia guardada y la red no contesta a tiempo, se usa la copia.
  const fromNet = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  e.waitUntil(fromNet.then(() => {}, () => {}));                               // deja terminar la descarga aunque ya se haya respondido
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (!cached) {
      try { return await fromNet; }
      catch (err) { return (await caches.match('./index.html')) || Response.error(); }
    }
    const res = await Promise.race([
      fromNet.catch(() => null),
      new Promise(done => setTimeout(() => done(null), NET_TIMEOUT))
    ]);
    return res || cached;
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { c.postMessage({ open: 'balances' }); return c.focus(); }
      }
      return self.clients.openWindow('./#balances');
    })
  );
});
