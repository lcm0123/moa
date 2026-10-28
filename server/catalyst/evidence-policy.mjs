import policy from '../../config/catalyst-evidence-policy.json' with {type:'json'};
import {norm,safeUrl} from './core.mjs';
import {groupSources} from './source-lineage.mjs';
import {scopeTerms,scopeKey} from './document-scope.mjs';
import {canonicalIdentity} from './identity.mjs';
import {validUserCondition} from './query-policy.mjs';
export const evidencePolicyVersion=policy.version;
export function publicationAuthority(url){
 const valid=safeUrl(url);if(!valid)return null;const host=new URL(valid).hostname;
 const p=policy.publishers.find(p=>host===p.domain||host.endsWith('.'+p.domain));
 return p?{authorityVerified:true,ownershipVerified:false,sourceTier:p.tier,authorityType:p.type,publicationFamily:p.family,verificationMethod:p.policyBasis,verificationSource:'https://'+p.domain,status:'PUBLICATION_VERIFIED',rejectReason:null}:null;
}
export const corroborated=c=>c?.status==='SUPPORTED'&&c.evidencePolicy===evidencePolicyVersion&&c.corroboration?.passed===true;
export const admissible=c=>c?.status==='VERIFIED'||corroborated(c);
export function pathQuality(levels){
 if(!levels.length||levels.some(x=>['UNVERIFIED','CONFLICTED','RUMOR'].includes(x)||!['VERIFIED','SUPPORTED','INFERRED'].includes(x)))return 'INSUFFICIENT_PATH';
 if(levels.includes('INFERRED'))return 'PARTIAL_INFERRED_PATH';
 return levels.every(x=>x==='VERIFIED')?'VERIFIED_PATH':'STRONG_SUPPORTED_PATH';
}
const allCorePass=c=>!c.reasons?.length&&Object.entries(c.validationChecks||{}).length===9&&Object.entries(c.validationChecks).every(([k,v])=>k==='SOURCE_AUTHORITY'||v.status==='PASS');
const exactTerm=text=>/^(?:advanced )?(?:ic|package|packaging) substrates?$|^fc[- ]?bga$|^pcbs?$|^패키지\s*기판$/i.test(norm(text))?scopeKey(text):norm(text).toLowerCase();
function eventPeriod(c){
 const p=c.period||{};if(p.dates?.length)return p.dates.join('|');
 if(p.years?.length===1&&p.quarters?.length===1)return p.years[0]+p.quarters[0];
 // "Today announced" establishes publication day; ordinary publication dates
 // cannot silently become the date of the event.
 if(/\btoday (?:announced|approved)\b|오늘.{0,50}(?:발표|승인)/i.test(c.quote)&&c.asOf)return c.asOf.slice(0,10);
 return null;
}
export function corroborationKey(c){
 const p=c.normalizedProposition;if(!p?.subject||!p.predicate||!p.object)return null;
 if(/^(?:it|they|we|the company|our company|company|당사|회사)$/i.test(norm(p.subject))&&c.subject==='EVENT')return null;
 if(c.type==='event'){
  const target=scopeTerms(p.production_target||p.object)[0]?.id,period=eventPeriod(c);if(!target||!period)return null;
  return JSON.stringify([c.type,c.subject==='EVENT'?norm(p.subject).toLowerCase():c.subject,p.predicate,target,period,c.scope?.eventState||null]);
 }
 return JSON.stringify([c.type,c.subject==='EVENT'?exactTerm(p.subject):c.subject,p.predicate,exactTerm(p.object),c.scope||{}]);
}
function sourceRecords(claims){
 const records=[...new Map(claims.flatMap(c=>c.policySources||[]).map(s=>[s.id,s])).values()];
 return groupSources(records.slice(0,policy.maxCorroborationSources));
}
// Reconciliation compares validated clauses. It never promotes snippets, creates
// a new fact, changes a predicate, or equates a product family and its subtype.
export function corroborateClaims(claims){
 const conflicts=new Set();
 for(const c of claims){
  if(['VERIFIED','CONFLICTED','RUMOR'].includes(c.status)||!allCorePass(c)||!c.policySources?.length)continue;
  const key=corroborationKey(c);if(!key)continue;
  const peers=claims.filter(x=>!['CONFLICTED','RUMOR'].includes(x.status)&&allCorePass(x)&&corroborationKey(x)===key&&x.policySources?.length);
  const records=sourceRecords(peers).filter(s=>s.authorityVerified&&[2,3].includes(s.sourceTier)&&s.secureBody&&s.trust!=='DISCOVERY_ONLY'&&s.trust!=='UNTRUSTED_SOURCE');
  const families=new Map();for(const s of records){const family=s.independenceKey;if(family==='unknown')continue;const old=families.get(family);if(!old||old.sourceTier>s.sourceTier)families.set(family,s);}
  const independent=[...families.values()],tier2=independent.filter(s=>s.sourceTier===2).length;
  const enough=independent.length>=policy.minimumIndependentSources&&(c.type==='event'?tier2>=policy.eventMinimumTier2:tier2>=1);
  c.evidencePolicy=evidencePolicyVersion;c.evidenceLevel=c.status;c.sourceCount=records.length;c.independentSourceCount=independent.length;c.officialSourceCount=0;
  c.corroboration={passed:false,key,sourceFamilies:independent.map(s=>s.independenceKey),reason:enough?'PENDING_CONFLICT_CHECK':'INSUFFICIENT_INDEPENDENT_QUALITY_SOURCES'};
  if(!enough)continue;
  const amounts=new Set(peers.map(p=>JSON.stringify((p.typedValue||[]).filter(v=>v.unit==='currency').map(v=>[v.normalizedValue,v.currency]))).filter(v=>v!=='[]'));
  const completions=new Set(peers.map(p=>p.normalizedProposition.completion_date).filter(Boolean));
  if(amounts.size>1||completions.size>1){for(const p of peers)conflicts.add(p);continue;}
  c.status='SUPPORTED';c.evidenceLevel='SUPPORTED';c.confidence='MEDIUM';c.corroboration={...c.corroboration,passed:true,reason:'INDEPENDENT_SOURCE_CORROBORATION'};
  c.supportingClaimIds=peers.map(p=>p.id);c.sourceIds=[...new Set(records.map(s=>s.id))];
  c.sourceEvidence=[...new Map(peers.flatMap(p=>p.sourceEvidence||[]).map(e=>[e.sourceId,e])).values()];
 }
 for(const c of conflicts){if(c.status==='VERIFIED')continue;c.status='CONFLICTED';c.evidenceLevel='CONFLICTED';c.corroboration={...c.corroboration,passed:false,reason:'AMOUNT_OR_COMPLETION_CONFLICT'};}
 return claims;
}
export function researchPathGate({event,technical,product,asset,condition}){
 const conditional=validUserCondition(condition),reasons=[];if(!conditional&&!admissible(event))reasons.push('EVENT_BELOW_SUPPORTED');if(!admissible(technical))reasons.push('TECHNICAL_BELOW_SUPPORTED');if(!admissible(product))reasons.push('PRODUCT_BELOW_SUPPORTED');
 const target=conditional?condition.targetScope:event?.targetScope||scopeTerms(event?.normalizedProposition?.production_target||event?.normalizedProposition?.object)[0]?.id;
 if(!target||technical?.scopeVerification?.status!=='EXACT'||technical.scopeVerification.target!==target||product?.scopeVerification?.status!=='EXACT'||product.scopeVerification.target!==target)reasons.push('EXACT_SCOPE_REQUIRED');
 if(asset?.identityStatus!=='verified'||asset?.active!==true||!canonicalIdentity(asset).complete||!asset.id||!asset.name||!asset.exchange)reasons.push('VERIFIED_CANONICAL_ASSET_REQUIRED');
 return {passed:!reasons.length,reasons,eventRequired:!conditional,pathQuality:pathQuality([...(conditional?[]:[event?.status]),technical?.status,product?.status]),evidenceLevels:{event:conditional&&!event?'OPTIONAL_NOT_CHECKED':event?.status||'UNVERIFIED',technical:technical?.status||'UNVERIFIED',product:product?.status||'UNVERIFIED'}};
}
