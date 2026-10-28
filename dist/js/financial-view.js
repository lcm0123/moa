import {mountFinancialDashboard} from './financial-dashboard.js';
import {escapeHtml as esc} from './components.js';
import {updated,number} from './research-view.js';
import {dailyQuoteMeta} from './data.js';
export const metricLabels={revenue:'매출액',operatingIncome:'영업이익',netIncome:'순이익',eps:'희석 EPS',operatingCashFlow:'영업현금흐름',capex:'설비투자',freeCashFlow:'잉여현금흐름'};
export function financialScale(values,eps=false,currency='USD'){const largest=Math.max(0,...values.map(v=>Math.abs(v)));if(eps)return {divisor:1,label:currency==='KRW'?'원/주':'달러/주'};const divisor=largest>=1e9?1e9:largest>=1e6?1e6:1,label=(divisor===1e9?'십억 ':divisor===1e6?'백만 ':'')+(currency==='KRW'?'원':'달러');return {divisor,label};}
export function financialGeometry(values){const max=Math.max(0,...values),min=Math.min(0,...values),span=max-min||1;return {min,max,y:n=>24+(max-n)/span*146,zero:24+max/span*146};}
export function mountFinancials({company,financial,market,ticker,onNotApplicable,onIdentity,onData}){
 const abort=new AbortController(),signal=abort.signal,periodMeta=new Map();let data=null,quote=null,feed=null,interval='annual',loading=false,loaded=false,revision=0,inFlight=null,refreshQueued=false,draining=false;
 const quoteTime=()=>{const baseDate=quote?.baseDate||data?.quoteBaseDate||feed?.baseDate;return baseDate?dailyQuoteMeta({baseDate,syncedAt:quote?.syncedAt||data?.quoteSyncedAt||feed?.syncedAt,stale:quote?.stale||data?.quoteStale||feed?.stale}):updated(data?.quoteAsOf||feed?.asOf);};
 function companyView(){const p={...(quote||{}),...(data?.profile||{})},fields=[['회사명','name'],['티커','ticker'],['거래소','exchange'],['국가','country'],['통화','currency'],['섹터','sector'],['산업','industry'],['SEC CIK','cik'],['DART 고유번호','corpCode']];company.innerHTML=`<div class="research-heading"><h2>기업 정보</h2></div><dl class="company-information">${fields.filter(([,k])=>p[k]!=null&&p[k]!=='').map(([l,k])=>`<div><dt>${l}</dt><dd>${esc(p[k])}</dd></div>`).join('')}</dl>${p.description?`<p class="company-description">${esc(p.description)}</p>`:''}<dl class="company-information company-metrics">${[['시가총액','marketCap'],['발행주식 수','sharesOutstanding'],['52주 최고','yearHigh'],['52주 최저','yearLow'],['배당수익률','dividendYield']].filter(([,k])=>Number.isFinite(p[k])).map(([l,k])=>`<div><dt>${l}</dt><dd>${number(p[k])} ${k==='sharesOutstanding'?'주':k==='dividendYield'?'%':esc(p.currency||'')}</dd></div>`).join('')}</dl><p class="research-note">${esc(data?.quoteSource||feed?.source||'시세 연결 필요')} · ${esc(quoteTime())} · 기업 식별자 ${data?.identityStatus==='verified'?'공식 자료 대조 완료':data?.identityStatus==='provider_ticker'?'Finviz 티커 조회':'확인 전'}</p>${data?.message?`<p class="research-note">${esc(data.message)}</p>`:''}${p.sector?`<a class="research-sector-link" href="/?sector=${encodeURIComponent(p.sector)}&market=${market}" data-nav>${esc(p.sector)} 섹터맵 보기 →</a>`:''}`;}
 const dashboard=mountFinancialDashboard(financial,{onInterval(next){interval=next;if(next==='quarter'&&market==='KR'&&!data?.quarterly?.length)load(true);else if(data?.status==='error'||data?.status==='unavailable')load(true);}});
 function render(){dashboard.set({...data,...periodMeta.get(interval)},loading);onData?.(data,{loading,error:data?.status==='error'});}
 async function readOnce(){
  const n=++revision,requestedInterval=interval;
  try{const r=await fetch('/api/financials?'+new URLSearchParams({market,ticker,interval:requestedInterval,stored:'1'}),{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});if(!r.ok)throw new Error();const next=await r.json();if(signal.aborted||n!==revision)return;periodMeta.clear();for(const [mode,field] of [['annual','annual'],['quarter','quarterly']])if(next[field]?.length){const meta=Object.fromEntries(['source','currency','updatedAt','stale','limitations','ratios','message'].map(k=>[k,next[k]]));meta.updatedAt=next[field].at(-1).cacheRetrievedAt||null;periodMeta.set(mode,meta);}data={...next,annual:next.annual||[],quarterly:next.quarterly||[]};loaded=true;if(next.status==='not_applicable')onNotApplicable?.();if(next.identity?.status==='verified'||next.identityStatus==='verified')onIdentity?.(next.profile);}
  catch{if(!signal.aborted)data={...data,status:'error',message:'공시 재무를 불러오지 못했습니다. 다시 확인해 주세요.'};}
  if(!draining&&interval!==requestedInterval&&market==='KR'&&interval==='quarter'&&!data?.quarterly?.length)refreshQueued=true;
 }
 function load(force=false){
  if(signal.aborted)return Promise.resolve(data);
  if(inFlight){if(force&&!draining)refreshQueued=true;return inFlight;}
  if(loaded&&!force)return Promise.resolve(data);
  loading=true;render();companyView();
  // A collection may finish while the initial stored-data read is in flight.
  // Coalesce those forced refreshes into one follow-up, never an unbounded loop.
  inFlight=(async()=>{try{await readOnce();if(refreshQueued&&!signal.aborted){refreshQueued=false;draining=true;await readOnce();}return data;}
   finally{inFlight=null;refreshQueued=false;draining=false;if(!signal.aborted){loading=false;companyView();render();}}})();
  return inFlight;
 }
 companyView();render();
 return {load,setQuote(s,d){quote=s;feed=d;companyView();},destroy(){abort.abort();dashboard.destroy();}};
}
