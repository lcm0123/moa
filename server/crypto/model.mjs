import {parseCsv,csvNumber} from '../providers/finviz-client.mjs';
export const PERIODS=[['day','일간','Day'],['week','1주','Week'],['month','1개월','Month'],['quarter','3개월','Quarter'],['halfyear','6개월','Half Year'],['year','1년','Year'],['ytd','연초 이후','Year To Date'],['mtd','월초 이후','Month To Date'],['hour','1시간','1 Hour'],['5m','5분','5 Minutes']];
export const DAY=86400000;
export const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function cryptoNumber(v){const n=csvNumber(v);if(n!==null)return n;const s=String(v||'').trim();return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[Ee][+-]?\d+$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;}
export function baseSymbol(ticker){return ticker.startsWith('@')?ticker.slice(1):ticker.endsWith('USD')?ticker.slice(0,-3):ticker;}
export function parsePerformance(text,receivedAt){
 const required=['Ticker','Name','Price',...PERIODS.slice(0,3).map(p=>'Performance ('+p[2]+')')];
 const rows=parseCsv(text,required),seen=new Set();
 return rows.map(row=>{
  const ticker=row.Ticker.trim(),price=cryptoNumber(row.Price);if(!/^@?[A-Z0-9._-]{1,30}$/.test(ticker)||!row.Name?.trim()||seen.has(ticker)||price===null||price<=0)throw new Error('Finviz 코인 CSV의 식별자·가격을 확인해 주세요.');seen.add(ticker);
  return {id:'finviz:'+ticker,ticker,symbol:baseSymbol(ticker),name:row.Name.trim(),price,currency:'USD',returns:Object.fromEntries(PERIODS.map(([id,,field])=>[id,csvNumber(row['Performance ('+field+')'])])),receivedAt,asOf:null,asOfKind:'received',source:'Finviz Elite Crypto Performance',cmcId:null,categories:[],marketCap:null};
 });
}
export function matchIdentity(coin,candidates){
 const symbols=candidates.filter(c=>norm(c.symbol)===norm(coin.symbol));const matches=symbols.filter(c=>norm(c.name)===norm(coin.name));
 return matches.length===1?{cmcId:Number(matches[0].id),status:'matched',evidence:'CMC 이름·심볼 정확 일치'}:{cmcId:null,status:matches.length>1?'ambiguous':'unmatched',evidence:matches.length>1?'동일 이름·심볼 CMC ID 중복':symbols.length?'이름 불일치':'CMC 심볼 없음'};
}
export const selectedReturn=(coin,period)=>Number.isFinite(coin.returns?.[period])?coin.returns[period]:null;
export function sectorResults(items,categories,period='day',method='equal'){
 return categories.map(category=>{
  const members=items.filter(c=>c.categories.some(s=>s.id===category.id)),eligible=members.filter(c=>selectedReturn(c,period)!==null),capEligible=eligible.filter(c=>c.marketCap>0&&!c.capStale);
  const capReady=eligible.length>0&&capEligible.length===eligible.length,valid=method==='cap'?capEligible:eligible,totalCap=valid.reduce((sum,c)=>sum+(c.marketCap||0),0),usable=method!=='cap'||capReady;
  const coins=valid.map(c=>({...c,periodReturn:selectedReturn(c,period),weight:method==='cap'?c.marketCap/totalCap:1/valid.length}));for(const c of coins)c.contribution=c.periodReturn*c.weight;
  return {...category,value:usable&&coins.length?coins.reduce((s,c)=>s+c.contribution,0):null,count:usable?coins.length:0,available:members.length,cmcCount:category.numTokens,excluded:members.length-(usable?coins.length:0),rising:usable?coins.filter(c=>c.periodReturn>0).length:0,falling:usable?coins.filter(c=>c.periodReturn<0).length:0,capReady,coins:usable?coins:[],leaders:usable?[...coins].sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)).slice(0,3):[],reason:!usable?'시가총액 데이터 부족':!coins.length?'선택 기간 수익률 없음':null};
 }).filter(s=>s.available>0).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
}
export function customReturns(items,observations,start,end){
 const grouped=new Map();for(const o of observations){const key=o.instrument_id+':'+o.kst_day;const old=grouped.get(key);if(!old||o.received_at<old.received_at)grouped.set(key,o);}
 return items.map(c=>{const a=grouped.get(c.id+':'+start),b=grouped.get(c.id+':'+end);return {...c,returns:{...c.returns,custom:a?.price>0&&b?.price>0?(b.price/a.price-1)*100:null},customBasis:a&&b?{startAt:a.received_at,endAt:b.received_at,startPrice:a.price,endPrice:b.price}:null};});
}
