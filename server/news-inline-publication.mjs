import {one,rows} from './catalyst/store.mjs';
import {inlinePolicy,inlineState,gatePath,stableVersion,canonicalNewsUrl,safeNarrative} from './news-inline-model.mjs';
import {normalize,safeLink,applyConditions} from './news-companies-model.mjs';
import {financialProfileVersion,financialPolicy,financialConditionRows} from './news-inline-financials.mjs';
import {buildFinancialImpact} from './news-inline-scenarios.mjs';

export async function profileVersion(db,assetId){
 const data=await rows(db,`SELECT i.item_id,i.source_id,i.payload,c.status claim_status,f.lifecycle_status,f.verification_status
 FROM business_profile_index i LEFT JOIN catalyst_claims c ON c.id=json_extract(i.payload,'$.claimId')
 LEFT JOIN company_metadata_facts f ON f.id=i.observation_id WHERE i.asset_id=? ORDER BY i.item_id`,assetId);
 return stableVersion(data);
}
export async function buildInlineResult(result,{allowed,context=result.context}={}){
 const event=result.event,cutoff=context?.cutoff;
 async function proof(ref,assetId=null){
  const s=result.sources?.find(s=>s.id===ref?.sourceId);
  if(!s||s.access!=='READ'||s.userProvided||ref.userProvided||assetId&&s.assetId!==assetId||!safeLink(s.url)||!normalize(s.body).includes(normalize(ref.quote))||!await allowed(s))return null;
  // A historical publication date alone does not prove that today's body existed then.
  if(cutoff&&(!s.publishedAt||Date.parse(s.publishedAt)>Date.parse(cutoff)||!s.firstObservedAt||Date.parse(s.firstObservedAt)>Date.parse(cutoff)))return null;
  if(assetId&&(!s.publishedAt||!Number.isFinite(Date.parse(s.publishedAt))||Date.parse(s.publishedAt)>Date.parse(result.asOf)||Date.parse(result.asOf)-Date.parse(s.publishedAt)>inlinePolicy.maxEvidenceAgeMs))return null;
  return {sourceId:s.id,url:s.url,quote:ref.quote,title:s.title,publisher:s.publisher||null,publishedAt:s.publishedAt||null,locator:ref.locator,originGroup:s.independenceKey||s.id};
 }
 const eventEvidence=await proof(event?.evidence);
 if(!eventEvidence)return inlineState('unavailable',{code:'ARTICLE_EVIDENCE_UNAVAILABLE',retrieval:'inaccessible'});
 if(result.unknownConditions?.length)return inlineState('insufficient',{code:'CONDITIONS_UNRESOLVED',eventSummary:event.summary,eventEvidence,message:'입력한 조건을 확인할 수 없어 기업 연결을 보류했습니다.',asOf:result.asOf});
 const candidates=[],decisions=[];
 // Evaluate each path before company placement: a failed path cannot erase a different valid path.
 const evaluated=applyConditions(result.rawCandidates||[],result.applied||{});
 for(const c of [...evaluated.candidates,...evaluated.pending,...evaluated.excluded]){
  for(const l of c.links||[]){
   const d=event.demands.find(d=>d.product===l.product);if(!d)continue;
   const savedFinance=result.financialByAsset?.[c.asset.id]?.paths?.[l.sourceTerm]||result.financialByAsset?.[c.asset.id];
   const financial=savedFinance?structuredClone(savedFinance):null;if(financial)delete financial.paths;
   if(financial){for(const key of ['business','region','exports']){const f=financial[key],s=f&&(result.financialSources||[]).find(s=>s.id===f.sourceId);if(f&&(!s||s.assetId!==c.asset.id||!await allowed(s)))financial[key]=null;}if(!financial.business)financial.exactProductShare=null;if(!financial.region)financial.usShare=null;}
   const pathRows=financial?applyConditions([{...c,...financialConditionRows(financial)}],result.applied):null,pathCandidate=pathRows?[...pathRows.candidates,...pathRows.pending,...pathRows.excluded][0]:c;
   const business=await proof(l.evidence,c.asset.id),demand=await proof(d.evidence),decision=gatePath(pathCandidate,l,d,event,{conditions:result.applied,horizon:context?.horizon});
   decisions.push({assetId:c.asset.id,product:l.product,...decision});
   if(!business||!demand||!['conditional','event_link_verified'].includes(decision.result))continue;
   if(!safeNarrative(l.reason,[eventEvidence.quote,demand.quote,business.quote]))continue;
   let supplied=c.projectSupply&&await proof(c.projectSupply);if(c.projectSupply&&!supplied)continue;
   const conditions=[...d.conditions,...(supplied?[]:['이번 공급사 선정은 미확인'])];
   const weakeningEvidence=(c.counterEvidence||[]).filter(r=>r.effect==='WEAKENS'&&(!r.product||r.product===l.product)),risks=weakeningEvidence.map(r=>r.summary).filter(Boolean);
   const impact=buildFinancialImpact({demand:d,event,horizon:context?.horizon,assumptions:result.scenarioInputs?.[c.asset.id]});
   candidates.push({asset:c.asset,product:l.product,business:l.sourceTerm,reason:l.reason,result:decision.result,evidenceLevel:supplied?'이번 납품 확인':'조건부 연결',direction:weakeningEvidence.length&&decision.direction==='positive'?'mixed':decision.direction,
    timing:d.timing?.text||'시점 미확인',timingEvidence:d.timing?.evidence?await proof(d.timing.evidence):null,
    conditions:[...new Set(conditions)],weakening:[...new Set([...risks,...d.weakening])].slice(0,2),counterQuestion:d.counterQuestion,
    businessEvidence:business,eventEvidence:demand,supplyEvidence:supplied||null,asOf:result.asOf,financial,impact,financialForecast:null});break;
  }
 }
 const scope=context?.scope||'private',evidenceVersion=await stableVersion(result.documentVersions||{}),profileFingerprint=await stableVersion(result.profileVersions||{});
 const resultVersion=await stableVersion({context,evidenceVersion,profileFingerprint,financialVersion:financialPolicy.version,financialProfiles:result.financialProfileVersions||{},scenarios:result.scenarioInputs||{}});
 const anchor=event.project&&event.actor?await stableVersion([scope,normalize(event.actor),normalize(event.project)]):null;
 return inlineState(candidates.length?'complete':'insufficient',{candidates:candidates.slice(0,inlinePolicy.maxCards),eventSummary:event.summary||null,eventEvidence,
  message:candidates.length?'근거 확인 완료':event.corrective?'정정·취소된 사건으로 기존 연결을 표시하지 않습니다.':!event.demands.length?'이 기사에서 추가 지출로 이어지는 제품·사업 경로를 확인하지 못했습니다.':'공개자료에서 이번 사건과 연결되는 기업을 확인하지 못했습니다.',
  code:event.corrective?'CORRECTIVE_EVENT':!event.demands.length?'NO_DEMAND_PATH':candidates.length?'VERIFIED_CARDS':'INSUFFICIENT_EVIDENCE',
  claimKind:event.claimKind,corrective:!!event.corrective,eventAnchor:anchor,resultVersion,evidenceVersion,profileFingerprint,
  asOf:result.asOf,decisions,diagnostics:result.diagnostics,retrieval:candidates.length?'found':'not_found',scope,financialForecast:null});
}
export async function inlineDependencyWrites(db,row,result,{leaseToken=null}={}){
 if(!result?.inline)return [];
 // The version guard belongs to each write: hashing evidence can yield while
 // cancellation or a newer version replaces the job.
 const guard="EXISTS(SELECT 1 FROM news_company_jobs WHERE id=? AND version=? AND status='RUNNING') AND (? IS NULL OR EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='research-worker-lease' AND json_extract(value,'$.token')=? AND json_extract(value,'$.newsJob')=?))",args=[row.id,row.version,leaseToken,leaseToken,row.id];
 const writes=[db.prepare(`DELETE FROM news_inline_dependencies WHERE job_id=? AND ${guard}`).bind(row.id,...args)];
 for(const s of new Map([...(result.sources||[]),...(result.financialSources||[])].map(s=>[s.id,s])).values())writes.push(db.prepare(`INSERT INTO news_inline_dependencies SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(row.id,s.id,canonicalNewsUrl(s.url)||'',s.documentHash||await stableVersion(s.body),s.assetId||null,result.profileVersions?.[s.assetId]||null,JSON.stringify({url:s.url,securityVersion:s.securityVersion,documentHash:s.documentHash,bodyFingerprint:s.bodyFingerprint,publishedAt:s.publishedAt,originGroup:s.independenceKey}),...args));
 return writes;
}
export async function saveInlineDependencies(db,row,result,options){
 const writes=await inlineDependencyWrites(db,row,result,options);if(writes.length)await db.batch(writes);
}
export async function validateInlineDependencies(db,job,allowed){
 const deps=await rows(db,'SELECT * FROM news_inline_dependencies WHERE job_id=?',job.id),versions=new Map();
 if(!deps.length)return false;
 const snapshot=typeof job.result==='string'?JSON.parse(job.result||'null'):job.result;
 for(const [id,version]of Object.entries(snapshot?.financialProfileVersions||{}))if(await financialProfileVersion(db,id)!==version)return false;
 for(const d of deps){
  const s=JSON.parse(d.payload);if(!await allowed({...s,id:d.source_id}))return false;
  if(d.asset_id){
   const asset=await one(db,"SELECT identity_status,payload FROM catalyst_assets WHERE id=?",d.asset_id);
   if(!asset||asset.identity_status!=='verified'||JSON.parse(asset.payload).active===false)return false;
   if(!versions.has(d.asset_id))versions.set(d.asset_id,await profileVersion(db,d.asset_id));
   if(versions.get(d.asset_id)!==d.profile_version)return false;
  }
 }
 return true;
}
