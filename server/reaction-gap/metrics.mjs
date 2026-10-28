import policy from '../../config/reaction-gap.json' with {type:'json'};
import {mean,percentChange,sub,div,serialize} from './decimal.mjs';
import {unique,known} from './input.mjs';

const scopeKeys=['currency','venueScope','sessionScope','aggregationScope','definitionVersion','measure'];
export const scopeKey=c=>JSON.stringify(scopeKeys.map(k=>c?.[k]??null));
export const priceBasisKey=c=>JSON.stringify([c?.currency,c?.measure,c?.returnBasis,c?.adjustmentMethod,c?.adjustmentVersion,c?.definitionVersion,c?.venueScope,c?.sessionScope,c?.aggregationScope]);
function check(series,dates,range,kind,asset){
 const rows=dates.map(date=>series.map.get(date)),reasons=[...series.errors,...(!range.complete?range.reasonCodes:[])];
 if(series.missing)reasons.push(kind==='turnover'?'MISSING_ACTUAL_TURNOVER':'MISSING_VALUE');
 for(let i=0;i<dates.length;i++){
  const row=rows[i];if(!row){reasons.push(kind==='turnover'?'MISSING_ACTUAL_TURNOVER':i===0||i===dates.length-1?'ENDPOINT_MISSING':'INCOMPLETE_PRICE_WINDOW');continue;}
  reasons.push(...row.issues);
 }
 if(rows.filter(Boolean).length!==dates.length)reasons.push(kind==='turnover'?'INCOMPLETE_WINDOW':'INCOMPLETE_PRICE_WINDOW');
 const contracts=rows.filter(r=>r?.contract).map(r=>r.contract);
 if(new Set(contracts.map(scopeKey)).size>1)reasons.push('SCOPE_MISMATCH');
 if(kind!=='turnover'&&new Set(contracts.map(c=>JSON.stringify([c.adjustmentMethod,c.adjustmentVersion,c.returnBasis]))).size>1)reasons.push('ADJUSTMENT_MISMATCH');
 if(asset&&dates.some(date=>date<asset.validFrom||asset.validTo!==null&&date>asset.validTo))reasons.push('IDENTITY_OUT_OF_RANGE');
 if(!dates.length)reasons.push('NO_COMPLETED_SESSION');
 return {rows:rows.filter(Boolean),contract:contracts[0]||series.contract,reasons:unique(reasons),dates};
}
function metadata(checked,period,input){
 const c=checked.contract,lineage=checked.rows.flatMap(r=>r.lineage||[]);
 return {baseDate:checked.dates[0]||null,endDate:checked.dates.at(-1)||null,sourceIds:unique(lineage.map(x=>x.sourceId).filter(Boolean)),rawSnapshotIds:unique(lineage.map(x=>x.rawSnapshotId).filter(Boolean)),
  provenance:checked.rows.map((r,i)=>({date:r.date||checked.dates[i],lineage:r.lineage||[],supersededLineage:r.supersededLineage||[]})),
  timeMode:period.mode,venueScope:c.venueScope||null,sessionScope:c.sessionScope||null,aggregationScope:c.aggregationScope||null,
  adjustment:{method:c.adjustmentMethod||null,version:c.adjustmentVersion||null},calendarVersion:period.calendarVersion,
  calculationVersion:policy.calculationVersion,snapshotId:input.snapshotId};
}
function metric(value,unit,checked,period,input,{hold=[],reference=[],target=period.targetSessions,observed=period.observedSessions,places=policy.returnDisplayPlaces}={}){
 const blocked=unique([...checked.reasons,...hold,...(period.state==='HOLD'?period.reasonCodes:[])]),warnings=[...reference,...(period.state==='REFERENCE'?period.reasonCodes:[])];
 if(input.informationMode==='RETROSPECTIVE')warnings.push('RETROSPECTIVE_COMPARISON');
 if(checked.rows.some(r=>r.status==='HALTED'))warnings.push('HALTED');
 if(checked.rows.some(r=>r.status==='NO_TRADES'))warnings.push('NO_TRADES');
 const contracts=checked.rows.map(r=>r.contract).filter(Boolean);
 if(contracts.some(c=>c.freshness==='STALE'))warnings.push('STALE');
 if(contracts.some(c=>c.freshness!=='CURRENT'&&c.freshness!=='STALE'))warnings.push('FRESHNESS_UNKNOWN');
 if(contracts.some(c=>c.upstreamStatus==='ERROR'))warnings.push('UPSTREAM_ERROR');
 if(contracts.some(c=>!['OK','ERROR'].includes(c.upstreamStatus)))warnings.push('UPSTREAM_STATE_UNVERIFIED');
 return {value:blocked.length||!value?null:serialize(value,{places}),unit,state:blocked.length||!value?'HOLD':warnings.length?'REFERENCE':'DISPLAY',reasonCodes:unique([...blocked,...warnings]),observedSessions:observed,targetSessions:target,observations:checked.rows.length,...metadata(checked,period,input)};
}
const canCalculate=c=>!c.reasons.length&&c.rows.length>0;
const returnOf=c=>canCalculate(c)?percentChange(c.rows[0].value,c.rows.at(-1).value):null;
const meanOf=c=>canCalculate(c)?mean(c.rows.map(r=>r.value)):null;

export function calculateMetrics(candidate,series,benchmark,period,input,eligibility){
 const p=check(series.price,period.priceDates,period.ranges.price,'price',candidate);
 const prior=check(series.price,period.prePriceDates,period.ranges.prePrice,'price',candidate);
 const pre=check(series.turnover,period.preTurnoverDates,period.ranges.preTurnover,'turnover',candidate);
 const post=check(series.turnover,period.postTurnoverDates,period.ranges.postTurnover,'turnover',candidate);
 if(pre.reasons.includes('INCOMPLETE_WINDOW'))pre.reasons.push('INCOMPLETE_PRE_WINDOW');
 if(post.reasons.includes('INCOMPLETE_WINDOW'))post.reasons.push('INCOMPLETE_POST_WINDOW');
 // Turnover aggregation is independent of price adjustment, but must describe
 // the same venue/session. No closing-price-times-volume fallback exists.
 const turnoverScope=c=>!known(p.contract.venueScope)||!known(p.contract.sessionScope)?['SCOPE_UNVERIFIED']:
  c.venueScope!==p.contract.venueScope||c.sessionScope!==p.contract.sessionScope?['SCOPE_MISMATCH']:[];
 const preHold=turnoverScope(pre.contract),postHold=turnoverScope(post.contract);
 const value=returnOf(p),preValue=meanOf(pre),postValue=meanOf(post);
 const price=metric(value,'PERCENT',p,period,input,{hold:eligibility});
 const preReturn=metric(returnOf(prior),'PERCENT',prior,period,input,{hold:eligibility,target:policy.preSessions,observed:Math.max(0,prior.rows.length-1)});
 const preMean=metric(preValue,'KRW',pre,period,input,{hold:[...eligibility,...preHold],target:policy.preSessions,observed:pre.rows.filter(r=>!r.issues.length).length,places:policy.amountDisplayPlaces});
 const postMean=metric(postValue,'KRW',post,period,input,{hold:[...eligibility,...postHold],observed:post.rows.filter(r=>!r.issues.length).length,places:policy.amountDisplayPlaces});
 const ratioHold=[...eligibility,...preHold,...postHold,...pre.reasons,...post.reasons];
 if(scopeKey(pre.contract)!==scopeKey(post.contract))ratioHold.push('SCOPE_MISMATCH');
 if(preValue?.n===0n)ratioHold.push('ZERO_BASE_TURNOVER');
 const multiple=metric(preValue?.n>0n&&postValue?div(postValue,preValue):null,'MULTIPLE',{...post,rows:[...pre.rows,...post.rows]},period,input,{hold:ratioHold,places:policy.ratioDisplayPlaces});
 const b=check(benchmark,period.priceDates,period.ranges.price,'benchmark');
 const benchmarkHold=[];
 if(benchmark.missing)benchmarkHold.push('BENCHMARK_MISSING');
 if(candidate.benchmarkId!==candidate.listingMarket||!['KOSPI','KOSDAQ'].includes(candidate.listingMarket)||benchmark.id!==candidate.benchmarkId||benchmark.listingMarket!==candidate.listingMarket)benchmarkHold.push('BENCHMARK_MISMATCH');
 if(p.contract.returnBasis!==b.contract.returnBasis||p.contract.venueScope!==b.contract.venueScope||p.contract.sessionScope!==b.contract.sessionScope)benchmarkHold.push('BENCHMARK_MISMATCH');
 const benchmarkValue=returnOf(b),benchmarkReturn=metric(benchmarkValue,'PERCENT',b,period,input,{hold:[...eligibility,...benchmarkHold]});
 const difference=metric(value&&benchmarkValue?sub(value,benchmarkValue):null,'PERCENTAGE_POINT',{...p,rows:[...p.rows,...b.rows]},period,input,{hold:[...eligibility,...p.reasons,...b.reasons,...benchmarkHold]});
 return {priceReturn:price,benchmarkReturn,benchmarkDifference:difference,preReturn,turnover:{preMean,postMean,multiple,interpretation:'RELATIVE_ACTIVITY_NOT_ABSOLUTE_SCALE'},_priceValue:price.value?value:null,_priceContract:p.contract};
}
