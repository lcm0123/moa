import {dartCompanyMap,dartZipXml,dartRequest} from './providers/dart-financials.mjs';
import {cachedResearch} from './research-cache.mjs';
import {persistResearchEvents} from './research-events.mjs';
export const dartTypes={A:'정기공시',B:'주요사항보고',C:'발행공시',D:'지분공시',E:'기타공시',F:'외부감사관련',G:'펀드공시',H:'자산유동화',I:'거래소공시',J:'공정위공시'};
export const dartDay=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(now));
export const dartFrom=(now=Date.now())=>dartDay(now-90*86400000);
export const dartUrl=receipt=>'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+receipt;
export const rows=async(db,sql,args=[]) => (await db.prepare(sql).bind(...args).all()).results;
export function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
export function filingGroup(f){if(f.filing_type==='A'||/영업\(잠정\)실적|결산실적|잠정실적/.test(f.title))return 'regular';if(f.filing_type==='D'||/소유주식변동|소유상황보고서|대량보유상황|특정증권등거래계획/.test(f.title))return 'ownership';if(['B','C'].includes(f.filing_type))return 'major';return 'other';}
export function normalizeDart(row,ticker,corp,now){
 if(row.stock_code!==ticker||row.corp_code!==corp)throw Error('DART_IDENTITY_MISMATCH');
 const date=String(row.rcept_dt||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 if(!/^\d{14}$/.test(row.rcept_no||'')||!validDate(date)||typeof row.report_nm!=='string'||!row.report_nm.trim())throw Error('DART_SCHEMA_ERROR');
 const badges=[...row.report_nm.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]).filter(v=>/정정|첨부추가|변경등록|철회/.test(v));
 return {receipt:row.rcept_no,ticker,corp_code:corp,corp_name:String(row.corp_name||''),title:row.report_nm,received_date:date,submitter:String(row.flr_nm||'미제공'),badges,raw:row,first_seen_at:now};
}
export async function ensureDartRange(env,ticker,from=dartFrom(),to=dartDay(),live=false){
 const db=env.DB;await db.prepare('INSERT OR IGNORE INTO dart_targets(ticker) VALUES(?)').bind(ticker).run();
 await db.prepare('INSERT INTO dart_ranges(ticker,date_from,date_to,is_live) VALUES(?,?,?,?) ON CONFLICT(ticker,date_from,date_to) DO UPDATE SET next_sync=CASE WHEN is_live=0 AND excluded.is_live=1 THEN MIN(next_sync,?) ELSE next_sync END,is_live=MAX(is_live,excluded.is_live)').bind(ticker,from,to,live?1:0,Date.now()+300000).run();
}
export async function resolveDartCompany(env,ticker,request=dartRequest){
 if(!env.OPENDART_API_KEY)throw Error('DART_KEY_MISSING');
 const saved=env.DB?(await rows(env.DB,"SELECT payload FROM research_cache WHERE cache_key='dart:companies'"))[0]:null;
 const ttl=saved&&JSON.parse(saved.payload).schemaVersion===2?86400000:0;
 const registry=await cachedResearch(env,'dart:companies',ttl,async()=>({schemaVersion:2,items:dartCompanyMap(await dartZipXml(await request({...env,DART_API_KEY:undefined},'corpCode.xml',{},true)))}));
 const matches=registry.items.filter(r=>r.ticker===ticker);
 if(matches.length!==1)throw Error('DART_MAPPING_ERROR');
 return {...matches[0],mappingAt:registry.cacheUpdatedAt,mappingStale:!!registry.stale};
}
async function listPages(env,corp,job,request,type){
 const out=new Map();let totalPages=1;
 for(let page=1;page<=totalPages;page++){
  const data=await request({...env,DART_API_KEY:undefined},'list.json',{corp_code:corp,bgn_de:job.date_from.replaceAll('-',''),end_de:job.date_to.replaceAll('-',''),last_reprt_at:'N',sort:'date',sort_mth:'desc',page_count:'100',page_no:String(page),...(type?{pblntf_ty:type}:{})});
  if(data.status==='013'){if(page!==1)throw Error('DART_PAGINATION_CHANGED');return [];}
  if(data.status!=='000'||!Array.isArray(data.list)||!Number.isInteger(Number(data.total_page))||Number(data.total_page)<1||Number(data.total_page)>100)throw Error('DART_SCHEMA_ERROR');
  if(page>1&&Number(data.total_page)!==totalPages)throw Error('DART_PAGINATION_CHANGED');
  totalPages=Number(data.total_page);
  for(const item of data.list)out.set(item.rcept_no,item);
  if(page===totalPages&&out.size!==Number(data.total_count))throw Error('DART_PAGINATION_CHANGED');
 }
 return [...out.values()];
}
export async function syncDartRange(env,job,{request=dartRequest,resolve=resolveDartCompany,now=new Date().toISOString()}={}){
 const db=env.DB;const deadline=Date.now()+240000;let calls=0;const upstream=request;
 request=async(...args)=>{if(++calls>60||Date.now()>deadline)throw Error('DART_BATCH_LIMIT');return upstream(...args);};
 const company=await resolve(env,job.ticker,request);
 await db.prepare('UPDATE dart_targets SET corp_code=?,name=?,mapping_at=?,error=? WHERE ticker=?').bind(company.corpCode,company.name,company.mappingAt,company.mappingStale?'DART_MAPPING_STALE':null,job.ticker).run();
 const all=await listPages(env,company.corpCode,job,request);
 const normalized=all.map(r=>normalizeDart(r,job.ticker,company.corpCode,now));
 const stored=new Map((await rows(db,'SELECT receipt,filing_type FROM dart_filings WHERE ticker=? AND received_date>=? AND received_date<=?',[job.ticker,job.date_from,job.date_to])).map(f=>[f.receipt,f.filing_type]));
 const types=new Map(stored);let typeError=null;
 // list.json does not return pblntf_ty. Query each official type only when
 // unclassified/new receipts exist; never infer the official type from a title.
 if(normalized.some(f=>!types.get(f.receipt))){
  try{for(const type of Object.keys(dartTypes))for(const r of await listPages(env,company.corpCode,job,request,type)){
   normalizeDart(r,job.ticker,company.corpCode,now);types.set(r.rcept_no,type);
  }}catch{typeError='DART_TYPE_LOOKUP_FAILED';}
 }
 for(let i=0;i<normalized.length;i+=50){
  const part=normalized.slice(i,i+50);
  await db.batch(part.map(f=>db.prepare('INSERT INTO dart_filings(receipt,ticker,corp_code,corp_name,title,received_date,submitter,filing_type,badges,raw,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt) DO UPDATE SET title=excluded.title,submitter=excluded.submitter,filing_type=COALESCE(excluded.filing_type,filing_type),badges=excluded.badges,raw=excluded.raw,updated_at=excluded.updated_at').bind(f.receipt,f.ticker,f.corp_code,f.corp_name,f.title,f.received_date,f.submitter,types.get(f.receipt)||null,JSON.stringify(f.badges),JSON.stringify(f.raw),now,now)));
  const events=await persistResearchEvents(env,part.map(f=>({id:'dart:'+f.receipt,sourceKeys:['dart:'+f.receipt],key:'KR:'+f.ticker,kind:'filing',title:f.title,date:f.received_date,publishedDate:f.received_date,originalDate:f.received_date,collectedAt:now,precision:'date',timeZone:'Asia/Seoul',source:'OpenDART',sources:[{name:'DART 원문',url:dartUrl(f.receipt)}],href:'/stock/KR/'+f.ticker+'?tab=filings&receipt='+f.receipt,receipt:f.receipt})),{now,identities:[{key:'KR:'+job.ticker,issuerId:company.corpCode,source:'OpenDART corpCode.xml'}]});
  if(events.excludedKeys?.length)throw Error('DART_IDENTITY_MISMATCH');
  if(events.length)await db.batch(events.map(e=>db.prepare('UPDATE dart_filings SET event_id=? WHERE receipt=?').bind(e.eventId,e.receipt)));
 }
 if(job.is_live){
  // The first completed snapshot AFTER subscription is a baseline, not news.
  const max=normalized.map(f=>f.receipt).sort().at(-1)||job.date_to.replaceAll('-','')+'000000';
  await db.prepare('UPDATE dart_subscriptions SET baseline_receipt=?,baseline_at=? WHERE ticker=? AND baseline_receipt IS NULL AND created_at<=?').bind(max,now,job.ticker,now).run();
 }
 await db.prepare('UPDATE dart_ranges SET synced_at=?,error=?,next_sync=?,lease_until=0 WHERE ticker=? AND date_from=? AND date_to=?').bind(now,typeError,Date.now()+(job.is_live?300000:86400000),job.ticker,job.date_from,job.date_to).run();
 return {count:normalized.length,corpCode:company.corpCode,typeError};
}
export async function runDartBatch(env,options={}){
 if(!env.DB||!env.OPENDART_API_KEY)return;
 const db=env.DB;
 for(const {ticker} of await rows(db,'SELECT DISTINCT ticker FROM dart_subscriptions'))await ensureDartRange(env,ticker,dartFrom(),dartDay(),true);
 const job=(await rows(db,'SELECT * FROM dart_ranges WHERE next_sync<=? AND lease_until<=? AND (is_live=0 OR date_to=?) ORDER BY next_sync,is_live DESC LIMIT 1',[Date.now(),Date.now(),dartDay()]))[0];
 if(!job)return;
 const lease=await db.prepare('UPDATE dart_ranges SET lease_until=? WHERE ticker=? AND date_from=? AND date_to=? AND lease_until<=?').bind(Date.now()+600000,job.ticker,job.date_from,job.date_to,Date.now()).run();
 if(!lease.meta.changes)return;
 try{return await syncDartRange(env,job,options);}catch(e){
  const code=/^DART_[A-Z_]+$/.test(e.message)?e.message:'DART_CONNECTION_ERROR';
  await db.prepare('UPDATE dart_ranges SET error=?,next_sync=?,lease_until=0 WHERE ticker=? AND date_from=? AND date_to=?').bind(code,Date.now()+300000,job.ticker,job.date_from,job.date_to).run();
  if(code.includes('MAPPING')||code.includes('IDENTITY'))await db.prepare('UPDATE dart_targets SET error=? WHERE ticker=?').bind(code,job.ticker).run();
  return {error:code};
 }
}
export function startDartCollector(env){
 let stopped=false,timer;
 if(env.MOA_JOBS_ENABLED==='false'||!env.OPENDART_API_KEY)return ()=>{};
 const run=async()=>{try{await runDartBatch(env);}catch{/* Safe diagnostics are persisted per range. */}finally{if(!stopped){timer=setTimeout(run,10000);timer.unref?.();}}};
 timer=setTimeout(run,2000);timer.unref?.();return ()=>{stopped=true;clearTimeout(timer);};
}
