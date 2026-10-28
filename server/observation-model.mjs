import rules from '../config/observation-rules.json' with {type:'json'};
import {calendar,median} from './us-kr-model.mjs';
export {rules};
export const categories={industry_demand:'산업 수요·가격·발주',product_growth:'제품·기술 성장',supply_expansion:'공급망·고객 투자 확대',company_only:'기업 자체 사건',unknown:'원인 미확인'};
export const paths={same_product:'같은 제품·서비스',component:'부품·소재',production_process:'생산 장비·공정',customer_market:'같은 고객 시장',contract:'확인된 고객·공급 관계'};
export function classifyCause(text){
 // A company-specific catalyst is never expanded through a broad industry tag.
 if(/buyback|repurchase|lawsuit|settlement|acquisition|merger|clinical|FDA approval|자사주|소송|인수합병|임상/i.test(text))return {category:'company_only',topic:null};
 const topic=rules.topics.find(t=>t.eventTerms.some(w=>text.toLowerCase().includes(w.toLowerCase()))&&t.demandTerms.some(w=>text.toLowerCase().includes(w.toLowerCase())));
 if(!topic)return {category:'unknown',topic:null};
 return {category:/customer.{0,40}(spend|invest)|고객.{0,20}투자/i.test(text)?'supply_expansion':/orders|pricing|발주|가격/i.test(text)?'industry_demand':'product_growth',topic:topic.id};
}
export function signals(snapshot,env={}){
 if(!snapshot)return [];
 const cap=Number(env.OBSERVATION_MIN_MARKET_CAP||rules.minMarketCap),liq=Number(env.OBSERVATION_MIN_DOLLAR_VOLUME||rules.minDollarVolume),rise=Number(env.OBSERVATION_MIN_CHANGE_PCT||rules.minChangePct),rv=Number(env.OBSERVATION_MIN_RELATIVE_VOLUME||rules.minRelativeVolume);
 return snapshot.industries.flatMap(i=>i.stocks.map(s=>({...s,industry:i.name,industryExcess:s.changePct-i.returnPct,dollarVolume:s.price*s.volume,volatility:null})))
 .filter(s=>(!rules.excludeEtf||s.isEtf!==true)&&s.changePct>=rise&&s.marketCap>=cap&&s.dollarVolume>=liq&&(s.relativeVolume===null||s.relativeVolume===undefined||s.relativeVolume>=rv)).sort((a,b)=>b.industryExcess-a.industryExcess);
}
export function normalVolatility(bars,sessionDate){
 // Exclude the signal day and future bars. Unknown corporate-action adjustment:
 // reject implausible discontinuities instead of treating splits as volatility.
 const b=bars.filter(b=>b.date<sessionDate).slice(-31),returns=[];
 for(let i=1;i<b.length;i++){const r=(b[i].value/b[i-1].value-1)*100;if(!Number.isFinite(r)||Math.abs(r)>40)return null;returns.push(r);}
 if(returns.length<20)return null;const mean=returns.reduce((a,b)=>a+b)/returns.length;
 return {dailyStdPct:Math.sqrt(returns.reduce((n,r)=>n+(r-mean)**2,0)/(returns.length-1)),count:returns.length,basis:'직전 30거래일 종가 수익률 · 수정주가 여부 미확인'};
}
export function validateEvent(e,session){
 if(!e||e.sessionDate!==session.sessionDate||e.status!=='reported'||!e.report?.attributionVerified||!e.primary?.verified)return false;
 const published=Date.parse(e.primary.publishedAt),close=Date.parse(session.closeAt);
 return Number.isFinite(published)&&published<=close&&close-published<=7*86400000&&e.report.publishedDate===session.sessionDate&&e.topic&&e.category!=='company_only';
}
export function linkBusiness(event,business,session){
 const topic=rules.topics.find(t=>t.id===event?.topic);
 if(!topic||!validateEvent(event,session)||!business?.verified||business.version!==rules.version||business.topic!==event.topic)return null;
 const cutoff=Date.parse(session.targetOpen),seen=Date.parse(business.availableAt||business.checkedAt);
 if(!business.productEvidence?.text||!business.demandEvidence?.text||!Number.isFinite(seen)||seen>cutoff||Date.parse(business.sourceDate)>cutoff||cutoff-Date.parse(business.sourceDate)>550*86400000)return null;
 const components={cause:event.report.aiAssisted?50:75,application:75,importance:Number.isFinite(business.revenueShare)?Math.min(100,business.revenueShare):null,specificity:60,history:null,priced:null};
 // Missing measurements never become zero, a synthetic probability or a total.
 return {ticker:business.ticker,name:business.name,topic:topic.name,path:topic.path,direction:event.direction||'unknown',reason:topic.explanation,business,components,total:null,rankStatus:'조건부 관찰 · 종합 순위 보류',history:{status:'insufficient',count:0},priced:{status:'unavailable',reason:'해당 국내 거래일 시초가·현재가 확인 전'}};
}
export function nextKrSession(closeAt){return calendar.sessions.XKRX.find(s=>Date.parse(s.open)>Date.parse(closeAt))||null;}
export function splitReaction(bar,index){
 // Only explicit comparable prices, never infer split-adjusted previous prices.
 if(!bar?.comparable||!index?.comparable||![bar.previousClose,bar.open,bar.close,index.previousClose,index.open,index.close].every(n=>Number.isFinite(n)&&n>0))return null;
 const calc=b=>({gap:(b.open/b.previousClose-1)*100,intraday:(b.close/b.open-1)*100,total:(b.close/b.previousClose-1)*100});
 const s=calc(bar),m=calc(index);return {...s,excess:{gap:s.gap-m.gap,intraday:s.intraday-m.intraday,total:s.total-m.total}};
}
export function comparableBars(bars){
 const b=bars.map(p=>({...p,date:p.date||p.at,close:p.close??p.value})).sort((a,b)=>a.date.localeCompare(b.date));
 return b.map((p,i)=>{const prior=b[i-1],sessionIndex=calendar.sessions.XKRX.findIndex(s=>s.date===p.date),previousSession=calendar.sessions.XKRX[sessionIndex-1]?.date;
  const observed=prior?.close>0?(p.close/prior.close-1)*100:null;
  // Reject ex-date discontinuity, missing trading dates and unverified adjustment.
  const comparable=prior?.date===previousSession&&Number.isFinite(p.changePct)&&Number.isFinite(observed)&&Math.abs(observed-p.changePct)<0.06;
  return {...p,previousClose:prior?.close??null,comparable};});
}
export function reactions(records,stockBars,indexBars,now=Date.now()){
 const samples=[];
 for(const r of records){const kr=nextKrSession(r.closeAt);if(!kr||Date.parse(kr.close)>now||r.version!==rules.version||!r.existedAtSignal||!r.relationVerified)continue;
  if(![r.eventAvailableAt,r.businessAvailableAt,r.classifiedAt].every(d=>Number.isFinite(Date.parse(d))&&Date.parse(d)<Date.parse(kr.open)))continue;
  const p=splitReaction(stockBars.find(b=>b.date===kr.date),indexBars.find(b=>b.date===kr.date));if(p&&!samples.some(s=>s.date===kr.date))samples.push({date:kr.date,...p});
 }
 return {count:samples.length,status:samples.length>=rules.minSamples?'ready':'insufficient',up:samples.filter(s=>s.total>0).length,medians:Object.fromEntries(['gap','intraday','total'].map(k=>[k,median(samples.map(s=>s[k]))])),excessMedians:Object.fromEntries(['gap','intraday','total'].map(k=>[k,median(samples.map(s=>s.excess[k]))])),samples};
}
export function phase(session,now=Date.now()){
 if(!session)return '기준 거래일 확인 중';const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(now<Date.parse(session.targetOpen))return today===session.targetDate?'오늘 관찰할 종목':`${session.targetDate} 관찰할 종목`;
 return now<Date.parse(session.targetClose)?'국내 장 진행 · 시초가 반영과 이후 움직임 구분':'국내 장 종료 · 일별 결과 확인';
}
