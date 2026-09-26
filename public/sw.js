/* Interview OS service worker: offline app shell + notification handling.
 * Firestore stays the source of truth; this only caches static files.
 * The build script replaces __BUILD__ so each release gets a fresh cache. */
const CACHE = 'ios-shell-__BUILD__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

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
