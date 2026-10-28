import {providers} from '../providers/registry.mjs';
import {storedFscDaily} from '../providers/korean-chart.mjs';
import {cryptoService} from '../crypto-api.mjs';
import {calendar} from '../us-kr-model.mjs';
import {one} from './store.mjs';
import {config,CatalystError,messages} from './core.mjs';
import {fmpIndexHistory} from '../providers/fmp-indices.mjs';
import {usMarketSession} from '../us-market-session.mjs';
export function priceChange(a,b){return Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>=0?(b/a-1)*100:null;}
export function zScore(value,history){const x=history.filter(Number.isFinite);if(x.length<20||!Number.isFinite(value))return null;const m=x.reduce((s,v)=>s+v,0)/x.length,sd=Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/x.length);return sd>0?(value-m)/sd:null;}
export function windowMetrics(bars,count,benchmark=[]){
 if(!Number.isInteger(count)||count<1||new Set(bars.map(b=>b.date)).size!==bars.length||new Set(benchmark.map(b=>b.date)).size!==benchmark.length)return null;
 const end=bars.at(-1),start=bars.at(-1-count);if(!start||!end||bars.length<count+1)return null;
 const value=priceChange(start.close,end.close),bs=benchmark.find(b=>b.date===start.date),be=benchmark.find(b=>b.date===end.date),benchmarkReturn=priceChange(bs?.close,be?.close);
 const sum=arr=>arr.length===count&&arr.every(b=>Number.isFinite(b.volume)&&b.volume>=0)?arr.reduce((s,b)=>s+b.volume,0):null,volume=sum(bars.slice(-count)),returns=[],volumes=[];
 for(let offset=count;offset<=count*60;offset+=count){const e=bars.length-1-offset,s=e-count;if(s<0)break;returns.push(priceChange(bars[s].close,bars[e].close));if(volumes.length<20)volumes.push(sum(bars.slice(e-count+1,e+1)));}
 const mean=volumes.length===20&&volumes.every(Number.isFinite)?volumes.reduce((s,v)=>s+v,0)/20:null;
 const previousVolume=sum(bars.slice(-count*2,-count));
 return {returnPct:value,start:start.date,end:end.date,benchmarkReturn,excessReturn:value!==null&&benchmarkReturn!==null?value-benchmarkReturn:null,volume,volumeChange:priceChange(previousVolume,volume),relativeVolume:mean>0&&Number.isFinite(volume)?volume/mean:null,returnZScore:zScore(value,returns),volumeZScore:zScore(volume,volumes)};
}
export function qualityMetrics(metric,{asset,window,adjusted=null,stale=false,crypto=false}={}){
 const keys=['return','benchmarkReturn','excessReturn','volume','volumeChange','relativeVolume','abnormalReturn','volumeZScore','sectorReturn'];
 const result={asset,window,...metric,return:metric?.returnPct??null,benchmarkReturn:metric?.benchmarkReturn??null,excessReturn:metric?.excessReturn??null,volumeChange:metric?.volumeChange??null,relativeVolume:metric?.relativeVolume??null,abnormalReturn:metric?.returnZScore??null,sectorReturn:null,asOf:metric?.end??null,dataQuality:{},reasons:[]};
 if(!crypto&&['5D','20D'].includes(window)&&adjusted!==true){for(const k of ['return','returnPct','excessReturn','returnZScore','abnormalReturn'])result[k]=null;result.reasons.push('분할·배당·권리락 조정 기준 미확인');}
 for(const k of keys)result.dataQuality[k]=!Number.isFinite(result[k])?'UNAVAILABLE':stale||!crypto&&adjusted!==true&&['return','excessReturn','abnormalReturn'].includes(k)?'PARTIAL':'VERIFIED';
 result.adjusted=crypto?null:adjusted;return result;
}
export function marketSession(market,now=Date.now()){
 const zone=market==='US'?'America/New_York':'Asia/Seoul',date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now),sessions=calendar.sessions[market==='US'?'XNYS':'XKRX'],session=sessions.find(s=>s.date===date);
 if(date<calendar.from||date>calendar.through)return {type:'unknown',date,timezone:zone,supported:false};
 if(!session)return {type:'holiday',date,timezone:zone,supported:true,preMarketPrice:null,afterHoursPrice:null};
 const current=market==='US'?usMarketSession(now).id:now<Date.parse(session.open)?'before_open':now<Date.parse(session.close)?'regular':'closed';
 return {type:current,date,timezone:zone,open:session.open,close:session.close,supported:true,priceSession:'regular_close',preMarketPrice:null,afterHoursPrice:null};
}
export function closedSession(market,now=Date.now()) {if(new Date(now).toISOString().slice(0,10)<calendar.from||new Date(now).toISOString().slice(0,10)>calendar.through)return null;return calendar.sessions[market==='US'?'XNYS':'XKRX'].filter(s=>Date.parse(s.close)+30*60000<=now).at(-1)||null;}
const daily=history=>(history||[]).map(b=>({date:b.date||b.at,close:b.close??b.value,volume:b.volume??null})).filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date||'')&&Number.isFinite(b.close)&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date));
export async function marketContext(env,store,asset,{now=Date.now(),strict=false}={}){
 const key='market:v6.1:'+asset.id,old=await store.cache(key);if(old&&!old.stale){if(strict&&old.value.stale)throw new CatalystError('market_stale',messages.market_stale);return old.value;}
 let result;
 if(asset.kind==='CRYPTO'){
  const service=cryptoService(env),end=Math.floor(now/3600000)*3600000-1,start=end-31*86400000;
  if(env.LOCAL_PREVIEW!==true&&env.CRYPTO_PUBLIC_DISPLAY!=='true')throw new CatalystError('market_failed',messages.market_failed);
  const raw=await service.klines(asset.instrument,'1h',start,end),base=asset.instrument==='BTCUSDT'?null:await service.klines('BTCUSDT','1h',start,end);
  let eth=[];try{eth=asset.instrument==='ETHUSDT'?raw:await service.klines('ETHUSDT','1h',start,end);}catch{}
  const convert=a=>a.filter(b=>b.closeTime<=end).map(b=>({date:new Date(b.closeTime+1).toISOString(),close:b.close,volume:b.volume}));
  const bars=convert(raw),bench=base?convert(base):bars,last=bars.at(-1);if(!last)throw new CatalystError('market_failed',messages.market_failed);
  const windows=Object.fromEntries([['1H',1],['4H',4],['24H',24],['7D',168]].map(([label,n])=>[label,windowMetrics(bars,n,bench)]));
  for(const [label,n] of [['1H',1],['4H',4],['24H',24],['7D',168]])if(windows[label]&&Date.parse(windows[label].end)-Date.parse(windows[label].start)!==n*3600000)windows[label]=null;
  for(const [label,n] of [['1H',1],['4H',4],['24H',24],['7D',168]]){const m=windows[label];windows[label]=qualityMetrics(m,{asset:asset.id,window:label,crypto:true,stale:now-Date.parse(last.date)>2*3600000});windows[label].btcReturn=m?.benchmarkReturn??null;windows[label].ethReturn=m?windowMetrics(bars,n,convert(eth))?.benchmarkReturn??null:null;windows[label].dataQuality.ethReturn=windows[label].ethReturn===null?'UNAVAILABLE':now-Date.parse(last.date)>2*3600000?'PARTIAL':'VERIFIED';}
  result={assetId:asset.id,price:last.close,currency:'USDT',windows,benchmark:'BTC/USDT',startAt:windows['24H']?.start,endAt:last.date,source:'Binance Spot 확정 1시간봉',receivedAt:new Date(now).toISOString(),basis:'마지막 확정 시간봉 종가 · UTC · 진행 중 봉 제외',stale:now-Date.parse(last.date)>2*3600000,sectorReturn:null,funding:null,openInterest:null,liquidations:null,limitations:['현물 기준 · 펀딩비·미결제약정·청산 데이터 미연결']};
 }else{
  const market=asset.kind==='US_STOCK'?'US':'KR',feed=await providers.stocks[market](env,{id:asset.symbol}),stock=feed.items?.find(s=>s.ticker===asset.symbol);if(feed.status!=='ready'||!stock)throw new CatalystError('market_failed',messages.market_failed);
  const session=closedSession(market,now);if(!session)throw new CatalystError('market_failed','거래일 달력 갱신이 필요합니다.');
  let bars,benchmark=[],benchmarkLabel;
  if(market==='US'){
   bars=daily(stock.history);benchmarkLabel='S&P 500 현물지수';
   try{const f=await fmpIndexHistory(env,'SPX');if(f.status==='ready'&&!f.stale)benchmark=daily(f.points);}catch{}
  }else{
   const f=await storedFscDaily(env,stock);bars=daily(f.bars);benchmarkLabel=stock.exchange==='KOSDAQ'?'KOSDAQ':'KOSPI';
   const b=await one(store.db,'SELECT payload FROM fsc_index_history WHERE id=?',benchmarkLabel);if(b)benchmark=daily(JSON.parse(b.payload));
  }
  bars=bars.filter(b=>b.date<=session.date);benchmark=benchmark.filter(b=>b.date<=session.date);const last=bars.at(-1);if(!last)throw new CatalystError('market_failed',messages.market_failed);
  const sessions=calendar.sessions[market==='US'?'XNYS':'XKRX'];const closeAt=date=>sessions.find(s=>s.date===date)?.close||null;
  const windows=Object.fromEntries([['1D',1],['5D',5],['20D',20]].map(([label,n])=>[label,windowMetrics(bars,n,benchmark)]));
  for(const [label,n] of [['1D',1],['5D',5],['20D',20]])if(windows[label]&&sessions.filter(s=>s.date>windows[label].start&&s.date<=windows[label].end).length!==n)windows[label]=null;
  // Do not invent adjusted multi-day returns for the domestic provider.
  if(market==='KR'){for(const key of ['5D','20D'])if(windows[key])windows[key]={...windows[key],returnPct:null,excessReturn:null,reason:'수정주가 기준 미확인'};if(windows['1D']&&last.date===stock.baseDate){windows['1D'].returnPct=stock.changePct;windows['1D'].excessReturn=Number.isFinite(stock.changePct)&&windows['1D'].benchmarkReturn!==null?stock.changePct-windows['1D'].benchmarkReturn:null;}}
  for(const label of ['1D','5D','20D'])windows[label]=qualityMetrics(windows[label],{asset:asset.id,window:label,adjusted:stock.adjustmentVerified===true?true:null,stale:!!feed.stale||last.date!==session.date});
  result={assetId:asset.id,price:last.close,currency:market==='US'?'USD':'KRW',windows,benchmark:benchmarkLabel,startAt:closeAt(windows['1D']?.start),endAt:closeAt(last.date),tradeDate:last.date,expectedDate:session.date,source:feed.source,receivedAt:stock.historyReceivedAt||feed.receivedAt||stock.syncedAt||null,basis:'정규장 확정 일봉 · 거래일 기준',stale:!!feed.stale||last.date!==session.date,marketCap:stock.marketCap??null,sector:stock.sector||null,industry:stock.industry||null,sectorReturn:null,nextKoreanSession:market==='US'?calendar.sessions.XKRX.find(s=>Date.parse(s.open)>Date.parse(closeAt(last.date)))||null:null,limitations:[...(market==='KR'?['수정주가 검증 전: 5D·20D 수익률 미표시']:[]),'산업 지수와 동일 기간 비교 자료 미연결']};
 }
 result.session=asset.kind==='CRYPTO'?{type:'continuous',priceSession:'closed_hour',timezone:'UTC'}:marketSession(asset.kind==='US_STOCK'?'US':'KR',now);
 result.contextOnly=true;
 if(asset.kind==='CRYPTO'){const meta=await store.fact(asset.id,'crypto');result.marketCap=Number.isFinite(meta?.marketData?.marketCap)?meta.marketData.marketCap:null;result.marketCapAsOf=meta?.asOf||null;result.spotVolume=result.windows['24H']?.volume??null;result.futuresVolume=null;}
 result.dataQuality={marketCap:Number.isFinite(result.marketCap)?'PARTIAL':'UNAVAILABLE',sectorReturn:'UNAVAILABLE',funding:'UNAVAILABLE',openInterest:'UNAVAILABLE',liquidations:'UNAVAILABLE',futuresVolume:'UNAVAILABLE'};
 await store.putCache(key,result,asset.kind==='CRYPTO'?config.ttl.cryptoMove:config.ttl.stockMove);
 if(strict&&result.stale)throw new CatalystError('market_stale',messages.market_stale);return result;
}
