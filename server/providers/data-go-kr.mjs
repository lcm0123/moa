import {unavailable} from './base.mjs';
import {fscOperations,fscSource,normalizeFscItem,parseFscResponse,fscPolicy,kstDate,dateBefore,nextFscSync,stampFscRows,fscHash} from './data-go-kr-model.mjs';
import requestPolicy from '../../config/fsc-request-policy.json' with {type:'json'};
const inflight=new WeakMap();
const authenticationCodes=/^(HTTP_40[123]|FSC_(20|29|30|31))$/;
let activeRequests=0;
const requestWaiters=[];
const credentialColumns=new WeakMap();
export const fscAuthenticationFailure=code=>authenticationCodes.test(code||'');
export function fscFailureCode(error,fallback='REQUEST_FAILED'){
 const code=error?.code||error?.message||'';
 if(/^(HTTP_\d{3}|FSC_\w+|NO_DATA|NO_HISTORY|REQUEST_TIMEOUT|REQUEST_DEADLINE|REQUEST_LIMIT|RESPONSE_TOO_LARGE|SCHEMA_CHANGED|INCOMPLETE_PAGE|INCOMPLETE_HISTORY|INVALID_HISTORY_IDENTITY|INVALID_HISTORY|INVALID_DATA|INVALID_PAGE|TOO_MANY_PAGES|MIXED_OR_DUPLICATE_DATA)$/.test(code))return code;
 return error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':fallback;
}
export function createFscRequestBudget({clock=Date.now,timeoutMs=requestPolicy.requestTimeoutMs,deadlineMs=requestPolicy.operationDeadlineMs,maxRequests=requestPolicy.maxRequests}={}){
 return {clock,timeoutMs:Math.max(1,Math.min(timeoutMs,requestPolicy.requestTimeoutMs)),deadline:clock()+Math.max(1,Math.min(deadlineMs,requestPolicy.operationDeadlineMs)),maxRequests:Math.max(1,Math.min(maxRequests,requestPolicy.maxRequests)),requests:0};
}
export async function fscCredentialVersion(env){return fscHash(secret(env));}
export async function fscHasCredentialColumn(db,table){
 if(!['fsc_stock_history','fsc_index_history'].includes(table))throw new Error('INVALID_TABLE');
 let cache=credentialColumns.get(db);if(!cache){cache=new Map();credentialColumns.set(db,cache);}
 if(!cache.has(table))cache.set(table,(await db.prepare(`PRAGMA table_info(${table})`).all()).results.some(column=>column.name==='credential_version'));
 return cache.get(table);
}
function releaseRequest(){activeRequests--;requestWaiters.shift()?.();}
async function acquireRequest(signal){
 if(signal.aborted)throw Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'});
 if(activeRequests<requestPolicy.maxConcurrentRequests){activeRequests++;return releaseRequest;}
 return new Promise((resolve,reject)=>{
  const ready=()=>{signal.removeEventListener('abort',aborted);activeRequests++;resolve(releaseRequest);};
  const aborted=()=>{const i=requestWaiters.indexOf(ready);if(i>=0)requestWaiters.splice(i,1);reject(Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'}));};
  signal.addEventListener('abort',aborted,{once:true});requestWaiters.push(ready);
 });
}
function retryAfter(response,now){
 const value=response.headers?.get?.('retry-after');if(!value)return null;
 const delay=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
 return Number.isFinite(delay)&&delay>=0?Math.min(delay,requestPolicy.maxRetryAfterMs):null;
}
async function readFscBody(response,signal){
 if(signal.aborted){await response.body?.cancel?.().catch(()=>{});throw Error('REQUEST_TIMEOUT');}
 const length=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(length)&&length>requestPolicy.maxResponseBytes){await response.body?.cancel?.().catch(()=>{});throw Error('RESPONSE_TOO_LARGE');}
 if(!response.body?.getReader){const text=await response.text();if(new TextEncoder().encode(text).byteLength>requestPolicy.maxResponseBytes)throw Error('RESPONSE_TOO_LARGE');return text;}
 const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let size=0,count=0;
 const abort=()=>void reader.cancel().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;count++;
   if(size>requestPolicy.maxResponseBytes||count>requestPolicy.maxResponseChunks)throw Error('RESPONSE_TOO_LARGE');
   parts.push(decoder.decode(value,{stream:true}));
  }
  parts.push(decoder.decode());return parts.join('');
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
const textErrors={HTTP_403:'활용신청 승인 또는 서비스 접근 권한을 확인해 주세요.',HTTP_401:'인증키를 확인해 주세요.',FSC_20:'활용신청 승인 또는 서비스 접근 권한을 확인해 주세요.',FSC_30:'인증키를 확인해 주세요.',FSC_31:'인증키 이용 기간을 확인해 주세요.',HTTP_429:'API 호출 한도 초과',FSC_22:'API 일일 호출 한도 초과',FSC_23:'API 호출 속도 제한',NO_DATA:'최근 기준일의 데이터가 아직 제공되지 않았습니다.'};
const failMessage=code=>textErrors[code]||'일별 시세 동기화 실패 · 마지막 저장 자료';
function secret(env){let key=String(env.DATA_GO_KR_SERVICE_KEY||'').trim();try{key=decodeURIComponent(key)}catch{}return key;}
const latest=async(db,operation)=>(await db.prepare('SELECT * FROM fsc_daily_snapshots WHERE operation=? ORDER BY base_date DESC LIMIT 1').bind(operation).all()).results[0];
const state=async(db,operation)=>(await db.prepare('SELECT * FROM fsc_sync_state WHERE operation=?').bind(operation).all()).results[0];
export async function requestFscPage(env,operation,params,{fetcher=fetch,budget=createFscRequestBudget()}={}){
 const def=fscOperations[operation];if(!def)throw new Error('INVALID_OPERATION');const key=secret(env);if(!key)throw new Error('MISSING_KEY');
 const url=new URL('https://apis.data.go.kr/1160100/'+def.path);url.search=new URLSearchParams({...params,resultType:'json',serviceKey:key});
 if(budget.requests>=budget.maxRequests)throw Object.assign(new Error('FSC request failed'),{code:'REQUEST_LIMIT'});
 const remaining=budget.deadline-budget.clock();if(remaining<=0)throw Object.assign(new Error('FSC request failed'),{code:'REQUEST_DEADLINE'});
 const controller=new AbortController(),timeout=Math.min(remaining,budget.timeoutMs);let timer,release;
 const deadlineCode=remaining<=budget.timeoutMs?'REQUEST_DEADLINE':'REQUEST_TIMEOUT';
 const expiration=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('FSC request failed'),{code:deadlineCode}));},timeout);});
 // No application or SDK retries. Bound queue waiting, fetch, and body reading
 // together, including test providers that do not implement AbortSignal.
 try{
  return await Promise.race([expiration,(async()=>{
   release=await acquireRequest(controller.signal);
   if(budget.requests>=budget.maxRequests)throw Object.assign(new Error('FSC request failed'),{code:'REQUEST_LIMIT'});
   if(budget.clock()>=budget.deadline)throw Object.assign(new Error('FSC request failed'),{code:'REQUEST_DEADLINE'});
   budget.requests++;
   const response=await fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:controller.signal});
   const text=await readFscBody(response,controller.signal);
   let parsed;try{parsed=parseFscResponse(text,response.status);}catch(error){error.retryAfterMs=retryAfter(response,budget.clock());throw error;}
   const responseHash=await fscHash(text);await stampFscRows(parsed.items,{responseHash,page:parsed.page,itemShape:parsed.itemShape});
   return {...parsed,responseHash};
  })()]);
 }catch(error){throw Object.assign(new Error('FSC request failed'),{code:fscFailureCode(error),...(Number.isFinite(error.retryAfterMs)?{retryAfterMs:error.retryAfterMs}:{})});}
 finally{clearTimeout(timer);release?.();}
}
export async function syncFscOperation(env,operation,{now=Date.now(),fetcher=fetch}={}){
 const db=env.DB;if(!db||!secret(env))return {status:'disconnected',message:!db?'시세 저장소 연결 필요':'공공데이터포털 키 등록 필요'};
 if(!fscOperations[operation])throw new Error('INVALID_OPERATION');
 let running=inflight.get(db);if(!running){running=new Map();inflight.set(db,running)}if(running.has(operation))return running.get(operation);
 const task=(async()=>{
  const fingerprint=await fscCredentialVersion(env),at=new Date(now).toISOString(),leaseUntil=now+180000,budget=createFscRequestBudget();
  const previous=await state(db,operation);
  if(previous&&fscAuthenticationFailure(previous.error_code)&&previous.credential_version===fingerprint)return previous;
  await db.prepare('INSERT INTO fsc_sync_state(operation) VALUES(?) ON CONFLICT(operation) DO NOTHING').bind(operation).run();
  const lease=await db.prepare('UPDATE fsc_sync_state SET next_attempt=?,last_attempt=?,credential_version=? WHERE operation=? AND (next_attempt<=? OR credential_version<>?)').bind(leaseUntil,at,fingerprint,operation,now,fingerprint).run();
  if(!lease.meta.changes)return state(db,operation);
  try{
   const old=await latest(db,operation),first=dateBefore(kstDate(now));let found=null,baseDate=null;
   for(let offset=0;offset<requestPolicy.maxDateLookbacks;offset++){
    const date=dateBefore(first,offset);if(old&&date<old.base_date)break;
    const params={basDt:date.replaceAll('-',''),numOfRows:'1000',pageNo:'1'},initial=await requestFscPage(env,operation,params,{fetcher,budget});if(!initial.total)continue;
    if(initial.page!==1||initial.total>requestPolicy.maxRows)throw new Error('INVALID_PAGE');const rows=[...initial.items];
    for(let page=2;rows.length<initial.total;page++){
     if(page>requestPolicy.maxSnapshotPages)throw new Error('TOO_MANY_PAGES');const next=await requestFscPage(env,operation,{...params,pageNo:String(page)},{fetcher,budget});
     if(next.page!==page||next.total!==initial.total||next.size!==initial.size||!next.items.length)throw new Error('INCOMPLETE_PAGE');rows.push(...next.items);
    }
    if(rows.length!==initial.total)throw new Error('INCOMPLETE_PAGE');
    found=rows.map(r=>normalizeFscItem(r,operation,at));baseDate=date;
    if(found.some(r=>r.baseDate!==baseDate)||new Set(found.map(r=>r.id)).size!==found.length)throw new Error('MIXED_OR_DUPLICATE_DATA');break;
   }
   if(!found)throw Object.assign(new Error('NO_DATA'),{code:'NO_DATA'});
   // A newer worker may have reclaimed the lease or changed credentials during fetch.
   // Fence both writes inside the transaction so its snapshot and status stay together.
   await db.batch([
    db.prepare('INSERT INTO fsc_daily_snapshots(operation,base_date,synced_at,payload) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM fsc_sync_state WHERE operation=? AND next_attempt=? AND last_attempt=? AND credential_version=?) ON CONFLICT(operation,base_date) DO UPDATE SET synced_at=excluded.synced_at,payload=excluded.payload').bind(operation,baseDate,at,JSON.stringify(found),operation,leaseUntil,at,fingerprint),
    db.prepare('UPDATE fsc_sync_state SET last_success=?,base_date=?,next_attempt=?,error_code=NULL WHERE operation=? AND next_attempt=? AND last_attempt=? AND credential_version=?').bind(at,baseDate,nextFscSync(now),operation,leaseUntil,at,fingerprint)
   ]);
  }catch(e){const code=fscFailureCode(e,'SYNC_FAILED');const long=fscAuthenticationFailure(code)||/^(HTTP_429|FSC_2[23])$/.test(code);await db.prepare('UPDATE fsc_sync_state SET next_attempt=?,error_code=? WHERE operation=? AND next_attempt=? AND last_attempt=? AND credential_version=?').bind(now+Math.max(long?86400000:3600000,e.retryAfterMs||0),code,operation,leaseUntil,at,fingerprint).run();}
  return state(db,operation);
 })();running.set(operation,task);try{return await task}finally{running.delete(operation)}
}
export async function syncFscAll(env,options={}){const results=[];for(const operation of Object.keys(fscOperations)){const s=await syncFscOperation(env,operation,options);results.push({operation,baseDate:s.base_date||null,lastSync:s.last_success||null,errorCode:s.error_code||null,status:s.status|| (s.error_code?'error':'ready')});}return results;}
async function operationFeed(env,operation,feature='display'){
 const policy=fscPolicy(env,fscOperations[operation].family);
 if(!policy.display||!policy[feature])return {...unavailable('공공데이터 외부 표시 이용허락 설정이 필요합니다.','restricted',policy),provider:'data_go_kr',source:fscSource};
 if(!env.DB)return unavailable('시세 저장소 연결 필요');
 try{await syncFscOperation(env,operation);}catch{}
 const row=await latest(env.DB,operation),sync=await state(env.DB,operation);
 if(!row)return {...unavailable(sync?.error_code?failMessage(sync.error_code):'공공데이터포털 키 등록 또는 첫 동기화 필요',sync?.error_code?'error':'disconnected',policy),provider:'data_go_kr',source:fscSource,errorCode:sync?.error_code||null};
 const stale=!!sync?.error_code,items=JSON.parse(row.payload).map(s=>({...s,stale,syncedAt:row.synced_at}));
 return {status:'ready',provider:'data_go_kr',source:fscSource,items,policy,mode:'previous_close',asOf:row.base_date,asOfKind:'date',baseDate:row.base_date,syncedAt:row.synced_at,session:'unknown',stale,errorCode:sync?.error_code||null,message:stale?failMessage(sync.error_code):'',nextSyncAt:sync?.next_attempt?new Date(sync.next_attempt).toISOString():null};
}
export async function fscStocks(env,params={},feature='display'){
 const operations=['ranking','treemap'].includes(feature)?['stocks']:['stocks','etf','etn','elw'];
 const feeds=await Promise.all(operations.map(op=>operationFeed(env,op,feature)));
 const ready=feeds.filter(f=>f.status==='ready');if(!ready.length)return feeds[0];
 // Never merge same ticker mapped to conflicting ISINs or dates within an operation.
 const items=ready.flatMap(f=>f.items),ids=new Map();for(const s of items){if(ids.has(s.id))ids.set(s.id,null);else ids.set(s.id,s)}
 let result=[...ids.values()].filter(Boolean);
 if(params.id)result=result.filter(s=>s.id===params.id);
 if(params.q){const q=String(params.q).toLowerCase();result=result.filter(s=>(s.name+' '+s.ticker).toLowerCase().includes(q));}
 const selected=result.length?ready.find(f=>f.items.some(i=>i.id===result[0].id))||ready[0]:ready[0];
 // Product quotes keep their own dates and public policy; the ranking uses stocks only.
 return {...selected,items:result,status:result.length?'ready':'empty',stale:ready.some(f=>f.stale),coverage:feeds.map((f,i)=>({operation:operations[i],status:f.status,baseDate:f.baseDate,syncedAt:f.syncedAt,message:f.message})),baseDates:[...new Set(ready.map(f=>f.baseDate))]};
}
export async function fscIndices(env){const feed=await operationFeed(env,'indices');return {...feed,items:feed.items.filter(s=>['KOSPI','KOSDAQ','KOSPI200'].includes(s.id))};}
export function startFscSync(env){if(!env.DATA_GO_KR_SERVICE_KEY?.trim()||!env.DB)return ()=>{};let busy=false;const run=async()=>{if(busy)return;busy=true;try{await syncFscAll(env)}catch{}finally{busy=false}};run();const timer=setInterval(run,15*60000);timer.unref?.();return ()=>clearInterval(timer);}
