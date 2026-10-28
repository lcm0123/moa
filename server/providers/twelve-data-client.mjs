import {digest} from './finviz-client.mjs';
const endpoints=new Set(['/indices','/symbol_search','/quote','/time_series']);
const pending=new Map();
const DAY=86400000,MINUTE=60001;
export class TwelveDataError extends Error {
 constructor(code,message,retryAfterMs=null){super(message);this.code=code;this.retryAfterMs=retryAfterMs;}
}
export async function reserveTwelveCredit(DB,keyHash,now=Date.now()){
 if(!DB)throw new TwelveDataError('storage_required','호출 제한 저장소 연결 필요');
 // Atomic SQL reservation protects the shared account budget across server restarts/processes.
 const rows=await DB.prepare(`INSERT INTO twelve_data_requests(id,key_hash,requested_at)
 SELECT ?,?,? WHERE (SELECT COUNT(*) FROM twelve_data_requests WHERE key_hash=? AND requested_at>?)<8
 AND (SELECT COUNT(*) FROM twelve_data_requests WHERE key_hash=? AND requested_at>?)<800 RETURNING id`)
 .bind(crypto.randomUUID(),keyHash,now,keyHash,now-MINUTE,keyHash,now-DAY).all();
 if(rows.results.length){await DB.prepare('DELETE FROM twelve_data_requests WHERE requested_at<=?').bind(now-DAY).run();return;}
 const usage=(await DB.prepare('SELECT requested_at FROM twelve_data_requests WHERE key_hash=? AND requested_at>? ORDER BY requested_at').bind(keyHash,now-DAY).all()).results;
 const recent=usage.filter(r=>r.requested_at>now-MINUTE),wait=usage.length>=800?usage[0].requested_at+DAY-now:(recent[0]?.requested_at??now)+MINUTE-now;
 throw new TwelveDataError(usage.length>=800?'daily_limit':'minute_limit','Twelve Data 호출 한도 대기',Math.max(1,wait));
}
export async function twelveRequest(env,path,params={}){
 const key=env.TWELVE_DATA_API_KEY?.trim();if(!key)throw new TwelveDataError('key_missing','TWELVE_DATA_API_KEY 설정 필요');
 if(!endpoints.has(path)||Object.keys(params).some(k=>!['symbol','country','show_plan','outputsize','interval','timezone','exchange'].includes(k))||String(params.symbol||'').includes(','))throw new TwelveDataError('invalid_request','허용되지 않은 Twelve Data 조회');
 if(!env.DB)throw new TwelveDataError('storage_required','호출 제한 저장소 연결 필요');
 const query=new URLSearchParams(params);query.sort();const keyHash=await digest(key),cacheKey=await digest(keyHash+path+'?'+query),now=Date.now();
 const saved=(await env.DB.prepare('SELECT payload FROM twelve_data_cache WHERE cache_key=? AND expires_at>?').bind(cacheKey,now).all()).results[0];
 if(saved)return {...JSON.parse(saved.payload),cached:true};
 if(pending.has(cacheKey))return pending.get(cacheKey);
 const promise=(async()=>{
  await reserveTwelveCredit(env.DB,keyHash);
  let result;
  try{
   const response=await fetch('https://api.twelvedata.com'+path+'?'+query,{headers:{Accept:'application/json',Authorization:'apikey '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
   const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000000){await reader.cancel();throw new Error('size');}text+=decoder.decode(part.value,{stream:true});}
   text+=decoder.decode();const data=JSON.parse(text.replaceAll(key,'[redacted]'));
   result={httpStatus:response.status,data,receivedAt:new Date().toISOString(),cached:false};
  }catch{result={httpStatus:null,data:{status:'error',code:'connection_error',message:'Twelve Data 연결 또는 JSON 응답 오류'},receivedAt:new Date().toISOString(),cached:false};}
  const code=result.data.code,failed=result.httpStatus!==200||result.data.status==='error';
  const unavailable=[401,403].includes(Number(code))||Number(code)===404;
  const ttl=failed?(unavailable?DAY:Number(code)===429?MINUTE:60000):params.symbol==='USD/KRW'&&path==='/quote'?300000:params.symbol==='USD/KRW'&&path==='/time_series'&&params.interval==='1min'?900000:path==='/quote'?900000:path==='/time_series'?21600000:DAY;
  await env.DB.prepare('INSERT INTO twelve_data_cache(cache_key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(cacheKey,JSON.stringify(result),Date.now()+ttl).run();
  return result;
 })();pending.set(cacheKey,promise);try{return await promise;}finally{pending.delete(cacheKey);}
}
