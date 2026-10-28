import {readWatchlist,moveWatchlist,toggleWatchlist,WATCHLIST_KEY} from './watchlist.js';
import {retainWatchQuotes,sortedWatchQuotes} from './watchlist-model.js';
import {icon} from './components.js';
import {price,percentage,time,modeLabels,dailyQuoteMeta,amount} from './data.js';
import {reconcile,setText} from './market-client.js';
import {mountStockWorkbench,workbenchRowSummary} from './stock-workbench.js';
import {readWorkbenchSettings,patchWorkbenchSettings,WORKBENCH_SETTINGS_KEY,watchlistArrowKey,retainedWatchOrder} from './stock-workbench-state.js';
const direction=n=>n>0?'up':n<0?'negative':'neutral-text';
const sessionNames={pre:'장전',open:'정규장',post:'장후',premarket:'장전',regular:'정규장',aftermarket:'장후',closed:'장 마감',unknown:'장 상태 미확인'};
const columnNames={price:'현재가',change:'등락률',time:'시세 기준',turnover:'거래대금'};
const viewNames={price:'가격',financial:'실적',business:'사업',documents:'자료'};

export function mountWatchlist(host,{addStock=()=>{},notify=()=>{},onCompare}={}){
 const life=new AbortController(),signal=life.signal;
 let settings=readWorkbenchSettings(),pendingSettings={},quotes=new Map(),controller,requestId=0,visible=false,busy=false,keys=readWatchlist(),frozenOrder=null,scrollTimer,disposed=false;
 let selected=keys.includes(settings.selected)?settings.selected:keys[0]||null,panelOpen=Boolean(selected)&&(settings.panelOpen||globalThis.matchMedia?.('(max-width:700px)').matches!==true),listScroll=settings.scrollTop;
 const summaries=new Map();
 host.classList.add('watch-workspace');
 host.innerHTML=`<div class="watch-toolbar"><h3 class="watch-count"></h3><div><button class="secondary-button" data-watch="add">${icon('plus')} 종목 추가</button><button class="icon-button" data-watch="refresh" aria-label="관심종목 시세 새로고침">${icon('refresh')}</button></div></div><div class="watch-view-bar"><div class="watch-views" role="group" aria-label="관심종목 보기">${Object.entries(viewNames).map(([id,label])=>`<button data-watch-view="${id}">${label}</button>`).join('')}</div><label>시장 <select data-watch-filter aria-label="관심종목 시장"><option value="all">전체</option><option value="KR">국내</option><option value="US">미국</option></select></label><label>정렬 <select data-watch-sort aria-label="관심종목 정렬"><option value="manual">직접 설정한 순서</option><option value="gainers">일간 상승률순</option><option value="losers">일간 하락률순</option><option value="name">종목명순</option></select></label><details class="watch-column-settings"><summary>표시 항목</summary><div></div></details></div><div class="watch-save-error" role="status" hidden><span></span><button class="secondary-button" data-watch="retry-settings">다시 저장</button><button class="secondary-button" data-watch="restore-settings">저장된 설정 복구</button></div><p class="watch-order-note"></p><div class="watch-workspace-layout"><section class="watch-list-pane" aria-label="관심종목 목록"><div class="watch-table-wrap"><table class="watch-table"><thead><tr><th>종목</th>${Object.entries(columnNames).map(([id,label])=>`<th data-column="${id}">${label}</th>`).join('')}<th data-column="summary">선택 보기</th><th>목록 편집</th></tr></thead><tbody></tbody></table></div><div class="watch-empty" hidden>${icon('star')}<strong>등록된 관심종목 없음</strong><p>검색 결과의 별표로 관심종목을 추가해 주세요.</p><button class="secondary-button" data-watch="add">종목 검색하기</button></div><div class="watch-filter-empty" hidden>선택한 시장에 관심종목이 없습니다.</div></section><section class="watch-detail-pane" aria-label="관심종목 차트와 정보"></section></div><div class="watch-status" role="status" aria-live="polite"></div><div class="watch-foot"><span>이 브라우저에 목록·보기·선택 저장 · 시세는 1분마다 갱신 확인</span><details><summary>시세 표시 기준</summary><p>가격은 기존 시장 공급처의 시세입니다. 조회 시각과 체결 시각은 다릅니다. 실적·사업·자료는 선택한 종목의 저장 자료만 읽으며, 전체 관심종목을 새로 수집하지 않습니다.</p><a href="https://elite.finviz.com/help/screener" target="_blank" rel="noopener noreferrer">Finviz 표시 기준 ↗</a></details></div>`;
 const $=s=>host.querySelector(s),body=$('tbody'),status=$('.watch-status'),scroll=$('.watch-table-wrap');
 const isMobile=()=>globalThis.matchMedia?.('(max-width:700px)').matches===true;
 function save(patch){
  try{settings=patchWorkbenchSettings({...pendingSettings,...patch});pendingSettings={};$('.watch-save-error').hidden=true;return true;}
  catch{settings={...settings,...patch};pendingSettings={...pendingSettings,...patch};$('.watch-save-error').hidden=false;setText($('.watch-save-error span'),'이번 변경을 저장하지 못했습니다. 현재 화면에서는 사용할 수 있습니다.');return false;}
 }
 const workbench=mountStockWorkbench($('.watch-detail-pane'),{initialPeriod:settings.period,initialPanel:settings.panel,onPeriod:value=>save({period:value}),onPanel:value=>save({panel:value}),onCompare,onClose:closePanel,onState(state){summaries.set(state.stock.key+':'+state.panel,workbenchRowSummary(state,state.panel));while(summaries.size>40)summaries.delete(summaries.keys().next().value);renderRows();}});
 function filtered(){return keys.filter(key=>settings.filter==='all'||key.startsWith(settings.filter+':'));}
 function rows(){return retainedWatchOrder(sortedWatchQuotes(filtered(),quotes,settings.sort),frozenOrder);}
 function selectedStock(){return selected&&(quotes.get(selected)||{key:selected,market:selected.slice(0,2),ticker:selected.slice(3),status:'loading'});}
 function setOpen(value){panelOpen=value&&!!selected;host.dataset.panelOpen=String(panelOpen);$('.watch-detail-pane').hidden=!panelOpen;save({panelOpen});workbench.setVisible(visible&&panelOpen);}
 function closePanel({fromHistory=false}={}){
  if(!fromHistory&&history.state?.moaWatchPanel&&isMobile()){history.back();return;}
  setOpen(false);scroll.scrollTop=listScroll;body.querySelector('[data-watch-select="'+CSS.escape(selected||'')+'"]')?.focus({preventScroll:true});
 }
 function select(key,{user=false,focus=false}={}){
  if(!keys.includes(key))return;listScroll=scroll.scrollTop;selected=key;panelOpen=true;save({selected,scrollTop:listScroll,panelOpen:true});
  host.dataset.panelOpen='true';$('.watch-detail-pane').hidden=false;
  workbench.select(selectedStock(),{open:visible});renderRows();
  if(user&&isMobile()){
   if(!history.state?.moaWatchPanel)history.pushState({...history.state,moaWatchPanel:true},'',location.href);
   $('.watch-detail-pane [data-wb-close]').focus({preventScroll:true});$('.watch-detail-pane').scrollIntoView({block:'start'});
  }else if(focus){const button=body.querySelector('[data-watch-select="'+CSS.escape(key)+'"]');button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest'});}
 }
 function renderColumns(){
  const order=[...settings.columns,...Object.keys(columnNames).filter(k=>!settings.columns.includes(k))];
  const header=host.querySelector('thead tr');for(const key of order)header.insertBefore(header.querySelector('[data-column="'+key+'"]'),header.querySelector('[data-column="summary"]'));
  host.querySelectorAll('[data-column]').forEach(cell=>{const k=cell.dataset.column;cell.hidden=k==='summary'?settings.view==='price':settings.view!=='price'||!settings.columns.includes(k);});
  host.dataset.watchView=settings.view;
 }
 function renderRows(){
  const currentRows=rows();
  reconcile(body,currentRows,r=>r.key,()=>{const row=document.createElement('tr');row.innerHTML='<td class="watch-name"><button data-watch-select><strong></strong><small></small></button></td><td data-column="price" class="watch-price"><strong></strong><small></small></td><td data-column="change" class="watch-percent"></td><td data-column="time" class="watch-meta"><span></span><small></small></td><td data-column="turnover" class="watch-turnover"></td><td data-column="summary" class="watch-summary"></td><td class="watch-controls"><a class="icon-button" data-watch-detail target="_blank" rel="noopener noreferrer" title="상세 새 탭">↗</a><button class="icon-button" data-watch="up">↑</button><button class="icon-button" data-watch="down">↓</button><button class="icon-button" data-watch="remove">'+icon('close')+'</button></td>';return row;},(row,s)=>{
   const ready=s.status==='ready',name=s.name||s.ticker,button=row.querySelector('[data-watch-select]');button.dataset.watchSelect=s.key;button.setAttribute('aria-label',name+' 차트와 정보 선택');button.setAttribute('aria-pressed',String(s.key===selected));button.tabIndex=selected===s.key||!currentRows.some(x=>x.key===selected)&&currentRows[0]?.key===s.key?0:-1;
   row.classList.toggle('is-selected',s.key===selected);setText(button.querySelector('strong'),name);setText(button.querySelector('small'),s.ticker+' · '+(s.market==='US'?'미국':'국내'));
   const detail=row.querySelector('[data-watch-detail]');detail.href='/stock/'+s.market+'/'+encodeURIComponent(s.id||s.ticker);detail.setAttribute('aria-label',name+' 상세 새 탭');
   setText(row.querySelector('.watch-price strong'),ready?price(s):s.status==='loading'?'조회 중…':'시세 미제공');setText(row.querySelector('.watch-price small'),s.currency||'');
   const percent=row.querySelector('.watch-percent');percent.className='watch-percent '+direction(s.changePct);setText(percent,ready&&Number.isFinite(s.changePct)?percentage(s.changePct):'등락률 미제공');
   const meta=row.querySelector('.watch-meta');setText(meta.querySelector('span'),ready?((s.stale?'갱신 실패 · 마지막 ':'')+(s.mode==='snapshot'?'조회값':modeLabels[s.mode]||'조회값')):s.reason||'시세 확인 중');setText(meta.querySelector('small'),ready?(s.baseDate?dailyQuoteMeta(s):s.asOf?(s.asOfKind==='received'?'조회 ':'시세 기준 ')+time(s.asOf,true):'기준 시각 미제공')+' · '+(sessionNames[s.session]||'장 상태 미확인'):'');
   setText(row.querySelector('.watch-turnover'),Number.isFinite(s.turnover)?amount(s.turnover,s.currency):'미제공');
   setText(row.querySelector('.watch-summary'),summaries.get(s.key+':'+settings.view)||'선택하면 저장 자료 확인');
   const pos=keys.indexOf(s.key);for(const [action,label]of [['up','위로 이동'],['down','아래로 이동'],['remove','관심종목 해제']]){const b=row.querySelector('[data-watch="'+action+'"]');b.dataset.key=s.key;b.setAttribute('aria-label',name+' '+label);b.title=label;b.disabled=action==='up'?(settings.sort!=='manual'||pos===0):action==='down'?(settings.sort!=='manual'||pos===keys.length-1):false;}
   const ordered=[...settings.columns,...Object.keys(columnNames).filter(k=>!settings.columns.includes(k))];for(const id of ordered)row.insertBefore(row.querySelector('[data-column="'+id+'"]'),row.querySelector('[data-column="summary"]'));
  });
  renderColumns();$('.watch-filter-empty').hidden=!keys.length||currentRows.length>0;
 }
 function columnSettings(){const order=[...settings.columns,...Object.keys(columnNames).filter(k=>!settings.columns.includes(k))];$('.watch-column-settings>div').innerHTML=order.map((id,i)=>`<label><input type="checkbox" data-watch-column="${id}" ${settings.columns.includes(id)?'checked':''}>${columnNames[id]}<button type="button" data-column-move="${id}" ${i===0?'disabled':''} aria-label="${columnNames[id]} 열 앞으로">←</button></label>`).join('');}
 function render(){
  setText($('.watch-count'),'관심종목 '+keys.length+'개');$('.watch-empty').hidden=keys.length>0;scroll.hidden=!keys.length;host.querySelectorAll('button[data-watch-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.watchView===settings.view)));$('[data-watch-sort]').value=settings.sort;$('[data-watch-filter]').value=settings.filter;
  setText($('.watch-order-note'),settings.view==='price'?'종목을 선택하면 차트·기업 정보를 함께 봅니다. 목록의 ↑ ↓ 키로 이동 · 목록에 초점이 있는 동안 시세 정렬 순서 고정':'선택한 종목의 저장 자료만 확인합니다. 아직 선택하지 않은 행은 조회하지 않습니다.');
  host.dataset.panelOpen=String(panelOpen);$('.watch-detail-pane').hidden=!panelOpen;renderRows();columnSettings();
 }
 async function refresh(){
  controller?.abort();const current=new AbortController();controller=current;const version=++requestId,requested=readWatchlist();
  if(!requested.length){busy=false;keys=[];quotes.clear();selected=null;panelOpen=false;workbench.clear();render();setText(status,'');return;}
  busy=true;render();setText(status,'시세 갱신 중…');const timer=setTimeout(()=>current.abort(),20000);
  try{const response=await fetch('/api/watchlist?'+new URLSearchParams({symbols:requested.join(',')}),{signal:current.signal,cache:'no-store'});if(!response.ok)throw Error('unavailable');const data=await response.json();if(version!==requestId||disposed)return;quotes=retainWatchQuotes(quotes,data.items||[],readWatchlist());}
  catch{if(version!==requestId||disposed)return;quotes=retainWatchQuotes(quotes,[],readWatchlist());}
  finally{clearTimeout(timer);if(version===requestId&&!disposed){busy=false;render();if(selected&&panelOpen)workbench.select(selectedStock(),{open:visible});const failed=[...quotes.values()].filter(s=>s.stale||s.status!=='ready').length;setText(status,failed?failed+'개 종목의 시세를 갱신하지 못했습니다. 다시 갱신할 수 있습니다.':'');}}
 }
 function changed(){
  const old=keys,position=old.indexOf(selected);keys=readWatchlist();quotes=new Map([...quotes].filter(([key])=>keys.includes(key)));
  if(!keys.includes(selected)){selected=keys[Math.max(0,Math.min(position,keys.length-1))]||null;save({selected});if(selected&&panelOpen)workbench.select(selectedStock(),{open:visible});else if(!selected){panelOpen=false;workbench.clear();}}
  render();if(visible&&keys.some(key=>!quotes.has(key)))void refresh();
 }
 host.addEventListener('click',event=>{
  const b=event.target.closest('[data-watch]');if(b){try{const action=b.dataset.watch;if(action==='add')addStock();else if(action==='refresh')void refresh();else if(action==='retry-settings'){save({});render();}else if(action==='restore-settings'){pendingSettings={};settings=readWorkbenchSettings();$('.watch-save-error').hidden=true;workbench.setPeriod(settings.period);workbench.setPanel(settings.panel);selected=keys.includes(settings.selected)?settings.selected:keys[0]||null;panelOpen=!!selected;if(selected)workbench.select(selectedStock(),{open:visible});render();}else if(action==='remove')toggleWatchlist(b.dataset.key.slice(0,2),b.dataset.key.slice(3));else{frozenOrder=null;moveWatchlist(b.dataset.key,action==='up'?-1:1);}}catch(error){notify(error.message||'관심종목을 저장하지 못했습니다.');setText(status,error.message||'관심종목 저장 실패 · 다시 시도해 주세요.');}return;}
  const v=event.target.closest('button[data-watch-view]');if(v){save({view:v.dataset.watchView});if(settings.view!=='price')workbench.setPanel(settings.view);render();return;}
  const m=event.target.closest('[data-column-move]');if(m){const all=[...settings.columns,...Object.keys(columnNames).filter(k=>!settings.columns.includes(k))],at=all.indexOf(m.dataset.columnMove);if(at>0)[all[at-1],all[at]]=[all[at],all[at-1]];save({columns:all.filter(k=>settings.columns.includes(k))});renderRows();columnSettings();return;}
  const row=event.target.closest('tbody tr');if(row&&!event.target.closest('a,button:not([data-watch-select])')&&!event.ctrlKey&&!event.metaKey)select(row.dataset.key,{user:true,focus:true});
 },{signal});
 host.addEventListener('change',event=>{
  if(event.target.matches('[data-watch-sort]')){save({sort:event.target.value});frozenOrder=null;renderRows();}
  if(event.target.matches('[data-watch-filter]')){save({filter:event.target.value});frozenOrder=null;renderRows();}
  if(event.target.matches('[data-watch-column]')){const key=event.target.dataset.watchColumn;save({columns:event.target.checked?[...settings.columns,key]:settings.columns.filter(x=>x!==key)});renderRows();columnSettings();}
 },{signal});
 body.addEventListener('focusin',()=>{if(!frozenOrder)frozenOrder=rows().map(r=>r.key);},{signal});
 body.addEventListener('focusout',()=>queueMicrotask(()=>{if(!disposed&&!body.contains(document.activeElement)){frozenOrder=null;renderRows();}}),{signal});
 body.addEventListener('keydown',event=>{const shift=watchlistArrowKey(event);if(!shift)return;const current=rows(),position=current.findIndex(r=>r.key===event.target.closest('[data-watch-select]').dataset.watchSelect),next=current[Math.max(0,Math.min(current.length-1,position+shift))];if(next){event.preventDefault();select(next.key,{user:true,focus:true});}},{signal});
 scroll.addEventListener('scroll',()=>{listScroll=scroll.scrollTop;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>save({scrollTop:listScroll}),200);},{signal});
 addEventListener('moa-watchlist',changed,{signal});addEventListener('storage',event=>{if(event.key===WATCHLIST_KEY)changed();if(event.key===WORKBENCH_SETTINGS_KEY&&!Object.keys(pendingSettings).length){settings=readWorkbenchSettings();workbench.setPeriod(settings.period);render();}},{signal});
 addEventListener('popstate',()=>{if(location.pathname==='/'&&!history.state?.moaWatchPanel&&isMobile()&&panelOpen)closePanel({fromHistory:true});},{signal});
 const interval=setInterval(()=>{if(visible&&!document.hidden&&location.pathname==='/'&&!busy)void refresh();},60000);
 render();scroll.scrollTop=listScroll;
 return {setVisible(value){visible=value;workbench.setVisible(value&&panelOpen);if(value){changed();if(!busy)void refresh();if(selected&&panelOpen)workbench.select(selectedStock(),{open:true});}else{controller?.abort();++requestId;busy=false;save({scrollTop:listScroll});}},refresh(){if(visible)void refresh();},select:key=>select(key,{user:true,focus:true}),getSelected:()=>selected,stats:()=>({selected,quotes:quotes.size,...workbench.stats()}),destroy(){disposed=true;life.abort();controller?.abort();clearInterval(interval);clearTimeout(scrollTimer);workbench.destroy();}};
}
