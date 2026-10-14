/* DMS Rota v1.0.158 · notificações operacionais */
self.addEventListener('install',(event)=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',(event)=>{event.waitUntil(self.clients.claim());});
self.addEventListener('notificationclick',(event)=>{
  event.notification.close();
  const data=event.notification.data||{};
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const own=windows.find((client)=>{try{return new URL(client.url).origin===self.location.origin;}catch{return false;}});
    if(own){
      await own.focus();
      own.postMessage({type:'DMS_OPEN_ROUTE',route:data.route||'route_pending',occurrenceKey:data.occurrenceKey||''});
      return;
    }
    const opened=await self.clients.openWindow('/');
    if(opened)opened.postMessage({type:'DMS_OPEN_ROUTE',route:data.route||'route_pending',occurrenceKey:data.occurrenceKey||''});
  })());
});
