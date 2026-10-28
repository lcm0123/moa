// Stock detail refresh uses the same durable queue, worker and request budget.
import {spawn} from 'node:child_process';
import {CatalystStore,one} from '../server/catalyst/store.mjs';
import {profileRequestKey,issuerKey} from '../server/catalyst/business-profile.mjs';
import {createProfileRun,profilePolicy,profileEligibility} from '../server/catalyst/profile-queue.mjs';
import {hash} from '../server/catalyst/core.mjs';
import {createProfileBatchDispatch} from './profile-batch-dispatch.mjs';
export function createProfileOneShot(env,{launch=spawn}={}){
 const store=new CatalystStore(env.DB),batch=createProfileBatchDispatch(env,{launch});
 return {stop:batch.stop,async submit(asset){
  if(env.CATALYST_ENABLED!=='true'||env.CATALYST_RESEARCH_WORKER_ENABLED!=='false'||env.CATALYST_METADATA_WORKER_ENABLED!=='false'||env.ENABLE_OPENAI_WEB_SEARCH!=='false')throw Error('ONESHOT_FLAGS_REQUIRED');
  const key=profileRequestKey(asset),held=await store.runtime('research-worker-lease'),old=await store.runtime(key),now=Date.now();
  if(held?.until>now){if(held.profile===key)return {status:'RUNNING',shared:true};throw Error('RESEARCH_BUSY');}
  if(old?.completedAt&&now-Date.parse(old.completedAt)<60000)return {status:old.status,shared:true};
  if(profileEligibility(asset).state!=='ELIGIBLE')throw Error('IDENTITY_HOLD');
  const at=new Date().toISOString(),period=at.slice(0,10),id=await hash([issuerKey(asset),period,'LATEST_PROFILE',profilePolicy.version].join('|'));
  const previous=await one(store.db,'SELECT state,error_code FROM business_profile_jobs WHERE id=?',id);
  if(previous?.state==='SECURITY_BLOCKED'||/SECURITY|BLOCKED_HASH|BLOCKED_URL/.test(previous?.error_code||''))throw Error('SECURITY_BLOCKED_SOURCE');
  await store.db.prepare("INSERT INTO business_profile_jobs(id,issuer,asset_id,period_key,purpose,version,phase,checkpoint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state='QUEUED',attempts=0,available_at=0,error_code=NULL,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at").bind(id,issuerKey(asset),asset.id,period,'LATEST_PROFILE',profilePolicy.version,1,JSON.stringify({forceFetch:true}),at,at).run();
  const run=await createProfileRun(store,{mode:'OFFICIAL',companyLimit:1,requestLimit:profilePolicy.requestReservationPerCompany,targetJobId:id,profileKey:key});
  await store.runtime(key,{...old,status:'RUNNING',requestedAt:at});
  try{await batch.start(run.id);return {status:'RUNNING',shared:false,runId:run.id};}
  catch(e){await store.runtime(key,{...old,status:'FETCH_FAILED',completedAt:new Date().toISOString(),error:e.message==='RESEARCH_BUSY'?'RESEARCH_BUSY':'PROFILE_WORKER_FAILED'});throw e;}
 }};
}
