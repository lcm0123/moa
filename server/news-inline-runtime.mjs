import {one,rows} from './catalyst/store.mjs';
import {createNewsJob} from './news-companies-store.mjs';
import {articleRelationOwner,newsLivePolicy} from './news-live-policy.mjs';
import {inlinePolicy,inlineRequest,inlineScope,inlineState,stableVersion} from './news-inline-model.mjs';
import {validateInlineDependencies} from './news-inline-publication.mjs';
import {articleDiscoveryAt} from './news-articles.mjs';
const transient=new Set(['AI_RATE_LIMIT','AI_TIMEOUT','ARTICLE_READ_FAILED','WORKER_INTERRUPTED','TIMEOUT','PIPELINE_FAILED']);
const failureState=code=>/LIMIT|BUDGET|CONTEXT|QUEUE|MEMORY/.test(code||'')?'deferred':/EVIDENCE|SCHEMA|UNSUPPORTED|REFUSAL/.test(code||'')?'insufficient':'unavailable';
export function createInlineRelations({db,allowed,env={},now=Date.now}){
 const scope=inlineScope;
 const binding=id=>one(db,'SELECT * FROM news_inline_bindings WHERE scope=? AND article_id=?',scope,id);
 async function invalidate(b,reason){
  if(!b||b.state==='invalidated')return;
  await db.prepare("UPDATE news_inline_bindings SET state='invalidated',payload=?,updated_at=? WHERE scope=? AND article_id=? AND content_version=? AND job_id IS ?").bind(JSON.stringify({...JSON.parse(b.payload),reason,needsRecovery:true}),new Date(now()).toISOString(),scope,b.article_id,b.content_version,b.job_id).run();
  // Shared jobs may finish, but the invalidated pointer will never publish them.
 }
 async function read(article){
  const b=await binding(article.id),request=await inlineRequest(article);
  if(!b)return inlineState('deferred',{code:'NOT_YET_INGESTED',message:'다음 자동 수집에서 원문 확인 여부를 결정합니다.',articleId:article.id});
  if(request.contentVersion!==b.content_version){await invalidate(b,'ARTICLE_CHANGED');return inlineState('invalidated',{articleId:article.id,rechecking:false,contentVersion:request.contentVersion});}
  const meta=JSON.parse(b.payload),base={articleId:article.id,contentVersion:b.content_version,rechecking:false};
  if(b.state==='invalidated')return inlineState('invalidated',{...base,code:meta.reason});
  if(!b.job_id)return inlineState(b.state,{...base,code:meta.reason,...meta.message?{message:meta.message}:{}});
  const job=await one(db,'SELECT * FROM news_company_jobs WHERE id=? AND owner=?',b.job_id,articleRelationOwner);
  if(!job||JSON.parse(job.input).inlineV2?.scope!==scope)return inlineState('unavailable',{...base,code:'SCOPE_MISMATCH'});
  if(['QUEUED','RUNNING'].includes(job.status)){
   // Queue and worker are real, and bounded expiry is surfaced even when the worker stopped.
   if(now()-Date.parse(job.updated_at)>600000)return inlineState('unavailable',{...base,code:'WORKER_STALLED'});
   return inlineState(job.status==='RUNNING'?'verifying':'waiting',{...base,rechecking:true,phase:job.phase});
  }
  if(!['COMPLETE','PARTIAL'].includes(job.status))return inlineState(failureState(job.error),{...base,code:job.error||job.status,retrieval:/TIMEOUT/.test(job.error||'')?'timeout':'inaccessible'});
  const r=JSON.parse(job.result||'null');
  if(!r?.inline||r.context?.contentVersion!==b.content_version)return inlineState('unavailable',{...base,code:'VERSION_MISMATCH'});
  if(r.inline.eventAnchor&&!r.inline.corrective&&r.event.publishedAt){
   const correction=await one(db,"SELECT id FROM news_company_jobs WHERE owner=? AND id<>? AND status IN ('COMPLETE','PARTIAL') AND json_extract(result,'$.inline.corrective')=1 AND json_extract(result,'$.inline.eventAnchor')=? AND json_extract(result,'$.event.publishedAt')>=? LIMIT 1",articleRelationOwner,job.id,r.inline.eventAnchor,r.event.publishedAt);
   if(correction){await invalidate(b,'EVENT_CANCELLED_OR_CORRECTED');return inlineState('invalidated',{...base,code:'EVENT_CANCELLED_OR_CORRECTED'});}
  }
  if(!await validateInlineDependencies(db,job,allowed)){await invalidate(b,'EVIDENCE_CHANGED');return inlineState('invalidated',{...base,code:'EVIDENCE_CHANGED'});}
  const {decisions,diagnostics,eventAnchor,scope:privateScope,...visible}=r.inline;
  return {...visible,...base};
 }
 async function observe(articles,{deferred=null}={}){
  let enqueued=0;const at=new Date(now()).toISOString();
  for(const article of articles){
   let b=await binding(article.id),context=await inlineRequest(article),meta=b?JSON.parse(b.payload):{},changed=b&&b.content_version!==context.contentVersion;
   if(!changed&&meta.reason==='EVENT_CANCELLED_OR_CORRECTED')continue;
   const job=b?.job_id?await one(db,'SELECT * FROM news_company_jobs WHERE id=?',b.job_id):null;
   if(job&&JSON.parse(job.input).inlineV2?.promptVersion!==context.promptVersion)changed=true;
   if(job?.result&&['COMPLETE','PARTIAL'].includes(job.status)&&b.state!=='invalidated'&&!changed){await read(article);b=await binding(article.id);meta=JSON.parse(b.payload);}
   const retry=job?.status==='FAILED'&&transient.has(job.error)&&(meta.attempts||1)<inlinePolicy.maxAttempts&&now()-Date.parse(job.updated_at)>=inlinePolicy.retryMs;
   if(b&&!changed&&b.state!=='invalidated'&&job&&!retry)continue;
   if(changed)await invalidate(b,'ARTICLE_CHANGED');
   const age=now()-Date.parse(articleDiscoveryAt(article));
   let reason=deferred,state='deferred';
   if(!Number.isFinite(age)||age<0||age>inlinePolicy.maxArticleAgeMs){reason='ARTICLE_TIME_OUTSIDE_AUTOMATIC_SCOPE';state='insufficient';}
   if(enqueued>=newsLivePolicy(env).maxEnqueuePerTick)reason=reason||'NEXT_COLLECTION';
   const attempts=changed?1:retry?(meta.attempts||1)+1:meta.attempts||1;
   if(!changed&&b?.state==='invalidated')context={...context,evidenceRevision:await stableVersion(await rows(db,'SELECT d.asset_id,d.profile_version,i.item_id,i.payload,c.status,f.lifecycle_status FROM news_inline_dependencies d LEFT JOIN business_profile_index i ON i.asset_id=d.asset_id LEFT JOIN catalyst_claims c ON c.id=json_extract(i.payload,\'$.claimId\') LEFT JOIN company_metadata_facts f ON f.id=i.observation_id WHERE d.job_id=? ORDER BY d.source_id,i.item_id',b.job_id))};
   const {articleId,...jobContext}=context;let nextJob=null;
   if(!reason){
    try{const created=await createNewsJob(db,articleRelationOwner,{url:article.url,title:article.title,conditions:{includeIndirect:true}},{maxPending:newsLivePolicy(env).maxPending,inlineContext:{...jobContext,attempt:attempts},maxDailyJobs:inlinePolicy.maxDailyJobs});nextJob=created.row;enqueued+=!created.shared;state='waiting';}
    catch(e){reason=['DAILY_LIMIT','QUEUE_FULL'].includes(e.message)?e.message:'INTAKE_FAILED';}
   }
   // One pointer per article/version. Delayed jobs cannot commit through a replaced pointer.
   await db.prepare(`INSERT INTO news_inline_bindings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(scope,article_id) DO UPDATE SET event_key=excluded.event_key,content_version=excluded.content_version,job_id=excluded.job_id,state=excluded.state,payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,article.id,context.eventKey,context.contentVersion,nextJob?.id||null,state,JSON.stringify({reason,attempts,firstObservedAt:meta.firstObservedAt||at,message:reason==='ARTICLE_TIME_OUTSIDE_AUTOMATIC_SCOPE'?'자동 원문 확인 기간 밖의 기사입니다.':null}),at).run();
  }
  return {enqueued};
 }
 async function propagate(){
  // Explicit project + actor anchors only. Similar industry titles never join events.
  const corrections=await rows(db,"SELECT id,result FROM news_company_jobs WHERE owner=? AND status IN ('COMPLETE','PARTIAL') AND json_extract(result,'$.inline.corrective')=1 ORDER BY updated_at DESC LIMIT 30",articleRelationOwner);
  for(const j of corrections){const r=JSON.parse(j.result),anchor=r.inline.eventAnchor;if(!anchor)continue;
   const previous=await rows(db,"SELECT b.* FROM news_inline_bindings b JOIN news_company_jobs j ON j.id=b.job_id WHERE b.scope=? AND b.state<>'invalidated' AND j.id<>? AND json_extract(j.result,'$.inline.eventAnchor')=? AND json_extract(j.result,'$.event.publishedAt')<=?",scope,j.id,anchor,r.event.publishedAt||'');
   for(const b of previous)await invalidate(b,'EVENT_CANCELLED_OR_CORRECTED');
  }
 }
 return {read,observe,propagate,async decorate(items){return Promise.all(items.map(async a=>({...a,relation:await read(a)})));},async status(ids,resolve){const items=[];for(const id of ids){const a=await resolve(id);items.push({id,relation:a?await read(a):inlineState('unavailable',{articleId:id,code:'ARTICLE_EXPIRED'})});}return {items};}};
}
