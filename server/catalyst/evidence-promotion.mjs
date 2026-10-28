import {admissible,corroborateClaims} from './evidence-policy.mjs';
import {hash,clean,norm} from './core.mjs';
import {rows} from './store.mjs';
import {resolveSourceAuthority} from './source-authority.mjs';
import {resolveDocumentScope} from './document-scope.mjs';
import {promotionAssertions} from './promotion-assertions.mjs';
import {validateClaim} from './claims.mjs';
import {CatalystGraph} from './graph.mjs';
import {saveResearchClaim} from './research-store.mjs';
export const promotionVersion='promotion-10.10R-1';
export async function promotionStep(store,runId,url,stage,status,output={},rejectReason=null){
 await store.db.prepare('INSERT OR REPLACE INTO catalyst_evidence_promotions VALUES(?,?,?,?,?,?,?)').bind(runId,await hash(url),stage,status,rejectReason,new Date().toISOString(),JSON.stringify(output)).run();
}
export async function promoteEvidence({store,runId,source,targetProduct,asset=null,namespace='production',now=Date.now(),preserveVerified=false}){
 const stage=(name,status,output={},reason=null)=>promotionStep(store,runId,source.url,name,status,output,reason);
 await stage('DISCOVERED_SOURCE','DISCOVERED',{domain:new URL(source.url).hostname});
 const authority=await resolveSourceAuthority({url:source.url,expectedAsset:asset,expectedProduct:targetProduct,store,now,sourceMetadata:{ownershipProbeCompleted:true}});
 await stage('AUTHORITY_RESOLVED',authority.status,authority,authority.rejectReason);
 const scope=resolveDocumentScope({document:source,targetProduct}),result={authority,scope,claims:[],edges:[],extracted:0,rejectReason:null};
 const reject=async reason=>{result.rejectReason=reason;await stage('CLAIM_VALIDATED','REJECTED',{scope},reason);return result;};
 if(!authority.ownershipVerified&&!authority.authorityVerified)return reject(authority.rejectReason||'SOURCE_UNVERIFIED');
 if(source.evidence===false||source.trust==='UNTRUSTED_SOURCE'){await stage('SECURE_FETCHED','SUPPORTED',{},'TAVILY_EXTRACT_ONLY');return reject('TAVILY_EXTRACT_ONLY');}
 if(!source.documentId||!source.documentHash||!source.securityVersion||!source.locator||!source.sectionId||source.sectionTruncated||store.sourceReady&&!store.sourceReady(source))return reject('SECURE_BODY_OR_LOCATOR_MISSING');
 await stage('SECURE_FETCHED','FETCHED_SANITIZED',{documentId:source.documentId});
 await stage('SCOPE_RESOLVED',scope.status,scope,scope.rejectReason);
 if(scope.status!=='EXACT')return reject(scope.rejectReason);
 const assertions=promotionAssertions(source.body);result.extracted=assertions.length;
 await stage('CLAIM_EXTRACTED','CLAIM_EXTRACTED',{count:assertions.length});
 if(!assertions.length)return reject('NO_CAUSAL_RELATION');
 // A target mentioned elsewhere in the page cannot validate an unrelated clause.
 const bound={...source,resolvedAuthority:authority,sourceType:authority.ownershipVerified?'official':'news',documentBasis:authority.ownershipVerified&&!source.publishedAt?'CURRENT_OFFICIAL_DOCUMENT':source.documentBasis};
 for(const a of assertions){
  const localScope=resolveDocumentScope({document:{body:a.quote},targetProduct});if(localScope.status!=='EXACT'){result.rejectReason=localScope.rejectReason;continue;}
  if(preserveVerified){const old=await rows(store.db,"SELECT c.payload FROM catalyst_claims c JOIN catalyst_claim_ledger l ON l.claim_id=c.id WHERE c.status='VERIFIED' AND c.predicate=? AND c.quote=? AND EXISTS(SELECT 1 FROM json_each(c.source_ids) WHERE value=?) LIMIT 1",a.predicate,a.quote,source.id);if(old.length){result.claims.push(JSON.parse(old[0].payload));continue;}}
  const c=await validateClaim({id:promotionVersion+':'+a.ref,type:'transmission',subject_id:'EVENT',predicate:a.predicate,value:a.quote,quote:a.quote,source_id:source.id,promotion_ref:a.ref,target_product:targetProduct,freshness_policy_id:'TECHNICAL_PROCESS'},[bound],[],runId,now);
  c.promotionVersion=promotionVersion;c.scopeVerification=localScope;c.technicalTier=authority.sourceTier||1;
  const sections=await rows(store.db,'SELECT locator,html FROM catalyst_filing_sections WHERE document_id=? AND truncated=0 AND LENGTH(html)<=60000 LIMIT 128',source.documentId);
  const section=sections.find(s=>norm(clean(s.html)).includes(norm(a.quote)));
  c.evidenceLocator={source_id:source.id,document_id:source.documentId,section_id:section?.locator||source.sectionId,locator:section?.locator||source.locator,original_text_hash:await hash(section?.html||source.body),hash_basis:section?'SANITIZED_SOURCE_SECTION':'SANITIZED_SOURCE_BODY',quote_hash:await hash(a.quote),original_scope:localScope.explicitTerms,normalized_scope:localScope.target};
  const previous=await rows(store.db,"SELECT payload FROM catalyst_claims WHERE claim_type='transmission' AND predicate=? AND status IN ('UNVERIFIED','INFERRED','SUPPORTED') ORDER BY checked_at DESC LIMIT 30",c.predicate);
  corroborateClaims([c,...previous.map(r=>JSON.parse(r.payload))]);
  await saveResearchClaim(store,runId,'technical',c);result.claims.push(c);
  if(!admissible(c))continue;
  const graph=new CatalystGraph(store.db,{namespace});
  const inverse=['INSPECTS','PROCESSES','USED_IN','DESIGNED_FOR','REQUIRED_FOR'].includes(a.predicate);
  const fromKind=['INSPECTS','PROCESSES'].includes(a.predicate)?'EQUIPMENT':'PRODUCT';
  const toKind=inverse?'PRODUCT':a.predicate.endsWith('_EQUIPMENT')?'EQUIPMENT':a.predicate.endsWith('_MATERIAL')?'MATERIAL':'PROCESS';
  const from=await graph.node({kind:fromKind,label:a.subject}),to=await graph.node({kind:toKind,label:a.object});
  const input={source_node_id:from,target_node_id:to,relation_type:a.predicate,status:c.status,freshness_policy_id:'TECHNICAL_PROCESS'};
  await graph.propose(input,{claimIds:[c.id],runId});
  const prior=await rows(store.db,'SELECT status FROM catalyst_graph_edges WHERE id=(SELECT id FROM catalyst_candidate_edges WHERE source_node_id=? AND target_node_id=? AND relation_type=? LIMIT 1)',from,to,a.predicate);
  if(prior[0]?.status!=='VERIFIED'||c.status==='VERIFIED')result.edges.push(await graph.publish(input,[c.id],{now}));
 }
 const accepted=result.claims.filter(admissible),level=accepted.some(c=>c.status==='VERIFIED')?'VERIFIED':accepted.length?'SUPPORTED':'REJECTED';
 await stage('CLAIM_VALIDATED',level==='REJECTED'?level:'CLAIM_'+level,{count:accepted.length,levels:accepted.map(c=>({id:c.id,evidenceLevel:c.status}))},accepted.length?null:result.rejectReason||'CLAIM_VALIDATOR_FAILED');
 if(result.edges.length){result.rejectReason=null;await stage('EDGE_PUBLISHED',level,{edgeIds:result.edges.map(e=>e.id),claimIds:accepted.map(c=>c.id),levels:accepted.map(c=>({id:c.id,evidenceLevel:c.status}))});}
 return result;
}
export function scopeAwareDeepGate({anchor,technical,product,asset}){
 const reasons=[];
 if(!admissible(anchor))reasons.push('NO_EVENT_ANCHOR');
 if(!technical?.edges?.length||technical.scope?.target!==anchor?.targetScope)reasons.push('NO_VERIFIED_TARGET_TECHNICAL_PATH');
 if(!admissible(product)||product.scopeVerification?.status!=='EXACT'||product.scopeVerification.target!==anchor?.targetScope)reasons.push('GENERIC_PRODUCT_EXPOSURE');
 if(asset?.identityStatus!=='verified'||asset.active!==true)reasons.push('LISTED_IDENTITY_UNVERIFIED');
 return {passed:!reasons.length,reasons};
}
