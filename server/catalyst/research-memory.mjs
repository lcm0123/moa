import {researchStep} from './research-store.mjs';
export async function memorySample(env,store,job,label,extra={}){
 if(typeof process==='undefined'||!process.memoryUsage)return;
 if(env.CATALYST_RESEARCH_PROFILE_GC==='true')globalThis.gc?.();
 await researchStep(store,job.id,'memory',label,{output:{...process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024,systemFree:env.RESEARCH_FREE_MEMORY?.()??null,...extra}});
}
export function freeMemoryAllowed(env,freeBytes){const mb=Number(env.CATALYST_MIN_SYSTEM_FREE_MB);return !Number.isFinite(mb)||mb<=0||freeBytes>=mb*1048576;}
export function workerJobLimit(env){return Math.max(1,Math.min(10,Math.floor(Number(env.CATALYST_RESEARCH_MAX_JOBS_PER_PROCESS)||1)));}

export async function runWorkerJobs(env,run){
 let completed=0;const limit=workerJobLimit(env);
 while(completed<limit){const result=await run(completed);if(!result)break;completed++;if(result.status==='SYSTEM_MEMORY_DEFERRED')break;}
 return {completed,limit,recycle:true};
}
