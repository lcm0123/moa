import {one,rows} from './store.mjs';
import {ownedChat} from './chat-store.mjs';
import {stockIdentity} from './assets.mjs';

export const thesisStatementTypes=Object.freeze(['USER_BELIEF','USER_ASSUMPTION','USER_GOAL','EVIDENCE_FACT','DERIVED_METRIC','RESEARCH_INFERENCE','UNKNOWN']);
const parse=(value,fallback)=>{try{return JSON.parse(value??'null')??fallback;}catch{return fallback;}};
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('THESIS_INPUT_INVALID');return value.trim();};
const list=(value,max=12,length=300)=>{if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!v.trim()||v.length>length))throw Error('THESIS_INPUT_INVALID');return [...new Set(value.map(v=>v.trim()))];};
const validOwner=owner=>{if(!/^[a-f0-9]{64}$/.test(owner||''))throw Error('THESIS_ACCESS_DENIED');};
const importance=value=>{if(!Number.isInteger(value)||value<1||value>3)throw Error('THESIS_INPUT_INVALID');return value;};
const assetView=a=>({id:a.id,name:a.name,symbol:a.symbol,kind:a.kind,market:a.market||(a.kind==='KR_STOCK'?'KR':a.kind==='US_STOCK'?'US':'CRYPTO'),href:a.kind==='CRYPTO'?'/crypto?coin='+encodeURIComponent(a.instrumentId||a.symbol):'/stock/'+(a.kind==='KR_STOCK'?'KR':'US')+'/'+encodeURIComponent(a.symbol)+'?tab=company'});
// Tracking an already SEC-mapped issuer does not require guessing its exchange.
// The CIK+ticker canonical ID must still exactly match the existing verified DB row.
const linkableAsset=a=>!!a&&(a.canonicalIdentity?.complete||(a.kind==='US_STOCK'&&a.market==='US'&&a.identityStatus==='verified'&&a.canonicalIdentity?.missing?.length===1&&a.canonicalIdentity.missing[0]==='exchange'&&stockIdentity('US',a.symbol,a.issuerId)===a.id));

export async function ownedThesis(store,id,owner){validOwner(owner);return one(store.db,'SELECT * FROM investment_theses WHERE id=? AND owner_id=?',id,owner);}
async function selectedAssets(store,ids){
 const result=[];
 for(const id of ids){const a=await store.asset(id);if(!linkableAsset(a))throw Error('THESIS_ASSET_INVALID');result.push(assetView(a));}
 return result;
}
function boundedSource(s){
 const result={};
 for(const key of ['id','key','kind','title','url','assetId','asset','publisher','publishedAt','effectiveAt','eventTime','retrievedAt','availableAt','observedAt','fiscalPeriod','locator','documentId','documentHash','contentHash','eventKey','reportPath'])if(typeof s[key]==='string')result[key]=s[key].slice(0,key==='url'?2000:500);
 for(const key of ['corrected','amended','truncated'])if(typeof s[key]==='boolean')result[key]=s[key];
 if(Array.isArray(s.range)&&s.range.length===2&&s.range.every(Number.isFinite))result.range=s.range;
 if(Array.isArray(s.inputRefs))result.inputRefs=s.inputRefs.slice(0,18).filter(v=>typeof v==='string');
 if(Array.isArray(s.sourceUrls))result.sourceUrls=s.sourceUrls.slice(0,12).filter(v=>typeof v==='string'&&v.length<=2000);
 const excerpt=typeof s.text==='string'?s.text:s.excerpt;if(typeof excerpt==='string'&&excerpt.length<=9000)result.text=excerpt;
 else if(typeof excerpt==='string')result.textOmitted=true;
 if(Array.isArray(s.numbers))result.numbers=s.numbers.slice(0,24).map(number=>Object.fromEntries(['id','asset','metric','value','unit','period','start','basis','interval','filedAt','display'].filter(key=>number[key]!==undefined).map(key=>[key,number[key]])));
 // Saved structured observations only; never duplicate a document or full chat context.
 if(s.data&&typeof s.data==='object'&&JSON.stringify(s.data).length<=3500)result.data=s.data;
 return result;
}
export async function sanitizeThesisBaseline(baseline,{sourceAllowed=()=>false}={}){
 const b=baseline||{},saved=(b.evidence||[]).slice(0,18),allowed=[];
 for(const source of saved){
  try{if((!source.url||await sourceAllowed(source))&&(!source.sourceUrls||(await Promise.all(source.sourceUrls.map(url=>sourceAllowed({url})))).every(Boolean)))allowed.push(source);}catch{/* A revoked/unavailable source fails closed. */}
 }
 let last;do{last=allowed.length;const ids=new Set(allowed.map(s=>s.id));for(let i=allowed.length-1;i>=0;i--)if(allowed[i].inputRefs?.some(id=>!ids.has(id)))allowed.splice(i,1);}while(last!==allowed.length);
 const ids=new Set(allowed.map(s=>s.id)),blocks=(b.blocks||[]).slice(0,9).map(block=>block.refs?.some(id=>!ids.has(id))?{kind:'unknown',text:'자료의 접근 상태가 바뀌어 이 근거는 다시 확인해야 합니다.',refs:[]}:block);
 return {...b,evidence:allowed,blocks,hasEvidence:allowed.length>0,initialEvidenceStatus:allowed.length?'AVAILABLE':'NOT_ESTABLISHED',withheldSources:saved.length-allowed.length};
}
async function baselineFromChat(store,chatId,owner,options){
 const at=new Date().toISOString(),empty={savedAt:at,sourceChatId:null,sourceAnswerId:null,evidence:[],blocks:[],unknowns:[],hasEvidence:false,initialEvidenceStatus:'NOT_ESTABLISHED'};
 if(!chatId)return empty;
 const chat=await ownedChat(store,chatId,owner);if(!chat||!['complete','limited'].includes(chat.status))throw Error('THESIS_CHAT_UNAVAILABLE');
 const r=parse(chat.result,{}),sources=(r.sources||[]).slice(0,18),context=new Map((r.contextEvidence||[]).map(e=>[e.id,e]));
 const evidence=sources.map(s=>boundedSource({...context.get(s.id),...s}));
 const blocks=(r.blocks||[]).slice(0,9).map(b=>({kind:b.kind,text:String(b.text||'').slice(0,1800),refs:(b.refs||[]).slice(0,18)}));
 return sanitizeThesisBaseline({...empty,sourceChatId:chat.id,sourceAnswerId:chat.id,evidence,blocks,unknowns:blocks.filter(b=>b.kind==='unknown').map(b=>b.text).slice(0,6)},options);
}
async function normalizeInput(store,input,baseline,existing){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('THESIS_INPUT_INVALID');
 const merged={...existing,...input},assetIds=list(merged.linkedAssetIds??[],12,180),linkedAssets=await selectedAssets(store,assetIds);
 const positionContext=merged.positionContext??'UNSPECIFIED';if(!['HOLDING','WATCHING','UNSPECIFIED'].includes(positionContext))throw Error('THESIS_INPUT_INVALID');
 const value={title:text(merged.title,120,true),thesisText:text(merged.thesisText,4000,true),linkedAssetIds:assetIds,linkedIndustryConcepts:list(merged.linkedIndustryConcepts??[],12,100),positionContext,importance:importance(merged.importance??2),monitoringTopics:list(merged.monitoringTopics??[],12,500),reconsiderationConditions:list(merged.reconsiderationConditions??[],12,700)};
 const premises=input.premises??(existing?.premises||[{statement:value.thesisText,statementType:'USER_BELIEF',importance:value.importance,linkedAssetIds:assetIds,monitoringTopics:value.monitoringTopics,reconsiderationConditions:value.reconsiderationConditions}]);
 if(!Array.isArray(premises)||!premises.length||premises.length>16)throw Error('THESIS_INPUT_INVALID');
 const allowedSources=new Set((baseline.evidence||[]).map(s=>s.id));
 value.premises=premises.map(p=>{
  const statementType=p.statementType||'USER_BELIEF';if(!thesisStatementTypes.includes(statementType))throw Error('THESIS_INPUT_INVALID');
  const statement=text(p.statement,4000,true),refs=list(p.supportingSourceIds??[],18,180),ids=list(p.linkedAssetIds??[],12,180);
  if(ids.some(id=>!assetIds.includes(id))||refs.some(id=>!allowedSources.has(id)))throw Error('THESIS_REFERENCE_INVALID');
  if(['EVIDENCE_FACT','DERIVED_METRIC'].includes(statementType)&&(!refs.length||!baseline.blocks.some(b=>b.text===statement&&b.kind===(statementType==='EVIDENCE_FACT'?'fact':'calculation')&&refs.every(id=>b.refs.includes(id)))))throw Error('THESIS_FACT_UNVERIFIED');
  return {premiseId:p.premiseId&&/^[a-f0-9-]{36}$/.test(p.premiseId)?p.premiseId:crypto.randomUUID(),statement,statementType,importance:importance(p.importance??2),linkedAssetIds:ids,supportingSourceIds:refs,monitoringTopics:list(p.monitoringTopics??[],12,500),reconsiderationConditions:list(p.reconsiderationConditions??[],12,700)};
 });
 if(new Set(value.premises.map(p=>p.premiseId)).size!==value.premises.length)throw Error('THESIS_INPUT_INVALID');
 return {value,linkedAssets};
}
function versionStatements(store,id,version,owner,value,baseline,reason,now){
 return [store.db.prepare('INSERT INTO investment_thesis_versions(thesis_id,version,owner_id,title,thesis_text,snapshot,baseline_snapshot,change_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,version,owner,value.title,value.thesisText,JSON.stringify(value),JSON.stringify(baseline),reason,now),...value.premises.map(p=>store.db.prepare('INSERT INTO investment_thesis_premises(premise_id,thesis_id,thesis_version,statement,statement_type,importance,linked_asset_ids,supporting_source_ids,monitoring_topics,reconsideration_conditions) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(p.premiseId,id,version,p.statement,p.statementType,p.importance,JSON.stringify(p.linkedAssetIds),JSON.stringify(p.supportingSourceIds),JSON.stringify(p.monitoringTopics),JSON.stringify(p.reconsiderationConditions)))];
}
export async function saveThesis(store,owner,input,options={}){
 validOwner(owner);const baseline=await baselineFromChat(store,input?.sourceChatId,owner,options),{value}=await normalizeInput(store,input,baseline),id=crypto.randomUUID(),now=new Date().toISOString();
 await store.db.batch([store.db.prepare('INSERT INTO investment_theses(id,owner_id,title,thesis_text,linked_asset_ids,linked_industry_concepts,position_context,importance,monitoring_topics,reconsideration_conditions,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,value.title,value.thesisText,JSON.stringify(value.linkedAssetIds),JSON.stringify(value.linkedIndustryConcepts),value.positionContext,value.importance,JSON.stringify(value.monitoringTopics),JSON.stringify(value.reconsiderationConditions),now,now),...versionStatements(store,id,1,owner,value,baseline,'처음 저장',now)]);
 return getThesisDetail(store,id,owner,options);
}
export async function updateThesis(store,id,owner,input,options={}){
 const current=await ownedThesis(store,id,owner);if(!current)throw Error('THESIS_NOT_FOUND');if(current.status==='ARCHIVED')throw Error('THESIS_ARCHIVED');
 if(!Number.isInteger(input?.expectedVersion)||input.expectedVersion!==current.current_version)throw Error('THESIS_VERSION_CONFLICT');
 const reason=text(input.changeReason,500,true),old=await one(store.db,'SELECT * FROM investment_thesis_versions WHERE thesis_id=? AND version=? AND owner_id=?',id,current.current_version,owner);
 const baseline=parse(old.baseline_snapshot,{}),prior=parse(old.snapshot,{}),version=current.current_version+1;
 // Simple-form edits update the same primary belief and its explicit monitoring
 // scope. Historical versions retain the previous statement and conditions.
 if(!input.premises)input={...input,premises:prior.premises.map((p,i)=>{
  const next={...p};
  if(i===0&&p.statementType==='USER_BELIEF'){
   if(input.thesisText!==undefined)next.statement=input.thesisText;
   for(const key of ['linkedAssetIds','monitoringTopics','reconsiderationConditions','importance'])if(input[key]!==undefined)next[key]=input[key];
  }else if(Array.isArray(input.linkedAssetIds))next.linkedAssetIds=p.linkedAssetIds.filter(id=>input.linkedAssetIds.includes(id));
  return next;
 })};
 const {value}=await normalizeInput(store,input,baseline,prior),now=new Date().toISOString();
 try{await store.db.batch([...versionStatements(store,id,version,owner,value,baseline,reason,now),store.db.prepare("UPDATE investment_theses SET title=?,thesis_text=?,current_version=?,linked_asset_ids=?,linked_industry_concepts=?,position_context=?,importance=?,monitoring_topics=?,reconsideration_conditions=?,updated_at=? WHERE id=? AND owner_id=? AND current_version=? AND status='ACTIVE'").bind(value.title,value.thesisText,version,JSON.stringify(value.linkedAssetIds),JSON.stringify(value.linkedIndustryConcepts),value.positionContext,value.importance,JSON.stringify(value.monitoringTopics),JSON.stringify(value.reconsiderationConditions),now,id,owner,current.current_version)]);}catch(e){if(/UNIQUE constraint/i.test(e.message))throw Error('THESIS_VERSION_CONFLICT');throw e;}
 return getThesisDetail(store,id,owner,options);
}
export async function archiveThesis(store,id,owner,options={}){
 if(!await ownedThesis(store,id,owner))throw Error('THESIS_NOT_FOUND');const now=new Date().toISOString();
 await store.db.prepare("UPDATE investment_theses SET status='ARCHIVED',archived_at=COALESCE(archived_at,?),updated_at=? WHERE id=? AND owner_id=?").bind(now,now,id,owner).run();
 return getThesisDetail(store,id,owner,options);
}
export async function publicThesisReview(row,options={}){
 if(!row)return null;
 const pending=['queued','running'].includes(row.status),terminal=['failed','cancelled','complete','limited'].includes(row.job_status),expired=Number.isFinite(Date.parse(row.started_at))&&Date.now()-Date.parse(row.started_at)>=960000;
 // A status read never starts/retries work or advances the successful baseline.
 // The one-shot cleanup repairs persistence; this also covers a terminated host.
 if(pending&&(terminal||expired))return {id:row.id,thesisId:row.thesis_id,thesisVersion:row.thesis_version,jobId:row.job_id,status:row.job_status==='cancelled'?'cancelled':'failed',investigationStatus:'FAILED',baselineReviewId:row.baseline_review_id,startedAt:row.started_at,completedAt:row.completed_at||row.job_updated_at||null,result:{assessment:'INSUFFICIENT_DATA',investigationStatus:'FAILED',blocks:[{kind:'unknown',text:row.job_status==='cancelled'?'변화 확인이 취소되었습니다. 마지막 정상 비교 기준은 유지합니다.':'변화 확인 작업이 완료되지 않았습니다. 마지막 정상 비교 기준을 유지하며, 새 변화 확인을 눌러 다시 요청할 수 있습니다.',refs:[]}],changes:[],sources:[],unknowns:['검토가 완료되지 않아 변화를 판단할 수 없습니다.']},evidence:[],interrupted:true};
 const evidence=parse(row.evidence_snapshot,[]);let result=parse(row.result,null);
 const merged=new Map(evidence.map(s=>[s.id,s]));for(const s of result?.sources||[])merged.set(s.id,{...merged.get(s.id),...s});
 const baseline=await sanitizeThesisBaseline({evidence:[...merged.values()]},options);
 if(baseline.withheldSources&&result)result={assessment:'INSUFFICIENT_DATA',investigationStatus:'SOURCE_UNAVAILABLE',blocks:[{kind:'unknown',text:'사용한 자료의 접근 상태가 바뀌어 검토 결과를 다시 확인해야 합니다.',refs:[]}],changes:[],sources:[],unknowns:['접근할 수 없는 근거가 있습니다.']};
 // Older completed reviews may have exhausted comparisons while retaining the
 // model's COMPLETE label. Preserve history; project the actual usable scope.
 const comparisonIncomplete=row.investigation_status==='COMPLETE_WITHIN_SCOPE'&&result?.assessment==='INSUFFICIENT_DATA'&&result.initialEvidence!==true;
 const investigationStatus=baseline.withheldSources?'SOURCE_UNAVAILABLE':comparisonIncomplete?'PARTIAL':row.investigation_status;
 if(comparisonIncomplete&&!baseline.withheldSources)result={...result,investigationStatus:'PARTIAL'};
 return {id:row.id,thesisId:row.thesis_id,thesisVersion:row.thesis_version,jobId:row.job_id,status:row.status,investigationStatus,baselineReviewId:row.baseline_review_id,startedAt:row.started_at,completedAt:row.completed_at,result,evidence:baseline.evidence};
}
function presentThesis(row){return {id:row.id,title:row.title,thesisText:row.thesis_text,status:row.status,currentVersion:row.current_version,linkedAssetIds:parse(row.linked_asset_ids,[]),linkedIndustryConcepts:parse(row.linked_industry_concepts,[]),positionContext:row.position_context,importance:row.importance,monitoringTopics:parse(row.monitoring_topics,[]),reconsiderationConditions:parse(row.reconsideration_conditions,[]),createdAt:row.created_at,updatedAt:row.updated_at,lastReviewAt:row.last_review_at,lastSuccessfulReviewAt:row.last_successful_review_at};}
async function enrichThesis(store,row,owner,options){const value=presentThesis(row),assets=await Promise.all(value.linkedAssetIds.map(id=>store.asset(id)));value.linkedAssets=assets.filter(Boolean).map(assetView);value.latestReview=await publicThesisReview(await one(store.db,'SELECT r.*,j.status job_status,j.lease_until job_lease_until,j.updated_at job_updated_at FROM investment_thesis_reviews r LEFT JOIN catalyst_research_jobs j ON j.id=r.job_id WHERE r.thesis_id=? AND r.owner_id=? AND r.thesis_version=? ORDER BY r.started_at DESC,r.id DESC LIMIT 1',row.id,owner,row.current_version),options);return value;}
export async function listTheses(store,owner,{status='ACTIVE',limit=60,...options}={}){
 validOwner(owner);if(!['ACTIVE','ARCHIVED','ALL'].includes(status))throw Error('THESIS_INPUT_INVALID');limit=Math.max(1,Math.min(100,Number(limit)||60));
 const found=await rows(store.db,"SELECT * FROM investment_theses WHERE owner_id=? AND (?='ALL' OR status=?) ORDER BY importance DESC,COALESCE(last_review_at,updated_at) DESC,id LIMIT ?",owner,status,status,limit);
 return Promise.all(found.map(row=>enrichThesis(store,row,owner,options)));
}
function visiblePremises(premises,baseline){const ids=new Set(baseline.evidence.map(e=>e.id));return (premises||[]).map(p=>p.supportingSourceIds?.some(id=>!ids.has(id))?{...p,statement:'자료의 접근 상태가 바뀌어 이 근거는 다시 확인해야 합니다.',statementType:'UNKNOWN',supportingSourceIds:[]}:p);}
export async function getThesisDetail(store,id,owner,options={}){
 const row=await ownedThesis(store,id,owner);if(!row)return null;const value=await enrichThesis(store,row,owner,options);
 const versions=await rows(store.db,'SELECT * FROM investment_thesis_versions WHERE thesis_id=? AND owner_id=? ORDER BY version DESC LIMIT 100',id,owner);
 value.versions=await Promise.all(versions.map(async v=>{const baseline=await sanitizeThesisBaseline(parse(v.baseline_snapshot,{}),options),snapshot=parse(v.snapshot,{});return {version:v.version,title:v.title,thesisText:v.thesis_text,snapshot:{...snapshot,premises:visiblePremises(snapshot.premises,baseline)},baseline,changeReason:v.change_reason,createdAt:v.created_at};}));
 const current=value.versions.find(v=>v.version===value.currentVersion);value.baseline=current?.baseline;value.premises=current?.snapshot.premises||[];
 value.reviews=await Promise.all((await rows(store.db,'SELECT r.*,j.status job_status,j.lease_until job_lease_until,j.updated_at job_updated_at FROM investment_thesis_reviews r LEFT JOIN catalyst_research_jobs j ON j.id=r.job_id WHERE r.thesis_id=? AND r.owner_id=? ORDER BY r.started_at DESC,r.id DESC LIMIT 20',id,owner)).map(r=>publicThesisReview(r,options)));
 return value;
}
export async function draftThesis(store,chatId,owner,options={}){
 validOwner(owner);const chat=await ownedChat(store,chatId,owner);if(!chat||!['complete','limited'].includes(chat.status))throw Error('THESIS_CHAT_UNAVAILABLE');
 const baseline=await baselineFromChat(store,chatId,owner,options),result=parse(chat.result,{}),assetSuggestions=[];
 for(const item of (result.assets||[]).slice(0,12)){const a=await store.asset(item.id||item.assetId);if(linkableAsset(a))assetSuggestions.push(assetView(a));}
 const blocks=baseline.blocks.filter(b=>['analysis','assumption'].includes(b.kind));
 return {title:chat.query.slice(0,120),thesisText:(blocks[0]?.text||chat.query).slice(0,4000),sourceChatId:chat.id,draftOrigin:'SAVED_AI_ANSWER',draftLabel:'AI가 정리한 초안',assetSuggestions,linkedAssetIds:[],linkedIndustryConcepts:[],positionContext:'UNSPECIFIED',importance:2,monitoringTopics:[],reconsiderationConditions:[],initialEvidenceStatus:baseline.initialEvidenceStatus};
}
export async function buildThesisContext(store,id,owner,options={}){
 const detail=await getThesisDetail(store,id,owner,options);if(!detail)return null;
 const successful=detail.reviews.find(r=>r.thesisVersion===detail.currentVersion&&r.status==='complete'&&r.investigationStatus==='COMPLETE_WITHIN_SCOPE'&&(r.result?.assessment!=='INSUFFICIENT_DATA'||r.result?.initialEvidence===true));
 const context={id:detail.id,version:detail.currentVersion,title:detail.title,thesisText:detail.thesisText,positionContext:detail.positionContext,linkedAssetIds:detail.linkedAssetIds,linkedAssets:detail.linkedAssets,linkedIndustryConcepts:detail.linkedIndustryConcepts,premises:detail.premises,monitoringTopics:detail.monitoringTopics,reconsiderationConditions:detail.reconsiderationConditions,baseline:detail.baseline,lastSuccessfulReview:successful?{id:successful.id,thesisVersion:successful.thesisVersion,completedAt:successful.completedAt,result:successful.result}:null,userContextNotice:'사용자가 저장한 생각은 사실 확인 결과나 투자 지시가 아닙니다. 새로운 질문 조건을 우선하며 사용자 확인 없이 생각을 변경하지 않습니다.'};
 // Drop whole entries instead of truncating numerical units, negation or user conditions.
 const size=()=>JSON.stringify(context).length;
 while(size()>24000&&context.baseline?.evidence.length)context.baseline.evidence.pop();
 const originalPremiseCount=context.premises.length;
 while(size()>24000&&context.premises.length>1)context.premises.pop();
 if(size()>24000&&context.lastSuccessfulReview){context.lastSuccessfulReview={id:successful.id,thesisVersion:successful.thesisVersion,completedAt:successful.completedAt,resultOmitted:true};}
 if(size()>24000)context.baseline={savedAt:detail.baseline?.savedAt,sourceChatId:detail.baseline?.sourceChatId,evidence:[],blocks:[],initialEvidenceStatus:detail.baseline?.initialEvidenceStatus,contextOmitted:true};
 if(size()>24000)context.premises=[];
 context.omittedPremiseCount=originalPremiseCount-context.premises.length;
 context.contextScope='bounded_saved_thesis';return context;
}
