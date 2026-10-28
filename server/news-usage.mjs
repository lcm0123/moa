import {one,rows} from './catalyst/store.mjs';
import {budgetStatus} from './catalyst/ai.mjs';
import {articleRelationOwner} from './news-live-policy.mjs';

// Standard token prices, checked 2026-10-11. Unknown models have no cost estimate.
export function newsTokenCost(row){
 if(!/^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(row.model)||row.result?.endsWith('_usage_unknown'))return null;
 const cached=Math.min(row.input_tokens,row.cached_input_tokens);
 return ((row.input_tokens-cached)*.75+cached*.075+row.output_tokens*4.5)/1e6;
}
export async function recordNewsRequest(db,provider,status,now=Date.now()){
 const day=new Date(now+9*3600000).toISOString().slice(0,10),key='news-requests:'+day+':'+provider,at=new Date(now).toISOString();
 await db.prepare('INSERT OR IGNORE INTO catalyst_runtime VALUES(?,?,?)').bind(key,'{"requests":0,"failures":0}',at).run();
 await db.prepare("UPDATE catalyst_runtime SET value=json_set(value,'$.requests',json_extract(value,'$.requests')+1,'$.failures',json_extract(value,'$.failures')+?,'$.lastStatus',?),updated_at=? WHERE key=?").bind(status>=200&&status<300?0:1,status||0,at,key).run();
}
export async function newsUsage(db,env,now=Date.now()){
 const day=new Date(now+9*3600000).toISOString().slice(0,10),since=new Date(Date.parse(day+'T00:00:00+09:00')).toISOString(),until=new Date(Date.parse(since)+86400000).toISOString();
 const reservations=await rows(db,`SELECT r.*,u.model,u.input_tokens,u.cached_input_tokens,u.output_tokens,u.total_tokens,u.result,u.feature,u.latency_ms,u.http_status FROM catalyst_reservations r LEFT JOIN catalyst_usage u ON u.id=r.id WHERE r.created_at>=? AND r.created_at<? AND (r.run_id LIKE 'news-brief:%' OR EXISTS(SELECT 1 FROM news_company_versions v WHERE r.run_id=v.job_id||':'||v.version))`,Date.parse(since),Date.parse(until));
 const ai={calls:reservations.length,settledTokens:0,reservedTokens:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,unitemizedCalls:0,unitemizedTokens:0,pendingCalls:0,pricedCalls:0,estimatedUsd:0};
 const features={};
 for(const r of reservations){
  if(r.state==='settled')ai.settledTokens+=r.amount;else ai.reservedTokens+=r.amount;
  const feature=r.feature|| (r.run_id.startsWith('news-brief:')?'news_briefs_legacy':'news_analysis_legacy');
  const f=features[feature]??={calls:0,settledTokens:0};f.calls++;if(r.state==='settled')f.settledTokens+=r.amount;
  if(!r.model&&r.state==='reserved'){ai.pendingCalls++;continue;}
  if(!r.model||r.result?.endsWith('_usage_unknown')){ai.unitemizedCalls++;if(r.state==='settled')ai.unitemizedTokens+=r.amount;continue;}
  ai.inputTokens+=r.input_tokens;ai.cachedInputTokens+=r.cached_input_tokens;ai.outputTokens+=r.output_tokens;const cost=newsTokenCost(r);if(cost!==null){ai.pricedCalls++;ai.estimatedUsd+=cost;}
 }
 const jobs=await rows(db,'SELECT owner,status,result FROM news_company_jobs WHERE created_at>=? AND created_at<?',since,until),statuses={};let searches=0,completedWithDiagnostics=0,rssMaxMB=null;
 for(const j of jobs){statuses[j.status]=(statuses[j.status]||0)+1;const d=JSON.parse(j.result||'null')?.diagnostics;if(d){searches+=d.searches||0;completedWithDiagnostics++;if(d.rssMB)rssMaxMB=Math.max(rssMaxMB||0,d.rssMB);}}
 const providers=(await rows(db,"SELECT key,value FROM catalyst_runtime WHERE key LIKE ?",'news-requests:'+day+':%')).map(r=>({provider:r.key.split(':').slice(2).join(':'),...JSON.parse(r.value)}));
 const queue=await one(db,"SELECT SUM(status='QUEUED') pending,SUM(status='RUNNING') running FROM news_company_jobs WHERE owner=?",articleRelationOwner);
 return {day,timeZone:'Asia/Seoul',ai,features,jobs:{total:jobs.length,automatic:jobs.filter(j=>j.owner===articleRelationOwner).length,statuses,completedWithDiagnostics,rssMaxMB},providers,searches:{completedJobRequests:searches,estimatedStandardUsd:searches*.005,coverage:'완료 결과의 검색 횟수 · 중단된 작업은 제외'},queue:{pending:queue.pending||0,running:queue.running||0},budget:await budgetStatus(db,env,now),pricing:{model:'gpt-5.4-mini',inputPerMillion:.75,cachedPerMillion:.075,outputPerMillion:4.5,checkedAt:'2026-10-11',source:'https://developers.openai.com/api/docs/models/gpt-5.4-mini',searchSource:'https://brave.com/search/api/'},scope:'이 앱 뉴스 기능의 한국시간 일별 집계 · 비용은 토큰 세부 기록이 있는 호출만 계산 · 제공자 청구액·크레딧·세금 제외'};
}
