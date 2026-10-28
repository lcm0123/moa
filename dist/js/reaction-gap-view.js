// Display only. Values, periods and comparisons come from one server snapshot.
// No requests, browser storage, financial calculation or sample-data fallback.
import {escapeHtml as esc} from './components.js';
import {safeComparisonUrl} from './comparison-model.js';

const modes={EVENT:'사건 비교',DATE_REFERENCE:'공개일 참고',FIXED_WINDOW:'고정기간 비교'};
const statuses={WAITING:['비교 준비 중','저장된 자료와 근거를 확인하고 있습니다.'],QUEUED:['비교 대기 중','서버의 계산 순서를 기다리고 있습니다.'],RUNNING:['비교 중','같은 기간의 저장 자료를 확인하고 있습니다.'],COMPLETE:['비교 결과',''],PARTIAL:['일부 지표 확인','확인된 지표와 보류된 지표를 함께 표시합니다.'],HELD:['비교 보류','아래 자료 조건을 확인하기 전에는 값을 표시할 수 없습니다.'],FAILED:['비교하지 못했습니다','작업이 완료되지 않았습니다. 기존 뉴스·기업 정보는 계속 볼 수 있습니다.'],CANCELLED:['비교 취소됨','이 작업은 취소되었습니다.'],INVALIDATED:['자료가 변경되었습니다','기존 비교값의 유효성을 확인할 수 없어 표시를 중단했습니다.'],OFF:['비교 기능이 꺼져 있습니다','기존 뉴스·기업 정보는 계속 볼 수 있습니다.'],ACCESS_DENIED:['비교 자료를 볼 수 없습니다','자료 접근 권한을 확인해 주세요.'],TIMEOUT:['비교 확인이 지연되고 있습니다','자동 조회를 멈췄습니다. 다음 방문에서 저장 상태를 확인할 수 있습니다.'],ERROR:['비교 결과를 불러오지 못했습니다','연결 상태를 확인한 뒤 다시 방문해 주세요.']};
const reasons={
 PERIOD_MISMATCH:'지표의 기준일·종료일이 공통 비교기간과 다릅니다',OLDER_VERSION:'이미 확인한 결과보다 이전 버전이어서 표시를 보류합니다',
 MISSING_ACTUAL_TURNOVER:'실제 거래대금 자료가 없습니다',MISSING_VALUE:'필요한 관측값이 없습니다',ENDPOINT_MISSING:'기준일 또는 종료일의 가격이 없습니다',INCOMPLETE_PRICE_WINDOW:'해당 기간의 가격 자료가 부족합니다',INCOMPLETE_PRE_WINDOW:'이전 기준기간의 거래대금이 부족합니다',INCOMPLETE_POST_WINDOW:'이후 관측기간의 거래대금이 부족합니다',INCOMPLETE_WINDOW:'관측기간의 자료가 부족합니다',CALENDAR_RANGE_INCOMPLETE:'필요한 이전 거래일 범위가 부족합니다',CALENDAR_UNVERIFIED:'거래일 캘린더를 확인하지 못했습니다',INVALID_CALENDAR:'거래일 캘린더를 확인하지 못했습니다',COMPLETION_UNVERIFIED:'자료의 완료 여부를 확인하지 못했습니다',UNFINALIZED_DATA:'아직 확정되지 않은 자료입니다',NO_COMPLETED_SESSION:'아직 완료된 거래일이 없습니다',END_DATE_NOT_COMPLETED:'종료일 자료가 아직 완료되지 않았습니다',OBSERVATION_INCOMPLETE:'관측기간이 아직 끝나지 않았습니다',DATE_REFERENCE:'발표시각 미확인 · 공개일 기준 참고값입니다',EVENT_TIME_UNVERIFIED:'발표시각을 확인하지 못했습니다',INTRADAY_REFERENCE:'장중 발표 · 사건 이전 움직임이 포함될 수 있습니다',EVENT_DATE_MISMATCH:'사건 날짜와 발표시각이 일치하지 않습니다',RETROSPECTIVE_COMPARISON:'현재 확보한 근거로 과거를 비교한 결과입니다',REFERENCE_INPUT:'참고 조건이 포함된 비교입니다',
 CONTRACT_UNVERIFIED:'자료의 정의를 확인하지 못했습니다',SCOPE_UNVERIFIED:'거래시장·집계 범위를 확인하지 못했습니다',SCOPE_MISMATCH:'거래시장·집계 범위가 다릅니다',SESSION_MISMATCH:'거래 세션이 다릅니다',UNIT_MISMATCH:'금액·가격의 단위가 맞지 않습니다',ADJUSTMENT_UNVERIFIED:'주가 조정 기준을 확인하지 못했습니다',ADJUSTMENT_MISMATCH:'주가 조정 기준이 다릅니다',PRICE_BASIS_MISMATCH:'가격의 비교 기준이 다릅니다',PRICE_DEFINITION_MISMATCH:'가격 정의를 확인하지 못했습니다',BENCHMARK_MISSING:'같은 기간의 지수 자료가 없습니다',BENCHMARK_MISMATCH:'종목과 지수의 비교 기준이 다릅니다',BENCHMARK_DEFINITION_MISMATCH:'지수 정의를 확인하지 못했습니다',ZERO_BASE_TURNOVER:'이전 일평균 거래대금이 0이어서 배수를 계산할 수 없습니다',
 DISPLAY_NOT_ALLOWED:'이 지표의 표시 허용 여부를 확인하지 못했습니다',RIGHTS_UNCONFIRMED:'자료를 표시할 수 있는 이용범위가 미확인입니다',TEST_ONLY_POLICY_ON_REAL_DATA:'실제 자료에 테스트용 기준을 적용할 수 없습니다',SNAPSHOT_MISMATCH:'서로 다른 자료 버전이어서 표시를 보류합니다',CALCULATION_VERSION_MISMATCH:'계산 버전이 일치하지 않습니다',INVALID_DISPLAY_VALUE:'표시할 수 있는 숫자를 확인하지 못했습니다',UNIT_UNSUPPORTED:'표시 단위를 확인하지 못했습니다',
 EVIDENCE_UNVERIFIED:'사업 연결 근거를 확인하지 못했습니다',EVIDENCE_TIME_UNVERIFIED:'사업 근거의 공개 시점을 확인하지 못했습니다',EVIDENCE_REVOKED:'사업 근거가 철회되었습니다',EVENT_REVOKED:'사건 근거가 철회되었습니다',SOURCE_NOT_ALLOWED:'원문 접근 권한이 없습니다',SOURCE_ACCESS_DENIED:'원문 접근 권한이 없습니다',SOURCE_PERMISSION_CHECK_FAILED:'원문 접근 권한을 확인하지 못했습니다',EVIDENCE_CHANGED:'사업 근거가 변경되었습니다',IDENTITY_INVALID:'기업·증권 식별을 확인하지 못했습니다',IDENTITY_OUT_OF_RANGE:'해당 기간의 상장·기업 식별 정보가 부족합니다',SERIES_IDENTITY_MISMATCH:'시세의 기업·증권 식별자가 다릅니다',SECURITY_TYPE_INELIGIBLE:'이 증권 유형은 비교 대상이 아닙니다',LISTING_MARKET_UNVERIFIED:'상장시장을 확인하지 못했습니다',STRICT_COHORT_MISMATCH:'사업 역할·제품·비교 범위가 다릅니다',PRICE_RESULT_UNAVAILABLE:'비교 가능한 가격수익률이 부족합니다',
 UPSTREAM_ERROR:'외부 자료 조회에 실패했습니다',UPSTREAM_STATE_UNVERIFIED:'외부 자료 상태를 확인하지 못했습니다',STALE:'마지막 저장 자료입니다',FRESHNESS_UNKNOWN:'자료의 갱신 상태를 확인하지 못했습니다',HALTED:'거래정지 기간이 포함되어 있습니다',NO_TRADES:'거래가 없는 날이 포함되어 있습니다',MARKET_OR_CONTRACT_CHANGED:'시세 또는 자료 기준이 변경되었습니다',INVALIDATED:'저장된 결과의 유효성을 확인하지 못했습니다',FEATURE_DISABLED:'비교 기능이 비활성 상태입니다',ACCESS_REQUIRED:'실행 권한이 필요합니다',NOT_FOUND:'결과를 찾을 수 없거나 조회 권한이 없습니다',VERSION_NOT_FOUND:'요청한 결과 버전을 조회할 수 없습니다',RESULT_NOT_READY:'아직 저장된 비교 결과가 없습니다',RESPONSE_VERSION_UNSUPPORTED:'서버 응답 형식을 확인하지 못했습니다'
};
const commonReasons=new Set(['RETROSPECTIVE_COMPARISON','REFERENCE_INPUT','OBSERVATION_INCOMPLETE','DATE_REFERENCE']);
const referenceReasons=new Set([...commonReasons,'EVENT_TIME_UNVERIFIED','INTRADAY_REFERENCE','HALTED','NO_TRADES','STALE','FRESHNESS_UNKNOWN','UPSTREAM_ERROR','UPSTREAM_STATE_UNVERIFIED']);
const unique=items=>[...new Set(items)];
const text=value=>typeof value==='string'?value:'';
const reasonKey=value=>text(value).trim().replace(/[.。]+$/u,'').trim();
function uniqueReasons(items){const seen=new Set();return items.filter(item=>{const key=reasonKey(item);if(!key||seen.has(key))return false;seen.add(key);return true;});}
const bounded=(value,max=300)=>text(value).slice(0,max);
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value))?value:null;
const counter=value=>Number.isSafeInteger(value)&&value>=0?String(value):null;
const visibleStates=new Set(['DISPLAY','REFERENCE']);
export function reactionGapReason(code){
 if(reasons[code])return reasons[code];
 if(/^HTTP_(401|402|403)$|^FSC_(20|29|30|31)$/.test(text(code)))return '외부 자료의 접근 권한 확인이 필요합니다';
 if(/^HTTP_429$|^FSC_(22|23)$/.test(text(code)))return '외부 자료의 조회 한도에 도달했습니다';
 if(/TIMEOUT|DEADLINE/.test(text(code)))return '자료 확인 시간이 초과되었습니다';
 if(/SCHEMA|RAW_|REVISION/.test(text(code)))return '원자료 형식·정정 이력을 확인하지 못했습니다';
 return '자료 조건을 확인하지 못해 표시를 보류합니다';
}
function reasonText(codes,{common=true}={}){return uniqueReasons((Array.isArray(codes)?codes:[]).filter(c=>common||!commonReasons.has(c)).map(reactionGapReason));}

/** Server display decimal only; grouping/signs never convert an amount to Number. */
export function reactionGapExactText(value,unit){
 const raw=text(value?.display);if(!/^-?\d+(?:\.\d+)?$/.test(raw)||raw.length>240)return null;
 const positive=!raw.startsWith('-')&&!/^0+(?:\.0+)?$/.test(raw),parts=raw.split('.');
 let formatted=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(parts.length>1?'.'+parts[1]:'');
 if(unit==='PERCENT'||unit==='PERCENTAGE_POINT')return (positive?'+':'')+formatted+(unit==='PERCENT'?'%':'%p');
 if(unit==='MULTIPLE'||unit==='KRW'){formatted=formatted.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');return formatted+(unit==='MULTIPLE'?'배':'원');}
 return null;
}
function metricModel(metric,expectedUnit,response,allowed,expectedPeriod=null){
 const codes=Array.isArray(metric?.reasonCodes)?[...metric.reasonCodes]:[],snapshot=response.snapshotId,calculation=response.result?.calculationVersion;
 if(allowed!==true&&!codes.some(code=>!referenceReasons.has(code)))codes.push('DISPLAY_NOT_ALLOWED');
 if(metric?.snapshotId!==snapshot)codes.push('SNAPSHOT_MISMATCH');
 if(!text(calculation)||metric?.calculationVersion!==calculation)codes.push('CALCULATION_VERSION_MISMATCH');
 if(expectedPeriod&&metric?.value!==null&&metric?.value!==undefined&&(!date(metric?.baseDate)||!date(metric?.endDate)||metric.baseDate!==expectedPeriod.baseDate||metric.endDate!==expectedPeriod.endDate))codes.push('PERIOD_MISMATCH');
 if(metric?.unit!==expectedUnit)codes.push('UNIT_UNSUPPORTED');
 const output=reactionGapExactText(metric?.value,expectedUnit);
 if(metric?.value!==null&&metric?.value!==undefined&&!output)codes.push('INVALID_DISPLAY_VALUE');
 const available=allowed===true&&visibleStates.has(metric?.state)&&metric?.value!==null&&!!output&&metric?.unit===expectedUnit&&metric?.snapshotId===snapshot&&metric?.calculationVersion===calculation&&!codes.some(code=>!referenceReasons.has(code));
 return {available,text:available?output:null,state:available?metric.state:'HOLD',reasons:reasonText(codes,{common:!available}),baseDate:date(metric?.baseDate),endDate:date(metric?.endDate),observed:counter(metric?.observedSessions),target:counter(metric?.targetSessions)};
}
function stockHref(market,ticker){return market==='KR'&&/^\d{6}$/.test(ticker)||market==='US'&&/^[A-Z0-9][A-Z0-9.^_/-]{0,23}$/.test(ticker)?'/stock/'+market+'/'+encodeURIComponent(ticker):null;}
function permission(company,name){const p=company?.metricDisplayAllowed;return name.startsWith('turnover.')?p?.turnover?.[name.slice(9)]:p?.[name];}
function sourceDate(value){if(date(value))return value;const s=text(value);if(!/^\d{4}-\d{2}-\d{2}T/.test(s)||!Number.isFinite(Date.parse(s)))return null;return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));}

export function reactionGapModel(response){
 if(response?.responseVersion!=='reaction-gap-response-2')return {kind:'status',state:'ERROR',reasons:['RESPONSE_VERSION_UNSUPPORTED']};
 if(['CANCELLED','INVALIDATED','OFF','ACCESS_DENIED'].includes(response.state))return {kind:'status',state:response.state,reasons:Array.isArray(response.reasonCodes)?response.reasonCodes:[]};
 if(!response.result)return {kind:'status',state:statuses[response.state]?response.state:'WAITING',reasons:unique([...(response.reasonCodes||[]),...response.errorCode?[response.errorCode]:[]])};
 const r=response.result,p=response.presentation||{};
 if(!response.snapshotId||r.snapshotId!==response.snapshotId)return {kind:'status',state:'INVALIDATED',reasons:['SNAPSHOT_MISMATCH']};
 const period=r.period||{},presentation=new Map((Array.isArray(p.companies)?p.companies:[]).map(c=>[c.id,c]));
 const companies=(Array.isArray(r.companies)?r.companies:[]).map(company=>{
  const detail=presentation.get(company.id)||{},m=company.metrics||{},benchmark=p.benchmarks?.[company.listingMarket],ticker=bounded(detail.ticker,24),market=['KR','US'].includes(detail.market)?detail.market:'';
  const labels=benchmark?.kind==='MARKET_PRICE'&&text(benchmark.label)?bounded(benchmark.label,40)+' 대비':benchmark?.kind==='SECTOR_PRICE'&&text(benchmark.label)?bounded(benchmark.label,40)+' 업종 대비':'기준 지수 대비';
  return {id:company.id,name:bounded(detail.name,120)||ticker||'기업명 미확인',ticker,market,listingMarket:bounded(detail.listingMarket||company.listingMarket,24),href:stockHref(market,ticker),comparisonEligible:company.comparisonEligible===true,
   relationship:bounded(detail.relationshipLabel)||'사업 연결 설명 미제공',limitations:uniqueReasons([...(Array.isArray(detail.limitations)?detail.limitations.map(v=>bounded(v)):[]),...reasonText(company.reasonCodes)]),
   sources:(Array.isArray(detail.sources)?detail.sources:[]).map(s=>({title:bounded(s.title,160)||'사업 근거 원문',url:safeComparisonUrl(s.url),date:sourceDate(s.publishedAt)})).filter(s=>s.url),benchmarkLabel:labels,
   metrics:{priceReturn:metricModel(m.priceReturn,'PERCENT',response,permission(detail,'priceReturn'),period),benchmarkDifference:metricModel(m.benchmarkDifference,'PERCENTAGE_POINT',response,permission(detail,'benchmarkDifference'),period),preReturn:metricModel(m.preReturn,'PERCENT',response,permission(detail,'preReturn')),turnover:{multiple:metricModel(m.turnover?.multiple,'MULTIPLE',response,permission(detail,'turnover.multiple')),preMean:metricModel(m.turnover?.preMean,'KRW',response,permission(detail,'turnover.preMean')),postMean:metricModel(m.turnover?.postMean,'KRW',response,permission(detail,'turnover.postMean'))}}};
 });
 const byId=new Map(companies.map(c=>[c.id,c])),comparisons=[];
 for(const comparison of r.comparisons||[]){
  const a=byId.get(comparison.assetA),b=byId.get(comparison.assetB),value=metricModel(comparison,'PERCENTAGE_POINT',response,true);
  if(!a?.comparisonEligible||!b?.comparisonEligible||!a.metrics.priceReturn.available||!b.metrics.priceReturn.available||!value.available||!comparison.comparisonBasis)continue;
  comparisons.push({text:`같은 기간 ${a.name} − ${b.name}의 수익률 차이는 ${value.text}입니다.`,note:'두 기업의 실적 중요도가 같은지는 미확인입니다.'});
 }
 const notices=reasonText([...r.reasonCodes||[],...period.reasonCodes||[]]);
 if(Number.isSafeInteger(response.resultVersion)&&Number.isSafeInteger(response.version)&&response.resultVersion<response.version)notices.unshift(['QUEUED','RUNNING'].includes(response.state)?'이전 저장 결과 · 새 버전을 계산하고 있습니다':response.state==='FAILED'?'이전 저장 결과 · 이번 갱신은 완료되지 않았습니다':'서버가 표시를 허용한 이전 저장 결과입니다');
 if(r.informationMode==='RETROSPECTIVE')notices.unshift('현재 회고 비교 · 당시 추천 성과가 아닙니다');
 // Explain shared conditions once, while retaining each metric's distinct failure.
 // This only reduces repeated prose; it never changes values, states or permission.
 const pageReasons=new Set(notices.map(reasonKey));
 for(const company of companies){
  const m=company.metrics,main=[m.priceReturn,m.benchmarkDifference,m.turnover.multiple,m.turnover.preMean,m.turnover.postMean];
  const shared=main[0].reasons.filter(reason=>main.every(metric=>metric.reasons.some(value=>reasonKey(value)===reasonKey(reason))));
  company.limitations=uniqueReasons([...company.limitations,...shared]).filter(reason=>!pageReasons.has(reasonKey(reason)));
  const explained=new Set([...pageReasons,...company.limitations.map(reasonKey)]);
  for(const metric of [...main,m.preReturn]){
   const original=metric.reasons;metric.reasons=original.filter(reason=>!explained.has(reasonKey(reason)));
   metric.reasonsExplained=original.length>0&&metric.reasons.length===0;
  }
 }
 const observed=counter(period.observedSessions),target=counter(period.targetSessions),fixed=period.mode==='FIXED_WINDOW',dated=!!date(period.baseDate)&&!!date(period.endDate),countKnown=dated||(period.reasonCodes||[]).includes('NO_COMPLETED_SESSION');
 return {kind:'result',state:statuses[r.execution]?r.execution:'PARTIAL',snapshotId:response.snapshotId,calculationVersion:r.calculationVersion,testOnly:p.testOnly===true,eventLabel:bounded(p.eventLabel,500)||'기존 결과의 기업·사업 근거를 같은 기간으로 비교합니다.',mode:modes[period.mode]||'비교 기준 확인 중',baseDate:date(period.baseDate),endDate:date(period.endDate),observation:countKnown&&observed!==null&&target!==null?`${observed}/${target}${fixed?'거래간격':'거래일'} 관측`:null,preReturnLabel:fixed?'기준기간 이전 수익률':'사건 이전 수익률',notices:uniqueReasons(notices),companies,comparisons};
}
export function reactionGapStatusMarkup(state,reasonCodes=[]){
 const [label,message]=statuses[state]||statuses.ERROR,notes=reasonText(reasonCodes);
 return `<section class="reaction-gap rg-status" aria-label="반응 온도차"><h3>반응 온도차</h3><p class="rg-state" role="status">${esc(label)}</p>${message?`<p>${esc(message)}</p>`:''}${notes.length?`<ul class="rg-notices">${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}</section>`;
}
function periodText(m){return m.baseDate&&m.endDate?m.baseDate+' ~ '+m.endDate+(m.observed!==null?' · '+(m.observed==='0'?'자료 0일':m.observed+'거래일'):''):null;}
function metricMarkup(label,m,{period=false}={}){
 return `<div class="rg-metric ${m.available?'':'rg-metric-held'}"><dt>${esc(label)}</dt><dd>${m.available?`<strong>${esc(m.text)}</strong>${m.state==='REFERENCE'?'<span class="rg-reference">참고</span>':''}`:'<span class="rg-unavailable">보류</span>'}${m.reasons.length?`<span class="rg-metric-reason">${m.reasons.map(esc).join(' · ')}</span>`:!m.available&&!m.reasonsExplained?'<span class="rg-metric-reason">확인 가능한 값이 없습니다</span>':''}${period&&periodText(m)?`<span class="rg-metric-period">${esc(periodText(m))}</span>`:''}</dd></div>`;
}
export function reactionGapMarkup(model){
 if(!model||model.kind!=='result')return reactionGapStatusMarkup(model?.state||'ERROR',model?.reasons||[]);
 const [label]=statuses[model.state]||statuses.PARTIAL;
 return `<section class="reaction-gap" aria-label="반응 온도차" data-gap-snapshot="${esc(model.snapshotId)}"><header class="rg-header"><div><h3>반응 온도차</h3><p class="rg-event">${esc(model.eventLabel)}</p></div><span class="rg-state" role="status">${esc(label)}</span></header>${model.testOnly?'<p class="rg-test-banner">테스트용 가상 데이터 · 실제 종목 검증 결과가 아닙니다</p>':''}<div class="rg-period"><span>${esc(model.mode)}</span><span>${model.baseDate&&model.endDate?'종가 기준 '+esc(model.baseDate)+' ~ '+esc(model.endDate):'비교 기준일·종료일 확인 필요'}</span>${model.observation?`<span>${esc(model.observation)}</span>`:''}</div>${model.notices.length?`<ul class="rg-notices">${model.notices.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}<div class="rg-companies">${model.companies.map(c=>`<article class="rg-company"><header><h4>${c.href?`<a data-nav href="${esc(c.href)}">${esc(c.name)} <span aria-hidden="true">↗</span></a>`:esc(c.name)}</h4><span class="rg-company-id">${[c.market==='KR'?'국내':c.market==='US'?'미국':'',c.listingMarket,c.ticker].filter(Boolean).map(esc).join(' · ')}</span></header><p class="rg-relationship">${esc(c.relationship)}</p>${c.limitations.length?`<ul class="rg-notices rg-company-notices">${c.limitations.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}<dl class="rg-metrics">${metricMarkup('종가 수익률',c.metrics.priceReturn)}${metricMarkup(c.benchmarkLabel,c.metrics.benchmarkDifference)}${metricMarkup('거래대금 배수',c.metrics.turnover.multiple)}${metricMarkup('이전 일평균 거래대금',c.metrics.turnover.preMean,{period:true})}${metricMarkup('이후 일평균 거래대금',c.metrics.turnover.postMean,{period:true})}${metricMarkup(model.preReturnLabel,c.metrics.preReturn,{period:true})}</dl>${c.sources.length?`<ul class="rg-sources" aria-label="사업 연결 근거">${c.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><span>${s.date?'공개 '+esc(s.date):'공개일 미확인'}</span></li>`).join('')}</ul>`:'<p class="rg-source-missing">표시 가능한 사업 근거 원문 링크가 없습니다.</p>'}</article>`).join('')||'<p class="rg-empty">비교할 기업의 근거를 확인하지 못했습니다.</p>'}</div>${model.comparisons.length?`<div class="rg-comparisons">${model.comparisons.map(c=>`<p>${esc(c.text)}</p>`).join('')}<small>${esc(model.comparisons[0].note)}</small></div>`:''}<p class="rg-footnote">거래대금 배수는 이전 거래 규모와의 비교입니다. 자금 유입이나 향후 주가 상승을 뜻하지 않습니다.</p></section>`;
}
