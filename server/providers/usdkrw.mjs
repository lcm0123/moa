import {twelveRequest} from './twelve-data-client.mjs';
import {getPolicy} from './base.mjs';
import {ecosFeed} from './ecos.mjs';
const source='Twelve Data',pending=new WeakMap();
const number=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const fail=code=>Object.assign(new Error('FX data unavailable'),{code});
export function normalizeFxQuote(data,receivedAt){
 if(data.symbol!=='USD/KRW'||data.name!=='US Dollar / Korean Won'||data.exchange!=='Forex')throw fail('identity_mismatch');
 const value=number(data.close),quoteAt=number(data.last_quote_at);
 // timestamp is the session opening time in this response, NOT the latest quote.
 if(!(value>0)||!(quoteAt>0)||quoteAt*1000>Date.parse(receivedAt)+60000)throw fail('invalid_quote');
 const asOf=new Date(quoteAt*1000).toISOString();
 return {id:'USDKRW',name:'원·달러 환율',value,change:number(data.change),changePct:number(data.percent_change),previousValue:number(data.previous_close),
  asOf,asOfKind:'timestamp',baseDate:asOf.slice(0,10),sourceDate:data.datetime,sessionTimestamp:data.timestamp,syncedAt:receivedAt,
  source,sourceUrl:'https://twelvedata.com/forex',provider:'twelve_data_fx',mode:'periodic',refreshSeconds:300,neutral:true,unit:'원',instrumentType:'fx',
  session:data.is_market_open===true?'open':data.is_market_open===false?'closed':'unknown',basis:'국제 외환 시세 · 공급사 전일 종가 대비',closeLabel:'외환 시세 · 5분 갱신',historyKind:'daily',history:[]};
}
export function normalizeFxHistory(data,receivedAt,interval){
 if(data.meta?.symbol!=='USD/KRW'||data.meta?.type!=='Physical Currency'||data.meta?.currency_base!=='US Dollar'||data.meta?.currency_quote!=='Korean Won'||data.meta?.interval!==interval)throw fail('identity_mismatch');
 const seen=new Map();
 for(const r of data.values||[]){const at=interval==='1day'?r.datetime:r.datetime?.replace(' ','T')+'Z',value=number(r.close);if(!(value>0)||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.parse(receivedAt)+60000)throw fail('invalid_history');if(seen.has(at)&&seen.get(at)!==value)throw fail('duplicate_history');seen.set(at,value);}
 if(!seen.size)throw fail('empty_history');return {points:[...seen].sort(([a],[b])=>a.localeCompare(b)).map(([at,value])=>({at,value})),receivedAt,interval};
}
async function saved(env,key){return (await env.DB.prepare('SELECT * FROM fx_cache WHERE cache_key=?').bind(key).all()).results[0];}
async function sync(env,key,now,request){
 let jobs=pending.get(env.DB);if(!jobs){jobs=new Map();pending.set(env.DB,jobs);}if(jobs.has(key))return jobs.get(key);
 const job=(async()=>{const previous=await saved(env,key);if(previous?.next_attempt>now)return previous;
  try{const interval=key==='intraday'?'1min':'1day',result=await request(env,key==='quote'?'/quote':'/time_series',key==='quote'?{symbol:'USD/KRW',timezone:'UTC'}:{symbol:'USD/KRW',interval,outputsize:key==='intraday'?'480':'1000',timezone:'UTC'});
   if(result.httpStatus!==200||result.data.status==='error'){const code=[401,403,404,429].find(c=>c===Number(result.data.code)||c===result.httpStatus);throw fail(code?String(code):'request_failed');}
   const payload=key==='quote'?normalizeFxQuote(result.data,result.receivedAt):normalizeFxHistory(result.data,result.receivedAt,interval);
   await env.DB.prepare('INSERT INTO fx_cache VALUES(?,?,?,NULL) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,next_attempt=excluded.next_attempt,error_code=NULL').bind(key,JSON.stringify(payload),now+(key==='quote'?300000:key==='intraday'?900000:21600000)).run();
  }catch(e){const code=/^[a-z_0-9]+$/.test(e.code||'')?e.code:'request_failed';await env.DB.prepare('INSERT INTO fx_cache(cache_key,next_attempt,error_code) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET next_attempt=excluded.next_attempt,error_code=excluded.error_code').bind(key,now+(['401','403','404','429','daily_limit'].includes(code)?86400000:300000),code).run();}
  return saved(env,key);
 })();jobs.set(key,job);try{return await job;}finally{jobs.delete(key);}
}
export async function fxFeed(env,{now=Date.now(),request=twelveRequest}={}){
 const policy=env.LOCAL_PREVIEW?{display:true,chart:true}:getPolicy(env,'TWELVE_DATA_FX');
 const base={source,policy,items:[],status:'disconnected',mode:'periodic'};
 if(!policy.display)return {...base,status:'restricted',message:'Twelve Data 환율 표시 설정 필요'};
 if(!env.DB||!env.TWELVE_DATA_API_KEY)return {...base,message:'환율 시세 연결 설정 필요'};
 const quote=await sync(env,'quote',now,request);if(!quote?.payload)return {...base,status:'error',message:'장중 환율 조회 실패',errorCode:quote?.error_code};
 const item=JSON.parse(quote.payload),history=policy.chart?await sync(env,'daily',now,request):null;
 item.history=history?.payload?JSON.parse(history.payload).points:[];item.historySyncedAt=history?.payload?JSON.parse(history.payload).receivedAt:null;item.historyAsOf=item.history.at(-1)?.at;item.historyStale=!!history?.error_code;item.chartAllowed=policy.chart;
 item.stale=!!quote.error_code||now-Date.parse(item.syncedAt)>600000||item.session==='open'&&now-Date.parse(item.asOf)>1800000;
 return {...base,status:'ready',items:[item],stale:item.stale,message:'외환 시세 · 서버 5분 갱신 · 은행 매매기준율과 다름'};
}
export async function fxHistory(env,resolution='daily'){
 const feed=await fxFeed(env),item=feed.items[0];if(!item||!feed.policy.chart)return {status:'unavailable',points:[],message:feed.message};
 const intraday=resolution==='intraday',row=intraday?await sync(env,'intraday',Date.now(),twelveRequest):null;
 const points=intraday?(row?.payload?JSON.parse(row.payload).points:[]):item.history;
 return {status:points.length?'ready':'unavailable',source,points,historyKind:intraday?'intraday':'daily',asOf:points.at(-1)?.at,quoteAsOf:item.asOf,mode:'periodic',basis:item.basis,baseDate:item.baseDate,syncedAt:intraday&&row?.payload?JSON.parse(row.payload).receivedAt:item.historySyncedAt,stale:item.stale||!!row?.error_code||!intraday&&item.historyStale,unit:'원',supportsIntraday:true,message:points.length?'':'이 구간의 환율 이력이 없습니다.'};
}
export async function domesticMacroFeed(env){
 const daily=await ecosFeed(env);
 if(!env.TWELVE_DATA_API_KEY)return daily;
 const fx=await fxFeed(env);
 if(fx.status!=='ready')return {...daily,fxStatus:fx.status,fxMessage:fx.message};
 return {...daily,status:'ready',items:[...daily.items.filter(x=>x.id!=='USDKRW'),...fx.items],policy:{display:true,chart:daily.policy.chart||fx.policy.chart},source:'한국은행 ECOS / Twelve Data',message:'환율: 외환 시세 · 5분 갱신 / 금리: ECOS 일별 자료',stale:daily.stale||fx.stale};
}
