// Flow amounts are additive; per-share EPS is NOT (weighted-average shares change).
export const span=p=>(Date.parse(p.end)-Date.parse(p.start))/86400000+1;
export const compatible=(a,b)=>!!a&&!!b&&Number.isFinite(a.value)&&Number.isFinite(b.value)&&a.unit===b.unit&&a.tag===b.tag&&a.basis===b.basis;
export const nextDay=day=>new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
export function latestPoints(points){
 const groups=new Map();
 for(const p of points){const id=[p.start,p.end,p.unit,p.basis||''].join('|');if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
 return [...groups.values()].map(all=>{all.sort((a,b)=>a.filedAt.localeCompare(b.filedAt)||a.accession.localeCompare(b.accession));const latest=all.at(-1);return {...latest,history:all.map(p=>({accession:p.accession,filedAt:p.filedAt,value:p.value,url:p.url})),revised:all.some(p=>p.value!==latest.value)||/\/A$/.test(latest.form||'')};});
}
export function standaloneQuarters(points,{additive=true}={}){
 const all=latestPoints(points),out=all.filter(p=>span(p)>=70&&span(p)<=110);
 if(additive)for(const p of all.filter(p=>span(p)>110&&span(p)<=380)){
  // Subtract only matching fiscal-year starts, taxonomy, unit and basis. Later
  // restatements cannot be mixed into an older cumulative total.
  const prior=all.filter(b=>compatible(p,b)&&b.start===p.start&&b.end<p.end&&b.filedAt<=p.filedAt&&(Date.parse(p.end)-Date.parse(b.end))/86400000>=70&&(Date.parse(p.end)-Date.parse(b.end))/86400000<=110).sort((a,b)=>b.end.localeCompare(a.end))[0];
  if(!prior||prior.revised||p.revised)continue;
  if(out.some(q=>q.end===p.end&&q.basis===p.basis&&q.unit===p.unit))continue;
  out.push({...p,value:p.value-prior.value,start:nextDay(prior.end),derived:true,formula:'동일 회계연도 누적액 − 직전 분기 누적액',inputs:[p,prior]});
 }
 return out.sort((a,b)=>a.end.localeCompare(b.end));
}
