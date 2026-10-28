import {validWatchKey} from '../dist/js/watchlist.js';

export function parseWatchSymbols(raw=''){
 const keys=raw?raw.split(','):[];
 if(keys.length>100||keys.some(key=>!validWatchKey(key)))throw new Error('Invalid watchlist');
 return [...new Set(keys)];
}
// Fetch each market once through the existing, permission-checked provider cache.
export async function watchlistQuotes(env,keys,stockProviders){
 const markets=[...new Set(keys.map(key=>key.split(':')[0]))];
 const groups=await Promise.all(markets.map(async market=>{
  let feed;try{feed=await stockProviders[market](env,{quotesOnly:true});}catch{feed={status:'error',items:[]};}
  const allowed=feed.status==='ready'&&feed.policy?.display===true;
  return {market,status:feed.status,items:keys.filter(key=>key.startsWith(market+':')).map(key=>{
   const ticker=key.slice(3),stock=allowed?feed.items?.find(s=>s.market===market&&s.ticker===ticker&&Number.isFinite(s.price)):null;
   if(!stock)return {key,market,ticker,status:'unavailable',reason:feed.status==='error'?'시세 연결 오류':feed.status==='restricted'||feed.status==='ready'&&!allowed?'시세 표시 권한 확인 필요':'데이터 없음'};
   return {key,status:'ready',id:stock.id,market,ticker,name:stock.name,price:stock.price,currency:stock.currency,
    change:Number.isFinite(stock.change)?stock.change:null,changePct:Number.isFinite(stock.changePct)?stock.changePct:null,
    turnover:Number.isFinite(stock.turnover)?stock.turnover:null,volume:Number.isFinite(stock.volume)?stock.volume:null,exchange:stock.exchange||null,
    previousClose:Number.isFinite(stock.previousClose)?stock.previousClose:null,changeBasis:stock.changeBasis||null,
    source:stock.source||feed.source,baseDate:stock.baseDate||null,syncedAt:stock.syncedAt||feed.syncedAt||null,mode:stock.mode||feed.mode||'snapshot',delayMinutes:feed.delayMinutes,
    asOf:stock.asOf||feed.asOf||null,asOfKind:stock.asOfKind||feed.asOfKind||null,
    session:stock.session||feed.session||'unknown',sessionAt:stock.sessionAt||null,stale:Boolean(feed.stale||stock.stale)};
  })};
 }));
 return {items:groups.flatMap(g=>g.items),groups:groups.map(({market,status})=>({market,status}))};
}
