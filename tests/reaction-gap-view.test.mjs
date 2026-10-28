import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateReactionGap} from '../server/reaction-gap/index.mjs';
import {fixture,rowAt} from './fixtures/reaction-gap.mjs';
import {reactionGapModel,reactionGapMarkup,reactionGapStatusMarkup,reactionGapExactText,reactionGapReason} from '../dist/js/reaction-gap-view.js';

// This view fixture is synthetic and labelled by the server presentation field.
// No live DB, API, news item or provider contract is represented by these values.
function response(input=fixture()){
 input.informationMode='RETROSPECTIVE';const result=calculateReactionGap(input);
 const metricDisplayAllowed={priceReturn:true,benchmarkDifference:true,preReturn:true,turnover:{preMean:true,postMean:true,multiple:true}};
 return {responseVersion:'reaction-gap-response-2',id:'fixture-gap',state:'COMPLETE',snapshotId:input.snapshotId,result,storedAt:'2099-12-31T23:00:00Z',presentation:{eventLabel:'시험용 전력망 설비 구매',testOnly:true,dataClass:'SYNTHETIC_TEST_ONLY',companies:[{id:'TEST:A',name:'온도차시험 가',ticker:'999991',market:'KR',listingMarket:'KOSPI',metricDisplayAllowed:structuredClone(metricDisplayAllowed),relationshipLabel:'고압 변압기 제조·판매 근거',limitations:['해당 프로젝트 납품 여부는 미확인'],sources:[{title:'시험기업 사업보고서',url:'https://issuer.fixture.invalid/annual',publishedAt:'2030-01-01'}]},{id:'TEST:B',name:'온도차시험 나',ticker:'999992',market:'KR',listingMarket:'KOSPI',metricDisplayAllowed:structuredClone(metricDisplayAllowed),relationshipLabel:'고압 변압기 제조·판매 근거',sources:[]}],benchmarks:{KOSPI:{label:'KOSPI',kind:'MARKET_PRICE'}}}};
}
const display=value=>({numerator:value,denominator:'1',decimal:value,decimalIsExact:true,display:value});

test('server values and units are displayed without recalculating returns or comparisons',()=>{
 const api=response(),model=reactionGapModel(api),html=reactionGapMarkup(model);
 assert.equal(model.companies[0].metrics.priceReturn.text,'+2.0%');
 assert.equal(model.companies[0].metrics.benchmarkDifference.text,'-2.0%p');
 assert.equal(model.companies[0].metrics.turnover.multiple.text,'1.1배');
 assert.equal(model.companies[0].metrics.turnover.preMean.text,'10,000,000,000원');
 assert.equal(model.companies[0].metrics.turnover.postMean.text,'11,000,000,000원');
 assert(html.includes('KOSPI 대비'));assert(html.includes('테스트용 가상 데이터'));assert(html.includes('현재 회고 비교'));
 assert(html.includes('해당 프로젝트 납품 여부는 미확인'));assert(html.includes('/stock/KR/999991'));assert(html.includes('공개 2030-01-01'));
 assert(!html.includes('2099-12-31'));assert(!html.includes('RETROSPECTIVE_COMPARISON'));assert(!html.includes('<button'));assert(!html.includes('<details'));assert(!html.includes('<canvas'));assert(!html.includes('<svg'));
 const comparison=api.result.comparisons[0];comparison.value={...comparison.value,display:'-999.7'};
 assert(reactionGapModel(api).comparisons[0].text.includes('-999.7%p'));
});

test('source order remains frozen rather than ranked by price changes',()=>{
 const api=response();api.presentation.companies.reverse();const model=reactionGapModel(api);
 assert.deepEqual(model.companies.map(c=>c.name),['온도차시험 가','온도차시험 나']);
 assert(model.comparisons[0].text.includes('온도차시험 가 − 온도차시험 나'));
});

test('exact display strings preserve values above Number precision and prohibit numeric coercion',()=>{
 assert.equal(reactionGapExactText(display('9007199254740993.123456789'),'KRW'),'9,007,199,254,740,993.123456789원');
 assert.equal(reactionGapExactText(display('0.0'),'PERCENT'),'0.0%');
 assert.equal(reactionGapExactText(display('0'),'KRW'),'0원');
 assert.equal(reactionGapExactText(display('1.10'),'MULTIPLE'),'1.1배');
 for(const value of [0,2,Infinity,'NaN','1e3','<img>'])assert.equal(reactionGapExactText({display:value},'PERCENT'),null);
 assert.equal(reactionGapExactText(display('1'),'USD'),null);
 const code=fs.readFileSync(new URL('../dist/js/reaction-gap-view.js',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\b(?:fetch|parseFloat|parseInt|Number)\s*\(/);assert.doesNotMatch(code,/localStorage|sessionStorage/);
});

test('actual zero is visible while null has a concrete reason',()=>{
 const api=response();api.result.companies[0].metrics.priceReturn.value=display('0.0');
 api.result.companies[0].metrics.turnover.multiple={...api.result.companies[0].metrics.turnover.multiple,value:null,state:'HOLD',reasonCodes:['ZERO_BASE_TURNOVER']};
 const model=reactionGapModel(api),html=reactionGapMarkup(model);
 assert.equal(model.companies[0].metrics.priceReturn.text,'0.0%');assert.equal(model.companies[0].metrics.turnover.multiple.text,null);
 assert(html.includes('이전 일평균 거래대금이 0'));assert(!html.includes('ZERO_BASE_TURNOVER'));
});

test('turnover-only missing data retains independently valid prices despite partial publication flag',()=>{
 const input=fixture();rowAt(input,'turnover',32).value=null;const api=response(input);api.result.publication.allowed=false;
 api.presentation.companies[0].metricDisplayAllowed.turnover.preMean=false;
 const model=reactionGapModel(api);assert.equal(model.companies[0].metrics.priceReturn.text,'+2.0%');
 assert.equal(model.companies[0].metrics.turnover.preMean.available,false);assert.equal(model.companies[0].metrics.turnover.postMean.available,true);
 assert(!model.companies[0].metrics.turnover.preMean.reasons.some(reason=>reason.includes('이용범위')));
 assert(reactionGapMarkup(model).includes('실제 거래대금 자료가 없습니다'));
});

test('price-only held data retains independently valid turnover and omits ineligible comparison sentences',()=>{
 const input=fixture();input.candidates[0].price.contract.corporateActionsVerified=false;const model=reactionGapModel(response(input));
 assert.equal(model.companies[0].metrics.priceReturn.available,false);assert.equal(model.companies[0].metrics.turnover.multiple.text,'1.1배');
 assert.equal(model.comparisons.length,0);assert(reactionGapMarkup(model).includes('주가 조정 기준'));
});

test('metric-specific permissions suppress just the denied metric, not all companies',()=>{
 const api=response();api.presentation.companies[0].metricDisplayAllowed.priceReturn=false;api.presentation.companies[0].metricDisplayAllowed.turnover.preMean=false;
 const model=reactionGapModel(api);assert.equal(model.companies[0].metrics.priceReturn.available,false);assert.equal(model.companies[0].metrics.turnover.preMean.available,false);
 assert.equal(model.companies[0].metrics.turnover.postMean.available,true);assert.equal(model.companies[1].metrics.priceReturn.available,true);assert.equal(model.comparisons.length,0);
});

test('missing presentation or per-metric permissions cannot publish raw calculation values',()=>{
 const api=response();delete api.presentation;
 const model=reactionGapModel(api);assert(model.companies.every(c=>!c.metrics.priceReturn.available&&!c.metrics.turnover.multiple.available));assert.equal(model.comparisons.length,0);
 const missing=response();delete missing.presentation.companies[0].metricDisplayAllowed;assert.equal(reactionGapModel(missing).companies[0].metrics.priceReturn.available,false);
});

test('server-authorized previous versions are explicitly separate from an active or failed refresh',()=>{
 const api=response();Object.assign(api,{version:2,resultVersion:1,state:'RUNNING'});
 assert(reactionGapMarkup(reactionGapModel(api)).includes('이전 저장 결과 · 새 버전을 계산하고 있습니다'));
 api.state='FAILED';const html=reactionGapMarkup(reactionGapModel(api));assert(html.includes('이전 저장 결과 · 이번 갱신은 완료되지 않았습니다'));assert(html.includes('+2.0%'));assert(!html.includes('2099-12-31'));
});

test('HELD status never fills a sample number and preserves per-metric state semantics',()=>{
 const input=fixture();input.calendar.verified=false;const api=response(input),model=reactionGapModel(api),html=reactionGapMarkup(model);
 assert.equal(model.state,'HELD');assert.equal(model.observation,null);assert(html.includes('거래일 캘린더를 확인하지 못했습니다'));assert(!html.includes('+2.0%'));assert(!html.includes('0/5'));
 const odd=response();odd.result.execution='HELD';assert.equal(reactionGapModel(odd).companies[0].metrics.priceReturn.available,true);
});

test('server 3/5 observations and DATE_REFERENCE stay explicit without extending the period',()=>{
 const api=response(fixture({observed:3,mode:'DATE_REFERENCE'})),model=reactionGapModel(api),html=reactionGapMarkup(model);
 assert.equal(model.observation,'3/5거래일 관측');assert.equal(model.mode,'공개일 참고');assert.equal(model.endDate,api.result.period.endDate);
 assert(html.includes('3/5거래일 관측'));assert(html.includes('발표시각 미확인'));assert(html.includes(api.result.period.baseDate));
});

test('fixed windows use trade intervals and do not label a prior window as an event',()=>{
 const model=reactionGapModel(response(fixture({mode:'FIXED_WINDOW'}))),html=reactionGapMarkup(model);
 assert.equal(model.mode,'고정기간 비교');assert.equal(model.observation,'20/20거래간격 관측');assert(html.includes('기준기간 이전 수익률'));assert(!html.includes('사건 이전 수익률'));
});

test('test banner is shown only for the server explicit test-only marker',()=>{
 const api=response();delete api.presentation.testOnly;
 assert(!reactionGapMarkup(reactionGapModel(api)).includes('테스트용 가상 데이터'));
 api.presentation.testOnly='true';assert(!reactionGapModel(api).testOnly);
});

test('mixed metric snapshots and calculation versions are not displayed',()=>{
 const api=response();api.result.companies[0].metrics.priceReturn.snapshotId='old-snapshot';api.result.companies[1].metrics.turnover.multiple.calculationVersion='old-calculation';
 const model=reactionGapModel(api);assert.equal(model.companies[0].metrics.priceReturn.available,false);assert.equal(model.companies[1].metrics.turnover.multiple.available,false);assert.equal(model.comparisons.length,0);
 api.result.snapshotId='old-snapshot';assert.equal(reactionGapModel(api).state,'INVALIDATED');
});

test('a HOLD value or a contradictory hard reason can never become a visible number',()=>{
 const api=response();api.result.companies[0].metrics.priceReturn.state='HOLD';api.result.companies[1].metrics.priceReturn.reasonCodes.push('RIGHTS_UNCONFIRMED');
 const model=reactionGapModel(api);assert.equal(model.companies[0].metrics.priceReturn.available,false);assert.equal(model.companies[1].metrics.priceReturn.available,false);assert.equal(model.comparisons.length,0);
});

test('escaped long Korean names, safe source links and stock links do not inject HTML',()=>{
 const api=response();api.presentation.eventLabel='<img src=x onerror=alert(1)>';api.presentation.companies[0].name='아주긴한글기업명'.repeat(20)+'<script>alert(1)</script>';
 api.presentation.companies[0].href='javascript:alert(1)';api.presentation.companies[0].sources.push({title:'bad',url:'javascript:alert(1)'});
 const html=reactionGapMarkup(reactionGapModel(api));assert(!html.includes('<img'));assert(!html.includes('<script'));assert(!html.includes('javascript:'));assert(html.includes('&lt;img'));
 assert(html.includes('rel="noopener noreferrer"'));assert(html.includes('href="/stock/KR/999991"'));
});

test('unavailable states are distinct Korean text without raw reason codes',()=>{
 for(const state of ['WAITING','RUNNING','FAILED','CANCELLED','HELD','INVALIDATED','OFF','ACCESS_DENIED','TIMEOUT','ERROR']){
  const html=reactionGapStatusMarkup(state,['HTTP_403']);assert(html.includes('반응 온도차'));assert(!html.includes('HTTP_403'));assert(!html.includes('<button'));assert(html.includes('role="status"'));
 }
 assert.notEqual(reactionGapStatusMarkup('OFF'),reactionGapStatusMarkup('ACCESS_DENIED'));
 assert.equal(reactionGapReason('UNRECOGNIZED_SECRET_INTERNAL_CODE'),'자료 조건을 확인하지 못해 표시를 보류합니다');
 assert.equal(reactionGapModel({responseVersion:'future-version'}).state,'ERROR');
});

test('stored stale results carry visible warning but are not fabricated on transport failure',()=>{
 const api=response();api.result.companies[0].metrics.priceReturn.reasonCodes.push('STALE','UPSTREAM_ERROR');
 const model=reactionGapModel(api);assert.equal(model.companies[0].metrics.priceReturn.available,true);assert(reactionGapMarkup(model).includes('마지막 저장 자료'));
 const missing=reactionGapModel({responseVersion:'reaction-gap-response-2',state:'FAILED',result:null,errorCode:'HTTP_429'});assert.equal(missing.kind,'status');assert(!reactionGapMarkup(missing).includes('+2.0%'));
});

test('responsive CSS provides a single narrow column, wrapping, keyboard focus and no fixed table width',()=>{
 const css=fs.readFileSync(new URL('../dist/styles/reaction-gap.css',import.meta.url),'utf8');
 assert(css.includes('@media(max-width:520px)'));assert(css.includes('grid-template-columns:1fr'));assert(css.includes('overflow-wrap:anywhere'));assert(css.includes(':focus-visible'));assert(css.includes('min-width:0'));assert(!css.includes('min-width:1000px'));
});

test('conditions common to five main metrics are explained once per company and punctuation does not duplicate them',()=>{
 const api=response();api.result.companies=api.result.companies.slice(0,1);api.result.comparisons=[];
 const c=api.result.companies[0],m=c.metrics,main=[m.priceReturn,m.benchmarkDifference,m.turnover.multiple,m.turnover.preMean,m.turnover.postMean];
 api.presentation.companies[0].limitations=['사업 연결 근거를 확인하지 못했습니다.'];
 for(const metric of main)Object.assign(metric,{state:'HOLD',value:null,reasonCodes:['EVIDENCE_UNVERIFIED','CONTRACT_UNVERIFIED']});
 const model=reactionGapModel(api),html=reactionGapMarkup(model),visible=model.companies[0];
 assert.deepEqual(visible.limitations,['사업 연결 근거를 확인하지 못했습니다.','자료의 정의를 확인하지 못했습니다']);
 for(const metric of [visible.metrics.priceReturn,visible.metrics.benchmarkDifference,...Object.values(visible.metrics.turnover)]){assert.deepEqual(metric.reasons,[]);assert.equal(metric.reasonsExplained,true);assert.equal(metric.available,false);}
 assert.equal(html.split('사업 연결 근거를 확인하지 못했습니다').length-1,1);
 assert.equal(html.split('자료의 정의를 확인하지 못했습니다').length-1,1);
 assert(!html.includes('확인 가능한 값이 없습니다'),'explained held values do not add repetitive generic fallback');
});

test('page-wide conditions are not repeated below but turnover-specific missing data remains attached to its metric',()=>{
 const api=response();api.result.companies=api.result.companies.slice(0,1);api.result.comparisons=[];
 api.result.reasonCodes.push('CALENDAR_UNVERIFIED');
 const detail=api.presentation.companies[0];detail.limitations=['거래일 캘린더를 확인하지 못했습니다.'];
 const m=api.result.companies[0].metrics;
 for(const metric of [m.priceReturn,m.benchmarkDifference,m.turnover.multiple,m.turnover.preMean,m.turnover.postMean])Object.assign(metric,{state:'HOLD',value:null,reasonCodes:['CALENDAR_UNVERIFIED']});
 m.turnover.preMean.reasonCodes.push('MISSING_ACTUAL_TURNOVER');
 const model=reactionGapModel(api),html=reactionGapMarkup(model),visible=model.companies[0];
 assert.equal(html.split('거래일 캘린더를 확인하지 못했습니다').length-1,1);
 assert.deepEqual(visible.limitations,[]);assert.deepEqual(visible.metrics.priceReturn.reasons,[]);
 assert.deepEqual(visible.metrics.turnover.preMean.reasons,['실제 거래대금 자료가 없습니다']);
 assert.equal(visible.metrics.turnover.preMean.available,false);assert.equal(visible.metrics.turnover.preMean.reasonsExplained,false);
 assert(html.includes('실제 거래대금 자료가 없습니다'));
});

test('zero metric observations describe missing data days rather than zero trading days',()=>{
 const api=response();const metric=api.result.companies[0].metrics.turnover.preMean;
 Object.assign(metric,{observedSessions:0,state:'HOLD',value:null,reasonCodes:['MISSING_ACTUAL_TURNOVER']});
 const html=reactionGapMarkup(reactionGapModel(api));assert(html.includes(' · 자료 0일'));assert(!html.includes(' · 0거래일'));
});

test('cancelled, invalidated, disabled or denied envelopes cannot display a retained result',()=>{
 for(const state of ['CANCELLED','INVALIDATED','OFF','ACCESS_DENIED']){
  const api=response();api.state=state;const model=reactionGapModel(api),html=reactionGapMarkup(model);
  assert.equal(model.kind,'status');assert.equal(model.state,state);assert(!html.includes('+2.0%'));assert(!html.includes('/stock/KR/999991'));
 }
});

test('a price metric with a different period is held without discarding independently valid turnover',()=>{
 const api=response();api.result.companies[0].metrics.priceReturn.endDate='2030-01-01';
 const model=reactionGapModel(api),company=model.companies[0];assert.equal(company.metrics.priceReturn.available,false);assert.equal(company.metrics.turnover.multiple.available,true);
 assert.equal(model.comparisons.length,0);assert(reactionGapMarkup(model).includes('지표의 기준일·종료일이 공통 비교기간과 다릅니다'));
});

test('missing calculation version is not an implicit match between undefined metadata',()=>{
 const api=response();delete api.result.calculationVersion;delete api.result.companies[0].metrics.priceReturn.calculationVersion;
 assert.equal(reactionGapModel(api).companies[0].metrics.priceReturn.available,false);
});

test('a missing pre-event window remains visible with its held reason rather than disappearing',()=>{
 const api=response();Object.assign(api.result.companies[0].metrics.preReturn,{value:null,state:'HOLD',reasonCodes:['CALENDAR_RANGE_INCOMPLETE']});
 const html=reactionGapMarkup(reactionGapModel(api));assert(html.includes('사건 이전 수익률'));assert(html.includes('필요한 이전 거래일 범위가 부족합니다'));
});
