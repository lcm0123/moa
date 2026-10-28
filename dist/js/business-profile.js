import {escapeHtml as esc} from './components.js';
import {revenueCompositionMarkup,revenueCompositionModel} from './revenue-composition.js';
const statuses={NOT_COLLECTED:'자료 수집 전',FETCH_FAILED:'자료 확인에 실패했습니다',PARTIAL:'일부 항목만 확인',NOT_DISCLOSED:'해당 비중 미공개',STALE:'이전 공개자료 기준'};
const titles={BUSINESS_SEGMENT:'사업부별 매출',PRODUCT:'제품별 매출',END_MARKET:'고객 산업별 매출',DOMESTIC_EXPORT:'수출·내수',GEOGRAPHY:'지역별 매출',CUSTOMER:'고객별 매출'};
const scopeLabel=s=>({CONSOLIDATED:'연결 기준',SEPARATE:'별도 기준',UNSPECIFIED:'연결·별도 미기재'}[s]||'기업 범위 확인 필요');
const num=n=>typeof n==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(n)?n.split('.').map((part,i)=>i?part:part.replace(/\B(?=(\d{3})+(?!\d))/g,',')).join('.'):Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):null;
const unitLabel=u=>({'KRW trillion':'조 원','KRW billion':'십억 원','KRW million':'백만 원','USD million':'백만 USD','USD thousand':'천 USD'}[u]||u||'단위 미확인');
const href=url=>{try{return new URL(url).protocol==='https:'?url:null;}catch{return null;}};
const link=(url,label)=>href(url)?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';
export function evidenceLocationMarkup(r){
 const locator=typeof r.locator==='string'?r.locator.slice(0,200):null;
 return `<p class="bp-source-location">${link(r.sourceUrl,'이 항목 원문')}<br>${locator?'저장된 추출 위치: '+esc(locator)+'<br>':''}원문 검색어: <strong>${esc(r.label||'매출')}</strong><small>정확한 페이지·웹 섹션 이동 정보는 미확보입니다. 원문에서 검색어로 확인해 주세요.</small></p>`;
}
function dataset(ds,dimension){
 const retrieved=ds.items.map(r=>r.collectedAt).filter(Boolean).sort().at(-1),tableOnly=revenueCompositionModel(ds,dimension).tableOnly;
 return `<p class="bp-period">${esc(ds.period.label||ds.period.end||'기간 미확인')}${tableOnly?'':' · '+esc(scopeLabel(ds.scope))}${ds.correction?' · 정정 공시':''}${ds.historical?' · 이전 공개자료':''}</p>${tableOnly?'':`<p class="bp-note">${esc(ds.denominator||'공시 항목별 매출')}${ds.items.some(r=>r.denominatorKind==='SEGMENT_REVENUE')?' · 회사 전체 비중이 아닙니다.':''}</p>`}${revenueCompositionMarkup(ds,dimension,{formatAmount:num,unitLabel})}<div class="bp-source-footer"><span>자료 기준 ${esc(ds.period.end||'미확인')} · 공시일 ${esc(ds.publishedAt||'미확인')}</span>${link(ds.sourceUrl,ds.sourceTitle||'공시 원문')}${retrieved?`<small>수집 ${esc(retrieved)}</small>`:''}</div><details class="bp-evidence"><summary>항목별 근거·계산 방식</summary>${ds.items.map(r=>`<div data-bp-source-id="${esc(r.id||r.label)}" tabindex="-1"><strong>${esc(r.label)}</strong><p>${r.valueOrigin==='DERIVED'?'공시 금액으로 계산':r.basis==='RESEARCH_ESTIMATE'?'리서치 추정':'공시 직접값'}${r.shareOrigin==='DERIVED'?' · 비중은 공시 금액으로 계산':''}${r.dimension==='GEOGRAPHY'?' · '+esc(({CUSTOMER_LOCATION:'고객 소재지',BILLING_LOCATION:'청구지',SHIP_TO_LOCATION:'배송지',OPERATING_LOCATION:'영업 소재지',DISCLOSED_OTHER:'공시 분류',UNKNOWN:'지역 분류 기준 미확인'})[r.geographyBasis]||'지역 분류 기준 미확인'):''}</p>${r.scopeNotes?`<p class="bp-note">${esc(Array.isArray(r.scopeNotes)?r.scopeNotes.join(' · '):r.scopeNotes)}</p>`:''}<blockquote>${esc(r.quote||'')}</blockquote>${evidenceLocationMarkup(r)}${r.formula?`<p>계산식: ${esc(r.formula)}</p>${(r.inputs||[]).map(i=>`<p>${esc(i.period.label)} · ${esc(num(i.amountExact))} ${esc(r.unit)} · ${link(i.sourceUrl,'입력 공시')}<br><small>${esc(i.id)}</small></p>`).join('')}`:''}<small>수집 ${esc(r.collectedAt||'미확인')}${(r.totalRevenueExact??r.totalRevenue??null)!==null?' · 비교 매출 '+esc(num(r.totalRevenueExact??r.totalRevenue)+' '+unitLabel(r.unit)):''}</small></div>`).join('')}<p class="bp-note">원문 항목의 비중을 유지합니다. 사업부·제품·지역을 합산하거나 100%로 재조정하지 않습니다.</p></details>`;
}
const periodTypes=[['ALL','전체 공개자료'],['SINGLE_QUARTER','단일 분기'],['YTD','누적'],['ANNUAL','연간'],['TTM','최근 12개월']];
const dimensionOrder=['BUSINESS_SEGMENT','PRODUCT','END_MARKET','DOMESTIC_EXPORT','GEOGRAPHY','CUSTOMER'];
const tabLabels={BUSINESS_SEGMENT:'사업부',PRODUCT:'제품',END_MARKET:'고객 산업',DOMESTIC_EXPORT:'수출·내수',GEOGRAPHY:'지역',CUSTOMER:'고객'};
export function cleanBusinessProfileSelection(value){
 const input=value&&typeof value==='object'?value:{},out={};
 if(periodTypes.some(([key])=>key===input.type))out.type=input.type;
 if(dimensionOrder.includes(input.dimension))out.dimension=input.dimension;
 for(const dimension of dimensionOrder)if(typeof input[dimension]==='string'&&input[dimension].length<=1000)out[dimension]=input[dimension];
 return out;
}
function withCalculatedDatasets(data){
 const groups=structuredClone(data.groups||{}),derived=new Map();
 for(const r of [...(data.calculations?.quarters||[]),...(data.calculations?.ttm||[])].filter(x=>x.basis==='DERIVED')){
  if(!groups[r.dimension])continue;
  const key=['derived',r.dimension,r.issuer,r.tableKey,r.period.start,r.period.end,r.period.type,r.scope,r.entityScope,r.currency,r.unit,r.denominatorKind,r.denominatorLabel,r.revenueDefinition,r.revisionGroup].join('|');
  if(!derived.has(key))derived.set(key,{key,dimension:r.dimension,period:r.period,scope:r.scope,denominator:r.denominatorLabel,sourceUrl:r.sourceUrl,sourceTitle:r.sourceTitle,publishedAt:r.publishedAt,items:[]});
  derived.get(key).items.push(r);
 }
 for(const dataset of derived.values())groups[dataset.dimension].datasets.push(dataset);
 return groups;
}
export function businessProfileMarkup(data,selection={}){
 if(!data)return '<h2>사업·매출 구조</h2><p>저장된 기업 자료를 불러오는 중입니다.</p>';
 const groups=withCalculatedDatasets(data),dimensions=dimensionOrder.filter(k=>['DOMESTIC_EXPORT','GEOGRAPHY'].includes(k)||groups[k]?.datasets?.length||k==='PRODUCT'&&!groups.BUSINESS_SEGMENT?.datasets?.length);
 const selected=dimensions.includes(selection.dimension)?selection.dimension:dimensions.find(k=>groups[k]?.datasets?.length)||dimensions[0],original=groups[selected]||{status:'NOT_COLLECTED',datasets:[]};
 const datasets=original.datasets.filter(d=>!selection.type||selection.type==='ALL'||d.period.type===selection.type||selection.type==='YTD'&&d.period.type==='HALF_YEAR').sort((a,b)=>String(b.period.end||'').localeCompare(String(a.period.end||''))||Number(!!a.historical)-Number(!!b.historical)||String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))),ds=datasets.find(x=>x.key===selection[selected])||datasets[0];
 const empty=data.provider?.retryBlocked?'공시 다운로드가 복구된 뒤 수집할 수 있습니다.':original.status==='NOT_COLLECTED'?'자료 수집 전입니다.':original.status==='FETCH_FAILED'?'자료 확인에 실패했습니다. 다시 불러올 수 있습니다.':original.status==='NOT_DISCLOSED'?'해당 비중 미공개':original.datasets.length?'선택한 기간 종류의 자료가 없습니다.':'확보한 자료에서 이 항목을 아직 확인하지 못했습니다.';
 return `<div class="research-heading"><div><h2>사업·매출 구조</h2></div>${data.canCollect?'<button type="button" data-bp-collect>자료 불러오기</button>':''}</div>
 <p class="bp-action-status" role="status">${data.request?.status==='RUNNING'?'자료를 확인하고 있습니다.':data.collectionMessage?esc(data.collectionMessage):data.request?.status==='FETCH_FAILED'?'갱신에 실패했습니다. 마지막 확인 자료를 표시합니다.':esc(data.message||'')}</p>
 <div class="bp-composition-toolbar"><div class="bp-dimension-tabs" role="group" aria-label="매출 구성 종류">${dimensions.map(k=>`<button type="button" data-bp-dimension="${k}" aria-pressed="${k===selected}">${esc(tabLabels[k])}</button>`).join('')}</div><label class="bp-select-label">기간 종류 <select data-bp-type aria-label="매출 기간 종류">${periodTypes.map(([v,l])=>`<option value="${v}" ${selection.type===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
 <div class="bp-grid"><section class="bp-section" aria-label="${titles[selected]}"><div class="bp-section-head"><h3>${titles[selected]}</h3>${datasets.length>1?`<label class="bp-select-label">기준 자료 <select data-bp-period="${selected}" aria-label="${titles[selected]} 기준 자료">${datasets.map((x,i)=>`<option value="${esc(x.key)}" ${x.key===ds.key?'selected':''}>${esc(x.period.label)} · ${esc(scopeLabel(x.scope))}${x.correction?' · 정정':''}${x.historical?' · 이전 공시':''} (${i+1})</option>`).join('')}</select></label>`:''}</div>${ds?dataset(ds,selected):`<p class="bp-empty">${empty}</p>`}<p class="bp-status">${statuses[original.status]||'일부 항목만 확인'}</p></section></div>
 ${data.descriptions?.length?`<details class="bp-business"><summary>주요 사업 설명</summary>${data.descriptions.map(d=>`<blockquote>${esc(d.quote)}</blockquote>${link(d.url,'사업 설명 출처')}`).join('')}</details>`:''}
 <details class="bp-changes"><summary>분기별 변화</summary>${data.calculations?.changes?.length?data.calculations.changes.map(c=>`<p>${esc(c.label)} · ${esc(c.period.label)} · ${esc(c.kind)} · 매출액 ${num(c.amountGrowthPct)??'계산 불가'}${c.amountGrowthPct===null?'':'%'} · 비중 변화 ${num(c.shareChangePp)??'미확인'}${c.shareChangePp===null?'':'%p'}</p>`).join(''):'<p>비교 가능한 단일 분기 자료가 아직 없습니다.</p>'}${(data.calculations?.issues||[]).slice(0,4).map(i=>`<p>${esc(i.reason||'자료 충돌 · 비교 보류')}</p>`).join('')}</details>
 <details class="bp-additional"><summary>주요 고객·수주·설비</summary>${data.additional?.length?data.additional.map(r=>`<h4>${esc(r.label)}</h4><blockquote>${esc(r.quote)}</blockquote>${link(r.url,'근거 원문')}`).join(''):'<p>확인된 추가 자료가 없습니다.</p>'}</details><p class="bp-note">${esc(data.notice||'공시 항목별 구성입니다. 분류가 다른 비중은 서로 합산하지 않습니다.')} · <a href="/business">사업으로 기업 찾기 →</a></p>`;
}
export function mountBusinessProfile(root,{market,ticker,onData}){
 const controller=new AbortController(),storageKey='moa-business-profile-view-v1:'+market+':'+ticker;let selection={};try{selection=cleanBusinessProfileSelection(JSON.parse(sessionStorage.getItem(storageKey)||'{}'));}catch{}let data=null,timer=null,polls=0,inFlight=null,refreshQueued=false,draining=false;
 const saveSelection=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(cleanBusinessProfileSelection(selection)));}catch{}};
 const url='/api/business-profile?'+new URLSearchParams({market,ticker});
 const render=()=>{root.innerHTML=businessProfileMarkup(data,selection);};render();
 async function readOnce(){try{
   const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error();
   const next=await r.json();if(controller.signal.aborted)return;
   data=next;render();onData?.(data,{loading:false});return true;
  }catch{if(!controller.signal.aborted){onData?.(data,{loading:false,error:true});const el=root.querySelector('.bp-action-status');if(el)el.textContent='저장된 자료를 불러오지 못했습니다. 새로고침해 주세요.';else root.innerHTML='<h2>사업·매출 구조</h2><p>자료 연결 오류 · 새로고침으로 다시 확인해 주세요.</p>';}}
 }
 function load(force=false){
  if(controller.signal.aborted)return Promise.resolve(data);
  if(inFlight){if(force&&!draining)refreshQueued=true;return inFlight;}
  clearTimeout(timer);timer=null;onData?.(data,{loading:true});
  inFlight=(async()=>{let success=false;try{success=await readOnce();if(refreshQueued&&!controller.signal.aborted){refreshQueued=false;draining=true;success=await readOnce();}return data;}
   finally{inFlight=null;refreshQueued=false;draining=false;if(success&&!controller.signal.aborted&&data?.request?.status==='RUNNING'&&polls++<150)timer=setTimeout(load,2000);}})();
  return inFlight;
 }

 root.addEventListener('change',e=>{if(e.target.matches('[data-bp-type]')){selection.type=e.target.value;saveSelection();render();root.querySelector('[data-bp-type]')?.focus({preventScroll:true});}else if(e.target.dataset.bpPeriod){const dimension=e.target.dataset.bpPeriod;selection[dimension]=e.target.value;saveSelection();render();root.querySelector('[data-bp-period="'+dimension+'"]')?.focus({preventScroll:true});}},{signal:controller.signal});
 root.addEventListener('click',async e=>{const dimension=e.target.closest('[data-bp-dimension]');if(dimension){selection.dimension=dimension.dataset.bpDimension;saveSelection();render();root.querySelector('[data-bp-dimension="'+selection.dimension+'"]')?.focus({preventScroll:true});return;}const evidence=e.target.closest('[data-bp-evidence-id]');if(evidence){const section=evidence.closest('.bp-section'),details=section?.querySelector('.bp-evidence');if(details){details.open=true;const row=[...details.querySelectorAll('[data-bp-source-id]')].find(x=>x.dataset.bpSourceId===evidence.dataset.bpEvidenceId);(row||details).scrollIntoView({block:'nearest'});row?.focus({preventScroll:true});}return;}const b=e.target.closest('[data-bp-collect]');if(!b)return;b.disabled=true;try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal}),next=await response.json();if(!response.ok)throw Error(next.message);polls=0;clearTimeout(timer);if(inFlight)await inFlight;await load();}catch(error){if(!controller.signal.aborted){root.querySelector('.bp-action-status').textContent=error.message||'자료 확인에 실패했습니다.';b.disabled=false;}}},{signal:controller.signal});
 void load();return {load,openEvidence({id,dimension}={}){if(dimensionOrder.includes(dimension)){selection.dimension=dimension;delete selection[dimension];selection.type='ALL';saveSelection();render();}const details=root.querySelector('.bp-evidence');if(details){details.open=true;const row=[...root.querySelectorAll('[data-bp-source-id]')].find(x=>x.dataset.bpSourceId===id);(row||details).scrollIntoView({block:'nearest'});row?.focus({preventScroll:true});}},destroy(){controller.abort();clearTimeout(timer);}};
}
