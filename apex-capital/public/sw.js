// Network-first for navigation, cache-first for hashed assets, Web Push for fills.
const CACHE = 'liquidated-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; })));
});

// Server push (TP / SL / stop-out / pending fill forecast while the app is closed)
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Liquidated', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Liquidated';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // the app is on screen: it shows its own toast
      if (wins.some((w) => w.visibilityState === 'visible')) return;
      return self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || undefined,
        icon: './icon-192.png',
        badge: './icon-192.png',
        data: { url: './' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins[0];
      if (w) return w.focus();
      return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
    }),
  );
});
