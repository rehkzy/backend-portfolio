/* Service worker du dashboard — réception des notifications push */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Dashboard', body: event.data ? event.data.text() : '' }; }
    event.waitUntil(self.registration.showNotification(data.title || 'Dashboard Florian B.', {
        body: data.body || '',
        tag: data.tag || undefined,
        icon: '/dashboard/icon-192.png',
        badge: '/dashboard/icon-192.png',
        data: { url: data.url || '/dashboard/' },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/dashboard/';
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        for (const c of list) { if (c.url.includes('/dashboard') && 'focus' in c) return c.focus(); }
        return clients.openWindow(url);
    }));
});
