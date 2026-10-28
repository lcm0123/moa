import {admissible,corroborated,pathQuality} from './evidence-policy.mjs';
import {validUserCondition} from './query-policy.mjs';
import beneficiaryPolicy from '../../config/catalyst-beneficiary.json' with {type:'json'};
import {BraveAdapter,ExaAdapter,TavilySearchAdapter,dedupSearchItems} from './research-providers.mjs';
import {researchConfig as rc} from './research-config.mjs';
import {hash} from './core.mjs';
import {researchStep} from './research-store.mjs';
const technical=['TECHNICAL_RELATION','TAXONOMY_RELATION','PROCESS_DISCOVERY','EQUIPMENT_DISCOVERY','MATERIAL_DISCOVERY','PRODUCT_DISCOVERY','COMPANY_DISCOVERY'];
export function providerRoute(purpose){
 if(purpose==='PURE_PLAY_DISCOVERY')return ['Exa','TavilySearch'];
 if(purpose==='BENEFICIARY_DISCOVERY')return ['Brave','Exa','TavilySearch'];
 if(['RECENT_EVENT','NEWS'].includes(purpose))return ['Brave','TavilySearch'];
 if(technical.includes(purpose))return ['Exa','TavilySearch'];
 if(purpose==='OFFICIAL_SOURCE_DISCOVERY')return ['Exa','Brave'];
 if(purpose==='PAGE_EXTRACTION')return ['LocalSecureFetch','TavilyExtract'];
 return ['TavilySearch'];
}
export function purposeForStage(stage){return ({event:'RECENT_EVENT',technical:'TECHNICAL_RELATION',technicalGap:'TECHNICAL_RELATION',discovery:'COMPANY_DISCOVERY',probe:'PRODUCT_DISCOVERY',deep:'OFFICIAL_SOURCE_DISCOVERY'})[stage]||'GENERAL_FALLBACK';}
// Only validated document claims contribute. Search result snippets cannot stop research.
export function evidenceSufficient(purpose,claims=[]){
 const valid=claims.filter(c=>c.evidence!==false&&c.trust!=='UNTRUSTED_SOURCE'&&admissible(c)&&c.validationVersion&&c.sourceIds?.length);
 const official=c=>['official','business','regulatory'].includes(c.sourceType),independent=list=>new Set(list.map(c=>c.independenceKey||c.sourceIds[0])).size;
 if(['RECENT_EVENT','NEWS'].includes(purpose)){const list=valid.filter(c=>c.type==='event');return list.some(corroborated)||list.some(official)||independent(list.filter(c=>c.reliablePublisher===true))>=2;}
 if(['PRODUCT_DISCOVERY','COMPANY_DISCOVERY','OFFICIAL_SOURCE_DISCOVERY'].includes(purpose))return valid.some(c=>c.type==='business'&&(official(c)||corroborated(c)));
 const list=valid.filter(c=>c.type==='transmission');return list.some(corroborated)||independent(list.filter(c=>c.technicalTier===1))>=2||list.some(official)&&independent(list)>=2;
}
export function strictDeepGate(candidate,event,claims){
 const byId=new Map(claims.map(c=>[c.id,c])),verified=id=>admissible(byId.get(id)),reasons=[];
 if(!candidate.checks?.canonicalIdentity||!candidate.checks?.listing)reasons.push('NO_CANONICAL_ASSET');
 if(!['ACTUAL_EVENT_VERIFIED','ACTUAL_EVENT_SUPPORTED'].includes(event.status)&&event.mode!=='CONDITIONAL')reasons.push('NO_VERIFIED_EVENT_OR_EXPLICIT_CONDITION');
 if(!validUserCondition(event.userCondition)&&claims.some(c=>c.evidencePolicy)&&!(event.claims||[]).some(c=>c.type==='event'&&admissible(c)))reasons.push('NO_SUPPORTED_EVENT');
 const paths=(candidate.paths||[]).filter(p=>verified(p.businessClaimId)&&(p.allBridgeClaimIds||[p.technicalClaimId]).every(verified));
 if(!claims.some(c=>c.type==='business'&&c.subject===candidate.asset.id&&admissible(c)))reasons.push('NO_OFFICIAL_PRODUCT_EVIDENCE');
 if(!paths.length)reasons.push('NO_TARGET_APPLICATION_EVIDENCE');
 return {passed:!reasons.length,paths:paths.map(p=>{
  const supporting=[...(event.claims||[]).filter(admissible),...[p.businessClaimId,...p.allBridgeClaimIds||[p.technicalClaimId]].map(id=>byId.get(id)).filter(Boolean)];
  const ids=[...new Set(supporting.flatMap(c=>c.sourceIds||[]))],official=[...new Set(supporting.filter(c=>c.status==='VERIFIED').flatMap(c=>c.sourceIds||[]))];
  const families=new Set(supporting.flatMap(c=>c.corroboration?.sourceFamilies||[c.independenceKey]).filter(Boolean));
  const quality=pathQuality(supporting.map(c=>c.status));
  return {...p,pathQuality:quality,evidenceLevel:quality==='VERIFIED_PATH'?'VERIFIED':quality==='STRONG_SUPPORTED_PATH'?'SUPPORTED':'INFERRED',sourceCount:ids.length,independentSourceCount:families.size,officialSourceCount:official.length,sourceIds:ids,evidenceLevels:supporting.map(c=>({claimId:c.id,type:c.type,level:c.status}))};
 }),reasons};
}
export class ResearchRouter {
 constructor(env,store,job,{adapters}={}){Object.assign(this,{env,store,job});this.adapters=adapters||{Brave:new BraveAdapter(env),Exa:new ExaAdapter(env),TavilySearch:new TavilySearchAdapter(env)};this.counts={};this.stageCounts={};this.ready=false;this.telemetry={};this.seen=new Map();}
 get available(){return !!this.adapters.Brave?.configured;}
 metrics(name){return this.telemetry[name]||=( {requests:0,cacheHits:0,resultCount:0,usedResultCount:0,latencyMs:0,errors:0,fallbackTriggered:0});}
 async note(stage,output){if(this.store)await researchStep(this.store,this.job.id,stage,'provider_router',{output});}
 markUsed(items){for(const x of items)for(const name of x.discoveredBy||[x.provider])this.metrics(name).usedResultCount++;}
 async search(input,{stage='discovery',fallback=false,claims=[]}={}){
  const purpose=input.purpose||purposeForStage(stage),route=providerRoute(purpose),request={...input,purpose};
  if(evidenceSufficient(purpose,claims)){await this.note(stage,{purpose,status:'EVIDENCE_STOP'});return {status:'EVIDENCE_STOP',items:[],ready:true};}
  const key='research:router:10.9:'+await hash(JSON.stringify([purpose,input.subject||'',input.scope||'',input.query,input.language,input.recency,input.domainHints,input.maxResults]));
  const cached=await this.store?.cache(key);if(!fallback&&cached&&!cached.stale&&cached.value.hash===await hash(JSON.stringify(cached.value.items))){this.ready=true;this.metrics(cached.value.provider).cacheHits++;return {...cached.value,ready:true,cached:true};}
  if(this.env.CATALYST_RESEARCH_SEARCH_CACHE_ONLY==='true')return {status:'CACHE_ONLY_MISS',ready:this.ready,items:[]};
  const choices=fallback?route.slice(1):route;
  for(const name of choices){const adapter=this.adapters[name],m=this.metrics(name);if(!adapter?.configured){await this.note(stage,{purpose,provider:name,status:'PROVIDER_KEY_MISSING'});continue;}
   const hard=(this.job.discoveryPolicy===beneficiaryPolicy.version?beneficiaryPolicy.providerLimits:rc.router.providerLimits)[name]||0,softKey=({Brave:'BRAVE_SEARCH_SOFT_LIMIT',Exa:'EXA_SEARCH_SOFT_LIMIT',TavilySearch:'TAVILY_CREDIT_SOFT_LIMIT'})[name],soft=Number(this.env[softKey]),limit=Number.isFinite(soft)&&soft>0?Math.min(hard,Math.floor(soft)):hard;
   const phase=stage==='technicalGap'?'technical':stage,stageLimit=this.env.CATALYST_RESEARCH_TOOLS?.promotionEnabled?({event:{Brave:2,Exa:2,TavilySearch:1},technical:{Brave:0,Exa:4,TavilySearch:1}})[phase]?.[name]:undefined;
   if(stageLimit!==undefined&&(this.stageCounts[phase+':'+name]||0)>=stageLimit){await this.note(stage,{purpose,provider:name,status:'STAGE_PROVIDER_BUDGET_EXHAUSTED'});continue;}
   if(m.requests>=limit){await this.note(stage,{purpose,provider:name,status:'PROVIDER_BUDGET_EXHAUSTED'});continue;}
   m.requests++;this.counts[name]=m.requests;this.stageCounts[phase+':'+name]=(this.stageCounts[phase+':'+name]||0)+1;const start=performance.now();if(fallback||name!==route[0])m.fallbackTriggered++;
   try{const r=await adapter.search(request);m.latencyMs+=performance.now()-start;if(!r.ready)continue;
    const items=dedupSearchItems(r.items);for(const item of items){const previous=this.seen.get(item.canonicalUrl);if(previous)item.discoveredBy=[...new Set([...previous.discoveredBy,...item.discoveredBy])];this.seen.set(item.canonicalUrl,item);}
    m.resultCount+=items.length;this.ready=true;await this.note(stage,{purpose,provider:name,httpStatus:r.httpStatus,resultCount:items.length,latencyMs:r.latencyMs,fallback:name!==route[0],endpoint:r.endpoint});
    if(this.store){await this.store.db.prepare('INSERT INTO catalyst_research_search_usage VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),this.job.id,name,input.query,items.length,1,null,'provider_plan_unknown',Math.round(r.latencyMs||0),'ok',new Date().toISOString()).run();await this.store.putCache(key,{provider:name,items,hash:await hash(JSON.stringify(items))},rc.ttls.search);}
    if(items.length)return {...r,items}; // Verify these documents before asking another provider.
   }catch(e){m.errors++;m.latencyMs+=performance.now()-start;await this.note(stage,{purpose,provider:name,status:'SEARCH_FAILED',httpStatus:e.httpStatus||null,reason:/^[A-Z_0-9]+$/.test(e.message)?e.message:'PROVIDER_FAILED'});}
  }return {status:this.available?'SEARCH_FAILED':'DISCOVERY_LIMITED_NO_BROAD_SEARCH',ready:this.ready,items:[]};
 }
}
