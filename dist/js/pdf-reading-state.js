// Server-owned, version-scoped state. No private reading data is placed in URLs/storage.
export function mountPdfReadingState({url,root,getAnchor,restore,signal}){
 let ready=false,revision=0,version=null,bookmarks=[],timer=null,pending=null,saving=false,closed=false;
 const status=root.querySelector('.pdf-reading-status'),list=root.querySelector('.pdf-bookmark-list');
 const point=a=>a&&Number.isInteger(a.page)&&Number.isFinite(a.x)&&Number.isFinite(a.y)?{page:a.page,x:a.x,y:a.y}:null;
 function render(){list.replaceChildren();if(!bookmarks.length){list.textContent='저장한 북마크가 없습니다.';return;}for(const mark of bookmarks){const b=document.createElement('button');b.type='button';b.textContent=mark.page+'페이지';b.addEventListener('click',()=>restore(mark),{signal});list.append(b);}}
 async function load(){ready=false;clearTimeout(timer);pending=null;try{const r=await fetch(url,{signal,cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.message);if(closed)return;version=d.version;revision=d.revision;bookmarks=d.state?.bookmarks||[];render();if(d.state?.anchor)await restore(d.state.anchor);if(closed)return;ready=true;status.textContent=d.previousVersionAvailable&&!d.state?'원문 버전이 변경되어 이전 북마크·위치를 적용하지 않았습니다.':d.state?'읽던 위치를 복원했습니다.':'문서를 읽으면 위치가 저장됩니다.';changed();}catch(e){if(!signal.aborted)status.textContent=e.message||'위치 저장을 사용할 수 없습니다. PDF는 계속 볼 수 있습니다.';}}
 async function drain(keepalive=false){
  if(saving||!pending||!ready)return;saving=true;const state=pending;pending=null;
  try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,revision,state}),keepalive}),d=await r.json();if(!r.ok){ready=false;throw Error(d.message);}revision=d.revision;globalThis.dispatchEvent(new CustomEvent('moa-document-read',{detail:{url,version}}));if(!closed)status.textContent='읽던 위치·북마크 저장됨';}
  catch(e){if(!closed)status.textContent=e.message||'저장 실패 · 다시 불러오기로 복구해 주세요.';}
  finally{saving=false;if(pending&&ready)void drain(keepalive||closed);}
 }
 function changed(){if(!ready||closed)return;const anchor=point(getAnchor());if(!anchor)return;pending={anchor,bookmarks:bookmarks.map(x=>({...x}))};clearTimeout(timer);timer=setTimeout(()=>void drain(),650);}
 root.addEventListener('click',e=>{if(e.target.closest('[data-pdf-reading-retry]')){if(!saving)void load();}if(e.target.closest('[data-pdf-bookmark]')){if(!ready){status.textContent='위치 저장 연결을 먼저 다시 불러와 주세요.';return;}const p=point(getAnchor());if(!p)return;const found=bookmarks.some(b=>b.page===p.page);if(!found&&bookmarks.length>=30){status.textContent='북마크는 문서당 30개까지 저장할 수 있습니다.';return;}bookmarks=found?bookmarks.filter(b=>b.page!==p.page):[...bookmarks,p].sort((a,b)=>a.page-b.page);render();changed();clearTimeout(timer);void drain();}},{signal});
 return {load,changed,close(){if(closed)return;changed();clearTimeout(timer);closed=true;void drain(true);}};
}
