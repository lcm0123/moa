// Bounded, offline reader of the existing FSC history and immutable exact rows.
// Contract registries are administrator-reviewed data, never request parameters.
import {rows} from '../catalyst/store.mjs';
import {digest,stable,settings} from './store.mjs';
import policy from '../../config/reaction-gap.json' with {type:'json'};
import {validDate,timestamp} from './input.mjs';
import {resolveWindow} from './periods.mjs';
import {fscExactDecimal} from '../providers/fsc-exact.mjs';

const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
// A publisher may omit a document version. A content hash identifies that
// document only; applicability dates and all policy/rights gates still apply.
const proof=(p,day=null)=>Array.isArray(p?.evidence)&&p.evidence.some(e=>/^https:\/\//.test(e.url||'')&&(e.version||typeof e.documentHash==='string'&&/^[a-f0-9]{64}$/i.test(e.documentHash))&&validDate(e.applicableFrom)&&timestamp(e.reviewedAt)&&(!day||e.applicableFrom<=day&&(!e.applicableTo||validDate(e.applicableTo)&&day<=e.applicableTo)));
const kstDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(value));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Test policies cannot certify stored provider observations. A test observation
// must be explicitly labelled AND originate from a non-routable fixture URL;
// merely changing a label on a real provider/archive record cannot opt it in.
export function syntheticObservation(exact){
 try{return exact?.source?.dataClass==='SYNTHETIC_TEST_ONLY'&&new URL(exact.source.endpoint).hostname.endsWith('.invalid')&&!exact.source.locator?.archiveFile;}catch{return false;}
}
export function testPolicy(value){
 if(typeof value==='string')return /TEST_ONLY|\.fixture\.invalid/i.test(value);
 if(Array.isArray(value))return value.some(testPolicy);
 if(value&&typeof value==='object')return Object.entries(value).some(([key,v])=>/^test_?only$/i.test(key)&&(v===true||v==='true')||testPolicy(v));
 return false;
}
export function exactRowIssues(e,r,measure=null){
 const reasons=[],s=e.source||{};
 if(e.schemaVersion!=='fsc-exact-1'||!sha(s.rowHash)||!sha(s.responseHash)||s.revision!=='sha256:'+s.rowHash||r.revision!==s.revision||r.raw_hash!==s.rowHash||s.receivedAt!==r.received_at)reasons.push('RAW_LINEAGE_MISMATCH');
 for(const [k,f]of [['close','clpr'],['turnover','trPrc']])if((!measure||k===measure)&&(e.values?.[k]??null)!==fscExactDecimal(e.rawFields?.[f]))reasons.push('RAW_VALUE_MISMATCH');
 return [...new Set(reasons)];
}
const permission=r=>r?.verified===true&&['read','store','cache','derive','redisplay'].every(k=>r[k]===true);
export {permission};
function historyQuery(kind){return kind==='STOCK'?
 `SELECT json_extract(j.value,'$.fscExact') exact FROM fsc_stock_history h,json_each(h.payload) j WHERE h.stock_id=? AND json_extract(j.value,'$.date') BETWEEN ? AND ? AND json_type(j.value,'$.fscExact')='object' ORDER BY json_extract(j.value,'$.date') LIMIT ?`:
 `SELECT json_extract(j.value,'$.fscExact') exact FROM fsc_index_history h,json_each(h.payload) j WHERE h.id=? AND json_extract(j.value,'$.at') BETWEEN ? AND ? AND json_type(j.value,'$.fscExact')='object' ORDER BY json_extract(j.value,'$.at') LIMIT ?`;}

async function capture(db,sql,args,captures){
 const result=await rows(db,sql,...args),columns=result.length?Object.keys(result[0]):[];
 captures.push({sql,args,columns,expected:JSON.stringify(result.map(r=>columns.map(k=>r[k])))});return result;
}
export function dataReadFence(captures){
 const clauses=[],args=[];
 for(const c of captures){
  clauses.push(c.columns.length?`(SELECT json_group_array(json_array(${c.columns.map(k=>'q."'+k.replaceAll('"','""')+'"').join(',')})) FROM (${c.sql}) q)=?`:`NOT EXISTS(${c.sql})`);
  args.push(...c.args,...c.columns.length?[c.expected]:[]);
 }
 return {sql:clauses.length?clauses.join(' AND '):'1',args};
}
export async function validateDataReads(db,captures){
 for(const c of captures){const current=await rows(db,c.sql,...c.args);if(stable(current.map(r=>c.columns.map(k=>r[k])))!==stable(JSON.parse(c.expected)))return false;}
 return true;
}

function dates(frozen,asOf){
 const anchor=frozen.window.endDate||frozen.window.event?.publishedDate||frozen.window.event?.publishedAt?.slice(0,10)||asOf.slice(0,10);
 if(!validDate(anchor))throw Error('INVALID_DATA_WINDOW');
 const start=new Date(anchor+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-settings.lookbackCalendarDays);
 return {start:start.toISOString().slice(0,10),end:kstDay(asOf)};
}
function identityOk(exact,kind,candidate,day){
 const f=exact.rawFields||{},date=String(f.basDt||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 if(date!==day)return false;
 if(kind==='INDEX')return f.idxNm===candidate.id||(candidate.id==='KOSPI'&&f.idxNm==='코스피')||(candidate.id==='KOSDAQ'&&f.idxNm==='코스닥');
 return f.srtnCd===candidate.ticker&&f.isinCd===candidate.securityId&&f.mrktCtg===candidate.listingMarket;
}

/** Command-path only. Numeric legacy chart values are deliberately never read. */
export async function preserveExactHistory(db,frozen,{asOf}){
 const range=dates(frozen,asOf),targets=[...frozen.candidates.map(c=>({kind:'STOCK',...c})),...[...new Set(frozen.candidates.map(c=>c.benchmarkId).filter(Boolean))].map(id=>({kind:'INDEX',id}))];
 let inserted=0;
 for(const c of targets){
  const stock=c.kind==='STOCK';
  const found=await rows(db,historyQuery(c.kind),stock?c.ticker:c.id,range.start,range.end,settings.maxRowsPerAsset+1);
  if(found.length>settings.maxRowsPerAsset)throw Error('DATA_ROW_LIMIT');
  for(const row of found){const e=parse(row.exact),day=String(e?.rawFields?.basDt||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
   if(!e||e.schemaVersion!=='fsc-exact-1'||!identityOk(e,c.kind,c,day)||!timestamp(e.source?.receivedAt)||!sha(e.source?.rowHash)||!sha(e.source?.responseHash)||e.source.revision!=='sha256:'+e.source.rowHash)continue;
   const r=await db.prepare('INSERT OR IGNORE INTO reaction_gap_market_rows(kind,asset_id,day,revision,received_at,raw_hash,payload) VALUES(?,?,?,?,?,?,?)').bind(c.kind,c.id,day,e.source.revision,e.source.receivedAt,e.source.rowHash,stable(e)).run();inserted+=r.meta.changes;
  }
 }
 return {inserted};
}

export async function loadGapData(db,frozen,{asOf,informationMode}){
 if(frozen.candidates.length>settings.maxCandidates)throw Error('CANDIDATE_LIMIT');
 const captures=[],dependencies=[],registry={};
 for(const id of [settings.stockContractId,settings.indexContractId]){
  const row=(await capture(db,'SELECT * FROM reaction_gap_contracts WHERE id=?',[id],captures))[0],p=parse(row?.payload)||{};
  registry[id]={row,p,verified:row?.state==='VERIFIED'&&proof(p)};
  dependencies.push({kind:'CONTRACT',key:id,version:await digest(row||null)});
 }
 const calendarRow=(await capture(db,'SELECT * FROM reaction_gap_calendars WHERE id=?',[settings.calendarId],captures))[0],cal=parse(calendarRow?.payload)||{};
 dependencies.push({kind:'CALENDAR',key:settings.calendarId,version:await digest(calendarRow||null)});
 const calendar={...cal,verified:calendarRow?.state==='VERIFIED'&&proof(cal)&&cal.verified===true,version:calendarRow?.version||'UNVERIFIED',sessions:cal.sessions||[]};
 const stock=registry[settings.stockContractId],index=registry[settings.indexContractId];
 const completion=stock.verified?{...stock.p.completion,verified:stock.p.completion?.verified===true}:{verified:false,through:null,confirmedAt:null,policyVersion:'UNVERIFIED'};
 let period=resolveWindow({asOf,window:frozen.window,calendar,completion},policy);
 let needed=[...new Set([...period.priceDates,...period.prePriceDates,...period.preTurnoverDates,...period.postTurnoverDates])].sort();
 if(calendar.verified&&needed.some(day=>!proof(cal,day))){
  calendar.verified=false;period=resolveWindow({asOf,window:frozen.window,calendar,completion},policy);needed=[];
 }
 const range=needed.length?{start:needed[0],end:needed.at(-1)}:dates(frozen,asOf),raw=[],disclosure={},providerStates=[],adapterHolds={};
 function contract(reg,kind){const c=reg.p[kind]||{};return {...c,verification:reg.verified&&c.verification==='VERIFIED'?'VERIFIED':'UNVERIFIED',definitionVersion:c.definitionVersion||'UNVERIFIED',snapshotId:'PENDING'};}
 async function series(kind,c){
  // Capture the writer's source as well: a later legacy history correction
  // invalidates reads even before the next command imports its exact revision.
  const history=await capture(db,historyQuery(kind),[kind==='STOCK'?c.ticker:c.id,range.start,range.end,settings.maxRowsPerAsset+1],captures);
  if(history.length>settings.maxRowsPerAsset)throw Error('DATA_ROW_LIMIT');
  const states=await capture(db,kind==='STOCK'?'SELECT id,error_code,covered_through,received_at FROM fsc_stock_history WHERE stock_id=? ORDER BY id':'SELECT id,error_code,covered_through,received_at FROM fsc_index_history WHERE id=?',[kind==='STOCK'?c.ticker:c.id],captures);
  providerStates.push({assetId:c.id,kind,records:states});
  const found=await capture(db,'SELECT * FROM reaction_gap_market_rows WHERE kind=? AND asset_id=? AND day BETWEEN ? AND ? ORDER BY day,revision LIMIT ?',[kind,c.id,range.start,range.end,settings.maxRowsPerAsset+1],captures);
  if(found.length>settings.maxRowsPerAsset)throw Error('DATA_ROW_LIMIT');
  dependencies.push({kind:'MARKET',key:kind+':'+c.id,version:await digest(found)});
  const reg=kind==='STOCK'?stock:index;
  const hasReal=found.some(r=>!syntheticObservation(parse(r.payload)));
  const output={};
  for(const k of kind==='STOCK'?['price','turnover']:['benchmark']){
   const con=contract(reg,k);if(states.some(s=>s.error_code))con.upstreamStatus='ERROR';
   // Shared markers (including boolean testOnly/dataClass) affect every metric;
   // a marker confined to turnover must not suppress an independent price.
   const sharedPolicy=Object.fromEntries(Object.entries(reg.p).filter(([key])=>!['price','turnover','benchmark'].includes(key)));
   const testMismatch=hasReal&&testPolicy({version:reg.row?.version,sharedPolicy,contract:reg.p[k]});
   if(testMismatch){con.verification='UNVERIFIED';reg.actualDataVerificationRejected=true;adapterHolds[c.id+':'+k]=['TEST_ONLY_POLICY_ON_REAL_DATA'];}
   disclosure[c.id+':'+k]=!testMismatch&&reg.verified&&proof(reg.p,range.start)&&proof(reg.p,range.end)&&permission(con.rights||reg.p.rights);
   output[k]={assetId:c.id,issuerId:c.issuerId,securityId:c.securityId,contract:con,rows:found.map(r=>{
    const e=parse(r.payload)||{},issues=exactRowIssues(e,r,k==='turnover'?'turnover':'close'),identity=identityOk(e,kind,c,r.day)&&!issues.length,v=e.values?.[k==='turnover'?'turnover':'close'];
    const applicable=!testMismatch&&reg.verified&&proof(reg.p,r.day),revisionPolicy=reg.p.revisions?.[r.revision];
    return {date:r.day,value:!issues.length&&typeof v==='string'?v:null,status:identity&&applicable&&reg.p.completion?.verified===true&&r.day<=reg.p.completion.through&&!revisionPolicy?.withdrawn?(revisionPolicy?.verified&&['HALTED','NO_TRADES'].includes(revisionPolicy.status)?revisionPolicy.status:'FINAL'):'UNFINALIZED',
     observedAt:r.received_at,sourceId:e.source?.provider||null,rawSnapshotId:e.source?.responseHash||r.raw_hash,revision:r.revision,
     ...(identity&&applicable?{}:{contract:{verification:'UNVERIFIED'}}),
     supersedes:reg.verified?reg.p.revisions?.[r.revision]?.supersedes:undefined,revisionVerified:reg.verified&&reg.p.revisions?.[r.revision]?.verified===true};
   })};
  }
  raw.push(...found.map(r=>({kind,assetId:c.id,date:r.day,revision:r.revision,rawHash:r.raw_hash,payloadHash:null,issues:exactRowIssues(parse(r.payload)||{},r),exact:parse(r.payload)})));
  return output;
 }
 const candidates=[];for(const c of frozen.candidates)candidates.push({...c,...await series('STOCK',c)});
 const benchmarks=[];for(const id of [...new Set(candidates.map(c=>c.benchmarkId).filter(Boolean))])benchmarks.push({id,listingMarket:id,...(await series('INDEX',{id})).benchmark});
 const realData=raw.some(r=>!syntheticObservation(r.exact));
 if(realData&&testPolicy({version:calendarRow?.version,calendar:cal})){
  calendar.verified=false;adapterHolds.calendar=['TEST_ONLY_POLICY_ON_REAL_DATA'];
  period=resolveWindow({asOf,window:frozen.window,calendar,completion},policy);needed=[];
 }
 for(const r of raw)r.payloadHash=await digest(r.exact);
 const manifest={schemaVersion:'reaction-gap-manifest-2',adapterVersion:settings.version,calculationVersion:policy.calculationVersion,
  asOf,informationMode,frozen,source:frozen.source,window:frozen.window,period,requiredDates:needed,cohort:frozen.cohort,evidenceDependencies:frozen.dependencies,
  calendar:calendarRow||null,contracts:registry,raw,dependencies,reads:captures,disclosure,providerStates,adapterHolds};
 const snapshotId=await digest(manifest);
 for(const c of candidates)for(const k of ['price','turnover'])c[k].contract.snapshotId=snapshotId;
 for(const b of benchmarks)b.contract.snapshotId=snapshotId;
 const input={schemaVersion:policy.inputVersion,asOf,snapshotId,informationMode,window:frozen.window,calendar,completion,cohort:frozen.cohort,candidates,benchmarks,rights:{verified:Object.values(disclosure).every(Boolean),redisplay:Object.values(disclosure).every(Boolean)}};
 return {input,manifest,dependencies:[...frozen.dependencies,...dependencies],fence:dataReadFence(captures)};
}

// Result disclosure is independent for each metric, not one all-or-nothing gate.
export function discloseGap(core,manifest){
 const result=structuredClone(core),d=manifest.disclosure,h=manifest.adapterHolds||{};
 const redact=m=>{if(!m||typeof m!=='object')return; m.value=null;m.state='HOLD';m.reasonCodes=[...new Set([...(m.reasonCodes||[]),'RIGHTS_UNCONFIRMED'])];for(const p of m.provenance||[])for(const l of [...(p.lineage||[]),...(p.supersededLineage||[])])delete l.originalValue;};
 for(const c of result.companies){const m=c.metrics,p=d[c.id+':price'],t=d[c.id+':turnover'],b=d[c.listingMarket+':benchmark'];
  if(!p){redact(m.priceReturn);redact(m.preReturn);}if(!b)redact(m.benchmarkReturn);if(!p||!b)redact(m.benchmarkDifference);
  if(!t)for(const k of ['preMean','postMean','multiple'])redact(m.turnover[k]);
  const hold=(metric,reasons)=>{if(!reasons?.length)return;metric.value=null;metric.state='HOLD';metric.reasonCodes=[...new Set([...metric.reasonCodes,...reasons])];};
  for(const metric of [m.priceReturn,m.preReturn])hold(metric,[...(h.calendar||[]),...(h[c.id+':price']||[])]);
  hold(m.benchmarkReturn,[...(h.calendar||[]),...(h[c.listingMarket+':benchmark']||[])]);
  hold(m.benchmarkDifference,[...(h.calendar||[]),...(h[c.id+':price']||[]),...(h[c.listingMarket+':benchmark']||[])]);
  for(const k of ['preMean','postMean','multiple'])hold(m.turnover[k],[...(h.calendar||[]),...(h[c.id+':turnover']||[])]);
  // Source quotes are evidence, not price data; their permission is separately checked by evidence.mjs.
 }
 for(const c of result.comparisons){if(!d[c.assetA+':price']||!d[c.assetB+':price'])redact(c);
  const reasons=[...(h.calendar||[]),...(h[c.assetA+':price']||[]),...(h[c.assetB+':price']||[])];
  if(reasons.length){c.value=null;c.state='HOLD';c.reasonCodes=[...new Set([...c.reasonCodes,...reasons])];}
 }
 result.liveIntegration=true;result.integrationStage=2;
 result.publication={allowed:Object.values(d).length>0&&Object.values(d).every(Boolean)&&!Object.values(h).some(r=>r.length),reasonCodes:[...new Set([...Object.values(d).every(Boolean)?[]:['RIGHTS_UNCONFIRMED'],...Object.values(h).flat()])],audience:'AUTHENTICATED_OWNER',publicEnabled:false};
 const metrics=result.companies.flatMap(c=>[c.metrics.priceReturn,c.metrics.preReturn,c.metrics.benchmarkDifference,...['preMean','postMean','multiple'].map(k=>c.metrics.turnover[k])]);
 if(metrics.every(m=>m.value===null))result.execution='HELD';else if(metrics.some(m=>m.state==='HOLD'))result.execution='PARTIAL';
 result.explanation=result.execution==='HELD'?'확인되지 않은 자료 조건으로 계산 결과를 보류했습니다.':'동일 관측기간의 저장 자료를 비교했습니다. 과거 추천 성과가 아닙니다.';
 return result;
}
