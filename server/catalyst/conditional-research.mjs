import {rows} from './store.mjs';
import {userCondition,validUserCondition} from './query-policy.mjs';
import {scopeTerms,scopeLabel} from './document-scope.mjs';
import {admissible,corroborateClaims} from './evidence-policy.mjs';
import {businessExposure,catalystEnrichment,verifiedListedAsset} from './business-exposure.mjs';
import {cachedSource,sourceClaims,resolveResearchAssets,storedClaims} from './research-evidence.mjs';
import {verifiedProductAliases} from './product-aliases.mjs';
import {promoteEvidence} from './evidence-promotion.mjs';
import {ResearchRouter} from './research-router.mjs';
import {researchStep,saveCandidate,saveResearchSource,saveResearchClaim} from './research-store.mjs';
import {memorySample,freeMemoryAllowed} from './research-memory.mjs';
import {researchConfig,researchKinds} from './research-config.mjs';
import {enrichStockIdentity} from './identity-enrichment.mjs';

const policy=researchConfig.conditional;
const legalError=e=>/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'SOURCE_UNAVAILABLE';
export async function processConditionalResearch(env,store,job,{tools=env.CATALYST_RESEARCH_TOOLS,search=null,namespace='production'}={}){
 const condition=userCondition(job.query),technical=[],sourceMap=new Map(),assets=new Map(),candidates=[],rejected=[],read=new Set();let stage='condition';
 const step=(action,output={})=>researchStep(store,job.id,stage,action,{output});
 const mark=async next=>{stage=next;await store.db.prepare('UPDATE catalyst_research_jobs SET stage=?,updated_at=? WHERE id=?').bind(next,new Date().toISOString(),job.id).run();};
 const scoped=(name,asset,fn)=>tools.withStage?tools.withStage(name,asset?.id,fn):fn();
 const available=(name,asset)=>!tools.stageAvailable||tools.stageAvailable(name,asset?.id);
 const identify=async a=>a&&!verifiedListedAsset(a)&&a.identityStatus==='verified'?enrichStockIdentity(env,store,a):a;
 const finish=async(status,error=null)=>{
  const qualified=candidates.filter(c=>c.gate.passed),result={scope:'CONDITIONAL_RESEARCH',status,queryIntent:'CONDITIONAL_ANALYSIS',condition,eventRequired:false,counts:{event:0,technical:technical.filter(admissible).length,business:candidates.filter(c=>c.gate.evidenceLevel!=='UNVERIFIED').length,canonical:assets.size,qualified:qualified.length,deep:qualified.filter(c=>c.status==='DEEP_RESEARCHED').length},technical:technical.map(c=>({id:c.id,status:c.status,quote:c.quote,sourceIds:c.sourceIds,sourceUrl:c.sourceUrl,predicate:c.normalizedProposition?.predicate,applicationAssetId:c.applicationAssetId})),candidates,deep:qualified.filter(c=>c.status==='DEEP_RESEARCHED'),rejected,sourceIds:[...sourceMap.keys()],ranked:false,phase11Ready:qualified.length>0,providerUsage:search?.telemetry||null};
  await store.db.prepare('UPDATE catalyst_research_jobs SET status=?,stage=?,result=?,error_code=?,updated_at=?,lease_until=0 WHERE id=?').bind(error?'failed':qualified.length?'complete':'limited','conditional_complete',JSON.stringify(result),error,new Date().toISOString(),job.id).run();return result;
 };
 try{
  if(!validUserCondition(condition))return finish('EXPLICIT_CONDITION_REQUIRED');
  if(env.RESEARCH_FREE_MEMORY&&!freeMemoryAllowed(env,env.RESEARCH_FREE_MEMORY()))return finish('SYSTEM_MEMORY_DEFERRED');
  await memorySample(env,store,job,'CONDITIONAL_START');
  await store.db.prepare('UPDATE catalyst_research_jobs SET plan=? WHERE id=?').bind(JSON.stringify({intent:'FORWARD_IMPACT',queryIntent:'CONDITIONAL_ANALYSIS',condition,eventRequired:false,order:['TECHNICAL_MAP','BUSINESS_DISCOVERY','FILING_IR','INTERNET_CORROBORATION','DEEP','OPTIONAL_CATALYST']}),job.id).run();
  await step('USER_SUPPLIED_CONDITION',{...condition,savedAsEvent:false});
  search||=new ResearchRouter(env,store,job);
  const remember=async s=>{sourceMap.set(s.id,s);await saveResearchSource(store,job.id,stage,s,s.assetId||'');};
  const analyzeTechnical=async source=>{
   if(read.has(source.id))return;read.add(source.id);
   const authority=await tools.authority({url:source.url});
   if(!authority.ownershipVerified&&!authority.authorityVerified){await step('authority_rejected',{url:source.url,reason:authority.rejectReason});return;}
   const found=scopeTerms(source.body),matches=condition.targetScope==='SUBSTRATE'?found.length:found.some(t=>t.id===condition.targetScope)||source.body.toLowerCase().includes(condition.targetProduct.toLowerCase());
   if(!matches)return;
   const targets=condition.targetScope==='SUBSTRATE'?(found.filter(t=>['PACKAGE_SUBSTRATE','PCB'].includes(t.id)).length?found.filter(t=>['PACKAGE_SUBSTRATE','PCB'].includes(t.id)):found.filter(t=>t.id!=='SUBSTRATE')).slice(0,2).map(t=>scopeLabel(t.id)):[condition.targetProduct];
   await remember(source);
   const asset=await identify(authority.assetId?await store.asset(authority.assetId):null);
   if(verifiedListedAsset(asset)&&researchKinds[job.market_filter||'ALL'].includes(asset.kind))assets.set(asset.id,asset);
   for(const target of targets){const result=await promoteEvidence({store,runId:job.id,source,targetProduct:target,asset,preserveVerified:true,namespace});
    for(const c of result.claims)if(admissible(c)&&!technical.some(t=>t.id===c.id))technical.push({...c,applicationAssetId:asset?.id||c.applicationAssetId||null});
   }
   await step('technical_document',{sourceId:source.id,qualifiedClaims:technical.filter(c=>c.sourceIds.includes(source.id)).length,assetId:asset?.id||null});
  };
  await mark('technical');
  // Metadata and sanitized current-version text only; legacy raw files are never
  // opened or upgraded by assigning a new security version.
  const saved=await rows(store.db,"SELECT id FROM catalyst_sources WHERE json_extract(payload,'$.securityVersion') IS NOT NULL AND instr(lower(body),?)>0 ORDER BY CASE WHEN source_type='official' THEN 0 ELSE 1 END,LENGTH(body) DESC LIMIT 12",condition.targetProduct.toLowerCase());
  for(const ref of saved.slice(0,policy.maxTechnicalSources)){const s=await cachedSource(store,ref.id);if(s)await analyzeTechnical(s);}
  if(!technical.length&&search.available)for(const query of [`${condition.targetProduct} manufacturing inspection equipment official technical`,`${condition.targetProduct} production materials process technical publication`].slice(0,policy.maxTechnicalQueries)){
   if(!available('technical'))break;
   const r=await search.search({query,purpose:'TECHNICAL_RELATION',maxResults:4},{stage:'technical'});
   for(const item of r.items||[]){if(!available('technical'))break;const doc=await scoped('technical',null,()=>tools.read(item));if(doc.status==='read')await analyzeTechnical(await store.addSource(doc));}
   if(technical.length)break;
  }
  await step('technical_map_ready',{count:technical.length,eventRequired:false});
  if(!technical.length)return finish('TECHNICAL_EVIDENCE_INSUFFICIENT');
  await mark('discovery');
  // A validated technical publisher may suggest a listed issuer, but never
  // substitutes for that issuer's independently checked business clause.
  if(!assets.size&&search.available)for(const t of technical.slice(0,policy.maxDiscoveryQueries)){
   const p=t.normalizedProposition,product=/^(USES|REQUIRES)/.test(p.predicate)?p.object:p.subject;
   const r=await search.search({query:`${product} manufacturers listed company ${condition.targetProduct}`,purpose:'COMPANY_DISCOVERY',maxResults:5},{stage:'discovery'});
   for(const item of r.items||[])for(const raw of await resolveResearchAssets(store,item.title+' '+(item.snippet||''),{market:job.market_filter,limit:5})){const a=await identify(raw);if(verifiedListedAsset(a))assets.set(a.id,a);}
  }
  await step('candidate_identities',{count:assets.size});
  for(const asset of [...assets.values()].slice(0,policy.maxCandidates)){
   await mark('filing');const business=[],seenSources=new Set();
   const ingest=async raw=>{
    const s=raw.id?raw:await store.addSource(raw);if(seenSources.has(s.id)||store.sourceReady&&!store.sourceReady(s))return;seenSources.add(s.id);
    const authority=await tools.authority({url:s.url,expectedAsset:asset});
    // Older sanitized product pages lack documentBasis. Reuse the original
    // observation timestamp, never fabricate a publication date or refresh time.
    const bound={...s,assetId:asset.id,resolvedAuthority:authority,sourceType:authority.ownershipVerified?'official':s.sourceType,documentBasis:authority.ownershipVerified&&!s.publishedAt?'CURRENT_OFFICIAL_DOCUMENT':s.documentBasis};
    // Regulator documents retain their original issuer binding. Publication
    // clauses must explicitly name the same company in the claim validator.
    if(s.sourceType==='regulatory'&&s.assetId!==asset.id)return;
    if(!authority.ownershipVerified&&!authority.authorityVerified&&s.sourceType!=='regulatory')return;
    await remember(s);business.push(...await sourceClaims(store,job,'discovery',bound,asset));
    corroborateClaims(business);for(const c of business)await saveResearchClaim(store,job.id,'discovery',c,{assetId:asset.id});
   };
   if(tools.businessSources&&available('probe',asset))try{
    const filings=await scoped('probe',asset,()=>tools.businessSources(asset,'PRODUCT_RELATION'));
    await step('filing_ir_first',{assetId:asset.id,sources:filings.length});for(const s of filings.slice(0,policy.maxSourcesPerCandidate))await ingest(s);
   }catch(e){await step('filing_unavailable',{assetId:asset.id,reason:legalError(e)});}
   for(const s of [...sourceMap.values()]){const a=s.resolvedAuthority||await tools.authority({url:s.url});if(a.assetId===asset.id)await ingest(s);}
   const refs=await rows(store.db,"SELECT id FROM catalyst_sources WHERE asset_id=? AND json_extract(payload,'$.securityVersion') IS NOT NULL ORDER BY observed_at DESC LIMIT 5",asset.id);
   for(const ref of refs){const s=await cachedSource(store,ref.id);if(s)await ingest(s);}
   const gates=async()=>{const aliases=await verifiedProductAliases(store),all=business.filter(c=>c.type==='business'&&admissible(c));return all.flatMap(b=>technical.map(t=>businessExposure({condition,asset,business:b,technical:t,aliases,claims:business})));};
   let paths=await gates();
   if(search.available&&available('probe',asset)){
    await mark('corroboration');
    const roots=tools.roots?await scoped('probe',asset,()=>tools.roots(asset)):{roots:[]};
    const r=await search.search({query:`${asset.name} ${condition.targetProduct} products manufactures equipment`,purpose:'PRODUCT_DISCOVERY',domainHints:roots.roots.map(u=>new URL(u).hostname),maxResults:3},{stage:'probe'});
    for(const item of r.items||[]){if(!available('probe',asset))break;const doc=await scoped('probe',asset,()=>tools.read(item,{asset,roots}));if(doc.status==='read')await ingest(doc);paths=await gates();if(paths.some(p=>p.passed))break;}
   }
   const gate=paths.find(p=>p.passed)||paths.find(p=>p.pathQuality==='ADJACENT_EXPOSURE_PATH')||paths[0]||businessExposure({condition,asset});
   let candidate={asset,origins:['TECHNICAL_MAP','FILING_IR_FIRST'],status:gate.passed?'QUALIFIED':'EXCLUDED',gate,paths:paths.filter(p=>p.passed),businessEvidence:business.filter(c=>admissible(c)&&c.type==='business').map(c=>({id:c.id,quote:c.quote,sourceIds:c.sourceIds,sourceUrl:c.sourceUrl,status:c.status,asOf:c.asOf,locator:c.locator})),revenueExposure:gate.revenueExposure,actualCatalyst:'UNKNOWN',ranking:null,score:null};
   if(gate.passed){await mark('deep');await step('conditional_deep_entered',{assetId:asset.id,eventRequired:false});
    // Reuse available filing facts; unknown revenue/customer/order fields are
    // retained as gaps, rather than made eligibility requirements.
    const existing=await storedClaims(store,asset);candidate=catalystEnrichment(candidate,existing,{searched:false});candidate.status='DEEP_RESEARCHED';candidate.deep={reviewedClaimIds:business.filter(admissible).map(c=>c.id),missing:gate.missing,conclusion:gate.summary};
   }else rejected.push({assetId:asset.id,reasons:gate.reasons,pathQuality:gate.pathQuality});
   candidates.push(candidate);await saveCandidate(store,job.id,candidate);await memorySample(env,store,job,'CONDITIONAL_CANDIDATE_RELEASE',{assetId:asset.id});
  }
  return finish(candidates.some(c=>c.gate.passed)?'CONDITIONAL_EVIDENCE_READY':'BUSINESS_EXPOSURE_INSUFFICIENT');
 }catch(e){await step('conditional_failed',{reason:legalError(e),frames:String(e.stack||'').split('\n').filter(x=>/\.mjs:\d+:\d+/.test(x)).slice(0,4)});return finish('CONDITIONAL_RESEARCH_FAILED',legalError(e));}
 finally{await memorySample(env,store,job,'CONDITIONAL_FINISH');}
}
