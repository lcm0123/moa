import {corroborated} from './evidence-policy.mjs';
import {freshnessPolicy} from './graph-policy.mjs';
import {technicalPaths} from './technical-bridge.mjs';
import {norm,hash} from './core.mjs';
import {rows,one} from './store.mjs';
import {entityPhrases,canonicalIdentity} from './identity.mjs';
import {validateClaim,reconcileClaims} from './claims.mjs';
import {researchAssertions} from './research-assertions.mjs';
import {businessAssertions} from './business-assertions.mjs';
import {researchConfig as rc,concreteTarget,topicMatch,researchKinds} from './research-config.mjs';
import {saveResearchSource,saveResearchClaim,researchStep} from './research-store.mjs';
import {dartEventAssertions} from './dart-event-assertions.mjs';
import {discoverProductAliases} from './product-aliases.mjs';
import {invalidateFilingClaims} from './filing-claim-cache.mjs';

const identityNames=new WeakMap();
export const releaseResearchIdentityCache=store=>identityNames.delete(store);
const legalName=s=>norm(s).toLowerCase().replace(/[,.( )]+$/g,'').replace(/(?:\s+(?:incorporated|corporation|holdings|corp|inc|ltd|limited|co)\.?)+$/i,'').trim();
export async function resolveResearchAssets(store,text,{market='ALL',limit=20,allowSymbol=false}={}){
 const phrases=[...new Set([norm(text).toLowerCase(),...entityPhrases(String(text).slice(0,1200))])].slice(0,220),found=new Set();
 for(let i=0;i<phrases.length;i+=70){const p=phrases.slice(i,i+70),marks=p.map(()=>'?').join(',');if(!p.length)continue;
  const hits=await rows(store.db,`SELECT asset_id id FROM catalyst_aliases WHERE alias IN (${marks}) UNION SELECT id FROM catalyst_assets WHERE lower(name) IN (${marks}) ${allowSymbol?'OR lower(symbol) IN ('+marks+')':''} LIMIT 40`,...p,...p,...(allowSymbol?p:[]));
  for(const h of hits)found.add(h.id);
 }
 // Legal suffix normalization is candidate identity lookup only; it cannot turn
 // a product acronym in an article (AI/HBM/PCB) into a same-ticker security.
 if(!identityNames.has(store))identityNames.set(store,(await rows(store.db,"SELECT id,name FROM catalyst_assets WHERE kind<>'CRYPTO'")).map(a=>({id:a.id,name:legalName(a.name)})).filter(a=>a.name.length>=3));
 const names=new Set(phrases.map(legalName));for(const a of identityNames.get(store))if(names.has(a.name))found.add(a.id);
 const explicit=[...String(text).matchAll(/\b(?:NASDAQ|NYSE|AMEX|ticker)\s*[:：]\s*([A-Z0-9.-]{1,12})\b/gi)].map(m=>m[1]);
 for(const symbol of explicit)for(const a of await rows(store.db,'SELECT id FROM catalyst_assets WHERE symbol=?',symbol.toUpperCase()))found.add(a.id);
 const assets=[];for(const id of found){const a=await store.asset(id);if(a&&researchKinds[market].includes(a.kind)&&a.active!==false)assets.push(a);if(assets.length>=limit)break;}
 return assets;
}
export const goodClaim=c=>['VERIFIED','SUPPORTED'].includes(c.status);
export function reconcileResearchClaims(claims){
 const trusted=c=>{try{const host=new URL(c.sourceUrl).hostname;return rc.reliableNewsDomains.some(d=>host===d||host.endsWith('.'+d));}catch{return false;}};
 // Unrecognized news publishers cannot corroborate each other into support.
 reconcileClaims(claims.filter(c=>c.sourceType!=='news'||trusted(c)||c.evidencePolicy));return claims;
}
export async function sourceClaims(store,job,stage,source,asset=null,{now=Date.now()}={}){
 if(source.evidence===false||['DISCOVERY_ONLY','UNTRUSTED_SOURCE'].includes(source.trust))return [];
 if(store.sourceReady&&!store.sourceReady(source)||store.sourceAllowed&&!store.sourceAllowed(source.url))return [];
 await saveResearchSource(store,job.id,stage,source,asset?.id||'');const out=[];
 const cacheKey='research:claims:intent-business-1:'+source.id+':'+stage+':'+(asset?.id||'EVENT'),cached=await store.cache(cacheKey);
 if(cached&&!cached.stale&&cached.value.length){
  const saved=[];for(const id of cached.value){const r=await one(store.db,"SELECT c.payload FROM catalyst_claims c LEFT JOIN catalyst_research_claim_lifecycle l ON l.claim_id=c.id WHERE c.id=? AND c.status='VERIFIED' AND (l.state IS NULL OR l.state='ACTIVE')",id);if(r)saved.push(JSON.parse(r.payload));}
  if(saved.length===cached.value.length){for(const c of saved)await saveResearchClaim(store,job.id,stage,c,{assetId:asset?.id||'',claimCache:true});return saved;}
 }
 await discoverProductAliases(store,source);
 if(asset&&stage==='event'&&source.sectionHtml)for(const a of dartEventAssertions(source.sectionHtml,{title:source.title,issuer:asset.id})){
  const c=await validateClaim({id:a.ref,type:'event',subject_id:asset.id,predicate:a.predicate,value:a.quote,quote:a.quote,source_id:source.id,dart_event_ref:a.ref,dart_event_value:a,freshness_policy_id:'CAPEX'},[source],[asset],job.id,now);
  await saveResearchClaim(store,job.id,stage,c,{assetId:asset.id,assertion:a});out.push(c);
 }
 for(const a of researchAssertions(source.body)){
  if(stage==='event'&&a.kind!=='event'||stage==='technical'&&a.kind!=='technical')continue;
  if(a.kind==='business'&&!asset)continue;
  const subject=a.kind==='technical'?'EVENT':asset?.id||'EVENT',type=({event:'event',business:'business',technical:'transmission'})[a.kind];
  const claim=await validateClaim({id:'research:'+a.ref,type,subject_id:subject,predicate:a.predicate,value:a.quote,quote:a.quote,source_id:source.id,research_ref:a.ref,freshness_policy_id:a.kind==='event'?'CAPEX':a.kind==='business'?'COMPANY_BUSINESS':'TECHNICAL_PROCESS'},[source],asset&&a.kind!=='technical'?[asset]:[],job.id,now);
  if(a.kind==='technical'){claim.technicalTier=claim.validationChecks?.SOURCE_AUTHORITY?.status==='PASS'&&['official','business','regulatory'].includes(source.sourceType)?1:null;claim.applicationAssetId=source.assetId||null;claim.validity={state:'ACTIVE',validFrom:claim.asOf,validUntil:claim.asOf?new Date(Date.parse(claim.asOf)+freshnessPolicy({policy_id:'TECHNICAL_PROCESS'}).max_age).toISOString():null};}
  await saveResearchClaim(store,job.id,stage,claim,{assetId:asset?.id||'',assertion:a});out.push(claim);
 }
 if(asset&&['discovery','deep'].includes(stage)){
  for(const a of businessAssertions(source.body)){
   const type=a.category==='customers'?'customer':a.category==='capex_exposure'?'event':a.category==='revenue_share'?'revenue_share':'business';
   const claim=await validateClaim({id:'research-business:'+a.ref,type,subject_id:asset.id,predicate:a.predicate,value:a.quote,quote:a.quote,source_id:source.id,business_ref:a.ref,freshness_policy_id:'COMPANY_BUSINESS'},[source],[asset],job.id,now);
   await saveResearchClaim(store,job.id,stage,claim,{assetId:asset.id,category:a.category});out.push(claim);
  }
 }
 for(const c of out)if(source.documentId)await store.db.prepare('INSERT OR REPLACE INTO catalyst_research_claim_lifecycle VALUES(?,?,?,?,?,?)').bind(c.id,source.documentId,source.sectionKind||null,asset?.id||'EVENT','ACTIVE',new Date(now).toISOString()).run();
 const verified=out.filter(c=>c.status==='VERIFIED');if(verified.length)await store.putCache(cacheKey,verified.map(c=>c.id),stage==='event'?rc.ttls.event:rc.ttls.candidate);
 return out.slice(0,100);
}
export async function storedClaims(store,asset,{now=Date.now()}={}){
 await invalidateFilingClaims(store,asset);
 const list=await rows(store.db,"SELECT c.payload FROM catalyst_claims c JOIN catalyst_claim_ledger l ON l.claim_id=c.id LEFT JOIN catalyst_research_claim_lifecycle life ON life.claim_id=c.id WHERE c.subject_id=? AND c.status IN ('VERIFIED','SUPPORTED') AND (life.state IS NULL OR life.state='ACTIVE') AND c.as_of>=? ORDER BY c.checked_at DESC LIMIT 80",asset.id,new Date(now-400*86400000).toISOString().slice(0,10));
 // Legacy pre-ledger labels are not reusable verified facts. Recollect their
 // source instead of inventing validation fields or crashing SQLite bindings.
 const unique=new Map();
 for(const c of list.map(r=>JSON.parse(r.payload)).filter(c=>(!store.securityVersion||c.securityVersion===store.securityVersion)&&(!store.sourceAllowed||store.sourceAllowed(c.sourceUrl))&&c.validationVersion&&c.validationChecks&&Date.parse(c.asOf)<=now)){
  // A single segment sentence can support several products. Deduplicating by
  // quote alone silently discarded those separate validated propositions.
  const key=JSON.stringify([c.subject,c.predicate,c.object,c.quote,c.independenceKey]);
  if(!unique.has(key))unique.set(key,c);
 }return [...unique.values()];
}
export async function cachedSource(store,id){const row=await one(store.db,"SELECT body,json_remove(payload,'$.tables','$.operationalTables') payload FROM catalyst_sources WHERE id=?",id);if(!row)return null;const source={...JSON.parse(row.payload),body:row.body};return store.sourceReady&&!store.sourceReady(source)||store.sourceAllowed&&!store.sourceAllowed(source.url)?null:source;}
export function eventEvidence(claims,plan,{now=Date.now()}={}){
 const maxDays=plan.intent==='MOVE_ANALYSIS'?rc.moveMaxDays:rc.eventMaxDays;
 const relevant=claims.filter(c=>c.type==='event'&&goodClaim(c)&&c.asOf&&now-Date.parse(c.asOf)<=maxDays*86400000&&Date.parse(c.asOf)<=now&&[...plan.productTargets,...plan.entities,...plan.protocolTargets].filter(concreteTarget).some(t=>topicMatch(c.quote,t)));
 return {mode:plan.questionMode,status:relevant.some(c=>c.status==='VERIFIED')?'ACTUAL_EVENT_VERIFIED':relevant.some(corroborated)?'ACTUAL_EVENT_SUPPORTED':plan.questionMode==='CONDITIONAL'?'CONDITIONAL_ANALYSIS':'EVENT_UNCONFIRMED',claims:relevant,events:relevant.map(c=>{
  const amount=c.quote.match(/(?:\$|USD\s*|KRW\s*)[\d,.]+(?:\s*(?:million|billion|trillion))?|[\d,.]+\s*(?:조|억|백만)?\s*원/g)||null;
  const factory=c.quote.match(/(?:factory|plant|facility) (?:in|at) ([A-Z][\w -]{2,50})(?=[,.]|$)/)?.[0]||null;
  const productionStart=c.quote.match(/(?:production (?:starting|beginning|starts)|생산개시)\s*(?:in |from )?(?:20\d\d(?:[-/]\d{1,2})?|Q[1-4] 20\d\d)/i)?.[0]||null;
  return {claimId:c.id,company:c.normalizedProposition?.subject||null,eventState:c.scope?.eventState||'UNKNOWN',fact:c.quote,sourceUrl:c.sourceUrl,publishedAt:c.asOf,amount,amountBasis:'VERBATIM_NOT_NORMALIZED',period:c.period,factory,productionStart,structured:c.normalizedProposition?.ref?.startsWith('dart-event')?{...c.normalizedProposition,source_id:c.sourceIds[0]}:null,missing:[!amount&&!c.normalizedProposition?.investment_amount&&'amount',!factory&&'factory',!productionStart&&'productionStart'].filter(Boolean)};
 })};
}
export const evidencePaths=technicalPaths;
export function prefilterCandidate(candidate,{plan,event,technicalClaims,market='ALL',now=Date.now()}){
 const {asset}=candidate,claims=candidate.claims.filter(goodClaim),products=claims.filter(c=>c.type==='business'||c.type==='protocol_metric');
 const paths=evidencePaths(products,technicalClaims,event,plan),identity=canonicalIdentity(asset),fresh=products.filter(c=>c.asOf&&Date.parse(c.asOf)<=now&&now-Date.parse(c.asOf)<400*86400000),reasons=[];
 const listingKnown=asset.kind==='CRYPTO'?asset.active!==false:asset.active===true||asset.kind==='US_STOCK'&&asset.identitySource?.startsWith('https://www.nasdaqtrader.com/')&&Date.parse(asset.identityCheckedAt)<=now&&now-Date.parse(asset.identityCheckedAt)<7*86400000;
 if(asset.identityStatus!=='verified'||!identity.complete||!listingKnown)reasons.push(asset.kind==='CRYPTO'?'CRYPTO_IDENTITY_INCOMPLETE':'LISTED_IDENTITY_UNVERIFIED');
 if(!researchKinds[market].includes(asset.kind))reasons.push('MARKET_FILTER');
 if(!products.length)reasons.push('PRODUCT_OR_PROTOCOL_UNVERIFIED');
 if(event.status==='EVENT_UNCONFIRMED')reasons.push('EVENT_UNVERIFIED');
 if(!paths.length)reasons.push('NO_PRODUCT_LEVEL_CAUSAL_PATH');
 if(!fresh.length)reasons.push('STALE_OR_MISSING_BUSINESS_EVIDENCE');
 if(!claims.some(c=>c.sourceIds?.length))reasons.push('NO_VALIDATED_SOURCE');
 const exposure=products.find(c=>c.exposureType==='PRODUCT_REVENUE')?.exposureType||products.find(c=>c.exposureType==='SEGMENT_REVENUE')?.exposureType|| (products.length?'QUALITATIVE':'UNKNOWN');
 return {...candidate,paths,exposure,checks:{canonicalIdentity:identity.complete,listing:!!listingKnown,product:!!products.length,event:event.status!=='EVENT_UNCONFIRMED',causalPath:!!paths.length,businessExposure:exposure,fresh:!!fresh.length,source:claims.some(c=>c.sourceIds?.length),market:researchKinds[market].includes(asset.kind)},exclusionReasons:reasons,status:reasons.length?'EXCLUDED':'PREFILTER_PASSED'};
}
export async function indexCandidates(store,plan,job){
 const map=new Map(),unresolved=[];
 const add=(asset,origin)=>{if(plan.marketTargets.length&&!plan.marketTargets.some(m=>researchKinds[m]?.includes(asset.kind))){unresolved.push({name:asset.name,assetId:asset.id,status:'MARKET_FILTER'});return;}
  let c=map.get(asset.id);if(!c){if(map.size>=(rc.discoveryMentionLimit||rc.discoveryLimit)){
   const uncorroborated=[...map.values()].filter(x=>x.origins.every(o=>o==='DISCOVERED_BY_AI')).sort((a,b)=>b.asset.id.localeCompare(a.asset.id))[0];
   if(['DISCOVERED_BY_AI','WEB_DISCOVERY'].includes(origin)||!uncorroborated){unresolved.push({name:asset.name,assetId:asset.id,status:'DISCOVERY_BUDGET_DEFERRED'});return;}
   map.delete(uncorroborated.asset.id);unresolved.push({name:uncorroborated.asset.name,status:'DISCOVERY_BUDGET_DEFERRED',assetId:uncorroborated.asset.id});
  }c={asset,origins:[],status:'DISCOVERED',claims:[],sourceIds:[]};map.set(asset.id,c);}if(!c.origins.includes(origin))c.origins.push(origin);};
 const targets=[...(plan.premiseTargets||[]),...plan.equipmentTargets,...plan.materialTargets,...plan.productTargets,...plan.protocolTargets].filter(concreteTarget).slice(0,30);
 for(const t of targets){
  const hits=await rows(store.db,"SELECT DISTINCT company_id id FROM company_metadata_facts WHERE lifecycle_status='ACTIVE' AND verification_status IN ('VERIFIED','SUPPORTED') AND instr(lower(fact_key),?)>0 LIMIT 20",t.toLowerCase());
  for(const h of hits){const a=await store.asset(h.id);if(a)add(a,'COMPANY_METADATA');}
  // Previously validated filing products are an index source too. The query
  // discovers identities; the probe and exact technical path still gate them.
  const ledger=await rows(store.db,"SELECT DISTINCT c.subject_id id FROM catalyst_claims c JOIN catalyst_claim_ledger l ON l.claim_id=c.id LEFT JOIN catalyst_research_claim_lifecycle life ON life.claim_id=c.id WHERE c.claim_type='business' AND c.status IN ('VERIFIED','SUPPORTED') AND (life.state IS NULL OR life.state='ACTIVE') AND c.as_of>=? AND (instr(lower(l.object),?)>0 OR instr(lower(c.quote),?)>0) LIMIT 20",new Date(Date.now()-400*86400000).toISOString().slice(0,10),t.toLowerCase(),t.toLowerCase());
  for(const h of ledger){const a=await store.asset(h.id);if(a)add(a,'VERIFIED_PRODUCT_CLAIM');}

  const graph=await rows(store.db,"SELECT DISTINCT n.asset_id id FROM catalyst_graph_edges e JOIN catalyst_graph_nodes n ON n.id=e.source_node_id JOIN catalyst_graph_nodes p ON p.id=e.target_node_id JOIN catalyst_graph_policy gp ON gp.edge_id=e.id WHERE e.namespace='production' AND e.status='VERIFIED' AND gp.lifecycle_status='ACTIVE' AND n.asset_id IS NOT NULL AND instr(lower(p.label),?)>0 AND (e.valid_to IS NULL OR e.valid_to>?) LIMIT 20",t.toLowerCase(),new Date().toISOString());
  for(const h of graph){const a=await store.asset(h.id);if(a)add(a,'VERIFIED_GRAPH_DISCOVERY');}
 }
 for(const suggestion of plan.discoveredSuggestions){
  const found=await resolveResearchAssets(store,suggestion.name,{market:suggestion.market});
  if(found.length===1)add(found[0],'DISCOVERED_BY_AI');else unresolved.push({...suggestion,status:found.length?'AMBIGUOUS_IDENTITY':'LISTED_IDENTITY_UNVERIFIED'});
 }
 await researchStep(store,job.id,'discovery','candidate_discovered',{output:{count:map.size,unresolvedSuggestions:unresolved,origins:[...map.values()].map(c=>({assetId:c.asset.id,origins:c.origins}))}});
 const revision=await one(store.db,'SELECT MAX(last_verified_at) at FROM catalyst_graph_edges');
 return {map,add,unresolved,cacheIdentity:await hash(JSON.stringify([targets,plan.questionMode,'graph-3',revision?.at,rc.version]))};
}
