import {compareEconomicCandidates} from './economic-exposure.mjs';
import {companyProfile,businessProfileForResearch} from './company-research-profile.mjs';
import {searchBusinessProfiles} from './profile-search.mjs';
import {rows} from './store.mjs';
import {norm} from './core.mjs';
import {beneficiaryQuestion,validBeneficiaryQuestion} from './query-policy.mjs';
import {beneficiaryPolicy as policy,beneficiaryAssessment,expansionScope,knownFact} from './beneficiary-policy.mjs';
import {planBeneficiaries,extractBeneficiaryFacts,actualBusinessStatement,validateBeneficiaryExtraction} from './beneficiary-extraction.mjs';
import {ResearchRouter} from './research-router.mjs';
import {cachedSource,resolveResearchAssets} from './research-evidence.mjs';
import {researchStep,saveResearchSource,saveResearchClaim,saveCandidate} from './research-store.mjs';
import {verifiedListedAsset} from './business-exposure.mjs';
import {enrichStockIdentity} from './identity-enrichment.mjs';
import {memorySample,freeMemoryAllowed} from './research-memory.mjs';
const code=e=>/^[a-zA-Z_0-9]+$/.test(e?.code||'')?e.code:/^[a-zA-Z_0-9]+$/.test(e?.message||'')?e.message:'SOURCE_UNAVAILABLE';
export function explicitUniverseNames(query){
 const before=String(query).split(/같은|등의|such as|including/i)[0];
 return before!==query?before.split(/[,、]|\s+및\s+/).map(norm).filter(x=>x.length>=2&&x.length<60):[];
}
export function selectBeneficiarySections(sections,condition){
 const target=norm(condition.targetProduct).toLowerCase();
 const score=s=>{const t=norm(s.body);return (t.length>=120?4:0)+(/당사|our|we\b/i.test(t)?3:0)+(actualBusinessStatement(t)?6:0)+(t.toLowerCase().includes(target)?3:0)+(['SUBSTRATE','PCB','PACKAGE_SUBSTRATE'].includes(condition.targetScope)&&/PCB|기판|substrate/i.test(t)?3:0)-(/특허|patent/i.test(t)?8:0);};
 return sections.filter(s=>norm(s.body).length>=80).sort((a,b)=>score(b)-score(a)).slice(0,3);
}
export function selectBeneficiaries(outcomes){
 const initial=outcomes.filter(c=>c.assessment.passed).slice(0,policy.initialLimit);
 const ranked=initial.slice().sort(compareEconomicCandidates);
 const shortlist=ranked.slice(0,policy.shortlistLimit);
 const core=ranked.filter(c=>c.assessment.beneficiaryGroup==='CORE_BENEFICIARIES'),secondary=ranked.filter(c=>c.assessment.beneficiaryGroup==='SECONDARY_BENEFICIARIES'),watchlist=ranked.filter(c=>c.assessment.beneficiaryGroup==='WATCHLIST');
 const final=ranked.filter(c=>c.assessment.finalEligible).slice(0,policy.finalLimit);
 return {initial,shortlist,final,core,secondary,watchlist};
}
export async function cachedBeneficiaryCandidates(store,condition,universe=[]){
 // Existing source-bound facts precede broad discovery. Revalidate literal
 // propositions against the stored safe source; no model or network is called.
 const saved=await rows(store.db,"SELECT payload FROM catalyst_claims WHERE status IN ('VERIFIED','SUPPORTED') AND json_extract(payload,'$.validationVersion') LIKE 'beneficiary-%' ORDER BY checked_at DESC LIMIT 300");
 const groups=new Map();
 for(const {payload} of saved){const f=JSON.parse(payload);if(f.retracted||!f.sourceIds?.length||!f.quote||f.type!=='business')continue;const key=f.subject+'|'+f.sourceIds[0];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
 const candidates=new Map();
 for(const facts of groups.values()){
  const asset=await store.asset(facts[0].subject);if(!verifiedListedAsset(asset))continue;
  const source=await cachedSource(store,facts[0].sourceIds[0]);if(!source)continue;
  const checked=await validateBeneficiaryExtraction({business:facts.map(f=>({product:f.product,category:f.category,quote:f.quote,applicationQuote:f.applicationQuote||''}))},source,asset);
  if(!checked.facts.length)continue;
  const c=candidates.get(asset.id)||{asset,name:asset.name,status:'CACHED_BUSINESS',origins:['DB_VALIDATED_BUSINESS_CACHE'],items:[],facts:[],extractionRejected:[]};
  for(const f of checked.facts)if(!c.facts.some(old=>old.id===f.id))c.facts.push(f);
  c.assessment=beneficiaryAssessment({...c,condition,universe});candidates.set(asset.id,c);
 }
 return [...candidates.values()].filter(c=>c.assessment.passed).slice(0,policy.initialLimit);
}
export async function processBeneficiaryResearch(env,store,job,{tools=env.CATALYST_RESEARCH_TOOLS,search=null,planner=planBeneficiaries,extractor=extractBeneficiaryFacts}={}){
 job={...job,discoveryPolicy:policy.version};
 let stage='condition',plan=null;const condition=beneficiaryQuestion(job.query),scope=expansionScope(condition),universe=[],leads=new Map(),sources=new Map(),outcomes=[],failures=[],usedURLs=new Set();
 const step=(action,output={})=>researchStep(store,job.id,stage,action,{output});
 const mark=async s=>{stage=s;await store.db.prepare('UPDATE catalyst_research_jobs SET stage=?,updated_at=? WHERE id=?').bind(s,new Date().toISOString(),job.id).run();};
 const scoped=(s,a,fn)=>tools.withStage?tools.withStage(s,a?.id,fn):fn();
 const available=(s,a)=>!tools.stageAvailable||tools.stageAvailable(s,a?.id);
 const finish=async error=>{
  const {initial,shortlist,final,core,secondary,watchlist}=selectBeneficiaries(outcomes);
  const counts={materialityInvestigated:outcomes.filter(c=>c.materialityResearch?.sources>0).length,core:core.length,secondary:secondary.length,watchlist:watchlist.length,discoveredLeads:leads.size,initial:initial.length,businessExposure:initial.length,shortlist:shortlist.length,final:final.length,deep:outcomes.filter(c=>c.deep?.attempted).length,events:final.filter(c=>c.assessment.actualCatalyst==='YES').length};
  const pass=!error&&counts.initial>=15&&counts.materialityInvestigated>=policy.minimumMaterialityInvestigated;
  const result={scope:'BENEFICIARY_DISCOVERY',version:policy.economicVersion,coreBeneficiaries:core,secondaryBeneficiaries:secondary,watchlist,status:error?'BENEFICIARY_RESEARCH_FAILED':pass?'ECONOMIC_EXPOSURE_E2E_PASS':'BENEFICIARY_E2E_INCOMPLETE',researchResult:pass?'PASS':'FAIL',condition,expansionScope:scope,expansionUniverse:universe,industryNeeds:plan?.needs||[],counts,initialCandidates:initial,shortlist,finalCandidates:final,deep:outcomes.filter(c=>c.deep?.attempted),lowerPriority:outcomes.filter(c=>!final.includes(c)),unresolvedLeads:[...leads.values()].filter(l=>!l.asset).map(l=>({name:l.name,reason:l.reason||'CANONICAL_MAPPING_UNAVAILABLE'})),failures,providerUsage:search?.telemetry||{},rankingUI:false,phase11Ready:false,missingCoverage:['JP_LISTING_PROVIDER_NOT_CONNECTED'],finishedAt:new Date().toISOString()};
  await store.db.prepare('UPDATE catalyst_research_jobs SET status=?,stage=?,result=?,error_code=?,updated_at=?,lease_until=0 WHERE id=?').bind(error?'failed':pass?'complete':'limited','beneficiary_complete',JSON.stringify(result),error,new Date().toISOString(),job.id).run();return result;
 };
 try{
  if(!validBeneficiaryQuestion(condition))return finish('RESEARCH_TOPIC_REQUIRED');
  if(env.RESEARCH_FREE_MEMORY&&!freeMemoryAllowed(env,env.RESEARCH_FREE_MEMORY()))return finish('SYSTEM_MEMORY_DEFERRED');
  await memorySample(env,store,job,'BENEFICIARY_START');
  for(const name of explicitUniverseNames(job.query)){const a=(await resolveResearchAssets(store,name,{market:'ALL',limit:1}))[0];universe.push({name,asset:a||null,type:'USER_SUPPLIED_EXPANSION_UNIVERSE',factualClaim:false,eventVerified:false});}
  await step('condition',{condition,universe,scope,eventRequired:false});
  search||=new ResearchRouter(env,store,job);
  const remember=async s=>{sources.set(s.id,s);await saveResearchSource(store,job.id,stage,s,s.assetId||'');};
  const cached=await rows(store.db,"SELECT id FROM catalyst_sources WHERE json_extract(payload,'$.securityVersion') IS NOT NULL AND (instr(lower(body),?)>0 OR instr(body,?)>0) ORDER BY observed_at DESC LIMIT 15",condition.targetProduct.toLowerCase(),scope.targets.includes('PCB')?'기판':condition.targetProduct);
  for(const ref of cached){const s=await cachedSource(store,ref.id);if(s)await remember(s);}
  await mark('industry_needs');
  plan=await planner(env,store,job,[...sources.values()].slice(0,3).map(s=>({sourceId:s.id,text:s.body.slice(0,1000)})));
  plan.needs=(plan.needs||[]).slice(0,20).map(n=>({...n,status:'RESEARCH_HYPOTHESIS',sourceIds:[]}));
  await store.db.prepare('UPDATE catalyst_research_jobs SET plan=? WHERE id=?').bind(JSON.stringify({...plan,question:condition,queryIntent:condition.intent,discoveryPolicy:policy.version}),job.id).run();
  await step('dynamic_expansion_map',{needs:plan.needs,source:'RESEARCH_PLAN_NOT_FIXED_INDUSTRY_LIST'});
  const addLead=async(name,origin,item=null)=>{
   if(!name)return;
   const resolved=await resolveResearchAssets(store,name,{market:job.market_filter||'ALL',limit:2});
   if(!resolved.length){const key='unresolved:'+norm(name).toLowerCase();if(!leads.has(key)&&[...leads.values()].filter(l=>!l.asset).length<10)leads.set(key,{name,asset:null,origins:[origin],items:item?[item]:[],reason:'CANONICAL_MAPPING_UNAVAILABLE'});return;}
   for(const raw of resolved){if(condition.upstreamOnly&&universe.some(u=>u.asset?.id===raw.id))continue;
    const asset=await enrichStockIdentity(env,store,raw),old=leads.get(asset.id);
    if(old){old.origins=[...new Set([...old.origins,origin])];if(item&&!old.items.some(i=>i.url===item.url))old.items.push(item);continue;}
    if([...leads.values()].filter(l=>l.asset).length<policy.discoveryLeadLimit)leads.set(asset.id,{name:asset.name,asset,origins:[origin],items:item?[item]:[],reason:verifiedListedAsset(asset)?null:'CANONICAL_LISTING_UNVERIFIED'});
   }
  };
  await mark('discovery');
  const profileLeads=await searchBusinessProfiles(store,condition.targetProduct,{market:job.market_filter==='ALL'?null:job.market_filter,limit:12,sourceAllowed:env.CATALYST_SOURCE_ALLOWED});
  for(const p of profileLeads)await addLead(p.name,'BUSINESS_PROFILE_DB');
  await step('business_profile_db',{matches:profileLeads.length,searchCalls:0,aiCalls:0});
  for(const suggestion of (plan.leads||[]).slice(0,policy.initialLimit))await addLead(suggestion.name,'AI_DISCOVERY_HYPOTHESIS');
  for(const s of sources.values()){const a=s.assetId?await store.asset(s.assetId):s.resolvedAuthority?.assetId?await store.asset(s.resolvedAuthority.assetId):null;if(a)await addLead(a.name,'DB_CACHE');}
  if(search.available)for(const q of (plan.discoveryQueries||[]).slice(0,policy.discoveryQueries)){
   const r=await search.search({query:q,purpose:/[가-힣]/.test(q)?'BENEFICIARY_DISCOVERY':'COMPANY_DISCOVERY',language:/[가-힣]/.test(q)?'ko':'en',maxResults:8},{stage:'discovery'});
   for(const item of r.items||[]){const matched=await resolveResearchAssets(store,item.title+' '+item.snippet,{market:job.market_filter||'ALL',limit:5});for(const a of matched)await addLead(a.name,'WEB_SEARCH',item);}
  }
  let pureQueries=0;const categoryCounts=new Map();
  if(search.available)for(const need of plan.needs||[]){
   const category=norm(need.term);if(!category||pureQueries>=policy.purePlayQueries)break;
   for(const suffix of ['pure play listed company revenue segment','상장사 전문 주요제품 매출 비중']){
    if((categoryCounts.get(category)||0)>=policy.purePlayQueriesPerCategory||pureQueries>=policy.purePlayQueries)break;
    categoryCounts.set(category,(categoryCounts.get(category)||0)+1);pureQueries++;
    const r=await search.search({query:`${condition.targetProduct} ${category} ${suffix}`,purpose:'PURE_PLAY_DISCOVERY',language:/[가-힣]/.test(suffix)?'ko':'en',maxResults:6},{stage:'discovery'});
    for(const item of r.items||[]){const matched=await resolveResearchAssets(store,item.title+' '+item.snippet,{market:job.market_filter||'ALL',limit:5});for(const a of matched)await addLead(a.name,'PURE_PLAY_DISCOVERY',item);}
   }
  }
  await step('pure_play_discovery',{queries:pureQueries,perCategory:Object.fromEntries(categoryCounts),primary:'Exa',fallback:'TavilySearch'});
  await step('discovered_leads',{count:leads.size,mapped:[...leads.values()].filter(l=>l.asset).length});
  // Discovery suggestions remain unverified, but repeated generic company
  // mentions in search snippets must not crowd all product-specific leads out.
  const verifiedCache=await cachedBeneficiaryCandidates(store,condition,universe),proven=new Set(verifiedCache.map(c=>c.asset.id));
  for(const c of verifiedCache){await addLead(c.asset.name,'DB_VALIDATED_BUSINESS_CACHE');for(const id of new Set(c.facts.flatMap(f=>f.sourceIds))){const s=await cachedSource(store,id);if(s)await remember(s);}}
  const pool=[...leads.values()].filter(l=>l.asset).sort((a,b)=>Number(proven.has(b.asset.id))-Number(proven.has(a.asset.id))||Number(b.origins.includes('PURE_PLAY_DISCOVERY'))-Number(a.origins.includes('PURE_PLAY_DISCOVERY'))||Number(b.origins.includes('AI_DISCOVERY_HYPOTHESIS'))-Number(a.origins.includes('AI_DISCOVERY_HYPOTHESIS'))||Number(b.origins.includes('DB_CACHE'))-Number(a.origins.includes('DB_CACHE'))||b.items.length-a.items.length);
  const prioritized=[...pool.filter(l=>l.asset.market==='KR').slice(0,policy.koreanResearchSlots),...pool.filter(l=>l.asset.market!=='KR').slice(0,policy.initialLimit-policy.koreanResearchSlots)];
  const ordered=[...prioritized,...pool.filter(l=>!prioritized.includes(l))].slice(0,policy.initialLimit);
  const read=async(item,asset,roots,s='probe')=>{
   if(!available(s,asset))return null;
   const existing=[...sources.values()].find(x=>x.url===item.url);if(existing)return existing;
   if(usedURLs.has(item.url))return null;usedURLs.add(item.url);
   const doc=await scoped(s,asset,()=>tools.read(item,{asset,roots,purpose:'PRODUCT_RELATION'}));
   if(doc.status!=='read'){failures.push({assetId:asset.id,url:item.url,stage:s,code:doc.code||doc.status});return null;}
   const stored=await store.addSource(doc);await remember(stored);search.markUsed?.([item]);return stored;
  };
  const ingest=async(candidate,s,{allowAI=false}={})=>{
   if(!s||candidate.seen.has(s.id)||store.sourceReady&&!store.sourceReady(s))return;candidate.seen.add(s.id);
   const authority=await tools.authority({url:s.url,expectedAsset:candidate.asset});
   const bound={...s,resolvedAuthority:authority};
   if(authority.ownershipVerified&&authority.assetId===candidate.asset.id)Object.assign(bound,{assetId:candidate.asset.id,sourceType:'official',documentBasis:s.publishedAt?s.documentBasis:'CURRENT_OFFICIAL_DOCUMENT'});
   try{const out=await extractor(env,store,job,bound,candidate.asset,{allowAI,products:[...candidate.facts.filter(f=>f.type==='business'),...plan.needs.map(n=>({product:n.term,category:n.category}))]});candidate.extractionRejected.push(...out.rejected);for(const f of out.facts){if(!candidate.facts.some(x=>x.id===f.id)){candidate.facts.push(f);await saveResearchClaim(store,job.id,stage,f,{assetId:candidate.asset.id,policy:policy.version});}}
    const profile=await companyProfile(store,candidate.asset,bound,candidate.facts,condition);
    candidate.profileCacheHits=(candidate.profileCacheHits||0)+Number(profile.cacheHit);
    for(const f of profile.facts)if(!candidate.facts.some(x=>x.id===f.id)){await saveResearchClaim(store,job.id,stage,f,{assetId:candidate.asset.id,policy:policy.economicVersion});candidate.facts.push(f);}
    candidate.materialityObservations=[...(candidate.materialityObservations||[]),...profile.observations].slice(0,80);
    candidate.assessment=beneficiaryAssessment({...candidate,condition,universe});
    const relevant=out.facts.filter(f=>f.type==='business'&&beneficiaryAssessment({asset:candidate.asset,facts:[f],condition,universe}).finalEligible);
    for(const need of plan.needs){if(relevant.some(f=>norm(f.product).toLowerCase().includes(norm(need.term).toLowerCase())||norm(f.quote).toLowerCase().includes(norm(need.term).toLowerCase()))){need.sourceIds=[...new Set([...need.sourceIds,s.id])];need.status='SOURCE_SUPPORTED_NEED';}}
    for(const f of relevant)if(!plan.needs.some(n=>norm(n.term).toLowerCase()===norm(f.product).toLowerCase()))plan.needs.push({term:f.product,category:f.category,status:'SOURCE_SUPPORTED_NEED',sourceIds:f.sourceIds});
   }catch(e){failures.push({assetId:candidate.asset.id,url:s.url,stage:'extract',code:code(e)});}
  };
  const serialize=c=>{const {seen,...value}=c;return value;};
  for(const lead of ordered){
   if(env.CATALYST_RESEARCH_PROFILE_GC==='true')globalThis.gc?.();
   await mark('business_exposure');const c={...lead,status:'DISCOVERED',facts:[...(verifiedCache.find(x=>x.asset.id===lead.asset.id)?.facts||[])],seen:new Set(),extractionRejected:[],assessment:null};c.assessment=beneficiaryAssessment({...c,condition,universe});
   c.businessProfile=await businessProfileForResearch(store,c.asset,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED});
   if(!verifiedListedAsset(c.asset)){c.status='LOWER_PRIORITY';outcomes.push(serialize(c));continue;}
   let roots={roots:[],assetId:c.asset.id};try{roots=await scoped('probe',c.asset,()=>tools.roots(c.asset));}catch{}
   // Try the existing filing/IR flow first. Failure never removes a candidate.
   if(available('probe',c.asset))try{const filings=await scoped('probe',c.asset,()=>tools.businessSources(c.asset,'BENEFICIARY_BUSINESS'));await step('filing_first',{assetId:c.asset.id,count:filings.length});for(const raw of selectBeneficiarySections(filings,condition)){const s=raw.id?raw:await store.addSource(raw);await remember(s);await ingest(c,s);}}catch(e){failures.push({assetId:c.asset.id,stage:'filing',code:code(e)});}
   for(const s of sources.values())if(s.assetId===c.asset.id||s.resolvedAuthority?.assetId===c.asset.id||roots.roots.some(r=>new URL(s.url).hostname.replace(/^www\./,'')===new URL(r).hostname.replace(/^www\./,'')))await ingest(c,s);
   let items=lead.items.slice();
   if(search.available&&!c.assessment.passed){
    const tail=condition.kind==='ECONOMIC'?(c.asset.market==='KR'?'사업보고서 사업 노출 원가 수익 위험':'annual report business exposure costs earnings risks'):condition.upstreamOnly?(c.asset.market==='KR'?'장비 소재 제품':'equipment material products'):(c.asset.market==='KR'?'주요 제품 서비스 사업보고서':'products services annual report');
    const q=`"${c.asset.name}" ${condition.targetScope==='SUBSTRATE'?'PCB 기판 substrate':condition.targetProduct} ${tail}`;
    const result=await search.search({query:q,purpose:'PRODUCT_DISCOVERY',language:c.asset.market==='KR'?'ko':'en',maxResults:5},{stage:'probe'});items.push(...result.items||[]);
   }
   // Verified corporate root is also a source candidate, never proof by itself.
   items.push(...roots.roots.map(url=>({url,title:c.asset.name,provider:'OfficialRegistry'})));
   const unique=[...new Map(items.map(i=>[i.url,i])).values()].sort((a,b)=>Number(roots.roots.some(r=>new URL(b.url).hostname===new URL(r).hostname))-Number(roots.roots.some(r=>new URL(a.url).hostname===new URL(r).hostname)));
   for(const item of (c.assessment.passed?[]:unique.slice(0,policy.sourcesPerCandidate))){const owner=await tools.authority({url:item.url,expectedAsset:c.asset});if(!owner.ownershipVerified&&!owner.authorityVerified)continue;await ingest(c,await read(item,c.asset,roots));if(c.assessment.finalEligible)break;}
   if(c.assessment.passed){
    c.materialityResearch={attempted:true,priority:['target_revenue_share','segment_revenue','product_mix','customer_mix','orders_backlog','recent_growth'],sources:0,status:'UNKNOWN'};
    try{const materiality=await scoped('probe',c.asset,()=>tools.businessSources(c.asset,'BENEFICIARY_MATERIALITY'));c.materialityResearch.sources=materiality.length;
     for(const raw of materiality){const doc=raw.id?raw:await store.addSource(raw);await remember(doc);await ingest(c,doc);}
     c.materialityResearch.status=c.assessment.economicMateriality.status;
    }catch(e){c.materialityResearch.error=code(e);}
   }
   c.status=c.assessment.passed?'INITIAL_CANDIDATE':'LOWER_PRIORITY';outcomes.push(serialize(c));await saveCandidate(store,job.id,serialize(c));await step('business_result',{assetId:c.asset.id,passed:c.assessment.passed,finalEligible:c.assessment.finalEligible,facts:c.facts.length,reasons:c.assessment.reasons});await memorySample(env,store,job,'BENEFICIARY_CANDIDATE_RELEASE');
  }
  await mark('deep');
  const top=outcomes.filter(c=>c.assessment.passed).sort(compareEconomicCandidates).slice(0,policy.deepLimit);
  for(const c of top){const beforeDeep=new Set(c.facts.map(f=>f.id));let aiUsed=false;c.seen=new Set(c.facts.flatMap(f=>f.sourceIds));c.deep={attempted:true,fields:['revenue_share','financial','order','capex','customer','competitor'],found:[],missing:[]};
   let roots={roots:[]};try{roots=await scoped('deep',c.asset,()=>tools.roots(c.asset));}catch{}
   if(search.available&&available('deep',c.asset)){const r=await search.search({query:`"${c.asset.name}" ${condition.targetProduct} ${c.asset.market==='KR'?'매출 비중 수주 고객 실적':'segment revenue orders customers financial results'}`,purpose:'OFFICIAL_SOURCE_DISCOVERY',language:c.asset.market==='KR'?'ko':'en',maxResults:4},{stage:'deep'});let count=0;for(const item of r.items||[]){const owner=await tools.authority({url:item.url,expectedAsset:c.asset});if(!owner.ownershipVerified&&!owner.authorityVerified)continue;if(count++>=policy.deepSourcesPerCandidate)break;const doc=await read(item,c.asset,roots,'deep');if(doc){await ingest(c,doc,{allowAI:!aiUsed});aiUsed=true;}}}
   c.deep.newEvidenceIds=c.facts.filter(f=>!beforeDeep.has(f.id)).map(f=>f.id);c.deep.found=c.deep.fields.filter(type=>c.facts.some(f=>f.type===type&&knownFact(f)));c.deep.missing=c.deep.fields.filter(type=>!c.deep.found.includes(type));delete c.seen;c.status='DEEP_RESEARCHED';await saveCandidate(store,job.id,c);await step('deep_result',{assetId:c.asset.id,...c.deep});
  }
  return finish(null);
 }catch(e){await step('beneficiary_failed',{code:code(e),frames:String(e.stack||'').split('\n').filter(x=>/\.mjs:\d+:\d+/.test(x)).slice(0,4)});return finish(code(e));}
 finally{await memorySample(env,store,job,'BENEFICIARY_FINISH');}
}
