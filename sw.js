// 개발 중 - 캐시 비활성화 + 푸시 알림 수신
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('오프라인 상태야', { status: 503 })));
});

// 푸시 알림 수신
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: '톡다리', body: '야 어디있어?' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.png',
      badge: '/icon.png',
      vibrate: [200, 100, 200, 100, 200],
      silent: false,
      data: { url: self.location.origin }
    })
  );
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === e.notification.data?.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(e.notification.data?.url || '/');
    })
  );
});
