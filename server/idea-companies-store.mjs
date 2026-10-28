import {one,rows} from './catalyst/store.mjs';
import {hash} from './catalyst/core.mjs';
import {parseIdeaInput,ideaPolicy} from './idea-companies-model.mjs';
import {readJob,publicJob} from './news-companies-store.mjs';
import {financialProfileVersion} from './news-inline-financials.mjs';
import {buildIdeaScenario} from './idea-scenarios.mjs';

export const ideaEnabled=env=>env.IDEA_COMPANIES_ENABLED==='true'||env.LOCAL_PREVIEW===true&&env.IDEA_COMPANIES_ENABLED!=='false';
// The local user explicitly enabled automatic external supplementation. A
// production deployment still needs its feature flag; false is a kill switch.
export const ideaExternalEnabled=env=>env.IDEA_COMPANIES_EXTERNAL_ENABLED==='true'||env.LOCAL_PREVIEW===true&&env.IDEA_COMPANIES_EXTERNAL_ENABLED!=='false';
const json=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
export const isIdea=row=>json(row?.input).inputType==='IDEA';
const pendingIdeas="SELECT COUNT(*) FROM news_company_jobs WHERE status IN ('QUEUED','RUNNING') AND json_extract(input,'$.inputType')='IDEA'";
const ownerRuns="SELECT COUNT(*) FROM news_company_versions v JOIN news_company_jobs j ON j.id=v.job_id WHERE j.owner=? AND json_extract(j.input,'$.inputType')='IDEA' AND v.created_at>? AND v.reason IN ('IDEA_CREATE','IDEA_REFRESH')";
const ideaRequestKey=(owner,input)=>hash(JSON.stringify([owner,input.normalizedInput,input.markets,input.required,input.preferences,
 input.historical?input.asOf:input.asOf.slice(0,10),input.snapshot,input.ruleVersion,input.modelVersion,input.allowExternal]));
async function checkIdeaLimits(db,owner,now){
 const limits=await one(db,`SELECT (${pendingIdeas}) pending,(${ownerRuns}) runs`,owner,new Date(now-3600000).toISOString());
 if(limits.pending>=(ideaPolicy.maxPending||24)||limits.runs>=(ideaPolicy.maxRunsPerHour||30))throw Error('IDEA_QUEUE_LIMIT');
}
// Hash the existing projection and its source-of-truth statuses. No second master,
// body copies or raw ideas in a shared cache. Changes to rejected candidates count too.
export async function ideaSnapshot(db,markets=['KR']){
 const revision=await one(db,"SELECT value FROM catalyst_runtime WHERE key='idea-evidence-revision'");
 if(!revision)throw Error('IDEA_SCHEMA_REQUIRED');
 return hash(JSON.stringify(['idea-evidence-revision-1',markets,revision.value]));
}
export async function createIdeaJob(db,owner,body,{env={},now=Date.now()}={}){
 const input=parseIdeaInput(body,{now}),snapshot=await ideaSnapshot(db,input.markets);
 input.allowExternal=ideaExternalEnabled(env)&&body.allowExternal!==false;
 input.snapshot=snapshot;input.modelVersion=input.allowExternal?(env.CATALYST_AI_MODEL||'configured-adapter'):null;
 const key=await ideaRequestKey(owner,input);
 let old=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',owner,key);
 if(old&&(['QUEUED','RUNNING'].includes(old.status)||now-Date.parse(old.updated_at)<(ideaPolicy.cacheTtlMs||3600000)))return {row:old,shared:true};
 if(old)return {row:await refreshIdeaJob(db,owner,old.id,{version:old.version,action:'refresh'},{env,now}),shared:false};
 const id=crypto.randomUUID(),at=new Date(now).toISOString(),max=ideaPolicy.maxPending||24;
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO news_company_jobs SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE
    (${pendingIdeas})<? AND (${ownerRuns})<?`)
   .bind(id,owner,key,1,'QUEUED','DATABASE',JSON.stringify(input),null,null,at,at,max,owner,new Date(now-3600000).toISOString(),ideaPolicy.maxRunsPerHour||30),
  db.prepare("INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,NULL,'IDEA_CREATE',0,created_at FROM news_company_jobs WHERE id=?").bind(id)
 ]);
 const row=await one(db,'SELECT * FROM news_company_jobs WHERE owner=? AND request_key=?',owner,key);
 if(!row)throw Error('IDEA_QUEUE_LIMIT');return {row,shared:row.id!==id};
}
export async function refreshIdeaJob(db,owner,id,body,{env={},now=Date.now()}={}){
 const row=await readJob(db,id,owner);if(!row||!isIdea(row))throw Error('NOT_FOUND');
 if(body.version!==row.version)throw Error('VERSION_CONFLICT');
 if(body.action==='cancel'){
  await db.prepare("UPDATE news_company_jobs SET status='CANCELLED',phase='CANCELLED',error=NULL,updated_at=? WHERE id=? AND owner=? AND version=? AND status IN ('QUEUED','RUNNING')").bind(new Date(now).toISOString(),id,owner,row.version).run();return readJob(db,id,owner);
 }
 if(body.action!=='refresh')throw Error('INVALID_ACTION');
 if(['RUNNING','QUEUED'].includes(row.status))throw Error('RUNNING_CONFLICT');
 const old=json(row.input),input=parseIdeaInput({text:old.text,markets:old.markets,asOf:old.historical?old.asOf.slice(0,10):undefined},{now});
 input.allowExternal=ideaExternalEnabled(env)&&body.allowExternal!==false&&(body.allowExternal===true||old.allowExternal===true);
 input.snapshot=await ideaSnapshot(db,input.markets);input.modelVersion=input.allowExternal?(env.CATALYST_AI_MODEL||'configured-adapter'):null;
 const version=row.version+1,at=new Date(now).toISOString(),key=await ideaRequestKey(owner,input);
 const r=await db.batch([
  // Reserve both budgets in the same transaction as the version write. Another
  // refresh or create must see this run before it can claim the last slot.
  db.prepare(`UPDATE OR IGNORE news_company_jobs SET input=?,request_key=?,version=?,status='QUEUED',phase='DATABASE',error=NULL,updated_at=? WHERE id=? AND owner=? AND version=?
   AND status NOT IN ('QUEUED','RUNNING') AND (${pendingIdeas})<? AND (${ownerRuns})<?`)
   .bind(JSON.stringify(input),key,version,at,id,owner,row.version,ideaPolicy.maxPending||24,owner,new Date(now-3600000).toISOString(),ideaPolicy.maxRunsPerHour||30),
  db.prepare("INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,NULL,'IDEA_REFRESH',0,updated_at FROM news_company_jobs WHERE id=? AND version=?").bind(id,version)
 ]);
 if(!r[0].meta.changes){
  const current=await readJob(db,id,owner);
  if(current?.version===row.version)await checkIdeaLimits(db,owner,now);
  throw Error('VERSION_CONFLICT');
 }
 return readJob(db,id,owner);
}
export async function validateIdeaDependencies(db,row,allowed=()=>false){
 const result=json(row.result),input=json(row.input);
 if(result.ruleVersion!==ideaPolicy.version||!result.snapshot||result.snapshot!==await ideaSnapshot(db,input.markets))return false;
 for(const s of [...result.sources||[],...result.financialSources||[]])if(!await allowed(s))return false;
 for(const [id,version]of Object.entries(result.financialProfileVersions||{}))if(await financialProfileVersion(db,id)!==version)return false;
 return true;
}
export function publicIdeaJob(row,{valid=true}={}){
 const out=publicJob(row);if(!out)return out;
 out.stale=Date.now()-Date.parse(row.updated_at)>(ideaPolicy.cacheTtlMs||3600000);
 if(out.result){
  const finished=['COMPLETE','PARTIAL'].includes(out.status),visibleResult=valid&&finished;
  // Rejected identities and source bodies belong to the private diagnostic ledger,
  // not to a loophole list under strict user conditions.
  const r=out.result;delete r.rawCandidates;delete r.excluded;delete r.decisions;delete r.claimRecords;
  delete r.snapshot;delete r.profileVersions;delete r.documentVersions;delete r.financialSources;
  const visible=new Set([...(r.inline?.candidates||[]),...(r.inline?.conditional||[])].flatMap(c=>(c.claims||[]).map(x=>x.sourceId)));
  r.sources=(r.sources||[]).filter(s=>visible.has(s.id)).map(s=>({id:s.id,url:s.url,title:s.title,publishedAt:s.publishedAt,observedAt:s.observedAt}));
  if(!visibleResult){
   r.candidates=[];r.pending=[];
   r.inline={...r.inline,scenario:null,candidates:[],conditional:[],status:out.status==='CANCELLED'?'cancelled':'invalidated',
    message:out.status==='CANCELLED'?'탐색을 취소했습니다.':out.status==='FAILED'?'자료 재확인에 실패하여 이전 결과를 보류했습니다. 다시 시도해 주세요.':!valid?'사업 근거가 변경되어 이전 결과를 보류했습니다. 최신 근거로 다시 확인해 주세요.':'저장된 근거를 다시 확인하고 있습니다.',
    states:{execution:out.status,data:'INSUFFICIENT',freshness:'UNKNOWN'}};
   if(!valid&&finished){
    // Rebuild only current code-owned general principles from the user's
    // premise. No cached company, financial value, quote or source survives.
    const scenario=buildIdeaScenario(out.input,{status:'insufficient',interpretation:{products:out.input.products||[]},candidates:[],conditional:[],states:{data:'INSUFFICIENT',external:'NOT_REQUESTED'}});
    if(scenario)r.inline.scenario={...scenario,principlesOnly:true,evidenceNotice:r.inline.message};
   }
  }
  out.result={inputType:'IDEA',ruleVersion:r.ruleVersion,asOf:r.asOf,inline:r.inline,states:r.inline?.states||r.states,
   candidates:visibleResult?(r.inline?.candidates||[]):[],pending:[],
   sources:visibleResult?r.sources:[],diagnostics:r.diagnostics,limitations:r.limitations};
 }
 return out;
}
// Called after the existing business-profile index is refreshed. Only dependent
// local-only ideas are automatically requeued; paid runs never silently repeat.
export async function invalidateIdeaResults(db,assetId,{now=Date.now()}={}){
 const affected=await rows(db,`SELECT DISTINCT j.id,j.version,j.owner,j.input FROM news_company_jobs j JOIN news_inline_dependencies d ON d.job_id=j.id
 WHERE d.asset_id=? AND json_extract(j.input,'$.inputType')='IDEA' AND COALESCE(json_extract(j.input,'$.allowExternal'),0)=0
 AND j.status IN ('COMPLETE','PARTIAL')`,assetId);
 let queued=0;
 for(const j of affected){
  const input=json(j.input),at=new Date(now).toISOString();
  if(!input.historical)input.asOf=at;
  input.snapshot=await ideaSnapshot(db,input.markets);
  const key=await ideaRequestKey(j.owner,input),writes=await db.batch([
  db.prepare(`UPDATE OR IGNORE news_company_jobs SET version=version+1,status='QUEUED',phase='DATABASE',input=?,request_key=?,updated_at=? WHERE id=? AND version=? AND status IN ('COMPLETE','PARTIAL') AND (${pendingIdeas})<?`).bind(JSON.stringify(input),key,at,j.id,j.version,ideaPolicy.maxPending||24),
  db.prepare("INSERT OR IGNORE INTO news_company_versions SELECT id,version,input,NULL,'IDEA_EVIDENCE_CHANGED',0,updated_at FROM news_company_jobs WHERE id=? AND version=?").bind(j.id,j.version+1)
  ]);
  queued+=writes[0].meta.changes;
 }
 return queued;
}
