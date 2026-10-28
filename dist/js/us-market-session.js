// Official NYSE holiday/early-close calendar checked 2026-09-25:
// https://www.nyse.com/trade/hours-calendars
// Finviz Elite extended-hours coverage: https://finviz.com/elite (Data and Tickers).
// This describes the REQUEST window, never an unprovided execution timestamp.
const holidays=new Set([
 '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
 '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
 '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25'
]);
const earlyCloses=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const labels={premarket:'프리마켓',regular:'본장',aftermarket:'애프터마켓',daymarket:'주간거래',closed:'장 마감',unknown:'거래시간 미확인'};
const tradingDay=day=>{const weekday=new Date(day+'T00:00:00Z').getUTCDay();return weekday!==0&&weekday!==6&&!holidays.has(day);};
export function usMarketSession(at){
 const instant=new Date(at);if(!Number.isFinite(+instant))return {id:'unknown',label:labels.unknown,supported:false,basis:'request_time'};
 const p=Object.fromEntries(formatter.formatToParts(instant).map(x=>[x.type,x.value])),day=`${p.year}-${p.month}-${p.day}`,minutes=Number(p.hour)*60+Number(p.minute),earlyClose=earlyCloses.has(day);
 let id='closed';
 if(Number(p.year)<2026||Number(p.year)>2028)id='unknown';
 else if(minutes<240||minutes>=1200){
  const next=minutes>=1200?new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10):day;
  if(tradingDay(next))id='daymarket';
 }else if(tradingDay(day)){
  if(minutes<570)id='premarket';else if(minutes<(earlyClose?780:960))id='regular';else if(minutes<(earlyClose?1020:1200))id='aftermarket';
 }
 return {id,label:labels[id],supported:['premarket','regular','aftermarket'].includes(id),basis:'request_time',dateEt:day,timeEt:`${p.hour}:${p.minute}`,timeZone:'America/New_York',earlyClose,checkedAt:instant.toISOString()};
}

export function lastCompletedUsDay(now=Date.now()){
 const session=usMarketSession(now);if(!session.dateEt||session.id==='unknown')return null;
 for(let offset=0;offset<12;offset++){
  const date=new Date(Date.parse(session.dateEt)-offset*86400000).toISOString().slice(0,10);
  if(!tradingDay(date))continue;
  if(offset===0&&session.timeEt<(earlyCloses.has(date)?'13:00':'16:00'))continue;
  return date;
 }
 return null;
}
