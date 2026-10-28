// Safe presentation metadata for one already-validated immutable snapshot.
// Metric values/formulas remain exclusively in the calculation core.
import {safeLink} from '../news-companies-model.mjs';
import {syntheticObservation} from './data.mjs';

const text=(value,max=200)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):null;
const eligible=metric=>metric?.value!==null&&metric?.value!==undefined&&['DISPLAY','REFERENCE'].includes(metric.state);
export function gapPresentation(input,manifest,result){
 const frozen=manifest.frozen,byId=new Map(input.candidates.map(candidate=>[candidate.id,candidate]));
 const testOnly=manifest.raw.length>0&&manifest.raw.every(row=>syntheticObservation(row.exact));
 const benchmarks=Object.fromEntries(input.benchmarks.map(benchmark=>[benchmark.id,{label:['KOSPI','KOSDAQ'].includes(benchmark.id)?benchmark.id:'비교 지수',kind:benchmark.contract?.indexKind||'UNKNOWN'}]));
 const companies=result.companies.map(company=>{
  const candidate=byId.get(company.id),relationship=company.relationship||{},proof=relationship.provenance,metrics=company.metrics;
  const sources=relationship.verified&&safeLink(proof?.sourceUrl)?[{title:text(proof.sourceTitle)||'사업 근거 원문',url:safeLink(proof.sourceUrl),publishedAt:proof.originalPublishedAt||relationship.publishedAt||null}]:[];
  const limitations=['두 기업의 실적 중요도가 같은지는 미확인입니다.'];
  if(relationship.stage!=='CONFIRMED_DELIVERY')limitations.unshift('제품·사업 근거이며 해당 프로젝트 납품 확인은 아닙니다.');
  if(!relationship.verified)limitations.unshift('사업 연결 근거를 확인하지 못했습니다.');
  if(relationship.role==='INDIRECT_PRODUCT_SELLER')limitations.push('간접 사업 연결로 직접 공급 관계와 구분합니다.');
  const ticker=text(candidate?.ticker,20),market=candidate?.market;
  return {id:company.id,name:text(candidate?.name)||ticker||'기업명 확인 중',ticker,market,listingMarket:company.listingMarket,
   href:market==='KR'&&/^\d{6}$/.test(ticker||'')?'/stock/KR/'+ticker:null,
   relationshipLabel:relationship.verified?(text(relationship.product,120)||'관련 제품')+(relationship.stage==='CONFIRMED_DELIVERY'?' · 해당 프로젝트 납품 확인':' 관련 사업 확인'):'사업 연결 확인 보류',
   limitations,sources,benchmarkId:candidate?.benchmarkId||null,
   metricDisplayAllowed:{priceReturn:manifest.disclosure[company.id+':price']===true&&eligible(metrics.priceReturn),benchmarkDifference:manifest.disclosure[company.id+':price']===true&&manifest.disclosure[company.listingMarket+':benchmark']===true&&eligible(metrics.benchmarkDifference),preReturn:manifest.disclosure[company.id+':price']===true&&eligible(metrics.preReturn),turnover:Object.fromEntries(['preMean','postMean','multiple'].map(key=>[key,manifest.disclosure[company.id+':turnover']===true&&eligible(metrics.turnover[key])]))}};
 });
 return {version:'reaction-gap-presentation-1',eventLabel:text(frozen.displayContext?.label,300)||(frozen.source.inputType==='IDEA'?'저장 아이디어의 사업 연결':'저장 뉴스의 사업 연결'),mode:result.period?.mode||frozen.window.mode,
  testOnly,dataClass:testOnly?'SYNTHETIC_TEST_ONLY':'ACTUAL_OR_UNVERIFIED',companies,benchmarks};
}
