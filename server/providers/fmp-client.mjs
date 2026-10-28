import {digest} from './finviz-client.mjs';
import {usMarketSession} from '../us-market-session.mjs';
export const FMP_DAY=86400000;
const paths=new Set(['/stable/quote','/stable/historical-price-eod/light','/stable/historical-chart/5min','/stable/batch-index-quotes','/stable/index-list','/stable/forex-list','/stable/revenue-product-segmentation','/stable/revenue-geographic-segmentation']);
const pending=new Map();
export class FmpError extends Error {constructor(code,message){super(message);this.code=code;}}
export function fmpCacheTtl(path,now=Date.now()){
 const open=usMarketSession(now).id==='regular';
 let closedTtl=21600000;
 if(!open&&(path==='/stable/quote'||path==='/stable/historical-chart/5min')){
  // A premarket cache must expire at the open, not six hours into the session.
  for(let minutes=1;minutes<=360;minutes++)if(usMarketSession(now+minutes*60000).id==='regular'){closedTtl=minutes*60000;break;}
 }
 if(path==='/stable/quote')return open?1800000:closedTtl;
 if(path==='/stable/historical-chart/5min')return open?3600000:closedTtl;
 return FMP_DAY;
}
export async function reserveFmpCredit(DB,keyHash,now=Date.now()){
 if(!DB)throw new FmpError('storage_required','FMP 호출 제한 저장소 연결 필요');
 const rows=await DB.prepare(`INSERT INTO fmp_requests(id,key_hash,requested_at) SELECT ?,?,?
 WHERE (SELECT COUNT(*) FROM fmp_requests WHERE key_hash=? AND requested_at>?)<240 RETURNING id`)
 .bind(crypto.randomUUID(),keyHash,now,keyHash,now-FMP_DAY).all();
 if(!rows.results.length)throw new FmpError('daily_limit','FMP 하루 호출 한도 대기');
 await DB.prepare('DELETE FROM fmp_requests WHERE requested_at<=?').bind(now-FMP_DAY).run();
}
function safeText(text,key){return String(text).replaceAll(key,'[redacted]').replaceAll(encodeURIComponent(key),'[redacted]').replace(/https?:\/\/[^\s"<>]*[?&](?:apikey|api_key|auth)=[^\s"<>]*/gi,'[request omitted]');}
export function fmpFailure(status,data){
 const message=String(data?.['Error Message']??data?.error??data?.message??'');
 if(status===401||/invalid api.?key/i.test(message))return 'authentication_error';
 if(status===429||/limit reach|limit exceeded|too many|bandwidth|quota/i.test(message))return 'rate_limited';
 if([402,403].includes(status)||/premium|subscription|upgrade|restricted endpoint|not available.*plan/i.test(message))return 'access_denied';
 if(status===404)return 'not_found';
 if(status!==200||message)return 'provider_error';
 if(!Array.isArray(data))return 'invalid_response';
 if(!data.length)return 'empty';
 return null;
}
export async function fmpRequest(env,path,params={}){
 const key=env.FMP_API_KEY?.trim();if(!key)throw new FmpError('key_missing','FMP_API_KEY 설정 필요');
 const segmentation=path.startsWith('/stable/revenue-');
 if(!paths.has(path)||Object.keys(params).some(k=>!(segmentation?['symbol','period']:['symbol','from','to']).includes(k))||segmentation&&!['annual','quarter'].includes(params.period)||String(params.symbol||'').includes(','))throw new FmpError('invalid_request','허용되지 않은 FMP Stable 조회');
 if(!env.DB)throw new FmpError('storage_required','FMP 호출 제한 저장소 연결 필요');
 const query=new URLSearchParams(params);query.sort();
 const keyHash=await digest(key),cacheKey=await digest(keyHash+path+'?'+query),now=Date.now();
 const cached=(await env.DB.prepare('SELECT payload FROM fmp_cache WHERE cache_key=? AND expires_at>?').bind(cacheKey,now).all()).results[0];
 if(cached)return {...JSON.parse(cached.payload),cached:true};
 const block=(await env.DB.prepare('SELECT reason,until_at FROM fmp_blocks WHERE scope IN (?,?) AND until_at>? ORDER BY until_at DESC').bind(keyHash,cacheKey,now).all()).results[0];
 if(block)return {httpStatus:null,format:null,error:block.reason,blocked:true,data:null,receivedAt:null,cached:true};
 if(pending.has(cacheKey))return pending.get(cacheKey);
 const promise=(async()=>{
  await reserveFmpCredit(env.DB,keyHash);
  let result;
  try{
   // FMP Stable requires a query credential. Never log the request URL or raw exceptions.
   const url=new URL('https://financialmodelingprep.com'+path);url.search=query;url.searchParams.set('apikey',key);
   const response=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
   const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4000000){await reader.cancel();throw new Error('size');}text+=decoder.decode(part.value,{stream:true});}
   text=safeText(text+decoder.decode(),key);let data,format='JSON';
   try{data=JSON.parse(text);}catch{format=/^\s*</.test(text)?'HTML':'text';data={message:text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400)};}
   result={httpStatus:response.status,format,data,error:fmpFailure(response.status,data),receivedAt:new Date().toISOString(),cached:false};
  }catch{result={httpStatus:null,format:null,data:{message:'FMP 연결 또는 응답 오류'},error:'connection_error',receivedAt:new Date().toISOString(),cached:false};}
  const permanent=['authentication_error','access_denied','not_found'].includes(result.error);
  if(permanent||result.error==='rate_limited'){
   const scope=['authentication_error','rate_limited'].includes(result.error)?keyHash:cacheKey;
   await env.DB.prepare('INSERT INTO fmp_blocks(scope,reason,until_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET reason=excluded.reason,until_at=excluded.until_at').bind(scope,result.error,permanent?8640000000000000:Date.now()+FMP_DAY).run();
  }
  const ttl=permanent||result.error==='rate_limited'?FMP_DAY:result.error?3600000:fmpCacheTtl(path);
  await env.DB.prepare('INSERT INTO fmp_cache(cache_key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(cacheKey,JSON.stringify(result),Date.now()+ttl).run();
  return result;
 })();pending.set(cacheKey,promise);try{return await promise;}finally{pending.delete(cacheKey);}
}
