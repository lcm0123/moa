import {finvizCsv,parseCsv,requireFinviz,digest,FinvizError} from './finviz-client.mjs';
import {kstDate,shiftDay,validDay,wallTimeToInstant,chronological} from '../../dist/js/calendar-model.js';
function weekOf(day){const dow=new Date(day+'T00:00:00Z').getUTCDay();return shiftDay(day,-((dow+6)%7));}
export async function parseEconomicCalendar(text,receivedAt){
 const rows=parseCsv(text,['Event','Date','Time','Impact']);
 const items=new Map();
 for(const r of rows){
  if(!r.Event.trim()||!validDay(r.Date)||!['1','2','3'].includes(r.Impact))throw new FinvizError('Finviz 경제일정 필드 확인 필요');
  // Finviz economic export uses US Eastern wall time; DST is resolved per event date.
  const unknown=!r.Time.trim()||['-','TBA','TBD','All Day','Tentative'].includes(r.Time.trim());
  const startsAt=unknown?null:wallTimeToInstant(r.Date,r.Time,'America/New_York');
  const id='finviz-'+await digest([r.Event,r.Date,r.Time,r.For||''].join('|'));
  // The export has no event ID. Include time to retain separate same-day releases; only exact duplicates merge.
  items.set(id,{id,title:r.Event,country:'US',kind:'economic',originalDate:r.Date,originalTime:r.Time||null,originalTimeZone:'America/New_York',providerImpact:Number(r.Impact),importance:({1:'low',2:'medium',3:'high'})[r.Impact],featured:false,startsAt,dateKst:startsAt?kstDate(startsAt):r.Date,source:'Finviz 경제일정',receivedAt,period:r.For||null,actual:r.Actual||null,expected:r.Expected||null,prior:r.Prior||null,timeNote:unknown?'한국 날짜 미확정 · 공급사 미국 날짜 '+r.Date:null,readOnly:true,dateConfirmed:!unknown});
 }
 return [...items.values()];
}
export async function finvizCalendar(env,day,dateTo=day){
 requireFinviz(env,'calendar','CALENDAR');
 if(!validDay(day)||!validDay(dateTo)||dateTo<day||Date.parse(dateTo)-Date.parse(day)>30*86400000)throw new FinvizError('경제 일정 날짜 범위를 확인해 주세요.');
 // Reuse the confirmed weekly economic export. Include the previous US day at KST boundaries.
 const weeks=[];for(let week=weekOf(shiftDay(day,-1));week<=weekOf(dateTo);week=shiftDay(week,7))weeks.push(week);
 const all=new Map();let receivedAt=null;
 const responses=await Promise.all(weeks.map(dateFrom=>finvizCsv(env,'/export/calendar/economic',{dateFrom},900000)));
 for(const csv of responses){
  receivedAt=!receivedAt||csv.receivedAt<receivedAt?csv.receivedAt:receivedAt;
  for(const item of await parseEconomicCalendar(csv.text,csv.receivedAt))if(item.dateKst>=day&&item.dateKst<=dateTo)all.set(item.id,item);
 }
 const items=chronological([...all.values()]);
 if(env.DB&&items.length){
  // Keep each read under D1's bound-parameter limit for month-sized calendars.
  for(let i=0;i<items.length;i+=90){const batch=items.slice(i,i+90),placeholders=batch.map(()=>'?').join(',');
   const prefs=await env.DB.prepare('SELECT id,featured FROM calendar_preferences WHERE id IN ('+placeholders+')').bind(...batch.map(e=>e.id)).all();
   for(const item of batch){const pref=prefs.results.find(p=>p.id===item.id);if(pref)item.featured=Boolean(pref.featured);}
  }
 }
 return {items,receivedAt,source:'Finviz 경제일정 · 미국 동부시간 → 한국시간'};
}
