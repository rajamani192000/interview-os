/* Interview OS service worker: offline app shell + notification handling.
 * Firestore stays the source of truth; this only caches static files.
 * The build script replaces 202609261914 so each release gets a fresh cache. */
const CACHE = 'ios-shell-__BUILD__';
const SHELL = ["./","./chunk-2BXQN3C5.js","./chunk-2XJVJTRG.js","./chunk-34K7JQLT.js","./chunk-3LRRAUK4.js","./chunk-4BLUKYUU.js","./chunk-4C7WBKCR.js","./chunk-4G3PKQQE.js","./chunk-4JKOV5Y7.js","./chunk-543J3DXV.js","./chunk-6N7I43NR.js","./chunk-6VPKJ24K.js","./chunk-7CGTOI24.js","./chunk-7HEBKYQX.js","./chunk-ABET3QSM.js","./chunk-AM2IZU5O.js","./chunk-BOJLA26K.js","./chunk-CNOQQPK7.js","./chunk-CSUDX32A.js","./chunk-DB7VC227.js","./chunk-DPFBENXA.js","./chunk-DTUJUL7V.js","./chunk-E7IEU3KQ.js","./chunk-FKGPGDPX.js","./chunk-GXGUT4RM.js","./chunk-JDPITVNM.js","./chunk-KROYGL7Y.js","./chunk-LD7SKGCR.js","./chunk-LE4BEHEH.js","./chunk-MERQAOPT.js","./chunk-N5IXJSMP.js","./chunk-OAASBNSS.js","./chunk-PLBD5JKR.js","./chunk-PNV62EQ4.js","./chunk-PTJXBHEC.js","./chunk-PUU2PWSD.js","./chunk-QA37L7DV.js","./chunk-RGM4I5NL.js","./chunk-RQSKSVEH.js","./chunk-RSOKPAQQ.js","./chunk-SKTPKQR5.js","./chunk-T4W3EKKT.js","./chunk-THTVOVT7.js","./chunk-TVPIMBCW.js","./chunk-UKS3LRTR.js","./chunk-V5THC6HQ.js","./chunk-VKIFKM2Z.js","./chunk-VNVHYLBD.js","./chunk-VRHBKIXT.js","./chunk-WKPJISJO.js","./chunk-YAHOFA2N.js","./chunk-ZLV422DE.js","./chunk-ZUNKQ7SX.js","./icons/apple-touch-icon-180.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./index.html","./main-JDQWFJYB.js","./manifest.webmanifest","./styles-63KD4RLL.css"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ios-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase/Google APIs are never cached here
  if (req.mode === 'navigate') {
    // network first for the app page, fall back to the cached shell (SPA routes work offline)
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  // hashed build assets: cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
});

// FCM / Web Push payload: { notification: { title, body }, data: { link } }
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { notification: { title: 'Interview OS', body: e.data && e.data.text() } }; }
  const n = d.notification || {};
  const link = (d.data && d.data.link) || 'app/today';
  e.waitUntil(self.registration.showNotification(n.title || 'Interview OS', {
    body: n.body || 'Your daily plan is ready.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'ios-reminder',
    data: { link }, actions: [{ action: 'open', title: 'Start' }, { action: 'snooze', title: 'Snooze' }],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'snooze') {
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ type: 'snooze' }))));
    return;
  }
  const target = new URL((e.notification.data && e.notification.data.link) || 'app/today', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const w = cs.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.focus(); return w.navigate(target); }
    return self.clients.openWindow(target);
  }));
});
