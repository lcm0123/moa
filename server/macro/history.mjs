// Calendar comparisons use untransformed observations, never changes of a YoY rate.
export function calendarChanges(def, raw) {
 const latest=raw.filter(p=>Number.isFinite(p.value)).at(-1);
 const absolute=def.unitsPrefix.startsWith('Percent')||['NFCI','STLFSI4','BOPGSTB'].includes(def.id);
 const unit=def.unitsPrefix.startsWith('Percent')?'%p':absolute?def.displayUnit:'%';
 const compare=months=>{
  if(!latest||def.frequency==='Q'&&months===1)return null;
  const date=new Date(latest.date+'T00:00:00Z'),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-months);
  date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));
  const target=date.toISOString().slice(0,10);
  // Monthly/quarterly releases must match the exact period. D/W may fall on a holiday.
  const prior=['M','Q'].includes(def.frequency)?raw.find(p=>p.date===target):raw.filter(p=>p.date<=target&&Number.isFinite(p.value)).at(-1);
  if(!prior||!Number.isFinite(prior.value)||!['M','Q'].includes(def.frequency)&&(Date.parse(target)-Date.parse(prior.date))/86400000>(def.frequency==='W'?8:10))return null;
  if(!absolute&&prior.value<=0)return null;
  return {value:absolute?latest.value-prior.value:(latest.value/prior.value-1)*100,unit,from:prior.date,to:latest.date};
 };
 return {yoy:compare(12),mom:compare(1),formula:absolute?'현재 원자료 − 비교 원자료':'(현재 원자료 / 비교 원자료 − 1) × 100'};
}

export async function fetchFullObservations(request, {id,start,end}) {
 const observations=[],limit=5000;let expected=null;
 for(let offset=0;;offset+=limit){
  const body=await request({series_id:id,...(start?{observation_start:start}:{}),observation_end:end,units:'lin',limit:String(limit),offset:String(offset),sort_order:'asc'});
  if(!Array.isArray(body.observations)||!Number.isInteger(body.count)||body.count<1||body.offset!==offset||expected!==null&&body.count!==expected)throw new Error('RESPONSE_PAGINATION');
  expected=body.count;
  if(body.observations.length!==Math.min(limit,expected-offset))throw new Error('RESPONSE_PAGINATION');
  for(const p of body.observations){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||p.date>end||observations.at(-1)?.date>=p.date)throw new Error('RESPONSE_ORDER');
   observations.push({date:p.date,value:p.value,realtime_start:p.realtime_start,realtime_end:p.realtime_end});
  }
  if(observations.length===expected)return observations;
 }
}
