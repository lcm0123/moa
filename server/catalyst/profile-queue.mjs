import policy from '../../config/business-profile.json' with {type:'json'};
import {rows,one} from './store.mjs';
import {hash} from './core.mjs';
import {issuerKey,profileDimensions,projectBusinessProfile} from './business-profile.mjs';
import {profileProviderFailure,recordProfileProviderFailure,profileProviderState} from './profile-provider-state.mjs';
export {policy as profilePolicy};
const nowISO=()=>new Date().toISOString();
export function profileEligibility(asset){
 if(!['KR_STOCK','US_STOCK'].includes(asset.kind))return {state:'EXCLUDED',reason:asset.kind==='CRYPTO'?'TOKEN_PROFILE':'UNSUPPORTED_MARKET'};
 if(/ETF|ETN|FUND|WARRANT|RIGHT|UNIT/.test(String(asset.instrumentType||asset.securityType||''))||/\b(?:ETF|ETN|warrants?|units?|fund)\b/i.test(asset.name))return {state:'EXCLUDED',reason:'NON_OPERATING_INSTRUMENT'};
 if(asset.active===false)return {state:'EXCLUDED',reason:'INACTIVE_RETAINED'};
 if(!issuerKey(asset)||!/^[0-9]{1,10}$/.test(asset.issuerId)||asset.market==='KR'&&!/^\d{8}$/.test(asset.issuerId))return {state:'IDENTITY_HOLD',reason:'ISSUER_UNRESOLVED'};
 return {state:'ELIGIBLE',issuer:issuerKey(asset)};
}
export async function registerProfileUniverse(store,{reportDate=new Date().toISOString().slice(0,10),market=null,reuseExisting=false,latestOnly=false}={}){
 if(market!==null&&!['KR','US'].includes(market))throw Error('INVALID_MARKET');
 let cursor='',instruments=0,eligible=0,duplicates=0,identityHold=0,registered=0;const excluded={};
 // Keyset pages; do not load the entire company universe or document bodies.
 while(true){const page=await rows(store.db,'SELECT id FROM catalyst_assets WHERE id>? AND (? IS NULL OR kind=?) ORDER BY id LIMIT ?',cursor,market,market+'_STOCK',policy.pageSize);if(!page.length)break;
  for(const row of page){cursor=row.id;instruments++;const asset=await store.asset(row.id),e=profileEligibility(asset);
   if(e.state==='IDENTITY_HOLD'){identityHold++;continue;}if(e.state==='EXCLUDED'){excluded[e.reason]=(excluded[e.reason]||0)+1;continue;}eligible++;
   const exists=await one(store.db,'SELECT id FROM business_profile_jobs WHERE issuer=? AND (?=1 OR period_key=?) LIMIT 1',e.issuer,reuseExisting?1:0,reportDate);if(exists){duplicates++;continue;}
   for(const [i,purpose]of (latestOnly?['LATEST_PROFILE']:['LATEST_PROFILE','REVENUE_STRUCTURE','COMPARATIVE_PERIODS','HISTORY']).entries()){
    const id=await hash([e.issuer,reportDate,purpose,policy.version].join('|'));
    const result=await store.db.prepare('INSERT OR IGNORE INTO business_profile_jobs(id,issuer,asset_id,period_key,purpose,version,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,e.issuer,asset.id,reportDate,purpose,policy.version,i+1,nowISO(),nowISO()).run();if(i===0)registered+=result.meta.changes;
   }
  }
 }
 const companies=(await one(store.db,'SELECT COUNT(DISTINCT j.issuer) n FROM business_profile_jobs j JOIN catalyst_assets a ON a.id=j.asset_id WHERE (? IS NULL OR a.kind=?)',market,market+'_STOCK')).n;
 const result={asOf:reportDate,market,masterInstruments:instruments,eligibleInstruments:eligible,targetCompanies:companies,duplicateLinks:Math.max(0,eligible-companies),alreadyRegistered:duplicates,identityHold,excluded,newCompanies:registered,scope:'기존 기업 Master와 DART 종목코드 매핑 기준. 매핑 실패는 별도로 보류합니다.'};await store.runtime('business-profile-universe'+(market?':'+market:''),result);return result;
}
export async function createProfileRun(store,{mode='CACHE_ONLY',companyLimit=6,requestLimit=0,targetJobId=null,profileKey=null}={}){
 if(targetJobId!==null&&!/^[a-f0-9]{64}$/.test(targetJobId)||profileKey!==null&&!/^business-profile-request:(KR|US):\d+$/.test(profileKey))throw Error('INVALID_BATCH_TARGET');
 if(!['CACHE_ONLY','OFFICIAL'].includes(mode)||!Number.isInteger(companyLimit)||companyLimit<1||companyLimit>policy.maxBatchCompanies||!Number.isInteger(requestLimit)||requestLimit<0||requestLimit>policy.maxBatchRequests||mode==='OFFICIAL'&&requestLimit<policy.requestReservationPerCompany)throw Error('INVALID_BATCH_BUDGET');
 const id=crypto.randomUUID();await store.db.prepare('INSERT INTO business_profile_runs(id,state,mode,company_limit,request_limit,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?,?)').bind(id,'PAUSED',mode,companyLimit,requestLimit,nowISO(),nowISO(),JSON.stringify({version:policy.version,historyQuarters:policy.historyQuarters,aiCalls:0,searchCalls:0,targetJobId,profileKey,scope:'이 앱 내 호출 예약; 공급사 계정의 외부 프로젝트 사용량은 알 수 없음'})).run();return {id,state:'PAUSED'};
}
export async function reserveProfileWork(store,run,job){
 const n=run.mode==='CACHE_ONLY'?0:policy.requestReservationPerCompany,id=crypto.randomUUID();
 const r=await store.db.prepare("UPDATE business_profile_runs SET reserved_requests=reserved_requests+? WHERE id=? AND state='RUNNING' AND reserved_requests+used_requests+?<=request_limit AND (?=0 OR (SELECT COALESCE(SUM(CASE WHEN state='SETTLED' THEN actual ELSE reserved END),0) FROM business_profile_reservations WHERE created_at>=?)+?<=?) RETURNING id").bind(n,run.id,n,n,nowISO().slice(0,10),n,policy.dailyProfileRequestLimit).all();if(!r.results.length)return null;
 await store.db.prepare('INSERT INTO business_profile_reservations VALUES(?,?,?,?,?,?,?)').bind(id,run.id,job.id,n,null,'RESERVED',nowISO()).run();return {id,amount:n};
}
export async function settleProfileWork(store,reservation,actual){
 if(!Number.isInteger(actual)||actual<0||actual>reservation.amount)throw Error('INVALID_USAGE_SETTLEMENT');
 await store.db.batch([
  store.db.prepare("UPDATE business_profile_runs SET reserved_requests=reserved_requests-?,used_requests=used_requests+? WHERE id=(SELECT run_id FROM business_profile_reservations WHERE id=? AND state='RESERVED')").bind(reservation.amount,actual,reservation.id),
  store.db.prepare("UPDATE business_profile_reservations SET actual=?,state='SETTLED' WHERE id=? AND state='RESERVED'").bind(actual,reservation.id)
 ]);
}
export async function updateProfileCoverage(store,asset,profile,reason=null){
 const at=nowISO(),issuer=issuerKey(asset);
 const fields=[['DESCRIPTION',profile.descriptions.length,profile.descriptions.map(d=>d.url)],...profileDimensions.map(k=>[k,profile.groups[k].datasets.reduce((n,d)=>n+d.items.filter(x=>x.metric!=='NON_DISCLOSURE').length,0),profile.groups[k].datasets.map(d=>d.sourceUrl)]),['SINGLE_QUARTER',profile.calculations.quarters.length,[]],['TTM',profile.calculations.ttm.length,[]]];
 for(const [dimension,count,sources]of fields){const g=profile.groups[dimension],state=reason==='FETCH_FAILED'?'FETCH_FAILED':count?'AVAILABLE':g?.status==='NOT_DISCLOSED'?'NOT_DISCLOSED':profile.request?.completedAt?'EXTRACTION_UNRESOLVED':'NOT_COLLECTED';
  await store.db.prepare(`INSERT INTO business_profile_coverage VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(issuer,dimension,period_key) DO UPDATE SET state=excluded.state,observation_count=excluded.observation_count,source_ids=excluded.source_ids,last_success=COALESCE(excluded.last_success,last_success),updated_at=excluded.updated_at,reason=excluded.reason`).bind(issuer,dimension,'LATEST',state,count,JSON.stringify([...new Set(sources)]),count&&!reason?at:null,at,reason).run();
  for(const ds of g?.datasets||[]){const key=[ds.period.start,ds.period.end,ds.period.type,ds.scope].join('|');await store.db.prepare("INSERT INTO business_profile_coverage VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(issuer,dimension,period_key) DO UPDATE SET observation_count=excluded.observation_count,source_ids=excluded.source_ids,updated_at=excluded.updated_at").bind(issuer,dimension,key,ds.items.every(r=>r.metric==='NON_DISCLOSURE')?'NOT_DISCLOSED':'PARTIAL',ds.items.length,JSON.stringify([ds.sourceUrl]),at,at,null).run();}
 }
}
export async function claimProfileJob(store,token,{now=Date.now(),targetJobId=null}={}){
 await store.db.prepare("UPDATE business_profile_jobs SET state=CASE WHEN attempts>=? THEN 'MANUAL_REVIEW' ELSE 'RETRY_WAIT' END,error_code='INTERRUPTED',lease_token=NULL,lease_until=0 WHERE state='RUNNING' AND lease_until<? AND (? IS NULL OR id=?)").bind(policy.maxAttempts,now,targetJobId,targetJobId).run();
 const job=await one(store.db,"SELECT * FROM business_profile_jobs WHERE state IN ('QUEUED','RETRY_WAIT','BUDGET_WAIT') AND attempts<? AND available_at<=? AND (? IS NULL OR id=?) ORDER BY phase,(priority + (CAST(strftime('%s','now') AS INTEGER)-CAST(strftime('%s',created_at) AS INTEGER))/86400) DESC,created_at,id LIMIT 1",policy.maxAttempts,now,targetJobId,targetJobId);if(!job)return null;
 const got=await store.db.prepare("UPDATE business_profile_jobs SET state='RUNNING',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND state IN ('QUEUED','RETRY_WAIT','BUDGET_WAIT') RETURNING *").bind(token,now+policy.leaseMs,nowISO(),job.id).all();return got.results[0]||null;
}
export async function retryProfileJob(store,id){
 const job=await one(store.db,'SELECT * FROM business_profile_jobs WHERE id=?',id);
 if(!job||!['MANUAL_REVIEW','RETRY_WAIT','BUDGET_WAIT','PARTIAL'].includes(job.state)||/SECURITY|BLOCKED_HASH|BLOCKED_URL/.test(job.error_code||''))throw Error('JOB_RETRY_NOT_ALLOWED');
 await store.db.prepare("UPDATE business_profile_jobs SET state='QUEUED',attempts=0,available_at=0,error_code=NULL,updated_at=? WHERE id=? AND state<>'RUNNING'").bind(nowISO(),id).run();
 return {state:'QUEUED',message:'재시도 대기열에 등록했습니다. 실행 중인 배치가 없으면 자동으로 수집하지 않습니다.'};
}
export async function runProfileBatch(store,runId,{collect,sourceAllowed,token=crypto.randomUUID(),now=Date.now}={}){
 const initial=await one(store.db,'SELECT * FROM business_profile_runs WHERE id=?',runId);if(!initial||initial.state!=='RUNNING')throw Error('EXPLICIT_START_REQUIRED');
 const start=performance.now();let done=0;
 while(done<initial.company_limit){
  const run=await one(store.db,'SELECT * FROM business_profile_runs WHERE id=?',runId);if(run.state!=='RUNNING')break;
  const job=await claimProfileJob(store,token,{now:now(),targetJobId:JSON.parse(initial.payload).targetJobId||null});if(!job)break;
  const jobAsset=await store.asset(job.asset_id),provider=run.mode==='OFFICIAL'?await profileProviderState(store,jobAsset?.market,now()):null;
  if(provider?.retryBlocked){
   await store.db.prepare("UPDATE business_profile_jobs SET state='RETRY_WAIT',attempts=MAX(0,attempts-1),error_code=?,available_at=?,lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?").bind(provider.code,Date.parse(provider.retryAfter),job.id,token).run();
   await store.db.prepare("UPDATE business_profile_runs SET payload=json_set(payload,'$.providerHold',?) WHERE id=?").bind(provider.code,runId).run();break;
  }
  const reservation=await reserveProfileWork(store,run,job);if(!reservation){await store.db.prepare("UPDATE business_profile_jobs SET state='BUDGET_WAIT',attempts=attempts-1,lease_until=0,lease_token=NULL WHERE id=?").bind(job.id).run();await store.db.prepare("UPDATE business_profile_runs SET state='BUDGET_WAIT' WHERE id=?").bind(runId).run();break;}
  let state='PARTIAL',result={},error=null,usageKnown=false;
  try{
   const asset=await store.asset(job.asset_id);if(profileEligibility(asset).state!=='ELIGIBLE')throw Error('IDENTITY_HOLD');
   result=await collect(asset,{cacheOnly:run.mode==='CACHE_ONLY',job,requestLimit:reservation.amount});usageKnown=Number.isInteger(result.requests);if(result.error)throw Error(result.error);
   const profile=await projectBusinessProfile(store,asset,sourceAllowed);await updateProfileCoverage(store,asset,profile);
   state=result.sources?'PARTIAL':'MANUAL_REVIEW';
   if(profile.descriptions.length&&Object.values(profile.groups).every(g=>g.datasets.length||g.status==='NOT_DISCLOSED'))state='COMPLETE';
   result={...result,description:profile.descriptions.length,observations:Object.values(profile.groups).reduce((n,g)=>n+g.datasets.reduce((m,d)=>m+d.items.length,0),0),quarter:profile.calculations.quarters.length,ttm:profile.calculations.ttm.length};
  }catch(e){error=/^[A-Z_0-9]+$/.test(e.message)?e.message:'FETCH_FAILED';state=/SECURITY_BLOCK|BLOCKED_HASH|BLOCKED_URL/.test(error)?'SECURITY_BLOCKED':/BUDGET/.test(error)?'BUDGET_WAIT':/403|ACCESS_DENIED|IDENTITY|EXTRACTION|ARCHIVE_REQUIRED/.test(error)?'MANUAL_REVIEW':job.attempts>=policy.maxAttempts?'MANUAL_REVIEW':'RETRY_WAIT';
   const asset=await store.asset(job.asset_id);if(asset&&sourceAllowed){const saved=await projectBusinessProfile(store,asset,sourceAllowed);await updateProfileCoverage(store,asset,saved,'FETCH_FAILED');}
  }
  // Uncertain request usage keeps the reservation, including crashes and timeouts.
  if(usageKnown)await settleProfileWork(store,reservation,result.requests);else if(run.mode==='CACHE_ONLY')await settleProfileWork(store,reservation,0);
  const providerFailure=run.mode==='OFFICIAL'&&profileProviderFailure(error,jobAsset?.market)?await recordProfileProviderFailure(store,jobAsset.market,error,now()):null;
  if(providerFailure)state='RETRY_WAIT';
  await store.db.prepare('UPDATE business_profile_jobs SET state=?,result=?,error_code=?,checkpoint=?,lease_until=0,lease_token=NULL,available_at=?,updated_at=?,attempts=MAX(0,attempts-?) WHERE id=? AND lease_token=?').bind(state,JSON.stringify(result),error,JSON.stringify({...JSON.parse(job.checkpoint||'{}'),phase:job.phase,completedAt:nowISO()}),providerFailure?Date.parse(providerFailure.retryAfter):state==='RETRY_WAIT'?now()+60000*job.attempts:0,nowISO(),providerFailure?1:0,job.id,token).run();done++;
  await store.db.prepare('UPDATE business_profile_runs SET processed=processed+1,updated_at=? WHERE id=?').bind(nowISO(),runId).run();
  if(providerFailure){await store.db.prepare("UPDATE business_profile_runs SET payload=json_set(payload,'$.providerHold',?) WHERE id=?").bind(error,runId).run();break;}
 }
 await store.db.prepare("UPDATE business_profile_runs SET state=CASE WHEN state='RUNNING' THEN 'PAUSED' ELSE state END,payload=json_set(payload,'$.lastBatchMs',?,'$.peakRssMB',?),updated_at=? WHERE id=?").bind(Math.round(performance.now()-start),globalThis.process?.resourceUsage?.().maxRSS/1024||null,nowISO(),runId).run();return {processed:done,elapsedMs:Math.round(performance.now()-start)};
}
export async function profileProgress(store,{offset=0,limit=30}={}){
 const universe=await store.runtime('business-profile-universe'),states=await rows(store.db,'SELECT state,COUNT(*) count FROM business_profile_jobs GROUP BY state'),coverage=await rows(store.db,"SELECT dimension,state,COUNT(*) companies,SUM(observation_count) observations FROM business_profile_coverage WHERE period_key='LATEST' GROUP BY dimension,state");
 const requiredCoverage=await rows(store.db,`WITH per_issuer AS (
 SELECT issuer,MAX(CASE WHEN dimension='PRODUCT' AND state='AVAILABLE' THEN 1 ELSE 0 END) products,
 MAX(CASE WHEN dimension='DOMESTIC_EXPORT' AND state='AVAILABLE' THEN 1 ELSE 0 END) exports
 FROM business_profile_coverage WHERE period_key='LATEST' GROUP BY issuer), targets AS (
 SELECT DISTINCT issuer FROM business_profile_jobs WHERE purpose='LATEST_PROFILE')
 SELECT substr(t.issuer,1,2) market,COUNT(*) targetCompanies,SUM(COALESCE(p.products,0)) productCompanies,
 SUM(COALESCE(p.exports,0)) exportCompanies,SUM(CASE WHEN p.products=1 AND p.exports=1 THEN 1 ELSE 0 END) bothCompanies,
 SUM(CASE WHEN p.issuer IS NULL THEN 1 ELSE 0 END) unprocessedCompanies
 FROM targets t LEFT JOIN per_issuer p ON p.issuer=t.issuer GROUP BY substr(t.issuer,1,2)`);
 return {universe,states,coverage,requiredCoverage,providerHealth:{KR:await profileProviderState(store,'KR'),US:await profileProviderState(store,'US')},runs:await rows(store.db,'SELECT * FROM business_profile_runs ORDER BY created_at DESC LIMIT 10'),jobs:await rows(store.db,'SELECT j.*,a.name,a.symbol FROM business_profile_jobs j JOIN catalyst_assets a ON a.id=j.asset_id ORDER BY j.updated_at DESC LIMIT ? OFFSET ?',Math.min(100,limit),offset),provider:await store.runtime('business-profile-fmp-support'),notes:['작업 시도와 항목 확보율은 다릅니다.','제품·수출 확보 수는 저장 집계이며 모든 기간·동일 기준·출처의 현재 제공 가능성을 보장하지 않습니다.','숫자 자료가 없는 기업의 비중은 0%가 아닙니다.','계정의 다른 프로젝트 사용량은 포함하지 않습니다.']};
}
