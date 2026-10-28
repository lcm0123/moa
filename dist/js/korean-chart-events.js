export const chartEventLabels={earnings:'실적',calendar:'일정',report:'리포트'};
export function koreanEventDate(event,market='KR'){
 if(event.at&&Number.isFinite(Date.parse(event.at)))return new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.at));
 if(market==='US'&&event.kind==='earnings'&&/^\d{4}-\d{2}-\d{2}$/.test(event.originalDate||''))return event.originalDate;
 return /^\d{4}-\d{2}-\d{2}$/.test(event.date||'')?event.date:null;
}
export function koreanChartEvents(events,bars,market='KR'){
 const seen=new Set(),out=[];
 for(const event of events||[]){
  if(!chartEventLabels[event.kind]||!event.id||seen.has(event.id))continue;
  const date=koreanEventDate(event,market);if(!date)continue;seen.add(event.id);
  // A non-trading date is never moved onto a different daily candle.
  const bar=bars.find(b=>(b.startDate||b.date)<=date&&(b.endDate||b.date)>=date);
  out.push({...event,date,barDate:bar?.date||null,label:chartEventLabels[event.kind]});
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
