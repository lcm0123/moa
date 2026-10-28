import {admissible,corroborated,corroborateClaims,researchPathGate} from './evidence-policy.mjs';
import {technicalGapQueries,scopePredicates,technicalSourcePriority} from './technical-bridge.mjs';
import {candidateProbe,sequentialCandidates} from './candidate-probe.mjs';
import {memorySample,freeMemoryAllowed} from './research-memory.mjs';
import {hash} from './core.mjs';
import {one,rows} from './store.mjs';
import {CatalystGraph} from './graph.mjs';
import {researchConfig as rc,concreteTarget,topicMatch,explicitConditionTargets} from './research-config.mjs';
import {planResearch,callResearchJSON,reviewSchema,reviewInstructions,validateReview} from './research-ai.mjs';
import {ResearchRouter,purposeForStage,evidenceSufficient,strictDeepGate} from './research-router.mjs';
import {researchStep,saveCandidate,saveResearchClaim} from './research-store.mjs';
import {sourceClaims,cachedSource,resolveResearchAssets,eventEvidence,prefilterCandidate,indexCandidates,storedClaims,goodClaim,reconcileResearchClaims,releaseResearchIdentityCache} from './research-evidence.mjs';
import {marketContext} from './market.mjs';
import {verifiedProductAliases} from './product-aliases.mjs';
import {precisionQueries} from './targeted-queries.mjs';
import {resolveEventAnchor,eventTechnicalConnection} from './event-anchor.mjs';
import {promoteEvidence,promotionStep} from './evidence-promotion.mjs';
import {resolveDocumentScope} from './document-scope.mjs';
import {queryIntent,intentGate,marketEvidenceReady} from './query-policy.mjs';
import {processBeneficiaryResearch} from './beneficiary-research.mjs';

const compactClaim=c=>({id:c.id,type:c.type,subject:c.subject,quote:c.quote,status:c.status,sourceType:c.sourceType,sourceUrl:c.sourceUrl,sourceIds:c.sourceIds,asOf:c.asOf,asOfKind:c.asOfKind,scope:c.scope,exposureType:c.exposureType,object:c.object,normalizedProposition:c.normalizedProposition,independenceKey:c.independenceKey,applicationAssetId:c.applicationAssetId,validity:c.validity,validationVersion:c.validationVersion,technicalTier:c.technicalTier,evidencePolicy:c.evidencePolicy,corroboration:c.corroboration,evidenceLevel:c.status,sourceCount:c.sourceCount,independentSourceCount:c.independentSourceCount,officialSourceCount:c.officialSourceCount,scopeVerification:c.scopeVerification});
const dedup=list=>[...new Map(list.map(c=>[c.id,c])).values()];
// Reserve the small document budget for IR/release routes after DART. A first
// query's fallback must not consume the entire event stage on more viewer shells.
export const eventFallbackAllowed=(promotion,current,index,total)=>!promotion||current!=='event'||index===total-1;
export function issuerMentionIsSpecific(asset,text){
 const name=String(asset.name||'').toLowerCase(),t=String(text||'').toLowerCase(),short=name.replace(/\b(?:inc|corp|corporation|ltd|limited|co)\b\.?/g,'').trim();
 // A legal-name alias such as News Corp -> "news" is a discovery ambiguity,
 // not permission to spend two issuer probes on a newsroom URL/title.
 return (!/^[a-z]{1,4}$/.test(short)&&! /^(?:news|press|release|group|global|holdings|company|investor|relations)$/.test(short))||t.includes(name);
}
export function officialResearchQueries(queries,roots){
 const hosts=['dart.fss.or.kr','opendart.fss.or.kr','sec.gov',...roots.flatMap(r=>r.roots||[]).map(url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}})].filter(Boolean);
 return queries.filter(q=>{const host=/\bsite:([a-z\d.-]+)/i.exec(q)?.[1]?.toLowerCase();return host&&hosts.some(root=>host===root||host.endsWith('.'+root));});
}
export function sufficientDeepEvidence(bundle){
 return !!bundle.paths?.length&&bundle.exposure?.basis!=='UNKNOWN'&&bundle.ownSourceIds.length>=3&&bundle.riskAssessment!==null&&bundle.claims.some(c=>c.asOf)&&!bundle.missing.includes('independent_source_coverage');
}
export function deepBundle(candidate,claims){
 const valid=dedup(claims.filter(goodClaim)),own=valid.filter(c=>c.subject===candidate.asset.id),customers=own.filter(c=>c.type==='customer'&&/CONFIRMED|SUPPLIES_TO|CUSTOMER_OF|SUPPLIER_OF/.test(c.normalizedProposition?.relationship||c.normalizedProposition?.predicate));
 const sourceIds=[...new Set(valid.flatMap(c=>c.sourceIds))],independent=[...new Set(own.map(c=>['business','official','regulatory'].includes(c.sourceType)?'issuer:'+c.subject:c.independenceKey))],ownSources=[...new Set(own.flatMap(c=>c.sourceIds))];
 const exposure=own.find(c=>c.type==='revenue_share'&&c.exposureType==='PRODUCT_REVENUE')||own.find(c=>c.type==='revenue_share'&&c.exposureType==='SEGMENT_REVENUE');
 const business=own.filter(c=>c.type==='business'),missing=[];
 const providerHealth=candidate.providerHealth||null;
 if(providerHealth?.provider==='SEC'&&providerHealth.status!=='READY')missing.push('sec_original_evidence_unavailable');
 if(!exposure)missing.push('product_revenue_share');if(!customers.length)missing.push('confirmed_customer');
 missing.push('risk_assessment','production_capacity','recent_financials');
 if(ownSources.length<3)missing.push('source_coverage');if(independent.length<2)missing.push('independent_source_coverage');
 // No timing inferred from being called an equipment/material company.
 const timing=[];for(const c of valid){if(/(?:capital expenditure|equipment orders|설비투자|장비 발주)/i.test(c.quote))timing.push({stage:'CAPEX',claimId:c.id});if(/(?:ramp.up|양산 전환)/i.test(c.quote))timing.push({stage:'RAMP_UP',claimId:c.id});if(/(?:consumables? (?:used|consumed)|생산 중 소모)/i.test(c.quote))timing.push({stage:'PRODUCTION',claimId:c.id});}
 if(!timing.length)missing.push('benefit_timing');
 const crypto=candidate.asset.kind==='CRYPTO'?{protocolRelation:own.filter(c=>['protocol_metric','tokenomics'].includes(c.type)),valueCapture:own.filter(c=>c.type==='value_capture'),governance:own.filter(c=>c.structuredPredicate==='GOVERNANCE_OF'||c.normalizedProposition?.predicate==='GOVERNANCE_OF'),funding:'UNKNOWN',openInterest:'UNKNOWN',liquidation:'UNKNOWN',unlock:'UNKNOWN',fundamentals:'UNKNOWN'}:null;
 if(crypto){missing.push('funding','open_interest','unlock');if(!crypto.valueCapture.length)missing.push('token_value_capture');}
 return {asset:candidate.asset,origins:candidate.origins,status:'DEEP_RESEARCHED',paths:candidate.paths,claims:valid.map(compactClaim),sourceIds,ownSourceIds:ownSources,independentSourceCount:independent.length,exposure:{basis:exposure?.exposureType|| (business.length?'QUALITATIVE':'UNKNOWN'),value:exposure?.value||null,claimId:exposure?.id||null},customerClaims:customers.map(c=>c.id),timing,crypto,riskAssessment:null,productionCapacity:null,recentFinancials:null,missing,coverage:{sources:ownSources.length,verifiedClaims:valid.length,...(providerHealth?{providerHealth,evidenceStatus:providerHealth.status==='READY'?'AVAILABLE':'REDUCED'}:{})},ranking:null,score:null};
}
export async function processResearch(env,store,job,{planner=planResearch,search=null,tools=env.CATALYST_RESEARCH_TOOLS,collectMetadata=null,reviewer=callResearchJSON,beneficiaryPlanner,beneficiaryExtractor}={}){
 if(['CONDITIONAL_ANALYSIS','BENEFICIARY_DISCOVERY'].includes(queryIntent(job.query)))return processBeneficiaryResearch(env,store,job,{tools,search,planner:beneficiaryPlanner,extractor:beneficiaryExtractor});
 const started=Date.now(),timings={},allClaims=[],sources=new Map(),rootMap=new Map(),readURLs=new Set(),eventAssets=new Set();let plan,stage='planner',eventAnchor=null;
 const sample=(label,extra)=>memorySample(env,store,job,label,extra);
 const mark=async name=>{stage=name;await store.db.prepare('UPDATE catalyst_research_jobs SET stage=?,updated_at=? WHERE id=?').bind(name,new Date().toISOString(),job.id).run();};
 const finish=async(result,status='complete',code=null)=>{
  if(search instanceof ResearchRouter){
   const totals=await one(store.db,"SELECT count(DISTINCT CASE WHEN json_extract(c.payload,'$.type')='business' AND c.status='VERIFIED' THEN c.id END) products FROM catalyst_research_claims r JOIN catalyst_claims c ON c.id=r.claim_id WHERE r.job_id=?",job.id);
   result.counts={...(result.counts||{}),verifiedCompanyProductClaims:totals?.products||0};
   result.incompletePaths||=[...(result.searchMentions||[]).map(c=>({asset:c.asset,stage:'probe',reason:c.reason})),...(result.exclusions||[]).map(c=>({asset:c.asset,stage:'prefilter',reasons:c.reasons}))];
  }
  result={...result,eventAnchor,version:rc.version,scope:tools?.promotionEnabled?'EVIDENCE_TIER_POLICY':'PHASE_10_9_ONLY',providerUsage:search?.telemetry||null,timings,elapsedMs:Date.now()-started,ranked:false};
  await store.db.prepare('UPDATE catalyst_research_jobs SET status=?,stage=?,result=?,error_code=?,updated_at=?,lease_until=0 WHERE id=?').bind(status,status,JSON.stringify(result),code,new Date().toISOString(),job.id).run();await sample('AFTER_RESULT_SAVE');return result;
 };
 try{
  await sample('START');
  if(env.RESEARCH_FREE_MEMORY&&!freeMemoryAllowed(env,env.RESEARCH_FREE_MEMORY()))return await finish({status:'SYSTEM_MEMORY_DEFERRED',deep:[]},'limited','SYSTEM_MEMORY_DEFERRED');
  search||=new ResearchRouter(env,store,job);
  if(!search.available)return await finish({status:'DISCOVERY_LIMITED_NO_BROAD_SEARCH',plan:null,event:null,discovered:[],prefilter:[],deep:[],missing:['Broad Search Provider 연결 필요']},'limited','DISCOVERY_LIMITED_NO_BROAD_SEARCH');
  await mark('planner');let at=Date.now();plan=await planner(env,store,job);timings.planner=Date.now()-at;await sample('AFTER_PLANNER');
  // Explicit user condition routing already returned above. A planner cannot
  // turn a specific event question into a hypothetical to bypass verification.
  plan.questionMode='ACTUAL';
  if(queryIntent(job.query)==='MOVE_ANALYSIS')plan.intent='MOVE_ANALYSIS';
  if(search instanceof ResearchRouter&&plan.questionMode==='CONDITIONAL')plan.explicitConditionTargets=explicitConditionTargets(job.query,plan.premiseTargets||plan.productTargets||[]);
  await store.db.prepare('UPDATE catalyst_research_jobs SET plan=? WHERE id=?').bind(JSON.stringify(plan),job.id).run();
  await researchStep(store,job.id,'planner','research_plan',{provider:plan.model,input:{query:job.query,mode:job.mode},output:{...plan,usage:plan.usage},durationMs:timings.planner});
  if(!tools)throw Error('research_worker_tools_missing');
  const known=new Map();
  for(const name of [...plan.entities,...plan.discoveredSuggestions.map(x=>x.name)].slice(0,24))for(const a of await resolveResearchAssets(store,name,{allowSymbol:job.market_filter==='CRYPTO'&&plan.entities.includes(name)}))known.set(a.id,a);
  const roots=async asset=>{if(!rootMap.has(asset.id))rootMap.set(asset.id,await (tools.withStage?tools.withStage(stage==='planner'?'event':stage,asset.id,()=>tools.roots(asset)):tools.roots(asset)));return rootMap.get(asset.id);};
  const scoped=(phase,asset,run)=>tools.withStage?tools.withStage(phase,asset?.id,run):run();
  const remember=source=>{sources.set(source.id,{id:source.id,url:source.url,assetId:source.assetId,publishedAt:source.publishedAt,observedAt:source.observedAt,sourceType:source.sourceType,truncated:source.truncated||false});readURLs.add(source.url);};
  const fetchEvidence=async(item,current,asset=null)=>{
   if(sources.size>=rc.maxJobSources)return [];
   if(!asset)for(const discovered of await resolveResearchAssets(store,item.title+' '+(item.snippet||''),{limit:4})){
    if(tools.promotionEnabled&&!issuerMentionIsSpecific(discovered,item.title+' '+(item.snippet||'')))continue;
    if(current==='event')eventAssets.add(discovered.id);
    if(!known.has(discovered.id)&&known.size<40){known.set(discovered.id,discovered);await roots(discovered);}
   }
   if(!asset){for(const a of known.values()){const r=rootMap.get(a.id);if(r?.roots.some(url=>{const host=new URL(item.url).hostname,root=new URL(url).hostname.replace(/^www\./,'');return host===root||host.endsWith('.'+root);})){asset=a;break;}}}
   if(tools.promotionEnabled&&current==='technical'){
    await promotionStep(store,job.id,item.url,'DISCOVERED_SOURCE','DISCOVERED',{domain:new URL(item.url).hostname});
    const authority=await tools.authority({url:item.url,expectedAsset:asset,expectedProduct:eventAnchor?.targetProduct,sourceMetadata:{ownershipProbeCompleted:true}});
    await promotionStep(store,job.id,item.url,'AUTHORITY_RESOLVED',authority.status,authority,authority.rejectReason);
    if(!authority.ownershipVerified&&!authority.authorityVerified)return [];
   }
   const key=(tools.promotionEnabled?'research:document:evidence-tier-1:':'research:document:sections-6:')+await hash([item.url,asset?.id||'',current].join('|')),cache=await store.cache(key);let source;
   if(cache&&!cache.stale)source=await cachedSource(store,cache.value.sourceId);
   if(!source){
    const read=await scoped(current==='discovery'?'probe':current,asset,async()=>tools.read(item,{asset,roots:asset?await roots(asset):null,purpose:current==='event'?'CAPACITY_EXPANSION':current==='deep'?'DEEP':'PRODUCT_RELATION'}));
    await researchStep(store,job.id,current,'selected_source',{input:{url:item.url,assetId:asset?.id||null},output:{status:read.status,code:read.code||null,resolvedUrl:read.url}});
    if(read.status!=='read'){if(tools.extractFallback&&['HTTP_403','unreadable_body','STATIC_PARSE_FAILED'].includes(read.code)){
     const extracted=await tools.extractFallback(item,read.code);await researchStep(store,job.id,current,'extraction_fallback',{output:{status:extracted.status,count:extracted.count||0,trust:'UNTRUSTED_SOURCE',verified:false}});
    }return [];}
    search.markUsed?.([item]);
    source=await store.addSource(read);await store.putCache(key,{sourceId:source.id},rc.ttls[current]||rc.ttls.candidate);
   }
   remember(source);readURLs.add(item.url);
   const bound=source.assetId?known.get(source.assetId)||asset:null;
   const claims=tools.promotionEnabled&&current==='technical'?(await promoteEvidence({store,runId:job.id,source,targetProduct:eventAnchor.targetProduct,asset:bound})).claims:await sourceClaims(store,job,current,source,bound);
   // A publication is not owned by its subject company. Resolve companies from
   // the actual body and validate their own product clauses without relabelling
   // the article as an official issuer source.
   if(!bound&&['discovery','deep'].includes(current)&&source.resolvedAuthority?.authorityVerified&&[2,3].includes(source.resolvedAuthority.sourceTier)){
    for(const issuer of await resolveResearchAssets(store,source.body,{market:job.market_filter,limit:4})){
     if(issuer.identityStatus!=='verified'||issuer.active!==true)continue;
     known.set(issuer.id,issuer);claims.push(...await sourceClaims(store,job,current,source,issuer));
    }
   }
   allClaims.push(...claims);reconcileResearchClaims(allClaims.filter(c=>c.validationChecks));for(const c of allClaims.filter(c=>c.validationChecks&&corroborated(c)))await saveResearchClaim(store,job.id,current,c);return claims;
  };
  const searchStage=async(current,queries,{asset=null,stop=null}={})=>{
   const queryList=queries.slice(0,current==='deep'?rc.searchLimits.deepPerCandidate:rc.searchLimits[current]),readLimit=search instanceof ResearchRouter?(current==='event'?4:['technical','technicalGap'].includes(current)?6:current==='deep'?4:8):current==='deep'?(job.mode==='deep'?rc.deepSourcesPerCandidate:rc.sourcesPerCandidate):current==='technicalGap'?20:12;
   const perQuery=Math.max(1,Math.floor(readLimit/Math.max(1,queryList.length)));
   const found=[];let count=0;for(const [queryIndex,query] of queryList.entries()){let queryReads=0;
    if(tools.stageAvailable&&!tools.stageAvailable(current,asset?.id)){await researchStep(store,job.id,current,'stage_budget_stop',{output:{reason:'NO_DOCUMENT_BUDGET_NO_MORE_SEARCH'}});break;}
    const purpose=tools.promotionEnabled&&current==='event'&&/investor relations|official release/i.test(query)?'OFFICIAL_SOURCE_DISCOVERY':purposeForStage(current),relevant=()=>allClaims.filter(c=>current==='event'?c.type==='event':['technical','technicalGap'].includes(current)?c.type==='transmission':c.subject===asset?.id);
    if(evidenceSufficient(purpose,relevant())||stop?.())break;
    const request={query,purpose,language:/[가-힣]/.test(query)?'ko':'en',recency:current==='event'?(plan.intent==='MOVE_ANALYSIS'?'month':'year'):null,domainHints:[],maxResults:6};
    const response=await search.search(request,{stage:current,candidateId:asset?.id,claims:relevant()});
    const items=[...(response.items||[])];if(['technical','technicalGap'].includes(current)){const officialRoots=[...rootMap.values()].flatMap(r=>r.roots||[]);items.sort((a,b)=>technicalSourcePriority(a,officialRoots)-technicalSourcePriority(b,officialRoots));}
    for(const item of items){found.push(item);if(count>=readLimit||queryReads>=perQuery)continue;
     if(tools.stageAvailable&&!tools.stageAvailable(current,asset?.id))break;
     if(readURLs.has(item.url)&&!asset)continue;
     await fetchEvidence(item,current==='technicalGap'?'technical':current,asset);count++;queryReads++;
     if(stop?.())break;
    }
    if(eventFallbackAllowed(tools.promotionEnabled,current,queryIndex,queryList.length)&&search instanceof ResearchRouter&&response.items?.length&&!evidenceSufficient(purpose,relevant())&&!stop?.()&&count<readLimit&&(!tools.stageAvailable||tools.stageAvailable(current,asset?.id))){
     const backup=await search.search(request,{stage:current,fallback:true,claims:relevant()});
     for(const item of backup.items||[]){found.push(item);if(count>=readLimit||tools.stageAvailable&&!tools.stageAvailable(current,asset?.id))break;if(readURLs.has(item.url)&&!asset)continue;await fetchEvidence(item,current==='technicalGap'?'technical':current,asset);count++;if(stop?.()||evidenceSufficient(purpose,relevant()))break;}
    }
    if(stop?.()||evidenceSufficient(purpose,relevant())||count>=readLimit)break;
   }return found;
  };
  await mark('event');at=Date.now();
  const eventKey='research:event:'+await hash(JSON.stringify([plan.entities.slice().sort(),plan.productTargets.slice().sort(),plan.eventTypes.slice().sort(),plan.questionMode,plan.intent]));
  const previousEvent=await store.cache(eventKey);
  if(previousEvent&&!previousEvent.stale){for(const id of previousEvent.value){const s=await cachedSource(store,id);if(s)await fetchEvidence({url:s.url,title:s.title},'event',known.get(s.assetId));}}
  // Explicit priority: DB/cache -> DART/SEC/official -> existing news -> broad search.
  if(tools.priorSources)for await(const entry of tools.priorSources({assets:[...known.values()],query:job.query})){
   await researchStep(store,job.id,'event','source_priority',{provider:entry.tier,output:{status:entry.status||'available',assetId:entry.asset?.id||null}});
   if(entry.source){
    const source=entry.source.id?entry.source:await store.addSource(entry.source);remember(source);
    for(const phase of (tools.promotionEnabled?['event']:['event','technical','discovery']))allClaims.push(...await sourceClaims(store,job,phase,source,entry.asset));
   }else if(entry.item)await fetchEvidence(entry.item,'event');
  }
  // Identity feeds, not model-proposed URLs, establish publisher ownership.
  for(const a of [...known.values()].filter(a=>plan.entities.some(t=>topicMatch(a.name+' '+a.symbol,t))).slice(0,4))await roots(a);
  const officialQueries=officialResearchQueries(plan.officialSourceQueries,[...rootMap.values()]);
  await researchStep(store,job.id,'event','official_query_validation',{output:{accepted:officialQueries,deferred:plan.officialSourceQueries.filter(q=>!officialQueries.includes(q)).map(query=>({query,reason:'UNVERIFIED_OFFICIAL_DOMAIN'}))}});
  const eventQueries=tools.promotionEnabled&&/기판|substrate|PCB/i.test(job.query)?[
   'site:dart.fss.or.kr 기판 신규시설투자 2026',
   'package substrate capacity expansion investment 2026 investor relations',
   '기판 증설 투자 2026 official release'
  ]:officialQueries.length?[officialQueries[0],...plan.eventQueries].slice(0,rc.searchLimits.event):plan.eventQueries;
  await searchStage('event',eventQueries,{stop:()=>eventEvidence(allClaims,plan).status==='ACTUAL_EVENT_VERIFIED'});
  if(tools.events)for(const id of [...eventAssets].slice(0,3)){
   const asset=known.get(id);if(!asset||asset.kind==='CRYPTO')continue;const official=await scoped('event',asset,()=>tools.events(asset));
   await researchStep(store,job.id,'event','official_event_sources',{provider:asset.kind==='KR_STOCK'?'OpenDART':'SEC cache',input:{assetId:id},output:{count:official.sources.length,failures:official.failures}});
   for(const raw of official.sources){const source=await store.addSource(raw);remember(source);allClaims.push(...await sourceClaims(store,job,'event',source,asset));}
  }
  // Lineage compares bounded text and provenance, never legacy table arrays.
  {
   const docs=[];for(const source of sources.values()){
    const r=await one(store.db,"SELECT id,url,body,content_hash contentHash,independence_key independenceKey,json_extract(payload,'$.originalSourceUrl') originalSourceUrl,json_extract(payload,'$.originUrl') originUrl,json_extract(payload,'$.originRef') originRef,json_extract(payload,'$.lineageVersion') lineageVersion FROM catalyst_sources WHERE id=?",source.id);if(r)docs.push(r);
   }
   const grouped=await store.saveSourceLineage(docs),groups=new Map(grouped.map(x=>[x.id,x.independenceKey]));
   for(const claim of allClaims){claim.independenceKey=groups.get(claim.sourceIds[0])||claim.independenceKey;for(const e of claim.sourceEvidence||[])e.independenceKey=groups.get(e.sourceId)||e.independenceKey;}
   docs.length=0;grouped.length=0;groups.clear();
  }
  reconcileResearchClaims(allClaims);
  for(const c of allClaims)await saveResearchClaim(store,job.id,'event',c,{reconciled:true});
  const event=eventEvidence(allClaims,plan);timings.event=Date.now()-at;await store.putCache(eventKey,[...sources.values()].map(s=>s.id),rc.ttls.event);
  if(tools.promotionEnabled){
   const evidence=[];for(const s of sources.values()){const source=await cachedSource(store,s.id);if(source)evidence.push(source);}
   eventAnchor=await resolveEventAnchor({question:job.query,discoveredSources:evidence,existingClaims:allClaims,store,runId:job.id});
   if(!admissible(eventAnchor))return await finish({status:'NO_EVENT_ANCHOR',event,deep:[],counts:{verifiedEvent:0,verifiedTechnicalEdges:0}},'limited','NO_EVENT_ANCHOR');
   event.targetScope=eventAnchor.targetScope;event.targetProduct=eventAnchor.targetProduct;
  }
  await researchStep(store,job.id,'event','event_result',{output:event,durationMs:timings.event});
  await sample('AFTER_EVENT_RESEARCH');
  if(search instanceof ResearchRouter&&!['ACTUAL_EVENT_VERIFIED','ACTUAL_EVENT_SUPPORTED'].includes(event.status)&&event.mode!=='CONDITIONAL')return await finish({status:'EVENT_UNCONFIRMED',event,deep:[],incompletePaths:[{stage:'event',reason:'NO_VERIFIED_EVENT_OR_EXPLICIT_CONDITION'}]},'limited','EVENT_UNCONFIRMED');
  if(plan.intent==='MOVE_ANALYSIS'){
   const entity=[...known.values()].find(a=>plan.entities.some(t=>topicMatch(a.name+' '+a.symbol,t)));
   if(entity)try{event.marketContext=await marketContext(env,store,entity);}catch{event.marketContext={status:'UNKNOWN'};}
   event.attribution='UNKNOWN';event.note='사건과 가격 움직임의 인과는 확인하지 않았습니다. Funding/OI 미연결.';
  }
  if(queryIntent(job.query)==='MOVE_ANALYSIS'){
   const gate=intentGate({query:job.query,eventVerified:event.claims.some(c=>c.type==='event'&&admissible(c)),newsVerified:event.claims.some(c=>admissible(c)&&['news','official','regulatory'].includes(c.sourceType)),marketVerified:marketEvidenceReady(event.marketContext)});
   if(!gate.passed)return finish({status:'MOVE_EVIDENCE_INSUFFICIENT',event,gate,deep:[]},'limited','MOVE_EVIDENCE_INSUFFICIENT');
  }
  await mark('technical');at=Date.now();
  const precise=tools.promotionEnabled?{...precisionQueries(plan),technical:[`${eventAnchor.targetProduct} manufacturing process official technical`,`${eventAnchor.targetProduct} equipment material application`]}:precisionQueries(plan);await researchStep(store,job.id,'technical','targeted_queries',{output:precise});
  await searchStage('technical',precise.technical,{stop:()=>allClaims.filter(c=>c.type==='transmission'&&goodClaim(c)).length>=4});
  const gaps=tools.promotionEnabled?[]:technicalGapQueries(event,plan);await researchStep(store,job.id,'technical','gap_hypotheses',{output:{queries:gaps,hypothesesOnly:true}});
  await searchStage('technicalGap',gaps.map(x=>x.query));timings.technical=Date.now()-at;
  let technicalClaims=dedup(allClaims.filter(c=>c.type==='transmission')).map(compactClaim);
  await sample('AFTER_TECHNICAL_RESEARCH');
  if(search instanceof ResearchRouter&&!technicalClaims.some(c=>admissible(c)&&!scopePredicates.includes(c.normalizedProposition?.predicate)))return await finish({status:'TECHNICAL_EVIDENCE_MISSING',event,technicalClaims,sources:[...sources.values()],counts:{verifiedEvent:event.claims.filter(c=>c.status==='VERIFIED').length,supportedEvent:event.claims.filter(corroborated).length,verifiedScopeEdges:technicalClaims.filter(c=>c.status==='VERIFIED'&&scopePredicates.includes(c.normalizedProposition?.predicate)).length,verifiedProcessEdges:0,verifiedCompanyProductClaims:0,initialSearchMentions:0,cheapProbePassed:0,qualifiedInitialCandidates:0,prefilter:0,deep:0},deep:[],incompletePaths:[{stage:'technical',reason:'NO_SUPPORTED_TECHNICAL_REQUIREMENT',eventStatus:event.status}]},'limited','TECHNICAL_EVIDENCE_MISSING');
  await mark('discovery');at=Date.now();const candidates=await indexCandidates(store,plan,job);
  const discoveryKey='research:discovery:'+candidates.cacheIdentity+':'+await hash(event.claims.flatMap(c=>c.sourceIds).sort().join('|'));
  const cachedDiscovery=await store.cache(discoveryKey);
  if(cachedDiscovery&&!cachedDiscovery.stale)for(const id of cachedDiscovery.value){const a=await store.asset(id);if(a)candidates.add(a,'CACHED_DISCOVERY');}
  const found=await searchStage('discovery',precise.discovery);
  for(const item of found)for(const a of await resolveResearchAssets(store,item.title+' '+(item.snippet||''),{market:job.market_filter})){known.set(a.id,a);candidates.add(a,'WEB_DISCOVERY');}
  for(const claim of allClaims.filter(c=>c.type==='business'&&admissible(c))){const a=known.get(claim.subject);if(a)candidates.add(a,'VALIDATED_PUBLICATION_PRODUCT');}
  // Product documents and official filings can introduce candidates independently
  // of AI suggestions. This remains discovery, never a benefit verdict.
  for(const s of sources.values())if(s.assetId){const a=await store.asset(s.assetId);if(a)candidates.add(a,s.sourceType==='business'?'FILING_IR':'OFFICIAL_PRODUCT');}
  const searchMentions=[];plan.productAliases=await verifiedProductAliases(store);
  await sequentialCandidates([...candidates.map.values()],{
   load:async c=>({...c,claims:dedup([...await storedClaims(store,c.asset),...allClaims.filter(x=>x.subject===c.asset.id)])}),
   process:async c=>{
    // Small existing metadata only. No large filing or network metadata fan-out.
    if(collectMetadata&&!c.claims.length){await collectMetadata(c.asset);c.claims=await storedClaims(store,c.asset);}
    if(search instanceof ResearchRouter&&!candidateProbe(c.asset,c.claims,plan).claimIds.length){
     const r=await roots(c.asset),target=technicalClaims.find(admissible)?.normalizedProposition?.object||plan.productTargets[0];
     if(r?.roots?.length){const result=await search.search({query:`${c.asset.name} ${target||''} product`,purpose:'PRODUCT_DISCOVERY',domainHints:r.roots.map(u=>new URL(u).hostname),maxResults:2},{stage:'probe'});
      for(const item of result.items||[])if(r.roots.some(u=>new URL(item.url).hostname===new URL(u).hostname))c.claims=dedup([...c.claims,...await fetchEvidence(item,'discovery',c.asset)]);
     }
    }
    c.probe=candidateProbe(c.asset,c.claims,plan);c.status=c.probe.status;
    for(const claim of c.claims)await saveResearchClaim(store,job.id,'discovery',claim,{assetId:c.asset.id,reused:true});
    if(c.status==='PROBE_QUALIFIED'&&[...candidates.map.values()].filter(x=>x.probeQualified).length>=rc.discoveryLimit){c.probe.reason='QUALIFIED_DISCOVERY_BUDGET';c.status='SEARCH_MENTION_ONLY';}
    if(c.status==='PROBE_QUALIFIED')candidates.map.get(c.asset.id).probeQualified=true;
    if(c.status==='SEARCH_MENTION_ONLY'){searchMentions.push({asset:c.asset,origins:c.origins,reason:c.probe.reason});candidates.map.delete(c.asset.id);}
    await researchStep(store,job.id,'discovery','candidate_probe',{input:{assetId:c.asset.id},output:c.probe});
   },
   persist:async c=>saveCandidate(store,job.id,{...c,claimIds:c.claims.map(x=>x.id),claims:undefined}),
   released:async c=>sample('AFTER_EACH_CANDIDATE',{assetId:c.asset.id,phase:'probe',retainedCandidateClaims:0})
  });
  timings.discovery=Date.now()-at;await store.putCache(discoveryKey,[...candidates.map.keys()],rc.ttls.discovery);
  allClaims.splice(0,allClaims.length,...allClaims.filter(c=>c.type==='transmission').map(compactClaim));
  await sample('AFTER_DISCOVERY');
  await mark('prefilter');at=Date.now();const filtered=[],excluded=[];
  // Only probe-qualified candidates may open a targeted filing. At most one
  // candidate's full claim set is alive; following stages carry IDs and paths.
  let researched=0;
  await sequentialCandidates([...candidates.map.values()].sort((a,b)=>a.asset.id.localeCompare(b.asset.id)),{
   load:async c=>({...c,claims:await storedClaims(store,c.asset)}),
   process:async c=>{
    if(tools.businessSources&&researched<rc.prefilterLimit){researched++;
     try{const selected=await scoped('probe',c.asset,()=>tools.businessSources(c.asset,'PRODUCT_RELATION'));
      await researchStep(store,job.id,'prefilter','targeted_sections',{input:{assetId:c.asset.id},output:{sections:selected.length}});
      for(const raw of selected){if(raw.providerHealth)c.providerHealth=raw.providerHealth;const source=await store.addSource(raw);remember(source);const claims=await sourceClaims(store,job,'discovery',source,c.asset);c.claims=dedup([...c.claims,...claims]);allClaims.push(...claims.filter(x=>x.type==='transmission'));}
      selected.length=0;
     }catch{await researchStep(store,job.id,'prefilter','targeted_source_unavailable',{input:{assetId:c.asset.id}});}
    }
    technicalClaims=dedup(allClaims.filter(c=>c.type==='transmission')).map(compactClaim);
    Object.assign(c,prefilterCandidate(c,{plan,event,technicalClaims,market:job.market_filter}));
    if(search instanceof ResearchRouter){const gate=strictDeepGate(c,event,[...c.claims,...technicalClaims]);c.paths=gate.paths;if(!gate.passed){c.status='EXCLUDED';c.exclusionReasons=[...new Set([...c.exclusionReasons,...gate.reasons])];}}
    if(tools.promotionEnabled){
     const exactProducts=[];
     for(const claim of c.claims.filter(x=>x.type==='business'&&admissible(x))){
      const source=await cachedSource(store,claim.sourceIds[0]);if(!source)continue;
      const authority=await tools.authority({url:source.url,expectedAsset:c.asset,sourceMetadata:{ownershipProbeCompleted:true}});
      const scope=resolveDocumentScope({document:{body:claim.quote},targetProduct:eventAnchor.targetProduct});
      await promotionStep(store,job.id,source.url,'COMPANY_PRODUCT_SCOPE',scope.status,{authority,scope,claimId:claim.id},authority.rejectReason||scope.rejectReason);
      if((authority.ownershipVerified||authority.authorityVerified&&corroborated(claim))&&scope.status==='EXACT')exactProducts.push(claim.id);
     }
     if(!exactProducts.length){c.status='EXCLUDED';c.exclusionReasons=[...new Set([...c.exclusionReasons,'GENERIC_PRODUCT_EXPOSURE'])];c.paths=[];}
    }
    if(c.status==='PREFILTER_PASSED'&&filtered.length>=rc.prefilterLimit){c.status='DEFERRED';c.exclusionReasons.push('PREFILTER_BUDGET_LIMIT');}
    const compact={...c,claimIds:c.claims.map(x=>x.id),claims:undefined};
    (c.status==='PREFILTER_PASSED'?filtered:excluded).push(compact);
    await researchStep(store,job.id,'prefilter',c.status==='PREFILTER_PASSED'?'candidate_passed':'candidate_excluded',{input:{assetId:c.asset.id},output:{checks:c.checks,reason:c.exclusionReasons}});
   },
   persist:async c=>saveCandidate(store,job.id,{...c,claimIds:c.claims.map(x=>x.id),claims:undefined}),
   released:async c=>sample('AFTER_EACH_CANDIDATE',{assetId:c.asset.id,phase:'prefilter',retainedCandidateClaims:0})
  });
  timings.prefilter=Date.now()-at;await sample('AFTER_PREFILTER');
  await mark('deep');at=Date.now();const deep=[];
  for(const compactCandidate of filtered.slice(0,rc.deepLimit)){
   const candidate={...compactCandidate,claims:await storedClaims(store,compactCandidate.asset)};
   if(tools.businessSources)try{for(const raw of await scoped('deep',candidate.asset,()=>tools.businessSources(candidate.asset,'DEEP'))){if(raw.providerHealth)candidate.providerHealth=raw.providerHealth;const source=await store.addSource(raw);remember(source);allClaims.push(...await sourceClaims(store,job,'deep',source,candidate.asset));}}catch{await researchStep(store,job.id,'deep','targeted_source_unavailable',{input:{assetId:candidate.asset.id}});}
   const targets=candidate.paths.map(p=>p.product).filter(concreteTarget).slice(0,2).join(' '),name=candidate.asset.name;
   await searchStage('deep',[`${name} ${targets} official products`,`${name} ${targets} annual report revenue customers`,`${name} ${targets} orders capacity risks`],{asset:candidate.asset,stop:()=>sufficientDeepEvidence(deepBundle(candidate,[...candidate.claims,...allClaims.filter(c=>c.subject===candidate.asset.id)]))});
   const pathClaims=technicalClaims.filter(c=>candidate.paths.some(p=>p.technicalClaimId===c.id||p.allBridgeClaimIds?.includes(c.id)||p.technicalClaimIds?.includes(c.id)));
   const bundle=deepBundle(candidate,[...candidate.claims,...allClaims.filter(c=>c.subject===candidate.asset.id),...pathClaims,...event.claims]);
   deep.push(bundle);await saveCandidate(store,job.id,bundle);await researchStep(store,job.id,'deep','candidate_evidence',{input:{assetId:candidate.asset.id},output:{claimIds:bundle.claims.map(c=>c.id),sources:bundle.sourceIds,missing:bundle.missing}});
   await store.putCache('research:candidate:'+candidate.asset.id,bundle,rc.ttls.candidate);
   candidate.claims.length=0;allClaims.splice(0,allClaims.length,...allClaims.filter(c=>c.type==='transmission').map(compactClaim));
   await sample('AFTER_EACH_CANDIDATE',{assetId:candidate.asset.id,phase:'deep',retainedCandidateClaims:0});
   if(deep.filter(sufficientDeepEvidence).length>=rc.deepStopAfter)break;
  }timings.deep=Date.now()-at;await sample('AFTER_DEEP');
  let review=null;const conflict=allClaims.some(c=>c.status==='CONFLICTED'),cross=plan.intent==='CROSS_ASSET_ANALYSIS';
  if(deep.length&&(job.mode!=='normal'||conflict||cross)){
   const compressed=deep.map(c=>({asset:{id:c.asset.id},missing:c.missing,claims:c.claims.slice(0,5).map(x=>({id:x.id,source_id:x.sourceIds,source_type:x.sourceType,date:x.asOf,claim:x.type,short_excerpt:x.quote,quote:x.quote,verification_status:x.status}))}));
   try{const response=await reviewer(env,store,job,{feature:'RESEARCH_REVIEW',schema:reviewSchema,instructions:reviewInstructions,input:{candidates:compressed},maxOutput:rc.reviewOutputTokens});review=validateReview(response.value,deep);}
   catch(e){review={status:e.code||'review_failed',candidateAssessment:[],removed:[]};}
  }
  const status=!search.ready?(search.available?'SEARCH_CACHE_MISS':'DISCOVERY_LIMITED_NO_BROAD_SEARCH'):!deep.length?'EVIDENCE_INSUFFICIENT_AFTER_TECHNICAL_SEARCH':'RESEARCH_EVIDENCE_READY';
  const publishedClaims=deep.flatMap(c=>c.claims),accuracy={publishedClaimCount:publishedClaims.length,unsupportedPublishedFacts:publishedClaims.filter(c=>!goodClaim(c)||!c.sourceIds?.length).length,rejectedClaimCount:allClaims.filter(c=>!goodClaim(c)).length,removedReviewSentences:review?.removed?.length||0};
  return await finish({status,plan,event,condition:event.mode==='CONDITIONAL'?'해당 증설 조건이 성립할 경우':null,searchMentions,counts:{verifiedEvent:event.claims.filter(c=>c.status==='VERIFIED').length,supportedEvent:event.claims.filter(corroborated).length,verifiedScopeEdges:technicalClaims.filter(c=>c.status==='VERIFIED'&&scopePredicates.includes(c.normalizedProposition?.predicate)).length,supportedScopeEdges:technicalClaims.filter(c=>corroborated(c)&&scopePredicates.includes(c.normalizedProposition?.predicate)).length,verifiedProcessEdges:technicalClaims.filter(c=>c.status==='VERIFIED'&&!scopePredicates.includes(c.normalizedProposition?.predicate)).length,supportedProcessEdges:technicalClaims.filter(c=>corroborated(c)&&!scopePredicates.includes(c.normalizedProposition?.predicate)).length,initialSearchMentions:searchMentions.length+candidates.map.size,qualifiedInitialCandidates:candidates.map.size,prefilter:filtered.length,deep:deep.length},technicalClaims:technicalClaims.map(compactClaim),discovered:[...candidates.map.values()].map(c=>({asset:c.asset,origins:c.origins})),unresolved:candidates.unresolved,prefilter:filtered.map(c=>({asset:c.asset,paths:c.paths,checks:c.checks})),exclusions:excluded.map(c=>({asset:c.asset,reasons:c.exclusionReasons})),deep,review,sources:[...sources.values()],searchReady:search.ready,accuracy,missing:deep.length?[]:['근거 검증을 통과한 후보 부족']},status==='RESEARCH_EVIDENCE_READY'?'complete':'limited',status==='RESEARCH_EVIDENCE_READY'?null:status);
 }catch(e){const code=e.code||(/^[a-z_]+$/.test(e.message)?e.message:'research_failed');const frames=String(e.stack||'').split('\n').filter(x=>/^\s+at .*(?:\.mjs:\d+:\d+|node:sqlite)/.test(x)).slice(0,5);await researchStep(store,job.id,stage,'failed',{output:{code,frames}});return await finish({status:code,plan:plan||null,failedStage:stage,deep:[]},'failed',code);}finally{allClaims.length=0;sources.clear();rootMap.clear();readURLs.clear();eventAssets.clear();releaseResearchIdentityCache(store);await sample('AFTER_CLEANUP');}
}
export async function processResearchJob(env,store,options={}){
 // Global DB lease covers independent CLI/web workers, not just one process flag.
 const key='research-worker-lease',now=Date.now();
 await store.db.prepare("INSERT OR IGNORE INTO catalyst_runtime VALUES(?, ?, ?)").bind(key,JSON.stringify({until:0}),new Date().toISOString()).run();
 if(options.leaseToken){const held=await store.runtime(key);if(held?.token!==options.leaseToken||held.jobId!==options.jobId||held.until<=now)return null;}
 else {const lock=await store.db.prepare("UPDATE catalyst_runtime SET value=?,updated_at=? WHERE key=? AND CAST(json_extract(value,'$.until') AS INTEGER)<?").bind(JSON.stringify({until:now+rc.workerTimeoutMs+60000}),new Date().toISOString(),key,now).run();if(!lock.meta.changes)return null;}
 try{
  if(!options.jobId){
   await store.db.prepare("UPDATE catalyst_research_jobs SET status='queued',stage='resume',lease_until=0 WHERE status='running' AND lease_until<? AND attempts<3").bind(now).run();
   await store.db.prepare("UPDATE catalyst_research_jobs SET status='failed',error_code='worker_interrupted',updated_at=? WHERE status='running' AND lease_until<? AND attempts>=3").bind(new Date().toISOString(),now).run();
  }
  const job=options.jobId?await one(store.db,"SELECT id,research_key,query,mode,market_filter,status FROM catalyst_research_jobs WHERE id=? AND status='queued'",options.jobId):await one(store.db,"SELECT id,research_key,query,mode,market_filter,status FROM catalyst_research_jobs WHERE status='queued' ORDER BY created_at LIMIT 1");if(!job)return null;
  await store.db.prepare("UPDATE catalyst_research_jobs SET status='running',lease_until=?,attempts=attempts+1 WHERE id=? AND status='queued'").bind(now+rc.workerTimeoutMs,job.id).run();
  return await processResearch(env,store,job,options);
 }finally{if(!options.leaseToken)await store.db.prepare('UPDATE catalyst_runtime SET value=?,updated_at=? WHERE key=?').bind(JSON.stringify({until:0}),new Date().toISOString(),key).run();}
}

// Bounded event recovery entry point for a server one-shot job. It shares the
// production store, readers, validators and graph. No ranking or resident loop.
export async function recoverEventResearch(env,store,job,{tools=env.CATALYST_RESEARCH_TOOLS,discoverySeeds=[]}={}){
 const sources=[],claims=[],funnel={searchResults:0,officialCandidateURLs:[],authorityPassed:0,fetched:0,scopePassed:0,claimsExtracted:0,verifiedEvents:0},aliasChecks=[],attempted=new Set();
 const candidates=await tools.cachedEventCandidates({secondary:true});funnel.searchResults=candidates.length;
 const relevant=candidates.filter(i=>/substrate|기판/i.test(i.title+' '+i.snippet));
 // Stable source priority; not an event strength or beneficiary ranking.
 relevant.sort((a,b)=>eventSourcePriority(a.url)-eventSourcePriority(b.url));
 for(const item of relevant.slice(0,5)){
  if(attempted.has(item.url))continue;attempted.add(item.url);funnel.officialCandidateURLs.push(item.url);
  const seed=discoverySeeds.find(s=>s.url===item.url),mentioned=await resolveResearchAssets(store,seed?.issuerName||item.title+' '+(item.snippet||''),{limit:12});
  aliasChecks.push(...mentioned.map(a=>({assetId:a.id,name:a.name,accepted:issuerMentionIsSpecific(a,item.title+' '+(item.snippet||''))})));
  const assets=mentioned.filter(a=>issuerMentionIsSpecific(a,item.title+' '+(item.snippet||'')));
  let authority=await tools.authority({url:item.url}),proof=[];
  if(!authority.ownershipVerified&&!authority.authorityVerified)for(const asset of assets.slice(0,1))proof.push(await tools.verifyCachedRoot(asset));
  authority=await tools.authority({url:item.url});
  await promotionStep(store,job.id,item.url,'AUTHORITY_RESOLVED',authority.status,{...authority,proof},authority.rejectReason);
  const readStage=[2,3,4].includes(authority.sourceTier)?'event':'eventOfficial';if(!tools.stageAvailable(readStage))continue;
  // Unknown authority may be fetched once as an ownership candidate; it never
  // becomes evidence unless the final secure URL resolves to an established owner.
  if(!authority.ownershipVerified&&!authority.authorityVerified&&!assets.length){await researchStep(store,job.id,'event','identity_unresolved',{input:{url:item.url},output:{reason:'NO_INDEPENDENT_ISSUER_IDENTITY'}});continue;}
  if(authority.sourceTier===4)continue;
  const read=await tools.withStage(readStage,null,()=>tools.read(item));
  await researchStep(store,job.id,'event','official_recovery_read',{input:{url:item.url,cacheReuse:true},output:{status:read.status,code:read.code,authority:read.resolvedAuthority?.status}});
  if(read.status!=='read')continue;funnel.fetched++;
  authority=await tools.authority({url:read.url});if(!authority.ownershipVerified&&!authority.authorityVerified)continue;funnel.authorityPassed++;
  const asset=authority.assetId?await store.asset(authority.assetId):null;
  const source=await store.addSource({...read,resolvedAuthority:authority,assetId:asset?.id||null,sourceType:authority.ownershipVerified?'official':'news'});sources.push(source);
  const scope=resolveDocumentScope({document:source,targetProduct:'substrate'});if(scope.status==='EXACT')funnel.scopePassed++;
  await promotionStep(store,job.id,item.url,'SCOPE_RESOLVED',scope.status,scope,scope.rejectReason);
  const extracted=await sourceClaims(store,job,'event',source,asset);claims.push(...extracted);funnel.claimsExtracted+=extracted.length;
  corroborateClaims(claims);for(const c of claims)await saveResearchClaim(store,job.id,'event',c);
  await researchStep(store,job.id,'event','evidence_policy',{output:{mode:authority.sourceTier===1?'OFFICIAL':'SECONDARY_CORROBORATION',verified:claims.filter(c=>c.status==='VERIFIED').length,supported:claims.filter(corroborated).length}});
  const anchor=await resolveEventAnchor({question:job.query,discoveredSources:sources,existingClaims:claims,store,runId:job.id});
  if(admissible(anchor))break;
 }
 const anchor=await resolveEventAnchor({question:job.query,discoveredSources:sources,existingClaims:claims,store,runId:job.id});funnel.verifiedEvents=anchor.status==='VERIFIED'?1:0;funnel.supportedEvents=corroborated(anchor)?1:0;
 const connections=[],company={started:false,initial:0,authorityVerified:0,productClaims:0,canonicalAssets:0,qualified:0,deep:[],candidates:[]};
 if(admissible(anchor)){
  const graph=new CatalystGraph(store.db),edges=await rows(store.db,"SELECT * FROM catalyst_graph_edges WHERE namespace='production' AND status IN ('VERIFIED','SUPPORTED') AND relation_type IN ('INSPECTS','PROCESSES','USED_IN') LIMIT 100");
  for(const edge of edges){
   const paths=await graph.paths(edge.source_node_id,{maxDepth:1});
   const path=paths.paths.find(p=>p.edges.some(e=>e.id===edge.id));if(!path)continue;
   const links=await rows(store.db,'SELECT c.payload FROM catalyst_graph_evidence e JOIN catalyst_claims c ON c.id=e.claim_id WHERE e.edge_id=?',edge.id);
   for(const row of links){const c=JSON.parse(row.payload),source=await cachedSource(store,c.sourceIds[0]);if(!source)continue;
    const authority=await tools.authority({url:source.url});if(!authority.ownershipVerified&&!authority.authorityVerified)continue;
    const connection=eventTechnicalConnection(anchor,c,edge);if(!['DIRECT_TECHNICAL_MATCH','SUPPORTED_TECHNICAL_MATCH'].includes(connection.status))continue;
    connections.push({...connection,productName:c.normalizedProposition.subject,sourceId:source.id,assetId:authority.assetId});await saveResearchClaim(store,job.id,'technical',c,{reusedEdgeId:edge.id});
   }
  }
 }
 if(connections.length){
  company.started=true;
  for(const assetId of [...new Set(connections.map(c=>c.assetId).filter(Boolean))]){
   company.initial++;const asset=await store.asset(assetId);if(!asset)continue;
   if(asset.identityStatus==='verified'&&asset.active===true&&asset.symbol&&asset.exchange)company.canonicalAssets++;
   const evidence=await rows(store.db,"SELECT id FROM catalyst_sources WHERE asset_id=? ORDER BY CASE WHEN source_type='official' THEN 0 ELSE 1 END,observed_at DESC LIMIT 6",assetId);
   const products=[];let official=false;
   for(const ref of evidence){const s=await cachedSource(store,ref.id);if(!s)continue;const a=await tools.authority({url:s.url,expectedAsset:asset});if(!a.ownershipVerified&&!a.authorityVerified)continue;official=true;
    const cs=await sourceClaims(store,job,'discovery',{...s,resolvedAuthority:a},asset);products.push(...cs.filter(c=>c.type==='business'));
   }
   corroborateClaims(products);for(const c of products)await saveResearchClaim(store,job.id,'discovery',c);
   if(official)company.authorityVerified++;company.productClaims+=products.filter(admissible).length;
   // Ownership of an inspection source does not prove manufacture of a product.
   const technical=connections.filter(c=>c.assetId===assetId),product=products.find(c=>admissible(c)&&technical.some(t=>c.normalizedProposition?.object?.includes(t.productName)&&['REPORTS_PRODUCTS','PRODUCES'].includes(c.normalizedProposition.predicate)));
   const scopedProduct=product?{...product,scopeVerification:resolveDocumentScope({document:{body:product.quote},targetProduct:anchor.targetProduct})}:null;
   const tc=technical.length?JSON.parse((await one(store.db,'SELECT payload FROM catalyst_claims WHERE id=?',technical[0].claimId)).payload):null;
   const gate=researchPathGate({event:anchor,technical:tc?{...tc,scopeVerification:technical[0].compatibility}:null,product:scopedProduct,asset});
   const candidate={asset,productClaimIds:products.map(c=>c.id),gate,customerRelationship:'UNKNOWN',revenueExposure:'UNKNOWN'};company.candidates.push(candidate);
   if(gate.passed){company.qualified++;company.deep.push({...candidate,exposure:'DIRECT_TECHNICAL_EXPOSURE'});}
  }
 }
 const result={scope:'EVIDENCE_TIER_POLICY',query:job.query,queryIntent:anchor.queryIntent,anchor,funnel,aliasChecks,connections,company,sourceIds:sources.map(s=>s.id),claimIds:claims.map(c=>c.id),ranked:false,status:!admissible(anchor)?'FAIL':company.deep.length?'PASS':'PARTIAL_PASS',phase11Ready:false};
 await store.db.prepare('UPDATE catalyst_research_jobs SET result=?,status=?,stage=?,updated_at=? WHERE id=?').bind(JSON.stringify(result),'limited','event_recovery_complete',new Date().toISOString(),job.id).run();return result;
}
export function eventSourcePriority(url){const p=new URL(url).pathname;return /newsroom/.test(p)?0:/\/ir-news|\/investor|\/ir\//.test(p)?1:/dart\.fss\.or\.kr/.test(url)?2:/exchange/.test(url)?3:4;}
