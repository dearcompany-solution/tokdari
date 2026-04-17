self.addEventListener('install',e=>self.skipWaiting());

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).catch(()=>new Response('오프라인',{status:503})));
});

self.addEventListener('push',e=>{
  const data=e.data?e.data.json():{title:'톡다리',body:'선톡 왔어!'};
  e.waitUntil(
    self.registration.showNotification(data.title||'톡다리',{
      body:data.body||'선톡 왔어!',
      icon:'/icon.png',
      badge:'/icon.png',
      vibrate:[300,100,300,100,300],
      tag:'tokdari-ping',
      renotify:true,
      requireInteraction:true,
      silent:false,
      sound:'/icon.png',
      data:{url:data.url||self.location.origin}
    })
  );
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(clientList=>{
      for(const client of clientList){
        if(client.url.includes(self.location.origin)&&'focus' in client)return client.focus();
      }
      if(clients.openWindow)return clients.openWindow('/');
    })
  );
});

// 백그라운드 sync - 앱 꺼져도 유지
self.addEventListener('sync',e=>{
  if(e.tag==='tokdari-ping')e.waitUntil(Promise.resolve());
});
