import {finvizCsv,parseCsv,csvNumber,requireFinviz,finvizPolicy,digest,FinvizError} from './finviz-client.mjs';
import {finvizConstituents} from './finviz-stocks.mjs';
import {kstDate,shiftDay,validDay,wallTimeToInstant} from '../../dist/js/calendar-model.js';

// Verified against Finviz API and Exports / Calendar / Earnings and actual CSV, 2026-09-25.
// Market Cap and Revenue are USD millions; EPS is adjusted, GAAP has separate columns.
const required=['Date','Ticker','Company','Market Cap','EPS Estimate','EPS Actual','EPS Surprise','EPS GAAP Estimate','EPS GAAP Actual','EPS GAAP Surprise','Revenue Estimate','Revenue Actual','Revenue Surprise','1-Day Price Reaction'];
export async function parseEarningsCalendar(text,receivedAt){
 const items=new Map();
 for(const row of parseCsv(text,required)){
  const match=row.Date.trim().match(/^(\d{4}-\d{2}-\d{2})(?: ([0-2]\d:[0-5]\d))?$/);
  if(!match||!validDay(match[1])||!row.Company.trim()||!/^[A-Z0-9.^_-]{1,30}$/.test(row.Ticker))throw new FinvizError('Finviz 실적 필드 확인 필요');
  const originalDate=match[1],originalTime=match[2]||null;
  const providerInstant=originalTime?wallTimeToInstant(originalDate,originalTime,'America/New_York'):null;
  // Same session classification as Finviz's calendar. These are session markers, not verified release timestamps.
  const hour=originalTime?Number(originalTime.slice(0,2)):null,session=hour===null?null:hour<=9?'BMO':hour>=16?'AMC':null;
  const id='earnings-'+await digest(row.Ticker+'|'+originalDate);
  items.set(id,{id,ticker:row.Ticker,name:row.Company,market:'US',currency:'USD',
   originalDate,originalTime,originalTimeZone:'America/New_York',session,startsAt:null,timePrecision:session?'session':'unknown',
   dateKst:providerInstant?kstDate(providerInstant):null,dateBasis:providerInstant?'provider-session':'unconfirmed',
   marketCap:csvNumber(row['Market Cap'],1e6),epsBasis:'adjusted',epsEstimate:csvNumber(row['EPS Estimate']),epsActual:csvNumber(row['EPS Actual']),epsSurprisePct:csvNumber(row['EPS Surprise']),
   epsGaapEstimate:csvNumber(row['EPS GAAP Estimate']),epsGaapActual:csvNumber(row['EPS GAAP Actual']),epsGaapSurprisePct:csvNumber(row['EPS GAAP Surprise']),
   revenueEstimate:csvNumber(row['Revenue Estimate'],1e6),revenueActual:csvNumber(row['Revenue Actual'],1e6),revenueSurprisePct:csvNumber(row['Revenue Surprise']),providerOneDayReaction:csvNumber(row['1-Day Price Reaction']),
   source:'Finviz 실적',receivedAt,indices:[]});
 }
 return [...items.values()];
}
export async function finvizEarnings(env,date,dateTo){
 requireFinviz(env,'calendar','EARNINGS');
 // Include the previous US day because AMC belongs to the following KST date.
 const csv=await finvizCsv(env,'/export/calendar/earnings',{dateFrom:shiftDay(date,-1),dateTo},900000);
 const items=(await parseEarningsCalendar(csv.text,csv.receivedAt)).filter(e=>e.dateKst?e.dateKst>=date&&e.dateKst<=dateTo:e.originalDate>=date&&e.originalDate<=dateTo);
 let membershipStatus='unavailable',membershipUpdatedAt=null;
 if(items.length&&finvizPolicy(env,'CONSTITUENTS').display&&finvizPolicy(env,'CONSTITUENTS').treemap){
  const ids=['SP500','NASDAQ100','DOW30'];
  const results=await Promise.all(ids.map(id=>finvizConstituents(env,id)));
  membershipStatus=results.every(r=>r.status==='ready')?'ready':'partial';
  results.forEach((result,i)=>{if(result.status!=='ready'||!result.verified)return;const tickers=new Set(result.items.map(s=>s.ticker));for(const item of items)if(tickers.has(item.ticker))item.indices.push(ids[i]);if(result.observedAt&&(!membershipUpdatedAt||result.observedAt<membershipUpdatedAt))membershipUpdatedAt=result.observedAt;});
 }
 return {items,receivedAt:csv.receivedAt,source:'Finviz 실적',membershipStatus,membershipUpdatedAt};
}
