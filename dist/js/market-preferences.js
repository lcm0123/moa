const key='moa-market-view-v1';
const indices={KR:['KOSPI200','KOSDAQ150'],US:['SP500','NASDAQ100','DOW30']};
export function resolvePreferences(config={},saved={}){
 const fallback=config.defaultMarket==='US'?'US':'KR';
 const market=['KR','US'].includes(saved.market)?saved.market:fallback;
 const rankMarket=['KR','US','all'].includes(saved.rankMarket)?saved.rankMarket:fallback;
 const sectorMarket=['KR','US'].includes(saved.sectorMarket)?saved.sectorMarket:fallback;
 return {market,rankMarket,sectorMarket,
  rankKind:['turnover','volume'].includes(saved.rankKind)?saved.rankKind:config.defaultRanking==='volume'?'volume':'turnover',
  sectorIndex:indices[sectorMarket].includes(saved.sectorIndex)?saved.sectorIndex:indices[sectorMarket][0]};
}
export function readPreferences(config){try{return resolvePreferences(config,JSON.parse(localStorage.getItem(key)||'{}')||{});}catch{return resolvePreferences(config);}}
export function savePreferences(state){try{localStorage.setItem(key,JSON.stringify({market:state.market,rankMarket:state.rankMarket,rankKind:state.rankKind,sectorMarket:state.sectorMarket,sectorIndex:state.sectorIndex}));}catch{}}
export function retainRanking(previous,next){
 if(!previous)return next;
 if(next.status==='error')return {...previous,stale:true};
 if(next.groups)return {...next,groups:next.groups.map(group=>{
  const old=previous.groups?.find(g=>g.market===group.market);
  return group.status==='error'&&old?.status==='ready'&&old.rankingFilter===group.rankingFilter?{...old,stale:true}:group;
 })};
 return next;
}
