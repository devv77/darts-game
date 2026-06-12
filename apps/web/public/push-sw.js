// Phase 8c — push handlers, imported into the generated Workbox service worker.
// Payload shape: { title, body, url } (see apps/server/src/push.ts).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* non-JSON */ }
  const title = data.title || 'Darts Counter';
  const options = {
    body: data.body || '',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.url || 'darts',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
