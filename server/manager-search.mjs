import catalog from '../config/manager-catalog.json' with {type:'json'};
export const managerCatalog=catalog;
export const normalizeSearch=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const managerProfile=cik=>catalog.managers.find(m=>m.cik===String(Number(cik)));
function distance(a,b){
 const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=0;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}return d[a.length][b.length];
}
export function managerMatch(manager,query){
 const q=normalizeSearch(query);if(!q)return null;
 const profile=managerProfile(manager.cik),people=profile?.people||[],candidates=[{value:manager.name,tier:0},...(profile?.aliases||[]).map(value=>({value,tier:1})),...(profile?.tickers||[]).map(value=>({value,tier:1})),...people.flatMap(p=>[p.name,...p.aliases].map(value=>({value,tier:1,person:p.name}))),...(!profile?(manager.people||[]).map(value=>({value,tier:1})):[])];
 if(/^\d{1,10}$/.test(q)&&Number(q)===Number(manager.cik))return {tier:0,distance:0,label:'CIK '+manager.cik};
 let best=null;
 for(const c of candidates){const v=normalizeSearch(c.value);if(!v)continue;let tier=null,edit=0;
  if(v===q)tier=c.tier;
  else if(q.length>=(/[가-힣]/.test(q)?2:3)&&v.includes(q))tier=2;
  else if(q.length>=4&&!/^\d+$/.test(q)&&/[가-힣]/.test(q)===/[가-힣]/.test(v)&&Math.abs(q.length-v.length)<=1){edit=distance(q,v);if(edit<=Math.min(2,Math.floor(q.length/4)))tier=3;}
  if(tier!==null&&(!best||tier<best.tier||tier===best.tier&&edit<best.distance))best={tier,distance:edit,label:c.person?'관련 인물: '+c.person:'일치한 검색어: '+c.value};
 }return best;
}
export function managerProviderQuery(query){
 const q=normalizeSearch(query);for(const p of catalog.managers){for(const person of p.people||[])if([person.name,...person.aliases].some(s=>normalizeSearch(s)===q))return person.providerQuery;
 if([...(p.aliases||[]),...(p.tickers||[])].some(s=>normalizeSearch(s)===q))return p.aliases.find(s=>/^[A-Za-z ]+$/.test(s))||query;}return query.trim();
}
export function featuredOrder(m){const rank=managerProfile(m.cik)?.featuredOrder;return Number.isInteger(rank)&&rank>0?rank:Infinity;}
// Future trusted, server-side analytics adapter. Never substitute holdings/AUM for visits.
// Call only with bot-filtered server events; no browser-provided counts are accepted.
export function engagementScores(events,now=Date.now(),config=catalog.ranking){
 const visitors=new Map(),favorites=new Map(),cutoff=now-config.windowDays*86400000;
 for(const e of events){const at=Date.parse(e.at);if(!e.visitorKey||e.bot!==false||!Number.isFinite(at)||at>now||at<cutoff)continue;
  const key=e.cik+'|'+e.visitorKey;if(e.kind==='visit')visitors.set(key,e.cik);if(e.kind==='favorite'&&(!favorites.has(key)||favorites.get(key).at<at))favorites.set(key,{cik:e.cik,active:e.active===true,at});}
 const result=new Map();for(const cik of new Set([...visitors.values(),...[...favorites.values()].map(e=>e.cik)])){const visits=[...visitors.values()].filter(c=>c===cik).length,favs=[...favorites.values()].filter(e=>e.cik===cik&&e.active).length;result.set(cik,{visits,favorites:favs,score:visits>=config.minimumVisitors?visits*config.visitorWeight+favs*config.favoriteWeight:null});}return result;
}
