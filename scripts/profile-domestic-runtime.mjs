import {CatalystStore,one} from '../server/catalyst/store.mjs';
import {syncAssets} from '../server/catalyst/assets.mjs';
import {resolveDartCompany} from '../server/dart-filings.mjs';
import {registerProfileUniverse,profilePolicy} from '../server/catalyst/profile-queue.mjs';
import {createDomesticProfileScheduler,domesticAutoKey} from '../server/catalyst/profile-domestic-auto.mjs';
export async function recoverProfileOrphan(store,lease,isAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}){
 if(!lease?.profileBatch||!Number.isInteger(lease.workerPid)||lease.workerPid<=0||isAlive(lease.workerPid))return false;
 // Never refund unknown request usage. A living/reused PID is conservatively
 // left to lease expiry. The token guards against a newer worker taking over.
 const at=new Date().toISOString();
 await store.db.batch([
  store.db.prepare("UPDATE business_profile_jobs SET state=CASE WHEN attempts>=? THEN 'MANUAL_REVIEW' ELSE 'RETRY_WAIT' END,error_code='INTERRUPTED',available_at=0,lease_until=0,lease_token=NULL,updated_at=? WHERE state='RUNNING' AND lease_token=?").bind(profilePolicy.maxAttempts,at,lease.token),
  store.db.prepare("UPDATE business_profile_runs SET state='PAUSED',updated_at=?,payload=json_set(payload,'$.exitCode',-1) WHERE id=? AND state='RUNNING'").bind(at,lease.profileBatch),
  store.db.prepare("UPDATE catalyst_runtime SET value=json_object('until',0),updated_at=? WHERE key='research-worker-lease' AND json_extract(value,'$.token')=?").bind(at,lease.token)
 ]);return true;
}
export async function refreshDomesticRegistry(env,store){
 const first=await one(store.db,"SELECT symbol FROM catalyst_assets WHERE kind='KR_STOCK' AND identity_status='verified' AND json_extract(payload,'$.active')=1 ORDER BY symbol LIMIT 1");if(!first)throw Error('KR_MASTER_UNAVAILABLE');
 // Existing daily corpCode.xml cache and exact-code mapping, never name inference.
 const mapping=await resolveDartCompany(env,first.symbol);if(mapping.mappingStale)throw Error('DART_MAPPING_REFRESH_FAILED');
 await syncAssets(store,{force:true});
 const registered=await registerProfileUniverse(store,{market:'KR',reuseExisting:true,latestOnly:true});
 const listing=await one(store.db,"SELECT base_date,payload FROM fsc_daily_snapshots WHERE operation='stocks' ORDER BY base_date DESC LIMIT 1");
 const unmapped=await one(store.db,`SELECT COUNT(*) n FROM json_each(?) l WHERE NOT EXISTS(SELECT 1 FROM catalyst_assets a WHERE a.kind='KR_STOCK' AND a.symbol=json_extract(l.value,'$.ticker') AND a.identity_status='verified' AND json_extract(a.payload,'$.active')=1)`,listing?.payload||'[]');
 return {...registered,mappingAt:mapping.mappingAt,listingAsOf:listing?.base_date||null,unmappedListedInstruments:unmapped.n};
}
export function startDomesticProfileRuntime(env,dispatch){
 if(env.BUSINESS_PROFILE_AUTO_ENABLED!=='true')return ()=>{};
 const store=new CatalystStore(env.DB);
 if(!env.OPENDART_API_KEY||env.CATALYST_ENABLED!=='true'||env.CATALYST_RESEARCH_WORKER_ENABLED!=='false'||env.CATALYST_METADATA_WORKER_ENABLED!=='false'||env.ENABLE_OPENAI_WEB_SEARCH!=='false'){
  void store.runtime(domesticAutoKey,{state:'CONFIG_REQUIRED',error:env.OPENDART_API_KEY?'ONESHOT_FLAGS_REQUIRED':'DART_KEY_MISSING',updatedAt:new Date().toISOString()}).catch(()=>{});return ()=>{};
 }
 const scheduler=createDomesticProfileScheduler(store,{dispatch,refreshRegistry:()=>refreshDomesticRegistry(env,store),recoverOrphan:lease=>recoverProfileOrphan(store,lease)});
 // Separate opt-in for stock data; retired research workers remain off.
 const tick=()=>void scheduler.tick().catch(()=>{}),initial=setTimeout(tick,2000),timer=setInterval(tick,profilePolicy.domesticAuto.intervalMs);
 initial.unref?.();timer.unref?.();return ()=>{clearTimeout(initial);clearInterval(timer);scheduler.stop();};
}
