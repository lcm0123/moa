import {one,rows} from './store.mjs';
import {researchConfig as rc,researchKey,researchKinds,definiteScenario} from './research-config.mjs';
import {norm} from './core.mjs';
import {beneficiaryQuestion} from './query-policy.mjs';
export async function researchStep(store,id,stage,action,{provider=null,input={},output={},durationMs=0,toolCostUSD=null}={}){
 await store.db.prepare('INSERT INTO catalyst_research_steps(job_id,stage,action,provider,input,output,duration_ms,tool_cost_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,stage,action,provider,JSON.stringify(input),JSON.stringify(output),Math.round(durationMs),toolCostUSD,new Date().toISOString()).run();
}
export async function enqueueResearch(store,input,{now=Date.now()}={}){
 const query=norm(input.query);if(query.length<2||query.length<4&&!beneficiaryQuestion(query)||query.length>500||!researchKinds[input.market||'ALL']||!['normal','newIndustry','deep'].includes(input.mode||'normal'))throw Error('invalid_research_request');
 const market=input.market||'ALL',mode=input.mode||'normal',key=await researchKey(query,{market,mode,conditional:definiteScenario(query)});
 let shared=await one(store.db,"SELECT id,research_key,query,market_filter,mode,status,stage,plan,result,error_code,created_at,updated_at,lease_until,attempts,version FROM catalyst_research_jobs WHERE research_key=? AND (status IN ('queued','running') OR (status IN ('complete','limited') AND updated_at>?)) ORDER BY created_at DESC LIMIT 1",key,new Date(now-rc.ttls.result).toISOString());
 if(shared&&!input.force)return {...shared,shared:true};
 // A force refresh still cannot fork an already active normalized job.
 if(shared&&['queued','running'].includes(shared.status))return {...shared,shared:true};
 if((await one(store.db,"SELECT count(*) n FROM catalyst_research_jobs WHERE status IN ('queued','running')")).n>=12)throw Error('research_queue_full');
 const id=crypto.randomUUID(),at=new Date(now).toISOString();
 await store.db.prepare("INSERT OR IGNORE INTO catalyst_research_jobs VALUES(?,?,?,?,?,'queued','queued',NULL,NULL,NULL,?,?,0,0,?)").bind(id,key,query,market,mode,at,at,rc.version).run();
 shared=await one(store.db,"SELECT id,research_key,query,market_filter,mode,status,stage,plan,result,error_code,created_at,updated_at,lease_until,attempts,version FROM catalyst_research_jobs WHERE research_key=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",key);return shared;
}
export async function readResearch(store,id){
 const job=await one(store.db,'SELECT id,research_key,query,market_filter,mode,status,stage,plan,result,error_code,created_at,updated_at,lease_until,attempts,version FROM catalyst_research_jobs WHERE id=?',id);if(!job)return null;
 return {...job,plan:job.plan?JSON.parse(job.plan):null,result:job.result?JSON.parse(job.result):null,
  steps:(await rows(store.db,'SELECT id,job_id,stage,action,provider,input,output,duration_ms,tool_cost_usd,created_at FROM catalyst_research_steps WHERE job_id=? ORDER BY id LIMIT 600',id)).map(r=>({...r,input:JSON.parse(r.input),output:JSON.parse(r.output)})),
  candidates:(await rows(store.db,'SELECT job_id,asset_id,status,origins,payload,updated_at FROM catalyst_research_candidates WHERE job_id=? ORDER BY asset_id LIMIT 100',id)).map(r=>({...r,origins:JSON.parse(r.origins),payload:JSON.parse(r.payload)})),
  usage:await one(store.db,'SELECT count(*) calls,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,COALESCE(SUM(total_tokens),0) totalTokens FROM catalyst_usage WHERE run_id=?',id),
  searchUsage:await rows(store.db,'SELECT provider,SUM(tool_calls) toolCalls,SUM(estimated_tool_cost_usd) estimatedToolCostUSD,COUNT(*) requests FROM catalyst_research_search_usage WHERE job_id=? GROUP BY provider',id)};
}
export async function researchMetrics(store,id){
 return {
  usage:await one(store.db,'SELECT count(*) calls,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,COALESCE(SUM(total_tokens),0) totalTokens FROM catalyst_usage WHERE run_id=?',id),
  searchUsage:await rows(store.db,'SELECT provider,SUM(tool_calls) toolCalls,COUNT(*) requests FROM catalyst_research_search_usage WHERE job_id=? GROUP BY provider',id),
  steps:await rows(store.db,'SELECT stage,SUM(duration_ms) duration_ms FROM catalyst_research_steps WHERE job_id=? GROUP BY stage',id)
 };
}
export async function saveCandidate(store,jobId,candidate){
 await store.db.prepare('INSERT INTO catalyst_research_candidates VALUES(?,?,?,?,?,?) ON CONFLICT(job_id,asset_id) DO UPDATE SET status=excluded.status,origins=excluded.origins,payload=excluded.payload,updated_at=excluded.updated_at').bind(jobId,candidate.asset.id,candidate.status,JSON.stringify(candidate.origins),JSON.stringify(candidate),new Date().toISOString()).run();
}
export async function saveResearchSource(store,jobId,stage,source,assetId=''){
 await store.db.prepare('INSERT OR REPLACE INTO catalyst_research_evidence VALUES(?,?,?,?,?)').bind(jobId,source.id,stage,assetId,JSON.stringify({url:source.url,publishedAt:source.publishedAt,observedAt:source.observedAt,authority:source.authority||null,independenceKey:source.independenceKey})).run();
}
export async function saveResearchClaim(store,jobId,stage,claim,details={}){
 if(store.securityVersion)claim.securityVersion=store.securityVersion;
 await store.saveClaim(claim,jobId);
 await store.db.prepare('INSERT OR REPLACE INTO catalyst_research_claims VALUES(?,?,?,?,?)').bind(jobId,claim.id,stage,details.assetId||'',JSON.stringify(details)).run();
}
