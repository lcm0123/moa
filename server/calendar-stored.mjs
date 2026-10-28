import {finvizPolicy} from './providers/finviz-client.mjs';
import {listCalendar} from './calendar-store.mjs';
import {kstDate} from '../dist/js/calendar-model.js';
export function storedEarningsEvent(e){
 const [market,ticker]=String(e.key||'').split(':');if(market!=='US'||!ticker)return null;
 const precision=e.timePrecision||e.precision||'unknown',at=e.startsAt||e.at||null;
 const startsAt=precision==='instant'&&at&&Number.isFinite(Date.parse(at))?at:null;
 return {...e,ticker,market,name:e.name||String(e.title||ticker).replace(/ · 실적 발표(?: 예정)?$/,''),dateKst:e.dateKst||(startsAt?kstDate(startsAt):precision==='session'?e.date:null),originalDate:e.originalDate||null,originalTimeZone:e.originalTimeZone||e.timeZone||null,indices:e.indices||[],startsAt,timePrecision:precision,dateConfirmed:e.dateConfirmed??(startsAt?true:null),epsBasis:e.epsBasis||null};
}
export async function storedCalendar(env,date,dateTo,kind='economic'){
 if(!env.DB)throw Error('DATABASE_UNAVAILABLE');
 const local=kind==='economic'?await listCalendar(env.DB,date,dateTo):[],items=new Map(local.map(e=>[e.id,e]));
 const allowed=finvizPolicy(env,kind==='earnings'?'EARNINGS':'CALENDAR');
 let receivedAt=null;
 if(allowed.display&&allowed.calendar){
  // Existing collector snapshots only. No source download, event writes or job registration.
  if(kind==='earnings'){
   const caches=(await env.DB.prepare("SELECT payload,updated_at FROM research_cache WHERE cache_key LIKE 'earnings:%' ORDER BY updated_at DESC LIMIT 32").all()).results;
   for(const row of caches){const data=JSON.parse(row.payload);for(const e of data.items||[]){const day=e.dateKst||e.originalDate;if(day>=date&&day<=dateTo&&!items.has(e.id)){items.set(e.id,{...e,indices:e.indices||[],dateConfirmed:e.dateConfirmed??null});if(!receivedAt||row.updated_at<receivedAt)receivedAt=row.updated_at;}}}
  }
  const rows=(await env.DB.prepare('SELECT payload,collected_at FROM research_events WHERE kind=? AND event_date>=? AND event_date<=? AND merged_into IS NULL ORDER BY last_seen_at DESC LIMIT 1000').bind(kind==='economic'?'calendar':'earnings',date,dateTo).all()).results;
  for(const row of rows){const e=JSON.parse(row.payload),day=e.dateKst||e.date;if(day<date||day>dateTo)continue;
   const id=e.id;if(!id||items.has(id))continue;
   if(kind==='earnings'){const item=storedEarningsEvent(e);if(!item)continue;items.set(id,item);}
   else items.set(id,{...e,country:e.country||e.key?.slice(0,2),startsAt:e.at||null,dateKst:day,dateConfirmed:!!e.at,title:e.title,importance:e.importance||'unknown',readOnly:true});
   if(row.collected_at&&(!receivedAt||row.collected_at<receivedAt))receivedAt=row.collected_at;
  }
 }
 return {items:[...items.values()],receivedAt,providerUpdatedAt:receivedAt,collectionMode:'stored',status:items.size?'ready':'not_collected',message:items.size?'저장된 일정 기준 · 수집 범위 내 자료만 표시':'이 기간에 저장된 일정이 없습니다. 예정된 발표가 없다는 뜻은 아닙니다.',source:'저장된 일정',membershipStatus:'partial',canManage:false};
}
