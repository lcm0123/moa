import policy from '../../config/reaction-gap.json' with {type:'json'};
import {decimal,mul} from './decimal.mjs';
import {parseTimestamp} from './periods.mjs';

export const unique=values=>[...new Set(values)].sort();
export const timestamp=value=>parseTimestamp(value)!==null;
export function validDate(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
/** Date precision is retained, never replaced with an invented publication time.
 * Without a verified source timezone, the whole civil day across supported UTC
 * offsets (-14..+14, same bound as parseTimestamp) must precede the cutoff.
 * These bounds are for eligibility only, not stored as event/publication times. */
export function publicationTimeReasons(publication,cutoff){
 const {publishedAt,publishedDate}=publication||{};
 const limit=parseTimestamp(cutoff);if(limit===null)return ['EVIDENCE_TIME_UNVERIFIED'];
 if(timestamp(publishedAt))return Date.parse(publishedAt)>limit?['EVIDENCE_AFTER_CUTOFF']:[];
 if(publishedAt!==null&&publishedAt!==undefined||!validDate(publishedDate))return ['EVIDENCE_TIME_UNVERIFIED'];
 const civilStart=Date.parse(publishedDate+'T00:00:00Z'),earliest=civilStart-14*3600000,latestExclusive=civilStart+38*3600000;
 return limit>=latestExclusive?[]:limit<earliest?['EVIDENCE_AFTER_CUTOFF']:['EVIDENCE_TIME_UNVERIFIED'];
}
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
export const known=value=>text(value)&&!['UNKNOWN','UNVERIFIED'].includes(value);
const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const scales={KRW:'1',THOUSAND_KRW:'1000',MILLION_KRW:'1000000',INDEX_POINT:'1'};

export function validateInput(input){
 const errors=[];
 if(!input||typeof input!=='object'||Array.isArray(input))return ['INVALID_INPUT'];
 if(input.schemaVersion!==policy.inputVersion)errors.push('INPUT_VERSION_MISMATCH');
 if(!timestamp(input.asOf))errors.push('INVALID_TIMESTAMP');
 if(!text(input.snapshotId))errors.push('SNAPSHOT_REQUIRED');
 if(!['AS_KNOWN','RETROSPECTIVE'].includes(input.informationMode))errors.push('INFORMATION_MODE_REQUIRED');
 if(['EVENT','DATE_REFERENCE'].includes(input.window?.mode)&&(!known(input.window.event?.id)||!known(input.window.event?.version)))errors.push('EVENT_ID_REQUIRED');
 if(!Array.isArray(input.candidates)||input.candidates.length>policy.maxCandidates)errors.push('INVALID_CANDIDATES');
 if(!Array.isArray(input.benchmarks)||input.benchmarks.length>10)errors.push('INVALID_BENCHMARKS');
 const cohort=input.cohort;
 if(!cohort||!text(cohort.id)||!text(cohort.version)||!text(cohort.selectionPolicyVersion)||!timestamp(cohort.frozenAt)||!timestamp(cohort.knowledgeCutoff)||!Array.isArray(cohort.orderedAssetIds))errors.push('INVALID_COHORT');
 else if(new Set(cohort.orderedAssetIds).size!==cohort.orderedAssetIds.length||cohort.orderedAssetIds.some(id=>!text(id))||cohort.orderedAssetIds.length>policy.maxCandidates)errors.push('INVALID_COHORT');
 else if(Date.parse(cohort.frozenAt)>Date.parse(input.asOf)||Date.parse(cohort.knowledgeCutoff)>Date.parse(input.asOf))errors.push('COHORT_AFTER_ASOF');
 for(const list of [input.candidates,input.benchmarks])if(Array.isArray(list)){
  if(list.some(x=>!x||!text(x.id))||new Set(list.map(x=>x?.id)).size!==list.length)errors.push('DUPLICATE_OR_INVALID_ID');
 }
 return unique(errors);
}

export function candidateReasons(candidate,input,period){
 const errors=[],r=candidate.relationship;
 if(candidate.identityVerified!==true||!known(candidate.issuerId)||!known(candidate.securityId)||candidate.market!=='KR')errors.push('IDENTITY_INVALID');
 if(!['KOSPI','KOSDAQ'].includes(candidate.listingMarket))errors.push('LISTING_MARKET_UNVERIFIED');
 if(candidate.securityType!=='COMMON_STOCK')errors.push('SECURITY_TYPE_INELIGIBLE');
 if(!validDate(candidate.validFrom)||candidate.validFrom>(period.baseDate||period.endDate||'')||candidate.validTo!==null&&(!validDate(candidate.validTo)||candidate.validTo<(period.endDate||'')))errors.push('IDENTITY_OUT_OF_RANGE');
 if(!r||r.verified!==true||r.subjectIssuerId!==candidate.issuerId||!known(r.role)||!known(r.product)||!['CONFIRMED_DELIVERY','PRODUCT_SELLER'].includes(r.stage)||!Array.isArray(r.sourceIds)||!r.sourceIds.length||r.sourceIds.some(id=>!known(id)))errors.push('EVIDENCE_UNVERIFIED');
 if(r?.revoked!==false)errors.push(r?.revoked===true?'EVIDENCE_REVOKED':'EVIDENCE_STATUS_UNKNOWN');
 const cutoff=input.informationMode==='AS_KNOWN'?input.cohort.knowledgeCutoff:input.asOf;
 errors.push(...publicationTimeReasons(r,cutoff));
 if(!timestamp(r?.firstObservedAt))errors.push('EVIDENCE_TIME_UNVERIFIED');
 else if(Date.parse(r.firstObservedAt)>Date.parse(cutoff))errors.push('EVIDENCE_AFTER_CUTOFF');
 if(period.mode!=='FIXED_WINDOW'&&(r?.eventId!==input.window?.event?.id||r?.eventVersion!==input.window?.event?.version))errors.push('EVENT_MISMATCH');
 return unique(errors);
}

// Values are decimal strings from the caller's source snapshot, never coerced
// from Number. This module does not fetch, repair, or silently fill a series.
export function normalizeSeries(series,{kind,input,asset}={}){
 const contract=series?.contract||{},errors=[],map=new Map();
 if(!series||!Array.isArray(series.rows))return {contract,errors:[],map,missing:true};
 if(series.rows.length>policy.maxRows)return {contract,errors:['ROW_LIMIT'],map,missing:false};
 if(kind!=='benchmark'&&(series.assetId!==asset.id||series.issuerId!==asset.issuerId||series.securityId!==asset.securityId))errors.push('SERIES_IDENTITY_MISMATCH');
 const groups=new Map();
 for(const row of series.rows){
  if(!row||!validDate(row.date)){errors.push('INVALID_DATE');continue;}
  const c={...contract,...row.contract},issues=[];let value=null;
  if(!timestamp(row.observedAt)){issues.push('OBSERVATION_TIME_UNVERIFIED');}
  else if(Date.parse(row.observedAt)>Date.parse(input.asOf)){
   const list=groups.get(row.date)||[];list.push({future:true,issues:['OBSERVATION_AFTER_ASOF']});groups.set(row.date,list);continue;
  }
  if(!known(row.sourceId)||!known(row.rawSnapshotId)||!known(row.revision))issues.push('SOURCE_UNVERIFIED');
  if(c.verification!=='VERIFIED'||!known(c.definitionVersion))issues.push('CONTRACT_UNVERIFIED');
  if(c.snapshotId!==input.snapshotId)issues.push('SNAPSHOT_MISMATCH');
  if(!known(c.venueScope)||!known(c.sessionScope)||!known(c.aggregationScope))issues.push('SCOPE_UNVERIFIED');
  if(c.sessionScope!=='REGULAR')issues.push('SESSION_MISMATCH');
  const expected=kind==='turnover'?'ACTUAL_TRADED_VALUE':kind==='benchmark'?'PRICE_INDEX':'CLOSE';
  if(c.measure!==expected)issues.push(kind==='turnover'?'MISSING_ACTUAL_TURNOVER':'PRICE_DEFINITION_MISMATCH');
  if(kind==='benchmark'){
   if(c.unit!=='INDEX_POINT'||c.indexKind!=='MARKET_PRICE'||c.currency!=='KRW')issues.push('BENCHMARK_DEFINITION_MISMATCH');
  }else if(c.currency!=='KRW'||!['KRW','THOUSAND_KRW','MILLION_KRW'].includes(c.unit))issues.push('UNIT_MISMATCH');
  if(kind!=='turnover'){
   if(c.corporateActionsVerified!==true||!known(c.adjustmentVersion))issues.push('ADJUSTMENT_UNVERIFIED');
   if(!['RAW_NO_ACTIONS_VERIFIED','SPLIT_ADJUSTED_PRICE'].includes(c.adjustmentMethod))issues.push('PRICE_BASIS_MISMATCH');
   if(c.returnBasis!=='PRICE_RETURN')issues.push('PRICE_BASIS_MISMATCH');
  }
  if(!['FINAL','HALTED','NO_TRADES'].includes(row.status))issues.push(row.status==='FETCH_FAILED'?'UPSTREAM_ERROR':row.status==='MISSING'?'MISSING_VALUE':'UNFINALIZED_DATA');
  if(row.value===null||row.value===undefined)issues.push(kind==='turnover'?'MISSING_ACTUAL_TURNOVER':'MISSING_VALUE');
  else try{value=mul(decimal(row.value),decimal(scales[c.unit]||'1'));if(value.n<0n||kind!=='turnover'&&value.n===0n)issues.push('INVALID_INPUT');}catch{issues.push('INVALID_INPUT');}
  let supersedes=[];
  if(row.revisionVerified===true&&row.supersedes!==undefined){
   if(!Array.isArray(row.supersedes)||row.supersedes.length>policy.maxRevisionParents||row.supersedes.some(id=>!known(id)))issues.push('REVISION_LINEAGE_INVALID');
   else supersedes=unique(row.supersedes);
  }
  const normalized={date:row.date,value,contract:c,status:row.status,issues:unique(issues),revision:row.revision,supersedes,lineage:[{sourceId:row.sourceId,rawSnapshotId:row.rawSnapshotId,revision:row.revision,observedAt:row.observedAt,originalValue:row.value??null,originalUnit:c.unit}]};
  const list=groups.get(row.date)||[];list.push(normalized);groups.set(row.date,list);
 }
 for(const [date,entries]of groups){
  const observed=entries.filter(x=>!x.future);
  if(!observed.length){map.set(date,{issues:['OBSERVATION_AFTER_ASOF'],lineage:[]});continue;}
  const signature=row=>stable({value:row.value?`${row.value.n}/${row.value.d}`:null,contract:{...row.contract,unit:kind==='benchmark'?'INDEX_POINT':'KRW'},status:row.status,issues:row.issues});
  const lineage=rows=>[...new Map(rows.flatMap(row=>row.lineage).map(item=>[stable(item),item])).values()].sort((a,b)=>stable(a).localeCompare(stable(b)));
  // Deduplicate retries before resolving revision lineage. Identical r2 retries
  // must not turn a valid r1 -> r2 correction into an ambiguous conflict.
  const copies=new Map();
  for(const row of observed.sort((a,b)=>stable(a.lineage).localeCompare(stable(b.lineage)))){
   const key=stable({revision:row.revision,signature:signature(row),supersedes:unique(row.supersedes)});
   const existing=copies.get(key);
   copies.set(key,existing?{...existing,lineage:lineage([existing,row])}:row);
  }
  const available=[...copies.values()];
  // Validate the complete available revision graph, not just the winning leaf.
  // A later r3 cannot legitimize an older r1 <-> r2 cycle. Kahn traversal also
  // avoids call-stack overflow for a long caller-supplied correction chain.
  const revisions=new Map();
  for(const row of available){const parents=revisions.get(row.revision)||new Set();for(const parent of row.supersedes)parents.add(parent);revisions.set(row.revision,parents);}
  const indegree=new Map([...revisions.keys()].map(id=>[id,0]));
  for(const parents of revisions.values())for(const parent of parents)if(indegree.has(parent))indegree.set(parent,indegree.get(parent)+1);
  const ready=[...indegree].filter(([,degree])=>degree===0).map(([id])=>id);let visited=0;
  for(let i=0;i<ready.length;i++){visited++;for(const parent of revisions.get(ready[i]))if(indegree.has(parent)){indegree.set(parent,indegree.get(parent)-1);if(indegree.get(parent)===0)ready.push(parent);}}
  if(visited!==revisions.size){map.set(date,{issues:['REVISION_LINEAGE_INVALID','CONFLICTING_OBSERVATIONS'],lineage:lineage(available)});continue;}
  if(new Set(available.map(signature)).size===1){map.set(date,{...available[0],lineage:lineage(available)});continue;}
  // A conflicting newer value requires explicit, verified correction lineage.
  const supersedesAll=row=>{
   const seen=new Set(),pending=[...row.supersedes];
   while(pending.length){const revision=pending.pop();if(seen.has(revision))continue;seen.add(revision);for(const parent of revisions.get(revision)||[])pending.push(parent);}
   return available.every(other=>other===row||other.revision!==row.revision&&seen.has(other.revision));
  };
  const winners=available.filter(supersedesAll);
  map.set(date,winners.length===1?{...winners[0],supersededLineage:lineage(available.filter(r=>r!==winners[0]))}:{issues:['CONFLICTING_OBSERVATIONS'],lineage:lineage(available)});
 }
 return {contract,errors:unique(errors),map,missing:false};
}
