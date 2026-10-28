export function rulesForUi(candidates,industry,sort,industries){
 const strength=c=>Math.max(...c.industries.map(r=>industries.find(i=>i.name===r.name)?.returnPct??-Infinity));
 return candidates.filter(c=>!industry||c.industries.some(r=>r.name===industry)).sort((a,b)=>{
  if(sort==='reaction'){const aa=a.reactions.status==='ready'?a.reactions.excessMedian:-Infinity,bb=b.reactions.status==='ready'?b.reactions.excessMedian:-Infinity;if(aa!==bb)return bb-aa;}
  if(sort==='strength'&&strength(a)!==strength(b))return strength(b)-strength(a);
  return b.revenueShare-a.revenueShare||a.ticker.localeCompare(b.ticker);
 });
}
