import policy from '../../config/reaction-gap.json' with {type:'json'};
import {validateInput,candidateReasons,normalizeSeries,unique} from './input.mjs';
import {resolveWindow} from './periods.mjs';
import {calculateMetrics,priceBasisKey} from './metrics.mjs';
import {sub,serialize} from './decimal.mjs';

/** Pure Phase 1 entry point. All data, knowledge cutoff, calendar and completion
 * attestations come from the caller. No runtime provider is wired to this API. */
export function calculateReactionGap(input){
 const errors=validateInput(input);
 const base={schemaVersion:'reaction-gap-output-1',calculationVersion:policy.calculationVersion,liveIntegration:false,
  publication:{allowed:false,reasonCodes:['PHASE1_NOT_CONNECTED',...(input?.rights?.verified===true&&input.rights.redisplay===true?[]:['RIGHTS_UNCONFIRMED'])]}};
 if(errors.length)return {...base,execution:'INVALID_INPUT',reasonCodes:errors,period:null,companies:[],comparisons:[]};
 const period=resolveWindow(input,policy),byId=new Map(input.candidates.map(c=>[c.id,c])),benchmarks=new Map(input.benchmarks.map(b=>[b.id,b]));
 const companies=[],internal=[],exclusions=[],benchmarkCache=new Map();
 const selectionReasons=input.cohort.selectedBeforePrices===true?[]:['PRICE_DEPENDENT_SELECTION'];
 for(const id of input.cohort.orderedAssetIds){
  const candidate=byId.get(id);if(!candidate){exclusions.push({id,reasonCodes:['CANDIDATE_MISSING']});continue;}
  const reasons=candidateReasons(candidate,input,period),benchmarkRaw=benchmarks.get(candidate.benchmarkId);
  const series={price:normalizeSeries(candidate.price,{kind:'price',input,asset:candidate}),turnover:normalizeSeries(candidate.turnover,{kind:'turnover',input,asset:candidate})};
  if(!benchmarkCache.has(candidate.benchmarkId))benchmarkCache.set(candidate.benchmarkId,{...normalizeSeries(benchmarkRaw,{kind:'benchmark',input}),id:benchmarkRaw?.id,listingMarket:benchmarkRaw?.listingMarket});
  const benchmark=benchmarkCache.get(candidate.benchmarkId);
  const calculated=calculateMetrics(candidate,series,benchmark,period,input,reasons),{_priceValue,_priceContract,...metrics}=calculated;
  const group=JSON.stringify([candidate.relationship?.eventId,candidate.relationship?.eventVersion,candidate.relationship?.product,candidate.relationship?.role,candidate.relationship?.stage,candidate.listingMarket]);
  const company={id,issuerId:candidate.issuerId,securityId:candidate.securityId,listingMarket:candidate.listingMarket,relationship:candidate.relationship,comparisonEligible:!reasons.length&&!selectionReasons.length,reasonCodes:unique([...reasons,...selectionReasons]),metrics};
  companies.push(company);internal.push({candidate,company,group,price:_priceValue,priceContract:_priceContract});
  if(reasons.length)exclusions.push({id,reasonCodes:reasons});
 }
 for(const candidate of [...input.candidates].sort((a,b)=>a.id.localeCompare(b.id)))if(!input.cohort.orderedAssetIds.includes(candidate.id))exclusions.push({id:candidate.id,reasonCodes:['NOT_IN_FROZEN_COHORT']});
 const groups=new Map();
 for(const row of internal)if(row.company.comparisonEligible){const group=groups.get(row.group)||{product:row.candidate.relationship.product,role:row.candidate.relationship.role,stage:row.candidate.relationship.stage,listingMarket:row.candidate.listingMarket,members:[]};group.members.push(row.candidate.id);groups.set(row.group,group);}
 const comparisons=[];
 for(let i=0;i<internal.length;i++)for(let j=i+1;j<internal.length;j++){
  const a=internal[i],b=internal[j],reasons=[...a.company.reasonCodes,...b.company.reasonCodes];
  if(a.candidate.issuerId===b.candidate.issuerId||a.candidate.securityId===b.candidate.securityId)reasons.push('SAME_ISSUER_OR_SECURITY');
  if(a.group!==b.group)reasons.push('STRICT_COHORT_MISMATCH');
  if(a.candidate.benchmarkId!==b.candidate.benchmarkId)reasons.push('BENCHMARK_MISMATCH');
  if(priceBasisKey(a.priceContract)!==priceBasisKey(b.priceContract))reasons.push('PRICE_BASIS_MISMATCH');
  if(!a.price||!b.price)reasons.push('PRICE_RESULT_UNAVAILABLE');
  if([a,b].some(r=>r.company.metrics.priceReturn.reasonCodes.some(c=>['HALTED','NO_TRADES'].includes(c))))reasons.push('TRADING_STATUS_INELIGIBLE');
  const reference=[a,b].some(r=>r.company.metrics.priceReturn.state==='REFERENCE');
  comparisons.push({assetA:a.candidate.id,assetB:b.candidate.id,value:reasons.length?null:serialize(sub(a.price,b.price),{places:policy.returnDisplayPlaces}),unit:'PERCENTAGE_POINT',state:reasons.length?'HOLD':reference?'REFERENCE':'DISPLAY',reasonCodes:unique([...reasons,...reference?['REFERENCE_INPUT']:[]]),baseDate:period.baseDate,endDate:period.endDate,observedSessions:period.observedSessions,targetSessions:period.targetSessions,independentSignalCount:reasons.length?0:1,calculationVersion:policy.calculationVersion,snapshotId:input.snapshotId,
   timeMode:period.mode,calendarVersion:period.calendarVersion,
   comparisonBasis:reasons.length?null:{currency:a.priceContract.currency,venueScope:a.priceContract.venueScope,sessionScope:a.priceContract.sessionScope,aggregationScope:a.priceContract.aggregationScope,definitionVersion:a.priceContract.definitionVersion,adjustment:{method:a.priceContract.adjustmentMethod,version:a.priceContract.adjustmentVersion}},
   sourceIds:unique([...a.company.metrics.priceReturn.sourceIds,...b.company.metrics.priceReturn.sourceIds]),rawSnapshotIds:unique([...a.company.metrics.priceReturn.rawSnapshotIds,...b.company.metrics.priceReturn.rawSnapshotIds])});
 }
 const metrics=companies.flatMap(c=>[c.metrics.priceReturn,c.metrics.benchmarkDifference,c.metrics.preReturn,...Object.values(c.metrics.turnover).filter(v=>v&&typeof v==='object')]);
 const available=metrics.filter(m=>m.value!==null).length;
 return {...base,asOf:input.asOf,snapshotId:input.snapshotId,informationMode:input.informationMode,period,
  execution:!available?'HELD':metrics.some(m=>m.state==='HOLD')||exclusions.length?'PARTIAL':'COMPLETE',
  evidence:companies.some(c=>c.reasonCodes.length)?'PARTIAL':companies.length?'VERIFIED':'UNVERIFIED',
  freshness:metrics.some(m=>m.reasonCodes.includes('STALE'))?'STALE':metrics.some(m=>m.reasonCodes.includes('FRESHNESS_UNKNOWN'))?'UNKNOWN':'AS_OF_INPUT',
  reasonCodes:unique([...period.reasonCodes,...selectionReasons]),cohort:{...input.cohort,eventMembers:companies.map(c=>c.id),strictGroups:[...groups.values()],ordering:'FROZEN_EVIDENCE_ORDER',priceRanked:false},companies,comparisons,exclusions};
}
