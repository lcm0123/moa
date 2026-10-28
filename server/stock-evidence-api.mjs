import {CatalystStore,one} from './catalyst/store.mjs';
import {workbenchIdentity,readStoredFinancials} from './stock-workbench-api.mjs';
import {readBusinessProfile,profileRequestKey,issuerKey} from './catalyst/business-profile.mjs';
import {catalystAdmin} from './catalyst-api.mjs';
import {profileProviderState} from './catalyst/profile-provider-state.mjs';
import {finvizFinancials} from './providers/finviz-financials.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {dartFinancials} from './providers/dart-financials.mjs';

// A bounded command over the existing caches and profile queue. GET never runs
// collectors, and lease/cooldown records survive a web-server restart.
export const stockEvidencePolicy=Object.freeze({version:'stock-evidence-1',cooldownMs:21600000,leaseMs:2400000,windowMs:3600000,maxCompaniesPerWindow:12,priorityMs:120000});
const globalKey='stock-evidence:collection-control:v1';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const iso=n=>new Date(n).toISOString();
const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const workerBusy=record=>record?.business?.state==='BUSY'&&record.business.code==='WORKER_BUSY';
function retryTime(record){
 const stored=time(record?.retryAfter),finished=time(record?.completedAt)||time(record?.requestedAt);
 return workerBusy(record)&&finished?Math.min(stored||Infinity,finished+60000):stored;
}
const financialRows=data=>data?.annual?.length?data.annual:data?.quarterly||[];
const hasFinancial=(data,asset={})=>{
 if(['restricted','mapping_error','unavailable','not_applicable'].includes(data?.status))return false;
 const latest=[...financialRows(data)].sort((a,b)=>String(b.end).localeCompare(String(a.end)))[0];
 const financialSector=/financial|bank|insurance|금융|은행|보험/i.test([data?.profile?.sector,data?.profile?.industry,asset.sector,asset.industry].filter(Boolean).join(' '));
 return (financialSector?['revenue']:['revenue','operatingIncome','freeCashFlow']).every(key=>Number.isFinite(latest?.values?.[key]?.value));
};
const hasBusiness=data=>!!data?.descriptions?.length&&['PRODUCT','BUSINESS_SEGMENT'].some(key=>data.groups?.[key]?.datasets?.some(d=>d.items?.length));
const messages={READY:'저장된 재무·사업 근거를 표시합니다.',IDLE:'부족한 재무·사업 근거를 기존 제공자에서 확인할 수 있습니다.',RUNNING:'외부 재무·공시 자료를 확인 중입니다. 저장된 자료는 계속 표시합니다.',PARTIAL:'확인한 자료를 저장했습니다. 일부 사업 근거는 아직 부족합니다.',FAILED:'외부 자료 확인에 실패했습니다. 기존 자료는 유지됩니다.',COOLDOWN:'최근 외부 확인을 마쳤습니다. 재확인 가능 시각까지 저장 자료를 표시합니다.',BUSY:'다른 기업 자료를 확인 중입니다. 잠시 후 다시 확인해 주세요.',RATE_LIMITED:'자동 자료 확인 한도에 도달했습니다.',BLOCKED:'자료 수집 권한 또는 설정 확인이 필요합니다.',INTERRUPTED:'이전 자료 확인이 중단되었습니다. 재확인 가능 시각을 확인해 주세요.'};
function failure(error){
 const text=String(error?.message||''),status=String(error?.status||'');
 if(/RESEARCH_BUSY/.test(text))return {state:'BUSY',code:'WORKER_BUSY'};
 if(/SECURITY|BLOCKED_HASH/.test(text))return {state:'BLOCKED',code:'SECURITY_BLOCKED'};
 if(status==='restricted'||/ACCESS|AUTH|401|403/.test(text))return {state:'BLOCKED',code:'ACCESS_DENIED'};
 if(status==='disconnected'||/FLAGS_REQUIRED|CONFIG|API_KEY/.test(text))return {state:'BLOCKED',code:'CONFIG_REQUIRED'};
 if(/429|RATE_LIMIT/.test(text))return {state:'FAILED',code:'RATE_LIMITED'};
 if(/TIMEOUT|Timeout|timed out/.test(text))return {state:'FAILED',code:'TIMEOUT'};
 return {state:'FAILED',code:'FETCH_FAILED'};
}
function financialPermission(env,asset){
 try{if(asset.market==='US')requireFinviz(env);else if(!env.OPENDART_API_KEY&&!env.DART_API_KEY)return {state:'BLOCKED',code:'CONFIG_REQUIRED'};return {state:'AVAILABLE'};}catch(e){return failure(e);}
}
async function collectFinancial(env,asset){
 // One existing normalized financial request, with its own provider cache. KR
 // annual collection is enough for the brief and avoids a 5-year quarterly backfill.
 return asset.market==='US'?finvizFinancials(env,asset.symbol):dartFinancials(env,asset.symbol,'annual');
}
function businessOutcome(status,complete=false){
 if(status==='RUNNING')return {state:'RUNNING'};
 if(status==='FETCH_FAILED')return {state:'FAILED',code:'PROFILE_FETCH_FAILED'};
 return complete?{state:'COMPLETE'}:{state:'PARTIAL',code:status==='NOT_COLLECTED'?'NO_DATA':'INCOMPLETE_BUSINESS_EVIDENCE'};
}
async function profileCompletion(store,asset,record,at,complete){
 const runId=record.business?.runId;if(!runId)return null;
 const run=await one(store.db,'SELECT state,processed,payload,created_at,updated_at FROM business_profile_runs WHERE id=?',runId);if(!run||run.state==='RUNNING'||run.processed<1||time(run.updated_at)<time(record.requestedAt))return null;
 let payload;try{payload=JSON.parse(run.payload);}catch{return null;}
 if(payload.profileKey!==profileRequestKey(asset)||!payload.targetJobId)return null;
 const job=await one(store.db,'SELECT issuer,asset_id,state,error_code,lease_until,updated_at FROM business_profile_jobs WHERE id=?',payload.targetJobId);
 // Same-day jobs are reused. A newer job attempt must not finish an older run.
 if(!job||job.issuer!==issuerKey(asset)||job.asset_id!==asset.id||job.lease_until>at||['RUNNING','QUEUED'].includes(job.state)||time(job.updated_at)<time(run.created_at)||time(job.updated_at)>time(run.updated_at))return null;
 const outcome=job.error_code?failure(Error(job.error_code)):businessOutcome(job.state==='MANUAL_REVIEW'?'NOT_COLLECTED':job.state,complete);
 return {...outcome,runId,completedAt:run.updated_at};
}

export function createStockEvidenceApi({now=()=>Date.now(),identity=workbenchIdentity,readFinancial=readStoredFinancials,readBusiness=(env,asset)=>readBusinessProfile(new CatalystStore(env.DB),asset,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}),collect=collectFinancial,financialAllowed=financialPermission}={}){
 return async function stockEvidence(request,env){
  const url=new URL(request.url),market=url.searchParams.get('market'),ticker=url.searchParams.get('ticker');
  if(!['GET','POST'].includes(request.method))return json({message:'조회와 자료 확인 요청만 지원합니다.'},405);
  if(!env.DB)return json({message:'자료 저장소 연결 오류'},503);
  if(!['KR','US'].includes(market)||!(market==='KR'?/^[0-9A-Z]{6}$/:/^[A-Z0-9][A-Z0-9.^_/-]{0,29}$/).test(ticker||'')||ticker.includes('..'))return json({message:'종목코드를 확인해 주세요.'},400);
  const authorized=await catalystAdmin(request,env);
  if(request.method==='POST'&&(!authorized||request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return json({message:'관리자 인증과 동일 출처 JSON 요청이 필요합니다.'},403);
  if(request.method==='POST'){try{const body=await request.text();if(body.length>1024||body.trim()&&JSON.stringify(JSON.parse(body))!=='{}')return json({message:'지원하지 않는 자료 확인 요청입니다.'},400);}catch{return json({message:'JSON 요청을 확인해 주세요.'},400);}}
  const store=new CatalystStore(env.DB),clock=now();
  try{
   const resolved=await identity(env,market,ticker),asset=resolved.asset;
   if(!asset||resolved.identity.status!=='verified')return json({identity:resolved.identity,canCollect:false,needs:{financial:false,business:false},collection:{state:'BLOCKED',code:'MAPPING_ERROR',message:'기업 식별 정보가 일치하지 않아 외부 자료 확인을 보류합니다.'}});
   const key='stock-evidence:collection:'+resolved.identity.key;
   const read=async()=>{
    const [financial,business,record,control,provider]=await Promise.all([readFinancial(env,asset),readBusiness(env,asset),store.runtime(key),store.runtime(globalKey),profileProviderState(store,market,now())]);
    const needs={financial:!hasFinancial(financial,asset),business:!hasBusiness(business)},f=financialAllowed(env,asset);
    const profileConfigured=!!env.CATALYST_ONESHOT?.submitProfile&&env.CATALYST_ENABLED==='true'&&env.CATALYST_RESEARCH_WORKER_ENABLED==='false'&&env.CATALYST_METADATA_WORKER_ENABLED==='false'&&env.ENABLE_OPENAI_WEB_SEARCH==='false';
    const businessPermission=!profileConfigured?{state:'BLOCKED',code:'CONFIG_REQUIRED'}:provider?.retryBlocked?{state:'BLOCKED',code:provider.code||'PROVIDER_WAIT'}:/SECURITY|BLOCKED_HASH/.test(business.request?.error||'')?{state:'BLOCKED',code:'SECURITY_BLOCKED'}:{state:'AVAILABLE'};
    const at=now(),collection={...(record||{}),state:record?.state||'IDLE'};delete collection.token;delete collection.leaseUntil;delete collection.priorityUntil;
    // Compatibility for earlier PARTIAL/FAILED records that incorrectly tied
    // a shared-worker wait to the independent financial six-hour cooldown.
    if(workerBusy(record)){collection.state='BUSY';if(retryTime(record))collection.retryAfter=iso(retryTime(record));}
    if(record?.state==='RUNNING'){
     const completion=record.business?.state==='RUNNING'?await profileCompletion(store,asset,record,at,!needs.business):null;
     if(completion){collection.business=completion;collection.completedAt=completion.completedAt;collection.state=['FAILED','BLOCKED'].includes(completion.state)?completion.state:'PARTIAL';}
     else if((record.leaseUntil||0)<=at){collection.state='INTERRUPTED';collection.code='LEASE_EXPIRED';}
    }
    if(!needs.financial&&!needs.business)collection.state='READY';
    let canCollect=authorized&&(needs.financial&&f.state==='AVAILABLE'||needs.business&&businessPermission.state==='AVAILABLE');
    if(collection.state==='RUNNING')canCollect=false;
    else if(record&&retryTime(record)>at){canCollect=false;collection.cooldown=true;if(!['READY','PARTIAL','FAILED','BLOCKED','BUSY','INTERRUPTED'].includes(collection.state))collection.state='COOLDOWN';}
    else if(canCollect&&control?.expiresAt>at){canCollect=false;collection.state=control.assetKey===resolved.identity.key?'RUNNING':'BUSY';collection.retryAfter=iso(control.expiresAt);}
    else if(canCollect&&control?.priorityUntil>at&&control.priorityAssetKey!==resolved.identity.key){canCollect=false;collection.state='BUSY';collection.retryAfter=iso(control.priorityUntil);}
    else if(canCollect&&control&&at-control.windowStart<stockEvidencePolicy.windowMs&&control.count>=stockEvidencePolicy.maxCompaniesPerWindow){canCollect=false;collection.state='RATE_LIMITED';collection.retryAfter=iso(control.windowStart+stockEvidencePolicy.windowMs);}
    if((!authorized&&collection.state!=='READY')||(!canCollect&&collection.state==='IDLE'))collection.state='BLOCKED';
    collection.financial??=needs.financial?f:{state:'STORED'};collection.business??=needs.business?businessPermission:{state:'STORED'};
    collection.message=messages[collection.state]||messages.PARTIAL;
    return {identity:resolved.identity,canCollect,needs,collection,source:'existing_providers',permissions:{financial:f,business:businessPermission},record,control};
   };
   const view=v=>{const {permissions,record,control,...body}=v;return body;};
   const initial=await read();
   if(request.method==='GET'||!initial.canCollect)return json(view(initial));
   const token=crypto.randomUUID(),leaseUntil=clock+stockEvidencePolicy.leaseMs;
   // SQL CAS is shared across processes. Expired leases recover without a new queue.
   const control=initial.control,windowStart=control&&clock-control.windowStart<stockEvidencePolicy.windowMs?control.windowStart:clock,count=(windowStart===control?.windowStart?control.count:0)+1;
   const claimed={token,assetKey:resolved.identity.key,expiresAt:leaseUntil,windowStart,count,...(control?.priorityAssetKey===resolved.identity.key&&control.priorityUntil>clock?{priorityAssetKey:control.priorityAssetKey,priorityUntil:control.priorityUntil}:{})};
   await env.DB.prepare(`INSERT INTO catalyst_runtime(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE catalyst_runtime.value=? AND COALESCE(json_extract(catalyst_runtime.value,'$.expiresAt'),0)<=? AND (COALESCE(json_extract(catalyst_runtime.value,'$.windowStart'),0)<=? OR COALESCE(json_extract(catalyst_runtime.value,'$.count'),0)<?)`).bind(globalKey,JSON.stringify(claimed),iso(clock),JSON.stringify(control),clock,clock-stockEvidencePolicy.windowMs,stockEvidencePolicy.maxCompaniesPerWindow).run();
   if((await store.runtime(globalKey))?.token!==token)return json(view(await read()),202);
   const record={version:stockEvidencePolicy.version,token,state:'RUNNING',requestedAt:iso(clock),retryAfter:iso(clock+stockEvidencePolicy.cooldownMs),leaseUntil,financial:initial.needs.financial?initial.permissions.financial:{state:'STORED'},business:initial.needs.business?initial.permissions.business:{state:'STORED'}};
   let keepPriority=false;
   try{
    // Re-check cooldown after acquiring the cross-process lock.
    const previous=await store.runtime(key);
    if(retryTime(previous)>clock)return json(view(await read()));
    const financialAt=time(previous?.financial?.attemptedAt)||time(previous?.financial?.requestStartedAt)||time(previous?.requestedAt);
    const reuseFinancial=workerBusy(previous)&&['COMPLETE','PARTIAL','FAILED','BLOCKED'].includes(previous.financial?.state)&&financialAt>0&&clock-financialAt<stockEvidencePolicy.cooldownMs;
    if(reuseFinancial)record.financial={...previous.financial,requestStartedAt:previous.financial.requestStartedAt||previous.requestedAt};
    await store.runtime(key,record);
    if(initial.needs.financial&&initial.permissions.financial.state==='AVAILABLE'&&!reuseFinancial){
     const attemptedAt=iso(now());
     try{const result=await collect(env,asset);record.financial=result?.stale?{state:'FAILED',code:'STALE_CACHE_RETAINED'}:hasFinancial(result,asset)?{state:'COMPLETE'}:financialRows(result).length?{state:'PARTIAL',code:'INCOMPLETE_METRICS'}:{state:'FAILED',code:result?.status==='empty'?'NO_DATA':'FETCH_FAILED'};}catch(e){record.financial=failure(e);}
     record.financial.attemptedAt=attemptedAt;
    }
    if(initial.needs.business&&initial.permissions.business.state==='AVAILABLE'){
     try{
      const result=await env.CATALYST_ONESHOT.submitProfile(asset);let runId=result.runId||null;
      if(result.status==='RUNNING'&&!runId){const lease=await store.runtime('research-worker-lease');if(lease?.until>now()&&lease.profile===profileRequestKey(asset))runId=lease.profileBatch||null;}
      record.business={...businessOutcome(result.status),runId};
     }catch(e){record.business=failure(e);}
    }
    const busyOnly=workerBusy(record);
    if(busyOnly){
     record.retryAfter=iso(now()+60000);
     // One fixed grace window for this busy sequence; GETs and repeated POSTs
     // cannot extend it. The current worker is never interrupted.
     record.priorityUntil=initial.record?.priorityUntil||claimed.priorityUntil||now()+stockEvidencePolicy.priorityMs;
     keepPriority=record.priorityUntil>now();
     if(keepPriority)await env.DB.prepare("UPDATE catalyst_runtime SET value=json_set(value,'$.priorityUntil',CAST(? AS INTEGER),'$.priorityAssetKey',?),updated_at=? WHERE key=? AND json_extract(value,'$.token')=? AND json_extract(value,'$.assetKey')=?").bind(record.priorityUntil,resolved.identity.key,iso(now()),globalKey,token,resolved.identity.key).run();
    }
    record.state=record.business.state==='RUNNING'?'RUNNING':busyOnly?'BUSY':[record.financial,record.business].every(x=>x.state==='BLOCKED')?'BLOCKED':[record.financial,record.business].some(x=>['COMPLETE','STORED','PARTIAL'].includes(x.state))?'PARTIAL':'FAILED';
    if(record.state!=='RUNNING')record.completedAt=iso(now());
    await env.DB.prepare("UPDATE catalyst_runtime SET value=?,updated_at=? WHERE key=? AND json_extract(value,'$.token')=?").bind(JSON.stringify(record),iso(now()),key,token).run();
    return json(view(await read()),record.state==='RUNNING'?202:200);
   }finally{
    await env.DB.prepare(`UPDATE catalyst_runtime SET value=${keepPriority?"json_set(value,'$.expiresAt',0)":"json_remove(json_set(value,'$.expiresAt',0),'$.priorityUntil','$.priorityAssetKey')"},updated_at=? WHERE key=? AND json_extract(value,'$.token')=? AND json_extract(value,'$.assetKey')=?`).bind(iso(now()),globalKey,token,resolved.identity.key).run();
   }
  }catch{return json({canCollect:false,needs:{financial:false,business:false},collection:{state:'FAILED',code:'STORAGE_ERROR',message:'자료 확인 상태를 읽지 못했습니다. 기존 자료는 유지됩니다.'}},500);}
 };
}
export const stockEvidenceApi=createStockEvidenceApi();
