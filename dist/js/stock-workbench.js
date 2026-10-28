import {escapeHtml as esc,icon} from './components.js';
import {mountStockPreview} from './stock-preview.js';
import {createWorkbenchRequests} from './stock-workbench-state.js';
import {percentage,time} from './data.js';

const panelLabels={business:'사업',financial:'실적',documents:'자료'};
const dimensions={BUSINESS_SEGMENT:'사업부',PRODUCT:'제품',END_MARKET:'전방시장',GEOGRAPHY:'지역',DOMESTIC_EXPORT:'수출·내수',CUSTOMER:'고객'};
const scopes={CONSOLIDATED:'연결',SEPARATE:'별도',consolidated:'연결',CFS:'연결',OFS:'별도',UNSPECIFIED:'연결·별도 미확인'};
export function safeWorkbenchLink(value,{local=false}={}){
 if(typeof value!=='string')return null;
 if(local&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\u0000-\u0020]|%5c/i.test(value)){try{const u=new URL(value,'https://moa.invalid');if(u.origin==='https://moa.invalid'&&/^\/(?:reports|stock|calendar)(?:[/?#]|$)/.test(u.pathname))return u.pathname+u.search+u.hash;}catch{return null;}}
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
const link=(url,label,{local=false}={})=>{const href=safeWorkbenchLink(url,{local});return href?`<a href="${esc(href)}" ${href.startsWith('/')?'data-nav':'target="_blank" rel="noopener noreferrer"'}>${esc(label)} ${href.startsWith('/')?'→':'↗'}</a>`:'';};
const numeric=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:2}):typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)?value.replace(/\B(?=(\d{3})+(?!\d))/g,','):null;
const when=value=>value&&Number.isFinite(Date.parse(value))?(/^\d{4}-\d{2}-\d{2}$/.test(value)?value:time(value,true)):'기준 시각 미확인';
const scope=value=>scopes[value]||'연결·별도 미확인';
const period=ds=>[ds.period?.label,scope(ds.scope),ds.denominator].filter(Boolean).join(' · ');
const readIdentity=r=>/^[a-f0-9]{64}$/.test(r?.eventId||'')&&Number.isInteger(r?.eventRevision)&&r.eventRevision>0;
export function workbenchDocumentLink(r){
 const markup=link(r.href,r.title||'제목 미제공',{local:true})||link(r.url,r.title||'제목 미제공');
 if(!markup)return `<strong>${esc(r.title||'제목 미제공')}</strong>`;
 return readIdentity(r)?markup.replace('<a ',`<a data-wb-event="${r.eventId}" data-wb-revision="${r.eventRevision}" `):markup;
}
export async function markWorkbenchDocumentRead(document,{fetcher=globalThis.fetch}={}){
 if(!readIdentity(document)||!safeWorkbenchLink(document.href||document.url,{local:true}))return false;
 const response=await fetcher('/api/research/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{id:document.eventId,revision:document.eventRevision}]}),signal:AbortSignal.timeout(15000),keepalive:true});
 if(!response.ok)throw Error('READ_STATE_FAILED');const result=await response.json();if(result.saved!==true)throw Error('READ_STATE_FAILED');return true;
}
function business(data){
 const groups=Object.entries(data.groups||{}).filter(([,g])=>g.datasets?.length),description=data.descriptions?.[0];
 return `${description?`<p class="wb-description">${esc(description.quote||'')}</p>${link(description.url,'사업 설명 근거')}`:'<p class="wb-unavailable">저장된 사업 설명을 아직 확인하지 못했습니다.</p>'}${groups.slice(0,3).map(([dimension,g])=>{const ds=g.datasets[0];return `<section class="wb-business-group"><h4>${esc(dimensions[dimension]||'공시 분류')}별 공개자료</h4><p class="wb-meta">${esc(period(ds))}</p><ul>${ds.items.filter(r=>r.metric!=='NON_DISCLOSURE').slice(0,4).map(r=>`<li><div><strong>${esc(r.label)}</strong><span>${numeric(r.percent)===null?'비중 미확인':esc(numeric(r.percent))+'%'}</span></div><small>${numeric(r.amountExact??r.amount)===null?'금액 미확인':esc(numeric(r.amountExact??r.amount)+' '+(r.unit||'단위 미확인'))} · ${r.valueOrigin==='DERIVED'?'공시 금액으로 계산':'공개자료 값'}${r.parent&&r.parent!==r.label?' · 상위 항목 '+esc(r.parent):''}</small></li>`).join('')}</ul>${link(ds.sourceUrl,'근거 공시')}<small class="wb-meta">공시 ${esc(when(ds.publishedAt))}</small></section>`;}).join('')}${groups.length?'<p class="wb-meta">공시 분류별 구성입니다. 비중을 합산하거나 100%로 다시 조정하지 않습니다.</p>':'<p class="wb-unavailable">저장된 사업·제품 매출 구성 자료가 없습니다. 비중 미확인은 0%가 아닙니다.</p>'}`;
}
function financial(data){
 const latest=data.quarterly?.at(-1)||data.annual?.at(-1),quarter=Boolean(data.quarterly?.length);
 if(!latest)return '<p class="wb-unavailable">저장된 확정 실적이 없습니다. 다른 종목 정보와 차트는 계속 확인할 수 있습니다.</p>';
 const metrics=[['revenue','매출'],['operatingIncome','영업이익'],['operatingMargin','영업이익률'],['operatingCashFlow','영업현금흐름'],['freeCashFlow','잉여현금흐름']];
 return `<h4>${esc(latest.label||latest.end)} · ${quarter?'단일 분기':'연간'}</h4><p class="wb-meta">대상기간 종료 ${esc(latest.end)} · ${esc(data.basisLabel||'공급자료 기준')}<br>이 기간 자료 조회 ${esc(when(latest.cacheRetrievedAt))}</p><dl class="wb-financial">${metrics.map(([id,title])=>{const p=latest.values?.[id];return `<div><dt>${title}</dt><dd>${Number.isFinite(p?.value)?esc(numeric(p.value)+' '+(p.unit||data.currency||'단위 미확인')):'저장 값 미제공'}${id!=='operatingMargin'&&Number.isFinite(p?.yoy)?`<small>전년 동기 대비 ${percentage(p.yoy)}</small>`:''}</dd>${p?`<small>${esc(scope(p.scope||p.basis))} · ${esc(p.basis||'회계기준 미확인')} · 발표 ${esc(when(p.filedAt))} ${link(p.url,'원문')}</small>`:''}</div>`;}).join('')}</dl>${data.fcfDefinition?`<p class="wb-meta">${esc(data.fcfDefinition)}</p>`:''}<p class="wb-meta">비교 가능한 저장 값의 전년 동기 변화만 표시합니다. 없는 분기를 채우지 않습니다.</p>`;
}
function documents(data){
 const items=data.items||[],issues=Object.entries(data.coverage||{}).filter(([,status])=>['error','restricted','mapping_error'].includes(status)).map(([kind,status])=>({reports:'리포트',filings:'공시',earnings:'실적 일정'}[kind]||'자료')+' '+({error:'연결 오류',restricted:'표시 권한 확인 필요',mapping_error:'기업 식별 정보 확인 필요'}[status]));
 return (issues.length?'<p class="wb-error" role="status">'+esc(issues.join(' · '))+'</p>':'')+(items.length?`<ul class="wb-documents">${items.slice(0,12).map(r=>`<li><div><span class="wb-document-type">${({report:'리포트',earnings:'실적',filing:'공시'}[r.kind]||'자료')}</span>${typeof r.read==='boolean'?`<span>${r.read?'읽음':'읽지 않음'}</span>`:''}${r.amended||r.badges?.length||r.eventRevision>1?'<span>정정·갱신</span>':''}</div>${workbenchDocumentLink(r)}<small>${esc(when(r.publishedAt||r.date))}${r.precision==='date'?' · 발표 시각 미확인':''} · ${esc(r.source||'출처 미확인')}</small></li>`).join('')}</ul>`:'<p class="wb-unavailable">이 종목에 연결된 저장 공시·리포트가 없습니다. 수록 자료만 표시합니다.</p>')+'<p class="wb-read-status" role="status"></p>';
}
export function workbenchPanelMarkup(state){
 if(!state)return '<p class="wb-unavailable">관심종목을 선택하면 저장 자료를 확인할 수 있습니다.</p>';
 if(state.status==='loading')return '<p class="wb-loading" role="status">선택한 종목의 저장 자료를 불러오는 중…</p>';
 if(state.status==='error')return `<p class="wb-error" role="status">${esc(state.message||state.data?.message||'자료 연결 오류')}</p><button class="secondary-button" data-wb-retry>다시 시도</button>`;
 if(['mapping_error','restricted'].includes(state.status))return `<p class="wb-unavailable">${esc(state.data?.message||(state.status==='mapping_error'?'기업 식별 정보 연결 필요':'자료 표시 권한 확인 필요'))}</p>`;
 const result=state.data||{},data=result.data||{};
 const observation=state.panel==='financial'?(data.quarterly?.at(-1)||data.annual?.at(-1)):null;
 return `${result.message?`<p class="wb-meta">${esc(result.message)}</p>`:''}${({business,financial,documents}[state.panel]||business)(data)}<p class="wb-source">${esc(result.source||data.source||'저장된 공개자료')} · 자료 기준 ${esc(when(observation?.cacheDataAsOf||observation?.end||result.dataAsOf))}<br>화면 조회 ${esc(when(result.fetchedAt))}</p>`;
}
export function workbenchRowSummary(state,view){
 if(!state)return '선택하면 저장 자료 확인';
 if(state.status==='loading')return '저장 자료 조회 중…';
 if(['error','restricted','mapping_error'].includes(state.status))return '자료 확인 필요';
 const d=state.data?.data||{};
 if(view==='financial'){const p=d.quarterly?.at(-1)||d.annual?.at(-1),r=p?.values?.revenue;return p?`${p.label||p.end} · 매출 ${Number.isFinite(r?.yoy)?percentage(r.yoy):'변화율 미제공'}`:'저장 실적 없음';}
 if(view==='business'){const g=d.groups?.PRODUCT||d.groups?.BUSINESS_SEGMENT,ds=g?.datasets?.[0],r=ds?.items?.find(r=>r.metric!=='NON_DISCLOSURE');return r?`${r.label} · ${numeric(r.percent)===null?'비중 미확인':numeric(r.percent)+'%'} · ${ds.period?.label||'기간 미확인'}`:'저장 사업 구성 없음';}
 if(view==='documents')return d.items?.[0]?.title||'저장 자료 없음';
 return '';
}

export function mountStockWorkbench(host,{initialPeriod='3m',initialPanel='business',onPeriod,onPanel,onState,onClose,onCompare}={}){
 const life=new AbortController();let selected=null,panel=initialPanel,lastState=null,active=false;
 host.classList.add('stock-workbench');
 host.innerHTML=`<div class="wb-heading"><div><span class="wb-eyebrow">선택종목</span><h3>관심종목을 선택해 주세요</h3><p class="wb-identity"></p></div><button class="icon-button" data-wb-close aria-label="선택종목 패널 닫고 목록으로">${icon('close')}</button></div><div class="wb-actions"><a class="secondary-button" data-wb-detail target="_blank" rel="noopener noreferrer" hidden>상세 새 탭 ↗</a><button class="secondary-button" data-wb-compare hidden>비교에 추가</button></div><div class="wb-chart"></div><div class="wb-tabs" role="tablist" aria-label="선택종목 저장 자료">${Object.entries(panelLabels).map(([key,label])=>`<button role="tab" data-wb-panel="${key}" aria-selected="${key===panel}">${label}</button>`).join('')}</div><section class="wb-content" role="tabpanel" aria-label="${panelLabels[panel]}">${workbenchPanelMarkup(null)}</section>`;
 const $=s=>host.querySelector(s),preview=mountStockPreview($('.wb-chart'),{initialPeriod,onPeriod});
 preview.clear();
 const loader=createWorkbenchRequests({onState(state){lastState=state;$('.wb-content').setAttribute('aria-busy',String(state.status==='loading'));$('.wb-content').innerHTML=workbenchPanelMarkup(state);onState?.(state);}});
 function renderTabs(){host.querySelectorAll('[data-wb-panel]').forEach(b=>{const yes=b.dataset.wbPanel===panel;b.setAttribute('aria-selected',String(yes));b.tabIndex=yes?0:-1;});$('.wb-content').setAttribute('aria-label',panelLabels[panel]);}
 function identity(stock){$('.wb-heading h3').textContent=stock?.name||stock?.ticker||'관심종목을 선택해 주세요';$('.wb-identity').textContent=stock?[stock.ticker,stock.market==='US'?'미국':'국내',stock.exchange,stock.currency].filter(Boolean).join(' · '):'';const a=$('[data-wb-detail]');a.hidden=!stock;a.href=stock?'/stock/'+stock.market+'/'+encodeURIComponent(stock.id||stock.ticker):'#';$('[data-wb-compare]').hidden=!stock||!onCompare;}
 function choosePanel(value){if(!panelLabels[value]||panel===value&&lastState)return;panel=value;renderTabs();onPanel?.(panel);if(selected&&active)void loader.select(selected,panel);}
 const pendingReads=new Set();
 async function openedDocument(event){
  if(event.type==='auxclick'&&event.button!==1)return;
  const a=event.target.closest('a[data-wb-event]');if(!a||!host.contains(a))return;
  const row=lastState?.panel==='documents'?lastState.data?.data?.items?.find(r=>r.eventId===a.dataset.wbEvent&&r.eventRevision===Number(a.dataset.wbRevision)):null;
  if(!row||row.read===true)return;const readKey=row.eventId+':'+row.eventRevision;if(pendingReads.has(readKey))return;
  const stateKey=lastState.key;pendingReads.add(readKey);
  try{if(await markWorkbenchDocumentRead({...row,href:a.getAttribute('href')})){if(!life.signal.aborted&&lastState?.key===stateKey){row.read=true;$('.wb-content').innerHTML=workbenchPanelMarkup(lastState);onState?.(lastState);}}}
  catch{if(!life.signal.aborted&&lastState?.key===stateKey&&$('.wb-read-status'))$('.wb-read-status').textContent='자료는 열었지만 읽음 상태를 저장하지 못했습니다. 다시 열면 재시도합니다.';}
  finally{pendingReads.delete(readKey);}
 }
 host.addEventListener('click',openedDocument,{signal:life.signal});host.addEventListener('auxclick',openedDocument,{signal:life.signal});
 host.addEventListener('click',event=>{if(event.target.closest('[data-wb-close]'))onClose?.();const b=event.target.closest('[data-wb-panel]');if(b)choosePanel(b.dataset.wbPanel);if(event.target.closest('[data-wb-retry]')&&selected)void loader.select(selected,panel,{force:true});if(event.target.closest('[data-wb-compare]')&&selected)onCompare?.(selected);},{signal:life.signal});
 host.addEventListener('keydown',event=>{const b=event.target.closest('[data-wb-panel]');if(!b||event.isComposing||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const keys=Object.keys(panelLabels),next=keys[(keys.indexOf(panel)+(event.key==='ArrowRight'?1:2))%3];choosePanel(next);host.querySelector('[data-wb-panel="'+next+'"]').focus();},{signal:life.signal});
 renderTabs();
 return {
  select(stock,{open=true}={}){const changed=!selected||selected.key!==stock?.key||selected.id!==stock?.id;selected=stock;active=open;identity(stock);if(!stock){loader.cancel();preview.clear();lastState=null;$('.wb-content').innerHTML=workbenchPanelMarkup(null);return;}if(changed){lastState=null;$('.wb-content').innerHTML=workbenchPanelMarkup({status:'loading'});}if(active){preview.select(stock,true);if(changed||!lastState)void loader.select(stock,panel);}else if(changed){loader.cancel();preview.loading();}},
  setPanel:choosePanel,setPeriod:period=>preview.setPeriod(period),
  setVisible(value){const returning=value&&!active;active=value;if(!value){loader.cancel();}else if(selected){preview.select(selected,true);if(!lastState||lastState.status==='loading'||returning&&panel==='documents')void loader.select(selected,panel,{force:returning&&panel==='documents'});}},
  clear(){selected=null;lastState=null;loader.clear();preview.clear();identity(null);$('.wb-content').innerHTML=workbenchPanelMarkup(null);},
  destroy(){life.abort();loader.destroy();preview.destroy();},stats:()=>loader.stats()
 };
}
