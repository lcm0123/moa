import {topics,fieldDefinitions} from './catalog.mjs';
const DAY=86400000,dateMs=d=>Date.parse(d+'T00:00:00Z');
const number=v=>v.toLocaleString('ko-KR',{maximumFractionDigits:2});
const sign=v=>(v>0?'+':'')+number(v);
const monthShift=(date,n)=>{const d=new Date(dateMs(date));d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
const endDate=s=>{const d=new Date(dateMs(s.latest.date));if(['M','Q'].includes(s.frequency))d.setUTCMonth(d.getUTCMonth()+(s.frequency==='Q'?3:1),0);return d.toISOString().slice(0,10);};

// Descriptive direction of the displayed metric. YoY acceleration is NOT a fall
// or rise in the price/output level. PAYEMS is monthly hiring, not total employment.
export function enrichSeries(def,calculated,full,{contextYears=5}={}){
 const {latest}=calculated,epsilon=def.changeEpsilon??.005;
 const direction=v=>!Number.isFinite(v)?'비교 불가':Math.abs(v)<epsilon?'유지':v>0?'상승':'하락';
 if(!latest)return {direction:direction(null),momentum:null,context:{available:false,reason:'관측값이 없습니다.'}};
 const target=monthShift(latest.date,-3),tolerance=def.frequency==='D'?10:def.frequency==='W'?8:0;
 const prior=full.history.filter(p=>p.date<=target&&Number.isFinite(p.value)).at(-1);
 const comparable=prior&&(dateMs(target)-dateMs(prior.date))/DAY<=tolerance;
 const change=comparable?latest.value-prior.value:null;
 const momentum={months:3,startDate:comparable?prior.date:null,endDate:latest.date,change,unit:calculated.deltaUnit,direction:direction(change),basis:calculated.transformLabel,formula:'표시 지표의 최신 값 − 3개월 전 값 (일·주별은 기준일 이전 10일·8일 이내 관측)',reason:comparable?null:'3개월 전 비교 가능한 관측값이 없습니다.'};
 const years=contextYears>=10?10:5,start=monthShift(latest.date,-12*years);
 const window=full.history.filter(p=>p.date>=start&&p.date<=latest.date),valid=window.filter(p=>Number.isFinite(p.value));
 const minimum={D:def.id==='DFEDTARU'?365:252,W:52,M:12,Q:4}[def.frequency]*years*.8;
 const toleranceStart={D:14,W:14,M:35,Q:100}[def.frequency];
 let reason=null;
 if(def.contextBreak&&def.contextBreak>start)reason=`${def.contextBreak} 산정 방식 변경으로 동일 기준 ${years}년 비교를 보류합니다.`;
 else if(valid.length<minimum||!valid.length||(dateMs(valid[0].date)-dateMs(start))/DAY>toleranceStart)reason=`동일 계산 기준의 ${years}년 자료가 충분하지 않습니다.`;
 const context=reason?{available:false,years,reason}:{available:true,years,startDate:valid[0].date,endDate:latest.date,count:valid.length,min:Math.min(...valid.map(p=>p.value)),max:Math.max(...valid.map(p=>p.value)),percentile:100*(valid.filter(p=>p.value<latest.value).length+.5*valid.filter(p=>p.value===latest.value).length)/valid.length,unit:calculated.unit,formula:'동일 지표의 과거 관측 중 더 낮은 값 수 + 같은 값 수의 1/2을 전체 관측 수로 나눈 비율. 예측 확률이 아닙니다.'};
 return {direction:direction(calculated.delta),momentum,context};
}

function fact(s){const date=s.frequency==='M'?s.latest.date.slice(0,7):s.frequency==='Q'?s.latest.date.slice(0,4)+'년 '+Math.ceil(Number(s.latest.date.slice(5,7))/3)+'분기':s.latest.date;return `${s.name}: ${date} ${number(s.latest.value)}${s.unit}${Number.isFinite(s.momentum?.change)?`, 3개월 전 대비 ${sign(s.momentum.change)}${s.momentum.unit}`:Number.isFinite(s.delta)?`, 직전 관측 대비 ${sign(s.delta)}${s.deltaUnit}`:''}${s.transform==='yoy'?' (전년 동기 증가율의 변화)':s.transform==='difference'?' (월간 고용 증감 규모)':''}${s.stale||s.delayed||s.latestMissing?' · 최신성·결측 확인 필요':''}`;}
function agreementFor(items,field){
 // Compare only a common 3-month horizon and compatible observation periods.
 // Expectations and observed inflation stay separate; trade and RRP have no
 // defensible one-dimensional polarity and do not receive an aggregate verdict.
 const usable=items.filter(s=>s.latest&&!s.stale&&!s.delayed&&!s.latestMissing&&s.signalPolarity&&Number.isFinite(s.momentum?.change)&&(field!=='inflation'||s.role!=='expectations'));
 if(usable.length<2)return {status:'insufficient',label:'종합 판단 보류',reason:'같은 방향으로 비교할 유효 지표가 2개 미만입니다.',positive:[],negative:[],flat:[]};
 const ends=usable.map(s=>dateMs(endDate(s)));
 if(Math.max(...ends)-Math.min(...ends)>45*DAY)return {status:'unaligned',label:'시점 차이로 판단 보류',reason:'최신 관측 대상 기간의 말일이 45일 넘게 차이 납니다.',positive:[],negative:[],flat:[]};
 const positive=[],negative=[],flat=[];
 for(const s of usable){const d=s.momentum.change*s.signalPolarity;if(Math.abs(d)<(s.changeEpsilon??.005))flat.push(s.id);else(d>0?positive:negative).push(s.id);}
 const mixed=positive.length&&negative.length;
 const definition=fieldDefinitions[field];
 return {status:mixed?'mixed':positive.length||negative.length?'aligned':'flat',label:mixed?'엇갈린 신호':positive.length?definition.positive:negative.length?definition.negative:'비교 지표 모두 큰 변화 없음',positive,negative,flat,reason:`3개월간 표시 지표의 방향 비교 · ${usable.length}개. 고용·주택의 실업/금리는 반대 방향으로 해석하며 금액 크기를 합산하지 않습니다.`,periods:usable.map(s=>({id:s.id,start:s.momentum.startDate,end:s.momentum.endDate}))};
}
export function buildHub(core,related,analysis,hidden=[]){
 const fields=analysis.topics.map(id=>{
  const items=core.filter(s=>s.field===id),more=related.filter(s=>s.field===id),valid=items.filter(s=>s.latest),fresh=valid.filter(s=>!s.stale&&!s.delayed&&!s.latestMissing),agreement=agreementFor(items,id);
  const reasons=[];if(!fresh.length)reasons.push('최신성·결측 조건을 충족하는 핵심 관측값이 없습니다.');
  if(['insufficient','unaligned'].includes(agreement.status))reasons.push(agreement.reason);
  if(valid.some(s=>s.stale||s.delayed||s.latestMissing))reasons.push('갱신 지연·결측 값은 방향 합의 계산에서 제외했습니다.');
  const missing=hidden.filter(s=>s.topics?.includes(id));if(missing.length)reasons.push(`${missing.length}개 후보의 메타데이터·이용 조건 검증 또는 연결에 실패했습니다.`);
  return {id,name:topics[id],...fieldDefinitions[id],connection:analysis.connectedTopics.includes(id)?analysis.connectionReasons[id]:'질문에서 직접 선택한 분야',connected:analysis.connectedTopics.includes(id),coreIds:items.map(s=>s.id),relatedIds:more.map(s=>s.id),agreement,facts:valid.map(fact),limitations:reasons,validCount:fresh.length,totalCount:items.length+more.length+missing.length};
 });
 const confirmed=fields.flatMap(f=>f.facts.slice(0,1).map(text=>({field:f.id,text}))),conflicting=fields.filter(f=>f.agreement.status==='mixed').map(f=>({field:f.id,text:`${f.name}: ${f.agreement.positive.map(id=>core.find(s=>s.id===id).name).join('·')} / ${f.agreement.negative.map(id=>core.find(s=>s.id===id).name).join('·')} — 최근 3개월 신호가 반대입니다.`}));
 const limitations=[...fields.flatMap(f=>f.limitations.map(text=>`${f.name}: ${text}`))];
 const dates=[...new Set(core.filter(s=>s.latest).map(s=>s.latest.date))];if(dates.length>1)limitations.push('일·주·월·분기 지표의 관측 시점이 다릅니다. 카드의 날짜를 함께 확인하세요.');
 if(analysis.omittedTopics.length)limitations.push(`기본 결과는 3개 분야까지입니다. ${analysis.omittedTopics.map(t=>topics[t]).join('·')}는 분야 메뉴에서 추가로 확인할 수 있습니다.`);
 limitations.push('시장 예상치가 연결되지 않아 서프라이즈를 계산하지 않습니다. 최신 수정치 기준이며 전망·원인·금리 결정을 단정하지 않습니다.');
 const answer=[];
 if(confirmed.length)answer.push(`${fields.map(f=>f.name).join(' · ')}의 ${core.filter(s=>s.latest).length}개 관측 지표를 확인했습니다.`);
 else answer.push('확인된 관측값이 없어 분석을 보류합니다.');
 const aligned=fields.filter(f=>f.agreement.status==='aligned');
 if(aligned.length)answer.push(aligned.map(f=>`${f.name}: ${f.agreement.label}`).join(' / ')+'.');
 if(conflicting.length)answer.push(`${conflicting.map(x=>topics[x.field]).join('·')} 내부에서 반대 방향의 신호가 관측됩니다.`);
 if(answer.length<3)answer.push(analysis.intent==='causes'||analysis.easing?'함께 관측되는 흐름을 비교하며 인과관계나 정책 결정을 추정하지 않습니다.':'분야별 변화는 서로 다른 단위·기간의 관측입니다. 경제 전체를 하나의 수치로 판정하지 않습니다.');
 return {fields,answer:answer.slice(0,3),confirmed,conflicting,limitations,agreementNote:'최근 3개월의 동일 지표 변화 방향을 분야 안에서만 비교합니다. 다른 분야를 합산한 경기 점수는 만들지 않습니다.'};
}
