/* Interview OS service worker: offline app shell + notification handling.
 * Firestore stays the source of truth; this only caches static files.
 * The build script replaces 202609261825 so each release gets a fresh cache. */
const CACHE = 'ios-shell-__BUILD__';
const SHELL = ["./","./chunk-2HPXJQYK.js","./chunk-2OBLP3A3.js","./chunk-3ALAVVXW.js","./chunk-3CMYNSUC.js","./chunk-3JQQGEKE.js","./chunk-3XLRBO6P.js","./chunk-4G3PKQQE.js","./chunk-4GOXUHZ2.js","./chunk-4LZ7NJCK.js","./chunk-543J3DXV.js","./chunk-543Y3SUZ.js","./chunk-5ELS257C.js","./chunk-5TZ7ZUOK.js","./chunk-6CRGU5JE.js","./chunk-6VPKJ24K.js","./chunk-7CGTOI24.js","./chunk-AM2IZU5O.js","./chunk-BADA7RLK.js","./chunk-CASCYT27.js","./chunk-CZOGWGR4.js","./chunk-DHCEYTKQ.js","./chunk-FWTOJLEN.js","./chunk-G4UG4LZY.js","./chunk-HFQ3ENHS.js","./chunk-JKO6CEQK.js","./chunk-JXR5NJI7.js","./chunk-KE6TO6GD.js","./chunk-KPLFXXMN.js","./chunk-KZ5BHXJQ.js","./chunk-LD7SKGCR.js","./chunk-NJ7YOYJM.js","./chunk-OQRVMCO6.js","./chunk-OV35L3WL.js","./chunk-PKB4GFOC.js","./chunk-QHWMRQXG.js","./chunk-QLS456J4.js","./chunk-RPHNBV6Q.js","./chunk-RSOKPAQQ.js","./chunk-U3APIOBK.js","./chunk-WEVXLI2M.js","./chunk-WTNAWN4G.js","./chunk-XCYK2TFP.js","./chunk-YAHOFA2N.js","./chunk-YC2NDVWH.js","./chunk-YNWO4U5L.js","./chunk-Z3YFLP64.js","./chunk-ZFCIYMC5.js","./icons/apple-touch-icon-180.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./index.html","./main-X5YBM2VB.js","./manifest.webmanifest","./styles-63KD4RLL.css"];

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
