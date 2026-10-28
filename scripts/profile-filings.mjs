import {hash} from '../server/catalyst/core.mjs';
import {issuerKey} from '../server/catalyst/business-profile.mjs';
import {profilePolicy} from '../server/catalyst/profile-queue.mjs';
import {koreanProfileReports,koreanProfileSources} from './profile-kr-source.mjs';
import {americanProfileReports,americanProfileSources} from './profile-us-source.mjs';
import {officialProfileIR} from './profile-ir-source.mjs';
import {storedKoreanProfileSources} from './profile-kr-cache.mjs';
import {one} from '../server/catalyst/store.mjs';

// Shared by every explicit profile batch, including CACHE_ONLY. Re-select useful
// tables from an already accepted filing before deciding whether a fetch is
// needed. Company pages never call this maintenance path.
export async function storedProfileFilingSources(env,store,asset,job={}){
 if(asset.market!=='KR')return [];
 const specified=JSON.parse(job.checkpoint||'{}');if(specified.ir)return [];
 const cached=await store.runtime('profile-filings:'+issuerKey(asset));
 let report=specified.report||cached?.reports?.[0];
 if(!report){
  const row=await one(store.db,"SELECT payload FROM catalyst_sources WHERE asset_id=? AND source_type='regulatory' AND json_extract(payload,'$.documentId') IS NOT NULL AND json_extract(payload,'$.originRef') IS NOT NULL ORDER BY published_at DESC,observed_at DESC LIMIT 1",asset.id);
  if(row){const source=JSON.parse(row.payload),receipt=source.originRef;
   if(/^\d{14}$/.test(receipt||'')&&/사업보고서|반기보고서|분기보고서/.test(source.title||'')&&/^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt||''))report={corp_code:asset.issuerId,rcept_no:receipt,rcept_dt:source.publishedAt.replaceAll('-',''),report_nm:source.title};
  }
 }
 return report?storedKoreanProfileSources(env,store,asset,report):[];
}
// Shared queue/storage; source-specific collectors. FMP and search are never prerequisites.
export async function profileFilingSources(env,store,tools,asset,job){
 const specified=JSON.parse(job.checkpoint||'{}');
 if(specified.ir){const ir=await officialProfileIR(store,tools,asset,{specified:specified.ir});if(!ir.sources.length)throw Error(ir.failures[0]?.code||'IR_SOURCE_UNAVAILABLE');return ir.sources;}
 const key='profile-filings:'+issuerKey(asset),cached=await store.runtime(key);let reports=cached?.reports;
 try{
  if(!reports||Date.now()-Date.parse(cached.checkedAt)>86400000){
   reports=(await (asset.market==='KR'?koreanProfileReports(env,asset):americanProfileReports(env,asset))).slice(0,profilePolicy.historyQuarters+4);await store.runtime(key,{reports,checkedAt:new Date().toISOString()});
   for(const r of reports){const id=await hash([issuerKey(asset),r.key,'REPORT',profilePolicy.version].join('|')),at=new Date().toISOString();await store.db.prepare('INSERT OR IGNORE INTO business_profile_jobs(id,issuer,asset_id,period_key,purpose,version,phase,checkpoint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,issuerKey(asset),asset.id,r.key,'REPORT',profilePolicy.version,4,JSON.stringify({report:r}),at,at).run();}
  }
  const report=specified.report||reports[0];if(!report)throw Error('NO_PERIODIC_REPORT');
  if(asset.market==='KR'){const stored=await storedKoreanProfileSources(env,store,asset,report);if(stored.length)return stored;}
  const sources=await (asset.market==='KR'?koreanProfileSources(tools,asset,report):americanProfileSources(env,tools,asset,report));if(!sources.length)throw Error('EXTRACTION_UNRESOLVED');return sources;
 }catch(e){
  const primaryFailure=/^[A-Z_0-9]+$/.test(e.message)?e.message:'FETCH_FAILED';await store.runtime('profile-source-status:'+issuerKey(asset),{primary:asset.market==='KR'?'DART':'SEC',state:primaryFailure,checkedAt:new Date().toISOString()});
  const fallback=await officialProfileIR(store,tools,asset);if(fallback.sources.length)return fallback.sources;throw Error(primaryFailure);
 }
}
