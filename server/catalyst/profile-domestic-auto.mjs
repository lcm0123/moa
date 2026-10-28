import {one,rows} from './store.mjs';
import {hash} from './core.mjs';
import {profilePolicy,profileEligibility,createProfileRun} from './profile-queue.mjs';
import {profileProviderState} from './profile-provider-state.mjs';
import {profileRequestKey} from './business-profile.mjs';
export const domesticAutoKey='business-profile-auto:KR';
const latest=`WITH latest AS (SELECT j.*,ROW_NUMBER() OVER(PARTITION BY issuer ORDER BY created_at DESC,id DESC) rn FROM business_profile_jobs j WHERE purpose='LATEST_PROFILE' AND issuer LIKE 'KR:%')`;
const active=`a.kind='KR_STOCK' AND a.identity_status='verified' AND json_extract(a.payload,'$.active')=1`;
const safeError=e=>/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'PROFILE_AUTO_FAILED';
export async function domesticProfileProgress(store){
 const counts=await one(store.db,`${latest} SELECT COUNT(*) target,SUM(j.state IN ('PARTIAL','COMPLETE')) processed,SUM(j.state IN ('QUEUED','BUDGET_WAIT')) pending,SUM(j.state='RUNNING') running,SUM(j.state IN ('RETRY_WAIT','MANUAL_REVIEW','SECURITY_BLOCKED')) failed FROM latest j JOIN catalyst_assets a ON a.id=j.asset_id WHERE rn=1 AND ${active}`);
 const coverage=await one(store.db,`SELECT COUNT(DISTINCT i.issuer) AS "indexed",COUNT(DISTINCT CASE WHEN i.dimension='PRODUCT' THEN i.issuer END) product,COUNT(DISTINCT CASE WHEN i.dimension='DOMESTIC_EXPORT' THEN i.issuer END) export FROM business_profile_index i JOIN catalyst_assets a ON a.id=i.asset_id WHERE ${active}`);
 const budget=await one(store.db,"SELECT COALESCE(SUM(CASE WHEN state='SETTLED' THEN actual ELSE reserved END),0) charged FROM business_profile_reservations WHERE created_at>=?",new Date().toISOString().slice(0,10));
 const state=await store.runtime(domesticAutoKey);
 return {...Object.fromEntries(Object.entries({...counts,...coverage}).map(([k,v])=>[k,Number(v)||0])),state:state?.state||'DISABLED',updatedAt:state?.updatedAt||null,current:state?.current||null,lastResult:state?.lastResult||null,error:state?.error||null,registryError:state?.registryError||null,registry:state?.registry||null,requestsToday:budget.charged,dailyLimit:profilePolicy.dailyProfileRequestLimit,scope:'DART 종목코드가 일치하는 현재 국내 상장사 · 원문에서 확인한 항목만 저장 · 뉴스 연결 근거 검증은 별도'};
}
export async function nextDomesticProfileJob(store,now=Date.now()){
 const list=await rows(store.db,`${latest} SELECT j.* FROM latest j JOIN catalyst_assets a ON a.id=j.asset_id WHERE rn=1 AND ${active} AND j.attempts<? AND j.available_at<=? AND (j.state IN ('QUEUED','RETRY_WAIT','BUDGET_WAIT') OR (j.state='RUNNING' AND j.lease_until<?)) AND COALESCE(j.error_code,'') NOT GLOB '*SECURITY*' AND COALESCE(j.error_code,'') NOT GLOB '*BLOCKED*' ORDER BY CASE WHEN j.attempts=0 THEN 0 ELSE 1 END,j.priority DESC,j.created_at,j.id LIMIT 20`,profilePolicy.maxAttempts,now,now);
 for(const job of list){const asset=await store.asset(job.asset_id);if(profileEligibility(asset).state==='ELIGIBLE')return {job,asset};}return null;
}
// Partial means this collection finished, not redownload every timer tick.
// A fresh weekly job retains old observations, errors and security holds.
export async function renewDomesticProfiles(store,now=Date.now()){
 const due=await rows(store.db,`${latest} SELECT j.* FROM latest j JOIN catalyst_assets a ON a.id=j.asset_id WHERE rn=1 AND ${active} AND j.state IN ('PARTIAL','COMPLETE') AND j.error_code IS NULL AND j.updated_at<?`,new Date(now-profilePolicy.domesticAuto.profileRefreshMs).toISOString());
 let created=0;const date=new Date(now).toISOString(),period=date.slice(0,10);
 for(const j of due){const id=await hash([j.issuer,period,'LATEST_PROFILE',profilePolicy.version].join('|'));const result=await store.db.prepare('INSERT OR IGNORE INTO business_profile_jobs(id,issuer,asset_id,period_key,purpose,version,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,j.issuer,j.asset_id,period,'LATEST_PROFILE',profilePolicy.version,1,date,date).run();created+=result.meta.changes;}return created;
}
// Reuse the dispatcher/lease, worker, reservation ledger and extraction path.
// Never selects US, historical or research jobs.
export function createDomesticProfileScheduler(store,{dispatch,refreshRegistry,recoverOrphan=async()=>false,now=Date.now}){
 let busy=false,stopped=false;
 const write=async patch=>{const old=await store.runtime(domesticAutoKey);return store.runtime(domesticAutoKey,{...old,...patch,updatedAt:new Date(now()).toISOString()});};
 const yieldToDemand=async()=>{const control=await store.runtime('stock-evidence:collection-control:v1');if(control?.priorityAssetKey&&control.priorityUntil>now()){await write({state:'WORKER_WAIT',current:null,nextAttemptAt:new Date(control.priorityUntil).toISOString()});return true;}return false;};
 return {stop(){stopped=true;},async tick(){
  if(busy||stopped)return;busy=true;
  try{
   const lease=await store.runtime('research-worker-lease');if(lease?.until>now()&&!await recoverOrphan(lease)){await write({state:'WORKER_WAIT',current:null});return;}
   if(await yieldToDemand())return;
   const status=await store.runtime(domesticAutoKey);
   if(!status?.registryAttemptAt||now()-Date.parse(status.registryAttemptAt)>profilePolicy.domesticAuto.registryRefreshMs){
    await write({state:'REGISTERING',registryAttemptAt:new Date(now()).toISOString(),current:null});
    try{const registry=await refreshRegistry();await renewDomesticProfiles(store,now());await write({registry,registryError:null});}catch(e){await write({registryError:safeError(e)});}
   }
   if(stopped)return;
   const provider=await profileProviderState(store,'KR',now());if(provider?.retryBlocked){await write({state:'PROVIDER_WAIT',error:provider.code,nextAttemptAt:provider.retryAfter});return;}
   const used=await one(store.db,"SELECT COALESCE(SUM(CASE WHEN state='SETTLED' THEN actual ELSE reserved END),0) n FROM business_profile_reservations WHERE created_at>=?",new Date(now()).toISOString().slice(0,10));
   if(used.n+profilePolicy.requestReservationPerCompany>profilePolicy.dailyProfileRequestLimit){await write({state:'BUDGET_WAIT',current:null});return;}
   const selected=await nextDomesticProfileJob(store,now());if(!selected){await write({state:'WAITING',current:null});return;}
   const {job,asset}=selected,run=await createProfileRun(store,{mode:'OFFICIAL',companyLimit:1,requestLimit:profilePolicy.requestReservationPerCompany,targetJobId:job.id,profileKey:profileRequestKey(asset)});
   await write({state:'COLLECTING',current:{ticker:asset.symbol,name:asset.name,runId:run.id},error:null});
   // Best-effort courtesy immediately before dispatch, not a new queue or lock.
   if(await yieldToDemand())return;
   await dispatch.start(run.id);await dispatch.wait();
   const done=await one(store.db,'SELECT state,error_code,result FROM business_profile_jobs WHERE id=?',job.id),usage=await one(store.db,'SELECT used_requests,processed FROM business_profile_runs WHERE id=?',run.id),r=JSON.parse(done.result||'{}');
   await write({state:'WAITING',current:null,lastResult:{ticker:asset.symbol,name:asset.name,state:done.state,error:done.error_code,sources:r.sources??0,observations:r.observations??0,requests:usage.used_requests,processed:usage.processed,at:new Date(now()).toISOString()}});
  }catch(e){await write({state:e.message==='RESEARCH_BUSY'?'WORKER_WAIT':'ERROR',error:safeError(e),current:null});}finally{busy=false;}
 }};
}
