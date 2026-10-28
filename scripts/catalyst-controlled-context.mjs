import {AsyncLocalStorage} from 'node:async_hooks';

// Process-local capability, never enabled by an environment variable or HTTP request.
const context=new AsyncLocalStorage();
const transportContext=new AsyncLocalStorage();
export const controlledTransport=run=>transportContext.run(true,run);
export const secureTransportActive=()=>transportContext.getStore()===true;
export const controlledContext=()=>context.getStore();
export async function controlledResearch(env,jobId,run,{limits:overrides=null,documentLimits=null}={}){
 if(env.CATALYST_ENABLED!=='true'||env.CATALYST_RESEARCH_WORKER_ENABLED!=='false'||env.CATALYST_METADATA_WORKER_ENABLED!=='false'||env.ENABLE_OPENAI_WEB_SEARCH!=='false'||!jobId)throw Error('CONTROLLED_FLAGS_REQUIRED');
 const state={jobId,active:true,counts:{},events:[],failures:[],limits:overrides?{...limits,...overrides}:limits,documentLimits,documentCounts:{},startedAt:new Date().toISOString()};
 try{return await context.run(state,async()=>({result:await run(state),audit:state}));}finally{state.active=false;}
}
const limits={Brave:8,Exa:6,TavilySearch:2,TavilyExtract:2,GoogleNews:4,Official:10,Company:8,DART:6,SEC:2,Market:2,PDF:2,Planner:1,Review:1};
const documentContext=new AsyncLocalStorage();
export const controlledDocumentScope=(stage,assetId,run)=>documentContext.run({stage,assetId},run);
export function controlledDocumentAvailable(stage,assetId='unbound'){
 const s=controlledContext();if(!s?.documentLimits)return true;
 if(s.documentLimits.eventOfficialReserved&&['event','eventOfficial'].includes(stage)){
  const used=(s.documentCounts.event||0)+(s.documentCounts.eventOfficial||0);
  if(used>=s.documentLimits.event)return false;
  if(stage==='event'&&(s.documentCounts.event||0)>=s.documentLimits.event-s.documentLimits.eventOfficialReserved)return false;
  return (s.documentCounts.total||0)<s.documentLimits.total;
 }
 const bucket=stage==='deep'?'deep:'+assetId:stage,limit=stage==='deep'?s.documentLimits.deepPerCandidate:s.documentLimits[stage];
 return !!limit&&(s.documentCounts.total||0)<s.documentLimits.total&&(s.documentCounts[bucket]||0)<limit;
}
export function controlledDocumentBudget(){
 const s=controlledContext();if(!s?.documentLimits)return;
 const {stage='probe',assetId='unbound'}=documentContext.getStore()||{},bucket=stage==='deep'?'deep:'+assetId:stage;
 const limit=stage==='deep'?s.documentLimits.deepPerCandidate:stage==='eventOfficial'?s.documentLimits.event:s.documentLimits[stage];
 if(!limit||!controlledDocumentAvailable(stage,assetId))throw Error('DOCUMENT_STAGE_BUDGET');
 s.documentCounts.total=(s.documentCounts.total||0)+1;s.documentCounts[bucket]=(s.documentCounts[bucket]||0)+1;
 controlledEvent({action:'document_budget',stage,bucket,count:s.documentCounts[bucket]});
}
export function controlledBudget(provider){
 const state=controlledContext();if(!state)return;
 if(!state.active)throw Error('CONTROLLED_JOB_FINISHED');
 if(!(provider in state.limits))throw Error('CONTROLLED_PROVIDER_FORBIDDEN');
 if((state.counts[provider]||0)>=state.limits[provider]){controlledEvent({provider,action:'budget_block'});throw Error('CONTROLLED_BUDGET_LIMIT');}
 state.counts[provider]=(state.counts[provider]||0)+1;
}
export function controlledEvent(value){const s=controlledContext();if(s){const event={at:new Date().toISOString(),rssMB:process.memoryUsage().rss/1048576,...value};s.events.push(event);s.onEvent?.(event);}}
