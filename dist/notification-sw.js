// Notification-only service worker: never intercepts market/API data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function storage(){return new Promise((resolve,reject)=>{const r=indexedDB.open('moa-push-receipts',1);r.onupgradeneeded=()=>r.result.createObjectStore('seen');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function seen(id,write=false){const db=await storage();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('seen',write?'readwrite':'readonly'),store=tx.objectStore('seen'),req=write?store.put(Date.now(),id):store.get(id);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function prune(){const db=await storage();try{await new Promise((resolve,reject)=>{const tx=db.transaction('seen','readwrite'),r=tx.objectStore('seen').openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(c.value<Date.now()-7*86400000)c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let d;try{d=event.data.json();}catch{return;}if(!/^[a-f0-9]{64}$/.test(d.id)||typeof d.href!=='string'||!/^\/(?:reports\?|stock\/(?:KR|US)\/)/.test(d.href))return;
 if(await seen(d.id))return;
 await self.registration.showNotification(String(d.title).slice(0,120),{body:String(d.body).slice(0,240),tag:'moa-'+d.id,renotify:false,data:{id:d.id,href:d.href}});await seen(d.id,true);await prune();
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();const {href,id}=event.notification.data||{};
 event.waitUntil((async()=>{const url=new URL(href||'/',self.location.origin);if(url.origin!==self.location.origin)return;
  try{await fetch('/api/notifications/read',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})});}catch{}
  const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});const tab=tabs.find(c=>new URL(c.url).origin===url.origin);
  if(tab){await tab.navigate(url.href);await tab.focus();}else await self.clients.openWindow(url.href);
 })());
});
