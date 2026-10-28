import {one,rows} from '../catalyst/store.mjs';
import {hash} from '../catalyst/core.mjs';
import settings from '../../config/reaction-gap-integration.json' with {type:'json'};
export {settings};
export const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
export const digest=value=>hash(stable(value));
export const gate=async db=>JSON.parse((await one(db,"SELECT value FROM catalyst_runtime WHERE key='reaction-gap-control'"))?.value||'{"enabled":false,"generation":0}');
export const readGapJob=(db,id,owner)=>one(db,'SELECT * FROM reaction_gap_jobs WHERE id=? AND owner=?',id,owner);

export async function setGapEnabled(db,enabled,{now=Date.now()}={}){
 const at=new Date(now).toISOString();
 await db.batch([
  db.prepare("UPDATE catalyst_runtime SET value=json_set(value,'$.enabled',json(?),'$.generation',COALESCE(json_extract(value,'$.generation'),0)+1),updated_at=? WHERE key='reaction-gap-control'").bind(enabled===true?'true':'false',at),
  ...enabled?[]:[db.prepare("UPDATE reaction_gap_jobs SET state='CANCELLED',lease_token=NULL,lease_until=0,error_code='FEATURE_DISABLED',updated_at=? WHERE state IN ('QUEUED','RUNNING')").bind(at)]
 ]);return gate(db);
}

export async function createGapJob(db,owner,request,frozen,{now=Date.now()}={}){
 const control=await gate(db);if(!control.enabled)throw Error('FEATURE_DISABLED');
 const requestKey=await digest({request,frozen,method:settings.version});
 const id=crypto.randomUUID(),at=new Date(now).toISOString();
 await db.prepare(`INSERT OR IGNORE INTO reaction_gap_jobs(id,owner,request_key,state,request,frozen,control_generation,created_at,updated_at)
 SELECT ?,?,?,'QUEUED',?,?,?,?,? WHERE (SELECT COUNT(*) FROM reaction_gap_jobs WHERE state IN ('QUEUED','RUNNING'))<?
 AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='reaction-gap-control' AND json_extract(value,'$.enabled')=1 AND json_extract(value,'$.generation')=?)`)
 .bind(id,owner,requestKey,stable(request),stable(frozen),control.generation,at,at,settings.maxPending,control.generation).run();
 const row=await one(db,'SELECT * FROM reaction_gap_jobs WHERE owner=? AND request_key=?',owner,requestKey);
 if(!row)throw Error('QUEUE_LIMIT');return {row,shared:row.id!==id};
}

export async function refreshGapJob(db,owner,id,expectedVersion,request,frozen,{now=Date.now()}={}){
 const control=await gate(db);if(!control.enabled)throw Error('FEATURE_DISABLED');
 if(!await readGapJob(db,id,owner))throw Error('NOT_FOUND');
 const requestKey=await digest({request,frozen,method:settings.version});
 const duplicate=await one(db,'SELECT id FROM reaction_gap_jobs WHERE owner=? AND request_key=? AND id<>?',owner,requestKey,id);if(duplicate)throw Error('REQUEST_CONFLICT');
 let changed;try{changed=await db.prepare(`UPDATE reaction_gap_jobs SET version=version+1,state='QUEUED',request_key=?,request=?,frozen=?,control_generation=?,lease_token=NULL,lease_until=0,error_code=NULL,updated_at=?
 WHERE id=? AND owner=? AND version=? AND (state IN ('QUEUED','RUNNING') OR (SELECT COUNT(*) FROM reaction_gap_jobs WHERE state IN ('QUEUED','RUNNING'))<?)
 AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='reaction-gap-control' AND json_extract(value,'$.enabled')=1 AND json_extract(value,'$.generation')=?)`)
 .bind(requestKey,stable(request),stable(frozen),control.generation,new Date(now).toISOString(),id,owner,expectedVersion,settings.maxPending,control.generation).run();
 }catch(e){if(String(e.message).includes('UNIQUE constraint failed'))throw Error('REQUEST_CONFLICT');throw e;}
 if(!changed.meta.changes)throw Error('VERSION_CONFLICT');return readGapJob(db,id,owner);
}

export async function claimGapJob(db,id,version,{now=Date.now(),token=crypto.randomUUID()}={}){
 const control=await gate(db);if(!control.enabled)throw Error('FEATURE_DISABLED');
 const changed=await db.prepare(`UPDATE reaction_gap_jobs SET state='RUNNING',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND version=? AND state='QUEUED' AND control_generation=?
 AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='reaction-gap-control' AND json_extract(value,'$.enabled')=1 AND json_extract(value,'$.generation')=?)`)
 .bind(token,now+settings.leaseMs,new Date(now).toISOString(),id,version,control.generation,control.generation).run();
 return changed.meta.changes?one(db,'SELECT * FROM reaction_gap_jobs WHERE id=?',id):null;
}

export async function publishGap(db,job,{input,result,manifest,dependencies,fences=[]},{now=Date.now()}={}){
 const snapshot=await digest(manifest),at=new Date(now).toISOString();
 if(snapshot!==input.snapshotId)throw Error('SNAPSHOT_MISMATCH');
 const fence=`EXISTS(SELECT 1 FROM reaction_gap_jobs j WHERE j.id=? AND j.version=? AND j.state='RUNNING' AND j.lease_token=? AND j.lease_until>=? AND j.control_generation=?
 AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='reaction-gap-control' AND json_extract(value,'$.enabled')=1 AND json_extract(value,'$.generation')=j.control_generation))${fences.map(f=>' AND ('+f.sql+')').join('')}`;
 const args=[job.id,job.version,job.lease_token,now,job.control_generation,...fences.flatMap(f=>f.args)];
 const writes=[db.prepare(`INSERT OR IGNORE INTO reaction_gap_versions(job_id,version,snapshot_id,manifest,input,result,created_at) SELECT ?,?,?,?,?,?,? WHERE ${fence}`)
 .bind(job.id,job.version,snapshot,stable(manifest),stable(input),stable(result),at,...args)];
 for(const dep of dependencies)writes.push(db.prepare(`INSERT OR IGNORE INTO reaction_gap_dependencies(job_id,version,kind,dependency_key,dependency_version) SELECT ?,?,?,?,? WHERE ${fence}`)
 .bind(job.id,job.version,dep.kind,dep.key,dep.version,...args));
 writes.push(db.prepare(`UPDATE reaction_gap_jobs SET latest_version=?,state=?,lease_token=NULL,lease_until=0,error_code=NULL,updated_at=? WHERE id=? AND ${fence}`)
 .bind(job.version,result.execution==='COMPLETE'?'COMPLETE':'PARTIAL',at,job.id,...args));
 const outcomes=await db.batch(writes);return outcomes[0].meta.changes===1;
}

/**
 * A separate security ledger cannot join this publication transaction. If its
 * post-publication check detects revocation, withdraw only our snapshot and
 * restore the previous valid pointer, never a newer worker's version.
 */
export async function withdrawGapPublication(db,job,snapshot,previousVersion,{now=Date.now()}={}){
 await db.batch([
  db.prepare("UPDATE reaction_gap_versions SET valid=0,invalid_reason='SECURITY_PERMISSION_CHANGED' WHERE job_id=? AND version=? AND snapshot_id=?").bind(job.id,job.version,snapshot),
  db.prepare(`UPDATE reaction_gap_jobs SET latest_version=(SELECT version FROM reaction_gap_versions WHERE job_id=? AND version=? AND valid=1),state='FAILED',error_code='SECURITY_PERMISSION_CHANGED',updated_at=?
   WHERE id=? AND version=? AND latest_version=? AND state IN ('COMPLETE','PARTIAL')
   AND EXISTS(SELECT 1 FROM reaction_gap_versions WHERE job_id=? AND version=? AND snapshot_id=? AND valid=0 AND invalid_reason='SECURITY_PERMISSION_CHANGED')`)
   .bind(job.id,previousVersion,new Date(now).toISOString(),job.id,job.version,job.version,job.id,job.version,snapshot)
 ]);
}

export async function failGap(db,job,code,{now=Date.now()}={}){
 const safe=/^[A-Z0-9_]{1,80}$/.test(code||'')?code:'CALCULATION_FAILED';
 await db.prepare("UPDATE reaction_gap_jobs SET state='FAILED',error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND version=? AND state='RUNNING' AND lease_token=?")
 .bind(safe,new Date(now).toISOString(),job.id,job.version,job.lease_token).run();
}
export async function cancelGap(db,owner,id,{now=Date.now()}={}){
 if(!await readGapJob(db,id,owner))throw Error('NOT_FOUND');
 await db.prepare("UPDATE reaction_gap_jobs SET state='CANCELLED',error_code='CANCELLED',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND owner=? AND state IN ('QUEUED','RUNNING')").bind(new Date(now).toISOString(),id,owner).run();
 return readGapJob(db,id,owner);
}
export async function readGapVersion(db,owner,id,version=null){
 return one(db,`SELECT v.* FROM reaction_gap_versions v JOIN reaction_gap_jobs j ON j.id=v.job_id WHERE j.id=? AND j.owner=? AND v.version=COALESCE(?,j.latest_version)`,id,owner,version);
}
export async function gapHistory(db,owner,id){
 if(!await readGapJob(db,id,owner))throw Error('NOT_FOUND');
 return rows(db,'SELECT version,snapshot_id,valid,invalid_reason,created_at FROM reaction_gap_versions WHERE job_id=? ORDER BY version DESC LIMIT ?',id,settings.historyLimit);
}
export async function invalidateGap(db,kind,key,reason='DEPENDENCY_CHANGED'){
 await db.prepare('UPDATE reaction_gap_versions SET valid=0,invalid_reason=? WHERE EXISTS(SELECT 1 FROM reaction_gap_dependencies d WHERE d.job_id=reaction_gap_versions.job_id AND d.version=reaction_gap_versions.version AND d.kind=? AND d.dependency_key=?)').bind(reason,kind,key).run();
}
