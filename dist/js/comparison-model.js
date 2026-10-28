import {normalizeBars,subtractMonths} from './stock-chart-model.js';
export const comparisonVersion='company-comparison-1';
export const comparisonLabels={COMPARABLE:'같은 기준으로 비교',COMPARABLE_WITH_CAVEAT:'기준 차이 확인',NOT_COMPARABLE:'같은 기준 비교 불가'};
const known=v=>v!==null&&v!==undefined&&v!==''&&!['UNKNOWN','UNSPECIFIED','unverified'].includes(v);
export function parseComparisonSymbols(raw){
 const keys=String(raw||'').split(',').filter(Boolean);
 if(keys.length>4||keys.some(k=>!(/^(?:KR:[0-9][0-9A-Z]{5}|US:[A-Z0-9][A-Z0-9.^_/-]{0,23})$/).test(k)))throw Error('국내·미국 주식 2~4개를 선택해 주세요.');
 return [...new Set(keys)];
}
export function compareObservations(observations){
 const values=observations.filter(Boolean),reasons=[];
 if(values.length!==observations.length||values.length<2)return {status:'NOT_COMPARABLE',reasons:['비교할 값이 부족합니다.']};
 for(const [key,label]of [['metricId','지표 정의'],['unit','단위·통화'],['periodKind','기간 종류'],['periodEnd','기간 종료일'],['consolidationScope','연결·별도 범위']]){
  if(values.some(v=>!known(v[key])))reasons.push(label+' 미확인');
  else if(new Set(values.map(v=>v[key])).size>1)reasons.push(label+'가 다릅니다');
 }
 if(values.some(v=>v.availability!=='available'||!Number.isFinite(v.value)))reasons.push('확인 가능한 값이 부족합니다');
 let hard=reasons.length>0;
 if(values.some(v=>!known(v.accountingBasis)))reasons.push('회계·조정 기준 미확인');
 else if(new Set(values.map(v=>v.accountingBasis)).size>1){reasons.push('회계 기준이 다릅니다');if(values.some(v=>/adjusted|non.?gaap/i.test(v.accountingBasis)))hard=true;}
 if(values.some(v=>v.periodStartDerived))reasons.push('정확한 기간 시작일 미제공');
 else if(values.some(v=>!v.periodStart)||new Set(values.map(v=>v.periodStart)).size>1){reasons.push('기간 시작일이 다르거나 미확인입니다');hard=true;}
 if(values.some(v=>v.dimension)&&new Set(values.map(v=>v.dimension)).size>1)return {status:'NOT_COMPARABLE',reasons:[...reasons,'사업부·제품 등 항목 범위가 다릅니다']};
 return {status:hard?'NOT_COMPARABLE':reasons.length?'COMPARABLE_WITH_CAVEAT':'COMPARABLE',reasons:[...new Set(reasons)]};
}
// Each instrument uses the same observed base date. Neither missing dates nor
// market holidays are replaced by zero/previous closes. Local price returns only.
export function comparePriceSeries(series,{period='1y',mode='return'}={}){
 const all=series.map(s=>({...s,bars:normalizeBars(s.bars)})),last=all.flatMap(s=>s.bars.map(b=>b.date)).sort().at(-1),months={'1m':1,'3m':3,'6m':6,'1y':12,'3y':36}[period],cutoff=last&&months?subtractMonths(last,months):null;
 const selected=all.map(s=>({...s,bars:s.bars.filter(b=>!cutoff||b.date>=cutoff)})),eligible=selected.filter(s=>s.bars.length),missing=selected.filter(s=>!s.bars.length).map(s=>({key:s.key,reason:s.error||'선택한 기간의 관측 가격이 없습니다.'}));
 const dateSets=eligible.map(s=>new Set(s.bars.map(b=>b.date))),first=eligible[0],dates=first?.bars.map(b=>b.date).filter(d=>dateSets.every(set=>set.has(d)))||[],baseDate=eligible.length>=2?dates[0]||null:null;
 if(!baseDate)return {version:comparisonVersion,baseDate:null,cutoff,series:[],missing:[...missing,...eligible.map(s=>({key:s.key,reason:'서로 겹치는 기준 거래일이 없습니다. 기간 또는 종목을 바꿔 주세요.'}))],warnings:[],mode,comparisonStatus:'NOT_COMPARABLE'};
 const output=[];
 for(const s of eligible){const base=s.bars.find(b=>b.date===baseDate);if(!(base.close>0)){missing.push({key:s.key,reason:'공통 기준일의 가격이 0 이하라 계산할 수 없습니다.'});continue;}
  const points=s.bars.filter(b=>b.date>=baseDate&&b.close>0).map(b=>({date:b.date,price:b.close,value:mode==='index'?100*b.close/base.close:100*(b.close/base.close-1)}));
  output.push({...s,bars:undefined,basePrice:base.close,points,latest:points.at(-1),partial:!!cutoff&&s.bars[0].date>cutoff});
 }
 const warnings=['현지 통화 가격수익률입니다. 환율·배당을 반영한 총수익률이 아닙니다.'];
 if(new Set(output.map(s=>s.market)).size>1)warnings.push('각 시장 거래일 종가 기준입니다. 같은 날짜도 동시 시세가 아닙니다.');
 if(output.some(s=>!known(s.adjustmentPolicy)))warnings.push('일부 가격의 주식분할·배당 조정 여부가 확인되지 않았습니다.');
 if(new Set(output.map(s=>s.adjustmentPolicy)).size>1)warnings.push('종목별 가격 조정 기준이 달라 직접 비교에 제한이 있습니다.');
 if(new Set(output.map(s=>s.currency)).size>1)warnings.push('통화가 다른 종목도 현지 통화 수익률로 표시합니다. 원화 수익률이 아닙니다.');
 if(output.some(s=>s.partial))warnings.push('상장일·저장 범위·누락 여부를 확인해 주세요. 확보한 공통 거래일부터 표시합니다.');
 return {version:comparisonVersion,baseDate,cutoff,endDate:last,series:output,missing,warnings,mode,comparisonStatus:output.length<2?'NOT_COMPARABLE':output.some(s=>!known(s.adjustmentPolicy))||new Set(output.map(s=>s.adjustmentPolicy)).size>1?'COMPARABLE_WITH_CAVEAT':'COMPARABLE'};
}
export function safeComparisonUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
