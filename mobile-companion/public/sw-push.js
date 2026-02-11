// Service worker push event handlers.
// This file is loaded alongside the PWA service worker.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Instruction Engine';
  const options = {
    body: data.body || 'New notification',
    icon: data.icon || '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    data: data.url || '/',
    tag: data.tag || 'ie-notification',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      if (windowClients.length > 0) {
        windowClients[0].focus();
        windowClients[0].navigate(event.notification.data);
      } else {
        clients.openWindow(event.notification.data);
      }
    }),
  );
});
