import {FinvizError} from './finviz-client.mjs';

// This JSON route is used by Finviz's official Futures Prices page, verified
// 2026-09-27. It is a website quote route, not the Elite CSV export contract.
// No auth token is sent. Display is gated by FINVIZ_FUTURES_POLICY in the caller.
const endpoint='https://elite.finviz.com/api/futures_all';
const names={ES:'S&P 500',NQ:'Nasdaq 100',YM:'DJIA'};
const requests=new WeakMap();
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function parseFuturesQuotes(data,receivedAt){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new FinvizError('Finviz 선물 시세 형식 확인 필요');
 return Object.entries(names).flatMap(([id,name])=>{
  const q=data[id];if(!q)return [];
  if(q.ticker!==id||q.label!==name||!finite(q.last)||q.last<=0||!finite(q.change)||!finite(q.changeUsd))return [];
  return [{id,symbol:'@'+id,name,value:q.last,change:q.changeUsd,changePct:q.change,
   changeBasis:'provider_daily',changeUnit:'points',changeSource:'Finviz Futures Prices · changeUsd',
   // prevClose is a chart close and can differ from the daily-change base.
   // Never recalculate or relabel it as a verified settlement price.
   reportedPreviousClose:finite(q.prevClose)?q.prevClose:null,
   contractName:null,contractMonth:null,instrumentType:'futures_reference',contractStatus:'unverified',
   asOf:receivedAt,asOfKind:'received',receivedAt,mode:'delayed',delayMinutes:null,history:[]}];
 });
}
export async function finvizFuturesQuotes(env){
 const key=env.DB||env,cached=requests.get(key);if(cached&&cached.until>Date.now())return cached.promise;
 const entry={until:Date.now()+120000};
 entry.promise=(async()=>{
  const saved=env.DB?(await env.DB.prepare("SELECT payload,next_attempt FROM finviz_futures_quotes WHERE id='prices'").all()).results[0]:null;
  if(saved?.payload&&saved.next_attempt>Date.now())return JSON.parse(saved.payload);
  try{
   const r=await fetch(endpoint,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
   if(r.status===429){const error=new FinvizError('Finviz 선물 조회 한도 대기');error.retryMs=Math.min(86400000,Math.max(300000,Number(r.headers.get('retry-after'))*1000||300000));throw error;}
   if(!r.ok||!/application\/json/i.test(r.headers.get('content-type')||''))throw new FinvizError('Finviz 선물 시세 연결 오류');
   if(Number(r.headers.get('content-length')||0)>1000000)throw new FinvizError('Finviz 선물 시세 응답 크기 오류');
   const reader=r.body.getReader(),decoder=new TextDecoder();let text='',size=0;
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1000000){await reader.cancel();throw new FinvizError('Finviz 선물 시세 응답 크기 오류');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
   const receivedAt=new Date().toISOString(),items=parseFuturesQuotes(JSON.parse(text),receivedAt);
   if(items.length!==3)throw new FinvizError('Finviz 선물 시세 항목 확인 필요');
   const result={items,receivedAt,stale:false};
   if(env.DB)await env.DB.prepare("INSERT INTO finviz_futures_quotes(id,payload,next_attempt) VALUES('prices',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,next_attempt=excluded.next_attempt").bind(JSON.stringify(result),entry.until).run();
   return result;
  }catch(error){
   entry.until=Date.now()+(error.retryMs||120000);
   if(saved?.payload){const result={...JSON.parse(saved.payload),stale:true};if(env.DB)await env.DB.prepare("UPDATE finviz_futures_quotes SET payload=?,next_attempt=? WHERE id='prices'").bind(JSON.stringify(result),entry.until).run();return result;}
   throw new FinvizError('Finviz 선물 시세 연결 오류');
  }
 })();requests.set(key,entry);return entry.promise;
}
