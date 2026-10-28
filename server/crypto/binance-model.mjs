export const DAY=86400000;
export const CRYPTO_PERIODS=[['hour','1시간'],['day','24시간'],['week','7일'],['month','30일']];
export const UNCLASSIFIED={id:'unclassified',name:'Unclassified',label:'미분류'};
export const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
export function spotUniverse(body){
 if(!Array.isArray(body?.symbols))throw new Error('Binance 거래쌍 응답 형식 오류');
 const seen=new Set();return body.symbols.filter(s=>s.status==='TRADING'&&s.isSpotTradingAllowed===true&&s.quoteAsset==='USDT'&&s.baseAsset&&/^[A-Z0-9]+$/.test(s.symbol)).sort((a,b)=>a.symbol.localeCompare(b.symbol)).filter(s=>{if(seen.has(s.baseAsset))return false;seen.add(s.baseAsset);return true;}).map(s=>({id:'binance:'+s.symbol,ticker:s.symbol,symbol:s.baseAsset,baseAsset:s.baseAsset,quoteAsset:s.quoteAsset,name:s.baseAsset,currency:'USDT',categories:[],primary:UNCLASSIFIED,returns:{},price:null,quoteVolume:null,pricePrecision:s.quoteAssetPrecision}));
}
export function tickerValue(row,receivedAt=new Date().toISOString(),stream=false){
 const price=number(stream?row.c:row.lastPrice),open=number(stream?row.o:row.openPrice),time=number(stream?row.E:row.closeTime),quoteVolume=number(stream?row.q:row.quoteVolume);
 if(!(price>0)||!(time>0)||quoteVolume===null||quoteVolume<0)return null;
 return {ticker:stream?row.s:row.symbol,price,quoteVolume,volume:number(stream?row.v:row.volume),open24h:open,return24h:open>0?(price/open-1)*100:null,asOf:new Date(time).toISOString(),receivedAt,source:'Binance Spot',mode:stream?'stream':'snapshot'};
}
export function applyTickers(map,rows,stream=false,receivedAt=new Date().toISOString()){
 const updates=[];if(!Array.isArray(rows))return updates;
 for(const row of rows){if(stream&&row.e!=='24hrMiniTicker')continue;const v=tickerValue(row,receivedAt,stream),old=v&&map.get(v.ticker);if(!old||Date.parse(old.asOf)>Date.parse(v.asOf)||(stream&&old.asOf===v.asOf))continue;Object.assign(old,v,{returns:{...old.returns,day:v.return24h}});updates.push({...v,id:old.id,returns:{day:v.return24h}});}
 return updates;
}
export function parseKlines(rows){
 if(!Array.isArray(rows))throw new Error('Binance OHLCV 응답 형식 오류');const bars=new Map();
 for(const row of rows){const [time,open,high,low,close,volume,closeTime,quoteVolume]=row.map(number);if(!(time>=0)||![open,high,low,close].every(n=>n>0)||high<Math.max(open,close)||low>Math.min(open,close)||low>high||!(volume>=0)||!(closeTime>=time))continue;bars.set(time,{time:time/1000,date:new Date(time).toISOString().slice(0,10),open,high,low,close,volume,quoteVolume,closeTime,ohlc:true});}return [...bars.values()].sort((a,b)=>a.time-b.time);
}
export function periodWindow(period,query=new URLSearchParams(),now=Date.now()){
 if(period==='day')return null;
 if(period==='custom'){const a=query.get('start'),b=query.get('end'),valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;if(!valid(a)||!valid(b))throw new Error('시작일·종료일을 확인해 주세요.');const start=Date.parse(a+'T00:00:00Z'),end=Date.parse(b+'T00:00:00Z');if(start>=end||start<Date.UTC(2017,7,17)||end>Math.floor(now/DAY)*DAY)throw new Error('2017-08-17 이후부터 오늘(UTC)까지의 서로 다른 날짜를 선택해 주세요.');return {start,end,interval:'1d',key:`custom:${a}:${b}`};}
 if(!['hour','week','month'].includes(period))throw new Error('지원하지 않는 수익률 기간');const step=period==='hour'?3600000:DAY,end=Math.floor(now/step)*step,start=end-(period==='hour'?step:period==='week'?7*DAY:30*DAY);return {start,end,interval:period==='hour'?'1h':'1d',key:period+':'+end};
}
export function windowReturn(bars,window){const a=bars.find(b=>b.time*1000===window.start),b=bars.find(b=>b.time*1000===window.end);return a&&b?{value:(b.open/a.open-1)*100,startPrice:a.open,endPrice:b.open,startAt:new Date(window.start).toISOString(),endAt:new Date(window.end).toISOString()}:null;}
// Provider verifies an exact exchange + base/quote pair and stable coin ID. Symbol-only matches are never accepted.
export function exchangeIdentities(universe,tickers,coins){const names=new Map(coins.map(c=>[c.id,c])),result=new Map();for(const c of universe){const matches=tickers.filter(t=>t.market?.identifier==='binance'&&t.base===c.baseAsset&&t.target===c.quoteAsset&&t.coin_id&&t.target_coin_id==='tether'&&!t.is_anomaly),ids=[...new Set(matches.map(t=>t.coin_id))];if(ids.length!==1)continue;const name=names.get(ids[0]);if(!name?.name||String(name.symbol).toUpperCase()!==c.baseAsset)continue;result.set(c.id,{geckoId:ids[0],name:name.name,mappingEvidence:'CoinGecko Binance 거래쌍·baseAsset·USDT(tether)·코인 ID·코인명 확인'});}return result;}
export {cryptoSectors} from '../../dist/js/crypto-sector-model.js';

