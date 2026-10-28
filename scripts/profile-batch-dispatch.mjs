import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CatalystStore,one} from '../server/catalyst/store.mjs';
import {profilePolicy} from '../server/catalyst/profile-queue.mjs';
// Restore only the server's boolean preview context from this worker's live
// dispatch lease. Environment strings and another run's lease are not grants.
export function profileWorkerPreview(lease,runId,token,now=Date.now()){
 if(!runId||!token||lease?.token!==token||lease?.profileBatch!==runId||!Number.isFinite(lease.until)||lease.until<=now)throw Error('DISPATCH_REQUIRED');
 return lease.localPreview===true;
}
export function createProfileBatchDispatch(env,{launch=spawn}={}){
 const store=new CatalystStore(env.DB);let active=null,pending=Promise.resolve();
 const stop=()=>{if(active?.child.exitCode===null){if(process.platform==='win32')execFile('taskkill',['/PID',String(active.child.pid),'/T','/F'],{windowsHide:true},()=>{});else active.child.kill();}};
 return {stop,wait:()=>pending,async pause(id){await store.db.prepare("UPDATE business_profile_runs SET state='PAUSED',updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return {state:'PAUSED',message:'현재 기업을 마친 뒤 멈춥니다.'};},async start(id){
  if(env.CATALYST_ENABLED!=='true'||env.CATALYST_RESEARCH_WORKER_ENABLED!=='false'||env.CATALYST_METADATA_WORKER_ENABLED!=='false'||env.ENABLE_OPENAI_WEB_SEARCH!=='false')throw Error('ONESHOT_FLAGS_REQUIRED');
  const run=await one(store.db,'SELECT * FROM business_profile_runs WHERE id=?',id);if(!run)throw Error('RUN_NOT_FOUND');
  const profileKey=JSON.parse(run.payload).profileKey||null;
  const token=crypto.randomUUID(),now=Date.now();await store.db.prepare('INSERT OR IGNORE INTO catalyst_runtime VALUES(?,?,?)').bind('research-worker-lease','{"until":0}',new Date().toISOString()).run();
  const got=await store.db.prepare("UPDATE catalyst_runtime SET value=?,updated_at=? WHERE key='research-worker-lease' AND COALESCE(CAST(json_extract(value,'$.until') AS INTEGER),0)<?").bind(JSON.stringify({token,profileBatch:id,profile:profileKey,localPreview:env.LOCAL_PREVIEW===true,until:now+profilePolicy.workerTimeoutMs+60000}),new Date().toISOString(),now).run();if(!got.meta.changes)throw Error('RESEARCH_BUSY');
  const release=()=>store.db.prepare("UPDATE catalyst_runtime SET value='{\"until\":0}' WHERE key='research-worker-lease' AND json_extract(value,'$.token')=?").bind(token).run();
  await store.db.prepare("UPDATE business_profile_runs SET state='RUNNING',updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();
  try{const child=launch(process.execPath,['--max-old-space-size='+profilePolicy.workerHeapMB,fileURLToPath(new URL('./profile-batch-once.mjs',import.meta.url)),id,token],{windowsHide:true,stdio:'ignore',env:{...process.env,MOA_DB_FILE:env.MOA_DB_FILE||'.sites-runtime/search-events.sqlite'}});active={id,child};
   const timeout=setTimeout(stop,profilePolicy.workerTimeoutMs);timeout.unref?.();let finished=false,resolveDone;pending=new Promise(resolve=>{resolveDone=resolve;});
   const finish=async code=>{if(finished)return;finished=true;clearTimeout(timeout);active=null;try{await store.db.prepare("UPDATE business_profile_runs SET state=CASE WHEN state='RUNNING' THEN 'PAUSED' ELSE state END,payload=json_set(payload,'$.exitCode',?),updated_at=? WHERE id=?").bind(code??-1,new Date().toISOString(),id).run();if(profileKey){const current=await store.runtime(profileKey);if(current?.status==='RUNNING')await store.runtime(profileKey,{...current,status:'FETCH_FAILED',completedAt:new Date().toISOString(),error:'PROFILE_WORKER_INCOMPLETE'});}await release();}finally{resolveDone();}};child.once('exit',code=>void finish(code));child.once('error',()=>void finish(-1));
   if(Number.isInteger(child.pid))await store.db.prepare("UPDATE catalyst_runtime SET value=json_set(value,'$.workerPid',?,'$.ownerPid',?) WHERE key='research-worker-lease' AND json_extract(value,'$.token')=?").bind(child.pid,process.pid,token).run();
   return {id,state:'RUNNING'};
  }catch{await release();await store.db.prepare("UPDATE business_profile_runs SET state='PAUSED' WHERE id=?").bind(id).run();throw Error('PROFILE_BATCH_FAILED');}
 }};
}
