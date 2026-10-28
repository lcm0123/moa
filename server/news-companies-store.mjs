import {one,rows} from './catalyst/store.mjs';
import {hash} from './catalyst/core.mjs';
import {policy,validateInput,parseConditions,applyConditions,changes} from './news-companies-model.mjs';
import {articleRelationOwner} from './news-live-policy.mjs';
import {buildInlineResult,validateInlineDependencies,inlineDependencyWrites} from './news-inline-publication.mjs';
import {validateScenarioInput,validateHorizon} from './news-inline-scenarios.mjs';
const now=()=>new Date().toISOString();
export const readJob=(db,id,owner)=>one(db,'SELECT * FROM news_company_jobs WHERE id=? AND owner=?',id,owner);
export function publicJob(row){if(!row)return null;const result=row.result?JSON.parse(row.result):null;if(result)result.sources=result.sources.map(({body,...s})=>s);return {id:row.id,version:row.version,status:row.status,phase:row.phase,input:JSON.parse(row.input),result,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at,stale:Date.now()-Date.parse(row.updated_at)>policy.staleMs};}
export async function quota(db,owner){const x=await one(db,'SELECT COUNT(*) n FROM news_company_versions v JOIN news_company_jobs j ON j.id=v.job_id WHERE j.owner=? AND v.paid=1 AND v.created_at>?',owner,new Date(Date.now()-3600000).toISOString());if(x.n>=policy.maxRunsPerHour)throw Error('USER_LIMIT');}
export async function createNewsJob(db,owner,body,{maxPending=48,inlineContext=null,maxDailyJobs=null}={}){
 const input={...validateInput(body),...(inlineContext?{inlineV2:inlineContext}:{})},key=await hash(JSON.stringify(input)),old=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',owner,key);if(old)return {row:old,shared:true};
 const automatic=owner===articleRelationOwner;
 if(automatic){
  if(inlineContext&&maxDailyJobs!==null){const used=await one(db,"SELECT COUNT(*) n FROM news_company_jobs WHERE owner=? AND created_at>=? AND json_extract(input,'$.inlineV2') IS NOT NULL",owner,now().slice(0,10));if(used.n>=maxDailyJobs)throw Error('DAILY_LIMIT');}
  // Automatic feed intake has no hourly article cap. The bounded queue and
  // shared token reservation still govern actual execution.
  const count=await one(db,"SELECT COUNT(*) n FROM news_company_jobs WHERE owner=? AND status IN ('QUEUED','RUNNING')",owner);if(count.n>=maxPending)throw Error('QUEUE_FULL');
  const id=crypto.randomUUID(),at=now();
  await db.batch([db.prepare("INSERT OR IGNORE INTO news_company_jobs SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM news_company_jobs WHERE owner=? AND status IN ('QUEUED','RUNNING'))<? AND (? IS NULL OR (SELECT COUNT(*) FROM news_company_jobs WHERE owner=? AND created_at>=? AND json_extract(input,'$.inlineV2') IS NOT NULL)<?)").bind(id,owner,key,1,'QUEUED','QUEUED',JSON.stringify(input),null,null,at,at,owner,maxPending,inlineContext?maxDailyJobs:null,owner,at.slice(0,10),maxDailyJobs),db.prepare("INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,NULL,'CREATE',1,created_at FROM news_company_jobs WHERE id=?").bind(id)]);
  const row=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',owner,key);if(!row)throw Error('QUEUE_FULL');return {row,shared:row.id!==id};
 }
 await quota(db,owner);const id=crypto.randomUUID(),at=now();
 await db.batch([db.prepare('INSERT OR IGNORE INTO news_company_jobs SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM news_company_versions v JOIN news_company_jobs j ON j.id=v.job_id WHERE j.owner=? AND v.paid=1 AND v.created_at>?)<?').bind(id,owner,key,1,'QUEUED','QUEUED',JSON.stringify(input),null,null,at,at,owner,new Date(Date.now()-3600000).toISOString(),policy.maxRunsPerHour),db.prepare("INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,NULL,'CREATE',1,created_at FROM news_company_jobs WHERE id=?").bind(id)]);
 const row=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',owner,key);if(!row)throw Error('USER_LIMIT');return {row,shared:row.id!==id};
}
export async function updateNewsJob(db,owner,id,body,{allowed=()=>false}={}){
 const row=await readJob(db,id,owner);if(!row)throw Error('NOT_FOUND');if(body.version!==row.version)throw Error('VERSION_CONFLICT');
 if(body.action==='cancel'){await db.prepare("UPDATE news_company_jobs SET status='CANCELLED',phase='CANCELLED',updated_at=? WHERE id=? AND owner=? AND version=?").bind(now(),id,owner,row.version).run();return readJob(db,id,owner);}
 if(!['conditions','scenarios','add','refresh'].includes(body.action))throw Error('INVALID_ACTION');
 if(['RUNNING','QUEUED'].includes(row.status))throw Error('RUNNING_CONFLICT');
 const input={...JSON.parse(row.input),ruleVersion:policy.version},old=row.result?JSON.parse(row.result):null,version=row.version+1,at=now();let result=old,status='QUEUED';
 const localOnly=['conditions','scenarios'].includes(body.action);
 if(localOnly&&old?.inline&&!await validateInlineDependencies(db,row,allowed))throw Error('FINANCIAL_EVIDENCE_CHANGED');
 if(body.action==='scenarios'){
  if(!old?.inline)throw Error('RESULT_REQUIRED');
  const scenario=validateScenarioInput(body.scenario,old.inline.candidates||[]);
  result={...old,scenarioInputs:{...old.scenarioInputs,[scenario.assetId]:scenario}};
  result.inline=await buildInlineResult(result,{allowed});result.changes=['사용자 가정을 저장해 연도별 매출을 다시 계산했습니다. 공시 사실·기업 순위는 변경하지 않았습니다.'];status=old.limitations?.length?'PARTIAL':'COMPLETE';
 }else if(body.action==='conditions'){
  if(!old)throw Error('RESULT_REQUIRED');Object.assign(input,parseConditions(body.conditionsText,body.conditions),{conditionsText:String(body.conditionsText||'').slice(0,500)});
  result={...old,...applyConditions(old.rawCandidates,input.conditions),applied:input.conditions,labels:input.labels,unknownConditions:input.unknown};result.summary=`조건 충족 ${result.candidates.length}개 · 판단 보류 ${result.pending.length}개 · 제외 ${result.excluded.length}개입니다. 제품 사업 근거와 이번 사업 납품 여부를 구분해 확인하세요.`;result.changes=changes(old,result);status=old.limitations?.length?'PARTIAL':'COMPLETE';
  if(input.inlineV2){input.inlineV2={...input.inlineV2,constraints:input.conditions,...body.horizon!==undefined?{horizon:validateHorizon(body.horizon)}:{}};result.context=input.inlineV2;result.inline=await buildInlineResult(result,{allowed,context:input.inlineV2});}
 }else{
  await quota(db,owner);if(Date.now()-Date.parse(row.updated_at)<policy.refreshCooldownMs)throw Error('REFRESH_COOLDOWN');
  if(body.action==='add'){const additional=validateInput(body);input.additional=[...(input.additional||[]),additional];if(input.additional.length>3)throw Error('DOCUMENT_LIMIT');}
 }
 const writes=await db.batch([db.prepare('UPDATE news_company_jobs SET version=?,status=?,phase=?,input=?,result=?,error=NULL,updated_at=? WHERE id=? AND owner=? AND version=? AND (?=0 OR (SELECT COUNT(*) FROM news_company_versions v JOIN news_company_jobs j ON j.id=v.job_id WHERE j.owner=? AND v.paid=1 AND v.created_at>?)<?)').bind(version,status,status,JSON.stringify(input),JSON.stringify(result),at,id,owner,row.version,localOnly?0:1,owner,new Date(Date.now()-3600000).toISOString(),policy.maxRunsPerHour),db.prepare('INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,result,?,?,? FROM news_company_jobs WHERE id=? AND owner=? AND version=?').bind(body.action,localOnly?0:1,at,id,owner,version)]);
 if(!writes[0].meta.changes){await quota(db,owner);throw Error('VERSION_CONFLICT');}return readJob(db,id,owner);
}
export async function completeNewsJob(db,row,result,status='COMPLETE',error=null,{leaseToken=null}={}){
 const at=now(),serialized=JSON.stringify(result),dependencies=['COMPLETE','PARTIAL'].includes(status)?await inlineDependencyWrites(db,row,result,{leaseToken}):[];
 const fence="(? IS NULL OR EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='research-worker-lease' AND json_extract(value,'$.token')=? AND json_extract(value,'$.newsJob')=?))",fenceArgs=[leaseToken,leaseToken,row.id];
 // Evidence, history and the terminal status commit together. All writes use
 // the RUNNING guard, so duplicate or cancelled completions cannot publish.
 await db.batch([...dependencies,db.prepare(`UPDATE news_company_versions SET result=? WHERE job_id=? AND version=? AND EXISTS(SELECT 1 FROM news_company_jobs WHERE id=? AND version=? AND status='RUNNING') AND ${fence}`).bind(serialized,row.id,row.version,row.id,row.version,...fenceArgs),db.prepare(`UPDATE news_company_jobs SET status=?,phase=?,result=?,error=?,updated_at=? WHERE id=? AND version=? AND status='RUNNING' AND ${fence}`).bind(status,status,serialized,error,at,row.id,row.version,...fenceArgs)]);
}
export const jobHistory=(db,id,owner)=>rows(db,'SELECT v.version,v.reason,v.created_at FROM news_company_versions v JOIN news_company_jobs j ON j.id=v.job_id WHERE j.id=? AND j.owner=? ORDER BY v.version DESC LIMIT 20',id,owner);
