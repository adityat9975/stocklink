/* StockLink service worker: makes the app installable, opens offline, and shows phone notifications.
   Private data (/api/*) is never cached. App files use network-first, so updates show up immediately when online. */
const CACHE = 'stocklink-shell-v5';
const SHELL = ['/', '/style.css', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/badge-96.png',
  '/js/main.js', '/js/i18n.js', '/js/core/api.js', '/js/core/busy.js', '/js/core/data.js', '/js/core/format.js', '/js/core/html.js',
  '/js/core/live.js', '/js/core/render.js', '/js/core/session.js', '/js/core/state.js', '/js/core/device.js', '/js/ui/components.js',
  '/js/ui/modals.js', '/js/ui/shell.js', '/js/features/admin.js', '/js/features/auth.js', '/js/features/images.js',
  '/js/features/retailer.js', '/js/features/wholesaler.js', '/js/features/notes.js', '/js/features/chat.js', '/js/features/insights.js', '/fonts/jakarta.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((r) => r || Response.error())));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'StockLink', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'StockLink', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    tag: 'sl-' + (d.id || Date.now()), data: { tab: d.tab || '' }, vibrate: [80, 40, 80],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ type: 'open-tab', tab }); return c.focus(); } }
    return self.clients.openWindow('/' + (tab ? '?tab=' + encodeURIComponent(tab) : ''));
  }));
});
