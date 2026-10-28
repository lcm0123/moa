import {validDay} from './calendar-model.js';

const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-100;
const score=(values,basis)=>basis==='reconstructed'?(values.reduce((total,n)=>total*(1+n/100),1)-1)*100:values.reduce((total,n)=>total+n,0)/values.length;
const order=(a,b)=>b.value-a.value||a.id.localeCompare(b.id);

// Aggregate the existing calendar records only. Observation snapshots are never
// compounded as though they were daily closes, and missing dates are not zeroes.
export function summarizeSectorMonth(items,{month,market,indexId,basis,today}){
 const byDay=new Map();
 for(const record of items||[]){
  if(!validDay(record.day)||record.day.slice(0,7)!==month||record.day>today||record.market!==market||record.indexId!==indexId)continue;
  if((record.kind==='reconstructed')!==(basis==='reconstructed'))continue;
  const previous=byDay.get(record.day);
  if(!previous||String(record.observedAt||'')>String(previous.observedAt||''))byDay.set(record.day,record);
 }
 const records=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)),groups=new Map();
 for(const record of records){
  const counts=new Map();for(const s of record.sectors||[])counts.set(s.id,(counts.get(s.id)||0)+1);
  for(const sector of record.sectors||[]){
   if(!sector.id||!sector.name)continue;
   if(!groups.has(sector.id))groups.set(sector.id,{id:sector.id,name:sector.name,days:[]});
   if(counts.get(sector.id)!==1||!finite(sector.changePct))continue;
   groups.get(sector.id).days.push({day:record.day,value:sector.changePct,strong:record.strong?.includes(sector.id)===true,weak:record.weak?.includes(sector.id)===true,stockCount:sector.stockCount??null,missingCount:sector.missingCount||0});
  }
 }
 const eligible=[...groups.values()].filter(s=>s.days.length===records.length&&s.days.length>0).map(s=>{
  const value=score(s.days.map(d=>d.value),basis);
  return {...s,value,strongDays:s.days.filter(d=>d.strong).length,weakDays:s.days.filter(d=>d.weak).length,positiveDays:s.days.filter(d=>d.value>0).length};
 }).filter(s=>Number.isFinite(s.value)).sort(order);
 const strong=eligible.slice(0,3),weak=[...eligible].reverse().filter(s=>!strong.some(t=>t.id===s.id)).slice(0,3);
 // With two or three sectors, reserve at least one distinct weak-side entry.
 if(eligible.length>1&&eligible.length<=3){strong.splice(Math.ceil(eligible.length/2));weak.splice(0,weak.length,...[...eligible].reverse().filter(s=>!strong.some(t=>t.id===s.id)));}
 const recent=records.length>=5?eligible.map(s=>({...s,value:score(s.days.slice(-5).map(d=>d.value),basis)})).sort(order):[];
 return {month,market,indexId,basis,status:records.length===0?'empty':records.length<2||eligible.length<2?'insufficient':'ready',days:records.length,
  firstDay:records[0]?.day||null,lastDay:records.at(-1)?.day||null,sectors:eligible,strong,weak,
  spread:eligible.length>1?eligible[0].value-eligible.at(-1).value:null,
  positiveSectors:eligible.filter(s=>s.value>0).length,negativeSectors:eligible.filter(s=>s.value<0).length,
  recentLeader:recent[0]||null,excludedSectors:groups.size-eligible.length,
  partialDays:records.filter(r=>r.missingCount>0||r.sectors?.some(s=>s.missingCount>0)).length,
  membershipChanged:new Set(records.map(r=>r.membershipVersion).filter(Boolean)).size>1};
}
