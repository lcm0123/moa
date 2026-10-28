import {spawn} from 'node:child_process';
import {freemem} from 'node:os';
import {fileURLToPath} from 'node:url';
import {one} from '../catalyst/store.mjs';
import {newsLivePolicy} from '../news-live-policy.mjs';
import {gate,setGapEnabled,claimGapJob,failGap,settings} from './store.mjs';

const sharedKey='research-worker-lease';
const enabled=env=>env.REACTION_GAP_ENABLED==='true';
const at=now=>new Date(now).toISOString();

// Shares the existing profile/news worker slot. No second worker queue or
// external collector starts here; jobs only read already stored data.
export function startReactionGapRuntime(env,{launch=spawn,clock=Date.now,poll=true,freeMemory=freemem}={}){
 const db=env.DB;let stopped=false,starting=false,active=null,timer=null;
 if(!enabled(env)||!db){
  env.REACTION_GAP_RUNTIME={ready:Promise.resolve(),kick:async()=>{throw Error('FEATURE_DISABLED');},cancel:async()=>{},disable:async()=>{}};
  return async()=>{};
 }
 const ready=(async()=>{const control=await gate(db);if(!control.enabled)await setGapEnabled(db,true,{now:clock()});})();
 const allowed=async()=>!stopped&&enabled(env)&&(await gate(db)).enabled;
 const release=token=>db.prepare("UPDATE catalyst_runtime SET value='{\"until\":0}' WHERE key=? AND json_extract(value,'$.token')=?").bind(sharedKey,token).run();
 const cancel=async id=>{
  const worker=active;
  if(worker&&!worker.finished&&(!id||worker.job.id===id)){
   // cancelGap/setGapEnabled already fences publication. If called directly,
   // invalidate the running job before its process can complete late.
   await db.prepare("UPDATE reaction_gap_jobs SET state='CANCELLED',error_code='CANCELLED',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND version=? AND state='RUNNING' AND lease_token=?").bind(at(clock()),worker.job.id,worker.job.version,worker.token).run();
   worker.child.kill();
  }
 };
 const recover=async()=>{
  // The shared slot may already belong to news/profile work after a crash or
  // a failed cleanup write. Expired gap leases must not remain RUNNING forever.
  // Fail only expired gap jobs; never resume them or modify another worker's slot.
  await db.prepare("UPDATE reaction_gap_jobs SET state='FAILED',error_code='WORKER_INTERRUPTED',lease_token=NULL,lease_until=0,updated_at=? WHERE state='RUNNING' AND lease_until<?").bind(at(clock()),clock()).run();
  const held=JSON.parse((await one(db,'SELECT value FROM catalyst_runtime WHERE key=?',sharedKey))?.value||'{}');
  if(held.gapJob&&held.until<=clock()){
   await db.batch([
    db.prepare("UPDATE reaction_gap_jobs SET state='FAILED',error_code='WORKER_INTERRUPTED',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND version=? AND state='RUNNING' AND lease_token=? AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key=? AND json_extract(value,'$.token')=?)").bind(at(clock()),held.gapJob,held.jobVersion,held.token,sharedKey,held.token),
    db.prepare("UPDATE catalyst_runtime SET value='{\"until\":0}' WHERE key=? AND json_extract(value,'$.token')=?").bind(sharedKey,held.token)
   ]);
  }
 };
 const kick=async()=>{
  await ready;
  // An enabled runtime may be disabled while a child is running. Persist the
  // generation fence before stopping that child; its inherited env stays true.
  if(!enabled(env)){await stop();throw Error('FEATURE_DISABLED');}
  if(!await allowed())throw Error('FEATURE_DISABLED');
  if(starting||active)return false;
  if(freeMemory()<newsLivePolicy(env).minimumFreeMemoryMB*1048576)return false;
  starting=true;let token=null,claimed=null,worker=null;
  try{
   await recover();if(!await allowed())throw Error('FEATURE_DISABLED');
   const row=await one(db,"SELECT * FROM reaction_gap_jobs WHERE state='QUEUED' ORDER BY created_at,id LIMIT 1");if(!row)return false;
   const now=clock();token=crypto.randomUUID();
   await db.prepare('INSERT OR IGNORE INTO catalyst_runtime(key,value,updated_at) VALUES(?,?,?)').bind(sharedKey,'{"until":0}',at(now)).run();
   const held=await db.prepare("UPDATE catalyst_runtime SET value=?,updated_at=? WHERE key=? AND CAST(json_extract(value,'$.until') AS INTEGER)<=?").bind(JSON.stringify({token,gapJob:row.id,jobVersion:row.version,until:now+settings.leaseMs}),at(now),sharedKey,now).run();
   if(!held.meta.changes){token=null;return false;}
   if(!await allowed())throw Error('FEATURE_DISABLED');
   claimed=await claimGapJob(db,row.id,row.version,{now,token});if(!claimed){await release(token);return false;}
   if(!await allowed())throw Error('FEATURE_DISABLED');
   const child=launch(process.execPath,[`--max-old-space-size=${settings.workerHeapMB}`,fileURLToPath(new URL('../../scripts/reaction-gap-once.mjs',import.meta.url)),row.id,String(row.version),token],{
    windowsHide:true,stdio:'ignore',cwd:fileURLToPath(new URL('../..',import.meta.url)),
    env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),MOA_DB_FILE:env.MOA_DB_FILE||'.sites-runtime/search-events.sqlite',CATALYST_SECURITY_ROOT:env.CATALYST_SECURITY_ROOT||'.sites-runtime/catalyst-security',REACTION_GAP_ENABLED:'true',CATALYST_RESEARCH_WORKER_ENABLED:'false',CATALYST_METADATA_WORKER_ENABLED:'false',ENABLE_OPENAI_WEB_SEARCH:'false'}
   });
   worker={job:claimed,child,token,finished:false,timeout:null};active=worker;
   const finish=async(code='WORKER_INTERRUPTED')=>{
    if(worker.finished)return;worker.finished=true;clearTimeout(worker.timeout);
    try{await failGap(db,worker.job,code,{now:clock()});await release(token);}catch{}finally{if(active===worker)active=null;}
   };
   // Attach before the first post-spawn await so immediate failures are fenced.
   child.once('exit',()=>void finish());child.once('error',()=>void finish());
   worker.timeout=setTimeout(()=>{child.kill();void finish('WORKER_TIMEOUT');},settings.timeoutMs);worker.timeout.unref?.();
   if(Number.isInteger(child.pid))await db.prepare("UPDATE catalyst_runtime SET value=json_set(value,'$.workerPid',?,'$.ownerPid',?) WHERE key=? AND json_extract(value,'$.token')=?").bind(child.pid,process.pid,sharedKey,token).run();
   return true;
  }catch(error){
   if(!worker){if(claimed)await failGap(db,claimed,stopped?'FEATURE_DISABLED':'WORKER_INTERRUPTED',{now:clock()});if(token)await release(token);}
   throw error;
  }finally{starting=false;}
 };
 const stop=async()=>{
  if(stopped)return;stopped=true;clearInterval(timer);
  await ready.catch(()=>{});
  await setGapEnabled(db,false,{now:clock()});
  await cancel();
  if(active)await release(active.token);
 };
 env.REACTION_GAP_RUNTIME={ready,kick,cancel,disable:stop};
 if(poll){timer=setInterval(()=>void kick().catch(()=>{}),settings.pollMs);timer.unref?.();}
 return stop;
}
