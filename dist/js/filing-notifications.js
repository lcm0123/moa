import {readWatchlist} from './watchlist.js';
import {escapeHtml as esc} from './components.js';
import {browserPushState} from './notification-model.js';
const time=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'미제공';
const bell='<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>';
const keyBytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function mountFilingNotifications(host,{navigate}){
 const button=document.createElement('button');button.className='notification-bell';button.setAttribute('aria-label','관심종목 알림');button.setAttribute('aria-haspopup','dialog');host.prepend(button);
 const dialog=document.createElement('dialog');dialog.className='filing-notification-dialog';dialog.setAttribute('aria-label','관심종목 알림함');dialog.innerHTML='<div class="research-heading"><h2>관심종목 알림</h2><button data-action="close" aria-label="알림함 닫기">닫기</button></div><p class="research-note">이 브라우저의 관심종목 · 리포트와 공시</p><div class="notification-toolbar"><div role="group" aria-label="알림 분류">'+[['all','전체'],['report','리포트'],['filing','공시']].map(([v,l])=>'<button data-filter="'+v+'" aria-pressed="'+(v==='all')+'">'+l+'</button>').join('')+'</div><button data-action="read-all">모두 읽음</button></div><details class="notification-settings"><summary>알림 설정</summary><label><input type="checkbox" name="reports"> 새 종목 리포트</label><label>공시 알림<select name="filings"><option value="all">모든 공시</option><option value="major">주요 공시만</option><option value="none">공시 끄기</option></select></label><p class="research-note">주요 공시: 정기·실적 및 주요사항·발행. 설정은 이후 수집 자료부터 적용됩니다.</p><button data-action="save-settings">설정 저장</button><label><input type="checkbox" role="switch" name="push"> 브라우저 알림 받기</label><p class="notification-push-state"></p></details><p class="notification-status" role="status"></p><div class="notification-list"></div><button data-action="more" hidden>이전 알림 더 보기</button>';document.body.append(dialog);
 const toast=document.createElement('div');toast.className='notification-toast';toast.setAttribute('role','status');toast.hidden=true;document.body.append(toast);
 const life=new AbortController();let items=[],type='all',data=null,busy=false,again=false,nextOffset=null,initial=true,lastSeen=Date.now(),timer,toastTimer,pushActive=false,settingsDirty=false;
 const $=s=>dialog.querySelector(s);
 dialog.id='watch-notification-popup';button.setAttribute('aria-controls',dialog.id);button.setAttribute('aria-expanded','false');
 function positionPopup(){
  const header=button.closest('header')?.getBoundingClientRect(),anchor=button.getBoundingClientRect();
  const top=Math.min(Math.max(anchor.bottom,header?.bottom||0)+10,Math.max(12,innerHeight-180));
  dialog.style.top=top+'px';dialog.style.maxHeight=Math.max(120,innerHeight-top-16)+'px';toast.style.top=top+'px';
 }
 function closePopup(restoreFocus=false){if(dialog.open)dialog.close();button.setAttribute('aria-expanded','false');if(restoreFocus)button.focus();}
 function openPopup(){positionPopup();toast.hidden=true;clearTimeout(toastTimer);if(!dialog.open)dialog.show();button.setAttribute('aria-expanded','true');$('[data-action=close]').focus();refresh();}
 dialog.addEventListener('close',()=>button.setAttribute('aria-expanded','false'),{signal:life.signal});
 document.addEventListener('pointerdown',e=>{if(dialog.open&&!dialog.contains(e.target)&&!button.contains(e.target))closePopup();},{signal:life.signal});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dialog.open){e.preventDefault();e.stopImmediatePropagation();closePopup(true);}},{signal:life.signal,capture:true});
 addEventListener('resize',positionPopup,{signal:life.signal});
 async function api(path='',body,method=body?'POST':'GET'){const r=await fetch('/api/notifications'+path,{method,signal:AbortSignal.any([life.signal,AbortSignal.timeout(10000)]),...(method!=='GET'?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}:{})});const d=await r.json();if(!r.ok)throw Error(d.message||'알림 연결 오류');return d;}
 function render(){
  const unread=data?.unread||0;button.innerHTML=bell+(unread?'<span class="notification-count">'+(unread>99?'99+':unread)+'</span>':'');button.setAttribute('aria-label','관심종목 알림'+(unread?' · 읽지 않음 '+unread+'개':''));
  $('.notification-list').innerHTML=items.length?items.map(e=>'<article class="notification-entry '+(e.unread?'is-unread':'')+'"><a href="'+esc(e.href)+'" data-notification="'+e.id+'"><strong>'+esc(e.name)+' · 새 '+(e.source==='earnings'?'실적 변화':e.kind==='report'?'리포트':'공시')+'</strong><span>'+esc(e.sourceLabel)+' · '+esc(e.title)+'</span>'+(e.supplement?'<small class="notification-supplement">'+esc(e.supplement)+'</small>':'')+'<small>'+esc(e.publicationLabel||'발행')+': '+(e.publishedAt?time(e.publishedAt):esc(e.publishedDate||'미제공')+' · 일자 기준')+'</small><small>사이트 수집: '+time(e.collectedAt)+'</small></a><button data-read="'+e.id+'" '+(e.unread?'':'disabled')+'>'+(e.unread?'읽음 처리':'읽음')+'</button></article>').join(''):'<p class="research-empty">새 알림이 없습니다. 관심종목 등록 전 자료는 알리지 않습니다.</p>';
  $('[data-action=more]').hidden=nextOffset===null;
  if(data&&!settingsDirty){$('[name=reports]').checked=data.settings.reports;$('[name=filings]').value=data.settings.filings;}
 }
 async function pushStatus(){
  const supported=browserPushState({secure:window.isSecureContext,notification:'Notification' in window,worker:'serviceWorker' in navigator,push:'PushManager' in window,permission:typeof Notification==='undefined'?'unsupported':Notification.permission,serverReady:!!data?.push.ready});
  pushActive=false;
  if(supported.available){const registration=await navigator.serviceWorker.getRegistration('/notification-sw.js');pushActive=!!(await registration?.pushManager.getSubscription());}
  $('[name=push]').checked=pushActive&&!!data?.push.subscriptions;$('[name=push]').disabled=!supported.available;
  $('.notification-push-state').textContent=supported.message||(pushActive?'브라우저를 닫아도 새 자료를 알립니다. 오래된 자료는 푸시하지 않습니다.':'켜면 브라우저 권한을 요청합니다. 사이트 내 알림은 항상 사용할 수 있습니다.');
 }
 function dismissToast(){toast.hidden=true;clearTimeout(toastTimer);}
 function scheduleToast(){clearTimeout(toastTimer);toastTimer=setTimeout(dismissToast,7000);}
 function showToast(events){const e=events[0];if(!e||dialog.open)return;positionPopup();toast.innerHTML='<button class="notification-toast-open" aria-label="새 알림 확인"><span class="notification-toast-label">새 알림</span><strong>'+esc(e.name)+' · '+(e.source==='earnings'?'실적 변화':e.kind==='report'?'리포트':'공시')+(events.length>1?' 외 '+(events.length-1)+'건':'')+'</strong><small>'+esc(e.title)+'</small><span class="notification-toast-more">알림 확인 →</span></button><button class="notification-toast-close" data-toast-dismiss aria-label="새 알림 안내 닫기">×</button>';toast.hidden=false;scheduleToast();}
 toast.addEventListener('pointerenter',()=>clearTimeout(toastTimer),{signal:life.signal});toast.addEventListener('pointerleave',scheduleToast,{signal:life.signal});toast.addEventListener('focusin',()=>clearTimeout(toastTimer),{signal:life.signal});toast.addEventListener('focusout',scheduleToast,{signal:life.signal});
 async function refresh(syncWatch=false,append=false){
  if(busy){again=true;return;}busy=true;
  try{
   if(syncWatch)await api('/watchlist',{keys:readWatchlist()});
   const d=await api('?type='+type+'&offset='+(append?nextOffset||0:0));
   const recent=d.recent||d.items;const fresh=recent.filter(e=>e.unread&&Date.parse(e.createdAt)>lastSeen);lastSeen=Math.max(lastSeen,...recent.map(e=>Date.parse(e.createdAt)||0));
   if(!initial&&!document.hidden)showToast(fresh);initial=false;data=d;items=append?[...items,...d.items]:d.items;nextOffset=d.nextOffset;render();
   $('.notification-status').textContent=!d.workerActive?'알림 작업자 연결 대기 · 기존 알림 표시':d.processingDelayed?'일부 자료의 알림 처리가 지연되고 있습니다.':d.delayed.length?'일부 관심종목의 공시 수집이 지연되고 있습니다.':'';
   if(dialog.open)await pushStatus();
  }catch(e){$('.notification-status').textContent=e.message+' · 이전 알림 유지';}
  finally{busy=false;if(again&&!life.signal.aborted){again=false;refresh(true);}}
 }
 async function read(ids,all=false){await api('/read',all?{all:true}:{ids});if(all){for(const e of items)e.unread=false;if(data)data.unread=0;}else for(const e of items)if(ids.includes(e.id)&&e.unread){e.unread=false;if(data)data.unread=Math.max(0,data.unread-1);}render();}
 button.addEventListener('click',()=>dialog.open?closePopup(true):openPopup(),{signal:life.signal});toast.addEventListener('click',e=>{if(e.target.closest('[data-toast-dismiss]'))dismissToast();else if(e.target.closest('.notification-toast-open'))openPopup();},{signal:life.signal});
 dialog.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');if(!target)return;
  try{
   if(target.dataset.filter){type=target.dataset.filter;for(const b of dialog.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===target));nextOffset=null;await refresh();}
   else if(target.dataset.notification){if(event.ctrlKey||event.metaKey||event.shiftKey)return;event.preventDefault();const item=items.find(i=>i.id===target.dataset.notification);await read([item.id]);closePopup();navigate(item.href);}
   else if(target.dataset.read)await read([target.dataset.read]);
   else if(target.dataset.action==='close')closePopup(true);
   else if(target.dataset.action==='read-all')await read([],true);
   else if(target.dataset.action==='more')await refresh(false,true);
   else if(target.dataset.action==='save-settings'){await api('/settings',{reports:$('[name=reports]').checked,filings:$('[name=filings]').value});settingsDirty=false;await refresh();}
  }catch(e){$('.notification-status').textContent=e.message;}
 },{signal:life.signal});
 dialog.addEventListener('change',async e=>{
  if(['reports','filings'].includes(e.target.name)){settingsDirty=true;return;}if(e.target.name!=='push')return;
  const enabled=e.target.checked;e.target.disabled=true;
  try{
   if(!enabled){const reg=await navigator.serviceWorker.getRegistration('/notification-sw.js'),sub=await reg?.pushManager.getSubscription();await api('/push',sub?{endpoint:sub.endpoint}:{},'DELETE');await sub?.unsubscribe();}
   else{
    // The only permission request: a user's explicit switch activation.
    if(await Notification.requestPermission()!=='granted')throw Error('브라우저 알림이 허용되지 않았습니다. 사이트 내 알림은 계속 사용할 수 있습니다.');
    const reg=await navigator.serviceWorker.register('/notification-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(data.push.publicKey)});
    try{await api('/push',sub.toJSON());}catch(error){await sub.unsubscribe();throw error;}
   }
   await refresh();
  }catch(error){$('.notification-status').textContent=error.message;e.target.checked=false;}
  finally{await pushStatus();}
 },{signal:life.signal});
 addEventListener('moa-watchlist',()=>refresh(true),{signal:life.signal});addEventListener('storage',()=>refresh(true),{signal:life.signal});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);},{signal:life.signal});
 const poll=()=>{if(!document.hidden)refresh();timer=setTimeout(poll,15000);};const ready=refresh(true);timer=setTimeout(poll,15000);render();
 const destroy=()=>{life.abort();clearTimeout(timer);clearTimeout(toastTimer);dialog.remove();button.remove();toast.remove();};return {ready,destroy};
}

