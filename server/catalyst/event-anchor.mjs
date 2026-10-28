import {admissible,corroborated} from './evidence-policy.mjs';
import {scopeTerms,scopeLabel,resolveDocumentScope} from './document-scope.mjs';
import {classifyQuery} from './core.mjs';
const unknown='UNKNOWN';
export function eventTechnicalConnection(anchor,claim,edge){
 const scope=resolveDocumentScope({document:{body:claim?.quote},targetProduct:anchor?.targetProduct});
 const valid=admissible(anchor)&&admissible(claim)&&['VERIFIED','SUPPORTED'].includes(edge?.status);
 const status=!valid?'INSUFFICIENT_SCOPE':scope.status==='EXACT'?(claim.scopeVerification?.target===anchor.targetScope?'DIRECT_TECHNICAL_MATCH':'SUPPORTED_TECHNICAL_MATCH'):scope.status==='BROAD'?'GENERIC_TECHNICAL_MATCH':'INSUFFICIENT_SCOPE';
 return {status,edgeId:edge?.id,claimId:claim?.id,eventClaimId:anchor?.claimId,eventTarget:anchor?.targetScope,technicalScope:claim?.scopeVerification?.target,compatibility:scope,relation:edge?.relation_type,existingEdgeUsed:true};
}
export function eventAnchorFields(c,source){
 const p=c.normalizedProposition||{},q=c.quote||'',subsidiary=p.subsidiary_name||p.subsidiary||unknown;
 const eventSubject=p.event_subject||p.subject||unknown;
 let eventType=unknown;
 if(subsidiary!==unknown||/subsidiary|종속회사|자회사/i.test(q))eventType='SUBSIDIARY_CAPEX';
 else if(/approved|승인|이사회.*결의/i.test(q))eventType='CAPEX_APPROVAL';
 else if(/new production line|신규 생산라인/i.test(q))eventType='NEW_PRODUCTION_LINE';
 else if(/(?:plant|factory).*expan|(?:공장|사업장).*증설/i.test(q))eventType='PLANT_EXPANSION';
 else if(/capacity|증설|생산능력/i.test(q))eventType='CAPACITY_EXPANSION';
 else if(/invest|capex|투자|유형자산/i.test(q))eventType='FACILITY_INVESTMENT';
 const raw=c.scope?.eventState||p.eventState;
 const status=({ANNOUNCED:'ANNOUNCED',APPROVED:'APPROVED',UNDER_CONSTRUCTION:'UNDER_CONSTRUCTION',COMPLETED:'COMPLETED',IN_PRODUCTION:'OPERATING',OPERATING:'OPERATING'})[raw]||unknown;
 return {issuer:source.resolvedAuthority?.sourceTier===2?p.subject||unknown:source.resolvedAuthority?.organizationName||source.publisher||p.subject||unknown,eventSubject,subsidiary,eventType,eventStatus:status,amount:p.investment_amount||unknown,expectedCompletion:p.completion_date||unknown,location:p.location||unknown,announcementDate:c.asOf,approvalDate:status==='APPROVED'?p.approval_date||unknown:unknown};
}
export async function resolveEventAnchor({question,discoveredSources=[],existingClaims=[],store,runId,now=Date.now()}){
 const conditional=classifyQuery(question).scenario;
 const out={status:'NO_EVENT_ANCHOR',queryIntent:conditional?'CONDITIONAL_ANALYSIS':'ACTUAL_ANALYSIS',eventAnchor:null,issuer:unknown,asset:unknown,eventType:unknown,targetProduct:unknown,targetScope:unknown,amount:unknown,announcementDate:unknown,approvalDate:unknown,expectedCompletion:unknown,eventStatus:unknown,sourceIds:[],rejectReason:'NO_VERIFIED_RECENT_OFFICIAL_EVENT'};
 for(const c of existingClaims){
  const source=discoveredSources.find(s=>c.sourceIds?.includes(s.id));
  if(c.type!=='event'||!admissible(c)||!source||(!corroborated(c)&&(!source.assetId||!['official','regulatory','business'].includes(source.sourceType)||c.validationChecks?.SOURCE_AUTHORITY?.status!=='PASS'))||!Number.isFinite(Date.parse(c.asOf))||now-Date.parse(c.asOf)>180*86400000||Date.parse(c.asOf)>now)continue;
  if(!/expan|invest|capacity|plant|factory|증설|투자|신설|생산능력/i.test(c.quote))continue;
  const target=scopeTerms(c.normalizedProposition?.production_target||c.normalizedProposition?.object||c.quote)[0];if(!target)continue;
  // Product-family compatibility is discovery only. The exact event scope is
  // carried downstream; a generic question is never rewritten to FC-BGA.
  const questionTargets=scopeTerms(question);if(questionTargets.length&&!questionTargets.some(t=>['PCB','SUBSTRATE'].includes(t.id)||t.id===target.id))continue;
  const fields=eventAnchorFields(c,source);if(fields.eventType===unknown)continue;
  Object.assign(out,{status:c.status,evidenceLevel:c.status,eventLevel:c.status==='VERIFIED'?'VERIFIED_EVENT':'SUPPORTED_EVENT',sourceCount:c.sourceCount||c.sourceIds.length,independentSourceCount:c.independentSourceCount||1,officialSourceCount:c.status==='VERIFIED'?1:0,evidencePolicy:c.evidencePolicy,corroboration:c.corroboration,eventAnchor:conditional?'ACTUAL_EVENT_EXAMPLE':'ACTUAL_EVENT',...fields,asset:source.assetId,targetProduct:scopeLabel(target.id),targetScope:target.id,sourceIds:c.sourceIds,claimId:c.id,authority:source.resolvedAuthority||source.authority,rejectReason:null});break;
 }
 if(store&&runId)await store.db.prepare('INSERT OR REPLACE INTO catalyst_event_anchors VALUES(?,?,?,?)').bind(runId,out.status,new Date(now).toISOString(),JSON.stringify(out)).run();return out;
}
