import {DatabaseSync} from 'node:sqlite';
import diagnostics from 'node:diagnostics_channel';
import os from 'node:os';
import {d1Adapter} from '../server/sqlite-adapter.mjs';
import {CatalystStore} from '../server/catalyst/store.mjs';
import {runProfileBatch,profilePolicy} from '../server/catalyst/profile-queue.mjs';
import {collectBusinessProfile} from '../server/catalyst/business-profile-collector.mjs';
import {deliverySourceAllowed} from './catalyst-delivery-security.mjs';
import {controlledResearch,controlledContext,secureTransportActive} from './catalyst-controlled-context.mjs';
import {installControlledFetch} from './catalyst-controlled-api.mjs';
import {createCatalystTools} from './catalyst-tools.mjs';
import {createResearchTools} from './catalyst-research-tools.mjs';
import {profileFilingSources,storedProfileFilingSources} from './profile-filings.mjs';
import {profileWorkerPreview} from './profile-batch-dispatch.mjs';
try{process.loadEnvFile('.env');}catch{}
const [runId,token]=process.argv.slice(2);if(!/^[a-f0-9-]{36}$/.test(runId||'')||!/^[a-f0-9-]{36}$/.test(token||''))throw Error('EXPLICIT_BATCH_REQUIRED');
const sqlite=new DatabaseSync(process.env.MOA_DB_FILE||'.sites-runtime/search-events.sqlite'),store=new CatalystStore(d1Adapter(sqlite,{statementCacheSize:8})),env={...process.env,DB:store.db};sqlite.exec('PRAGMA busy_timeout=10000; PRAGMA cache_size=-2048');
env.CATALYST_SOURCE_ALLOWED=s=>deliverySourceAllowed(env,s);env.RESEARCH_FREE_MEMORY=()=>os.freemem();
diagnostics.channel('http.client.request.start').subscribe(({request})=>{if(!controlledContext()?.active||!secureTransportActive()){request.destroy();process.exitCode=20;}});
try{
 const lease=await store.runtime('research-worker-lease');env.LOCAL_PREVIEW=profileWorkerPreview(lease,runId,token);
 const result=await runProfileBatch(store,runId,{token,sourceAllowed:env.CATALYST_SOURCE_ALLOWED,collect:async(asset,{cacheOnly,job})=>{
  let restore;
  try{
   const limits={Brave:0,Exa:0,TavilySearch:0,TavilyExtract:0,GoogleNews:0,Planner:0,Review:0,DART:cacheOnly?0:6,SEC:cacheOnly?0:3,Official:cacheOnly?0:6,Company:cacheOnly?0:3,PDF:0,Market:0,Listing:0};
   const r=await controlledResearch(env,job.id,async()=>{
    restore=installControlledFetch(env);
    const tools=createResearchTools(env,store,createCatalystTools(env));
    try{
     const replayed=await storedProfileFilingSources(env,store,asset,job);
     for(const source of replayed){if(!env.CATALYST_SOURCE_ALLOWED(source))throw Error('SECURITY_BLOCKED_SOURCE');await store.addSource(source);}
     const result=await collectBusinessProfile(env,store,asset,{cacheOnly,job,aiLimit:0,forceFetch:!cacheOnly,fetchSources:a=>tools.withStage('deep',a.id,()=>profileFilingSources(env,store,tools,a,job))});
     return {...result,replayedSections:replayed.length};
    }catch(e){return {error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'FETCH_FAILED'};}
   },{limits,documentLimits:{event:0,probe:2,technical:0,deepPerCandidate:2,total:2}});
   return {...r.result,requests:Object.values(r.audit.counts).reduce((n,v)=>n+v,0),providerRequests:r.audit.counts,parserMetrics:r.audit.events.filter(e=>e.action==='document_complete').map(e=>({provider:e.provider,peakRssMB:e.pythonPeakMB??null,latencyMs:Math.round(e.latencyMs||0)})),diagnostics:r.audit.events.filter(e=>/api_complete|api_failed|api_redirect_blocked|api_connection_failed/.test(e.action)).map(e=>({provider:e.provider,action:e.action,status:e.status??null,code:e.code||e.networkCode||null,requested:!!e.requested,latencyMs:Math.round(e.latencyMs||0)}))};
  }finally{restore?.();}
 }});const peakRssMB=process.resourceUsage().maxRSS/1024;
 sqlite.prepare("UPDATE business_profile_runs SET payload=json_set(payload,'$.workerPeakRssMB',?) WHERE id=?").run(peakRssMB,runId);
 console.log(JSON.stringify({...result,peakRssMB}));
}catch{process.exitCode=1;console.log('PROFILE_BATCH_FAILED');}finally{sqlite.close();}
