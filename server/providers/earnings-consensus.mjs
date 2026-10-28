import config from '../../config/earnings-surprise.json' with {type:'json'};
import {cachedResearch} from '../research-cache.mjs';
import {finvizCsv,requireFinviz} from './finviz-client.mjs';
import {parseEarningsCalendar} from './finviz-earnings.mjs';
import {parseHistory} from './finviz-stocks.mjs';
import {usMarketSession,lastCompletedUsDay} from '../../dist/js/us-market-session.js';
import {calculatePostEarningsPriceReaction} from '../earnings-surprise.mjs';
const day=ms=>new Date(ms).toISOString().slice(0,10),shift=(d,n)=>day(Date.parse(d)+n*86400000);
export function finvizConsensusRecord(e){
 const metric=(actual,estimate,basis,unit)=>({actual,estimate,actualBasis:basis,estimateBasis:basis,unit,paired:true,estimateAsOf:null});
 return {id:e.id,period:null,reportDate:e.originalDate,session:e.session,reportTimePrecision:'session',currency:'USD',collectedAt:e.receivedAt,source:'Finviz 실적 Export',sourceUrl:'https://finviz.com/calendar?tab=earnings&date='+e.originalDate,
  revenue:metric(e.revenueActual,e.revenueEstimate,'provider_revenue','USD'),eps:metric(e.epsActual,e.epsEstimate,'adjusted','USD/share'),
  epsGaap:metric(e.epsGaapActual,e.epsGaapEstimate,'GAAP','USD/share'),providerOneDayReaction:e.providerOneDayReaction};
}
export function historyWindows(now=Date.now()){
 const days=Math.floor(now/86400000),size=config.windowDays,last=Math.floor(days/size)*size,start=days-config.historyDays,windows=[];
 for(let n=last;n+size>start;n-=size)windows.push({from:day(n*86400000),to:day(Math.min(n+size-1,days)*86400000),historical:n+size<=days});
 return windows;
}
// Server-only provider adapter. A future KR provider must deliver same-period,
// same-currency and same-accounting-basis actual/estimate pairs, with provenance.
export async function loadEarningsConsensus(env,market,ticker,{now=Date.now()}={}){
 if(market==='KR')return {status:'not_provided',market,ticker,quarters:[],source:'국내 컨센서스 미연결',limitations:['OpenDART는 실제 공시 실적을 제공하지만 시장 예상치는 제공하지 않습니다. 증권사 한 곳의 추정치를 시장 컨센서스로 대신하지 않습니다.']};
 requireFinviz(env,'calendar','EARNINGS');
 const events=new Map(),failures=[],stamps=[];let stale=false,loaded=0;
 for(const window of historyWindows(now)){
  try{
   const data=await cachedResearch(env,'consensus:finviz:window:v1:'+window.from+':'+window.to,window.historical?7*86400000:config.cacheMs,async()=>{
    const csv=await finvizCsv(env,'/export/calendar/earnings',{dateFrom:window.from,dateTo:window.to});
    const rows=await parseEarningsCalendar(csv.text,csv.receivedAt);
    if(rows.some(e=>e.originalDate<window.from||e.originalDate>window.to))throw Error('Date range mismatch');
    return {items:rows.map(e=>({ticker:e.ticker,...finvizConsensusRecord(e)})),updatedAt:csv.receivedAt};
   });
   loaded++;stale ||= Boolean(data.stale);stamps.push(data.updatedAt);
   for(const row of data.items)if(row.ticker===ticker&&row.reportDate<=day(now))events.set(row.id,row);
   if(events.size>=config.displayPeriods)break;
  }catch{failures.push(window.from+' ~ '+window.to);}
 }
 if(!loaded)throw Error('Finviz 실적 연결 실패');
 const quarters=[...events.values()].sort((a,b)=>a.reportDate.localeCompare(b.reportDate)).slice(-config.displayPeriods);
 const limitations=['Finviz는 회계분기를 제공하지 않아 발표일 순서로 표시합니다. 분기 연속성은 확정하지 않습니다.','미국 EPS는 조정 EPS끼리 비교하며 SEC GAAP EPS와 섞지 않습니다.','예상치 확정 시각·참여 기관 수는 미제공입니다. 수집 당시 공급자 기록이며 발표 직전 컨센서스 이력으로 간주하지 않습니다.','미국 영업이익·국내 컨센서스는 현재 공급원에서 제공하지 않습니다.'];
 if(failures.length)limitations.push('일부 기간 수집 실패: '+failures.join(', '));
 try{
  requireFinviz(env,'chart','STOCKS');
  const history=await cachedResearch(env,'surprise:finviz:prices:v1:'+ticker,config.cacheMs,async()=>{const csv=await finvizCsv(env,'/export/stock',{t:ticker,p:'d'},300000);return {bars:parseHistory(csv.text),updatedAt:csv.receivedAt};});
  const completed=lastCompletedUsDay(now);stale ||= Boolean(history.stale);
  for(const row of quarters){
   const tradingDates=[];for(let d=shift(row.reportDate,-14);d<=shift(row.reportDate,25);d=shift(d,1))if(usMarketSession(d+'T16:00:00Z').supported&&completed&&d<=completed)tradingDates.push(d);
   row.priceReaction=calculatePostEarningsPriceReaction(row,history.bars,{tradingDates,now,priceBasis:'Finviz 종가 · 주식분할·배당 조정 여부 미확인'});
   row.priceReaction.updatedAt=history.updatedAt;
  }
  limitations.push('주가 반응은 첫 반영 거래일 직전 종가 대비 누적 변동입니다. 장마감 발표는 다음 거래일부터 셉니다. 공급자 장전·장후 표기는 정확한 발표 시각이 아닙니다.','주가 반응은 총수익률이 아니며 분할·배당 영향을 포함할 수 있습니다. 검증된 거래일 달력 범위(2026~2028) 밖이나 일봉 누락은 계산하지 않습니다.');
 }catch{limitations.push('일봉 연결 또는 표시 권한을 확인하지 못해 발표 후 주가 계산은 보류합니다.');}
 return {status:failures.length?'partial':quarters.length?'ready':'empty',market,ticker,quarters,periodBasis:'publication',updatedAt:stamps.sort()[0]||null,stale:stale||failures.length>0,limitations,source:'Finviz 실적 Export',failedWindows:failures};
}
