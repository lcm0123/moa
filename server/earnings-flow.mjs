import defaults from '../config/earnings-flow.json' with {type:'json'};
import {compatible,span} from './quarter-normalization.mjs';
export const flowLabels={early:'회복 조짐',confirmed:'회복 확인',slowing:'둔화 조짐',worsening:'악화 확인',hold:'판정 보류'};
const finite=Number.isFinite,delta=(a,b)=>finite(a)&&finite(b)?a-b:null;
const pct=(a,b)=>finite(a)&&finite(b)&&a>=0&&b>0?(a/b-1)*100:null;
const adjacent=(a,b)=>a&&b&&(Date.parse(a.end)-Date.parse(b.end))/86400000>=70&&(Date.parse(a.end)-Date.parse(b.end))/86400000<=110;
const compare=(a,b)=>compatible(a,b)&&Math.abs(span(a)-span(b))<=14;
const keys=['revenue','operatingIncome','eps','operatingCashFlow','freeCashFlow'];
export function detectEarningsFlow(data,{config=defaults,now=Date.now(),filings=[]}={}){
 const rows=[...new Map((data.quarterly||[]).filter(q=>q.end<=new Date(now).toISOString().slice(0,10)).map(q=>[q.end,q])).values()].sort((a,b)=>a.end.localeCompare(b.end));
 const profile=data.profile||{},financial=/financial|bank|insurance|credit|capital markets|금융|은행|보험|증권/i.test([profile.sector,profile.industry].join(' '))||/^(60|61|62|63|64|67)/.test(String(profile.sic||''))||/^(64|65|66)/.test(String(profile.industryCode||''));
 const classificationKnown=!!(profile.sector||profile.industry||profile.sic||profile.industryCode);
 const points=[];
 for(let i=0;i<rows.length;i++){
  const q=rows[i],v=q.values||{},prior=rows.slice(0,i).findLast(r=>{const gap=(Date.parse(q.end)-Date.parse(r.end))/86400000;return gap>=330&&gap<=400;}),old=prior?.values||{},prev=points.at(-1),metrics={};
  for(const k of keys){const p=v[k],b=old[k],last=rows[i-1]?.values?.[k];metrics[k]={value:finite(p?.value)?p.value:null,yoy:compare(p,b)?pct(p.value,b.value):null,yoyChange:compare(p,b)?p.value-b.value:null,qoq:adjacent(q,rows[i-1])&&compare(p,last)?pct(p.value,last.value):null,qoqChange:adjacent(q,rows[i-1])&&compare(p,last)?p.value-last.value:null,unit:p?.unit||null,source:p||null,yearAgoSource:compare(p,b)?b:null,previousSource:adjacent(q,rows[i-1])&&compare(p,last)?last:null};}
  const marginOf=a=>a.revenue?.value>0&&a.operatingIncome&&a.operatingIncome.start===a.revenue.start&&a.operatingIncome.end===a.revenue.end&&a.operatingIncome.unit===a.revenue.unit&&a.operatingIncome.basis===a.revenue.basis&&a.operatingIncome.accession===a.revenue.accession?a.operatingIncome.value/a.revenue.value*100:null;
  const margin=marginOf(v),oldMargin=marginOf(old),marginChange=compare(v.revenue,old.revenue)&&compare(v.operatingIncome,old.operatingIncome)?delta(margin,oldMargin):null;
  const acceleration=adjacent(q,rows[i-1])?delta(metrics.revenue.yoy,prev?.revenueYoy):null;
  const signal=(value,threshold)=>value===null?'missing':value>=threshold?'improving':value<=-threshold?'worsening':'flat';
  const scaled=k=>metrics[k].yoyChange!==null&&v.revenue?.value>0?metrics[k].yoyChange/v.revenue.value*100:null;
  const profit=compare(v.operatingIncome,old.operatingIncome)?old.operatingIncome.value<0&&v.operatingIncome.value>0?'흑자 전환':old.operatingIncome.value<0&&v.operatingIncome.value>old.operatingIncome.value?'적자 축소':old.operatingIncome.value>=0&&v.operatingIncome.value<0?'적자 전환':null:null;
  const signals={revenue:signal(acceleration,config.revenueAccelerationPp),margin:signal(marginChange,config.marginImprovementPp),profit:signal(scaled('operatingIncome'),config.profitChangeToRevenuePp),cash:signal(scaled('operatingCashFlow'),config.cashChangeToRevenuePp),fcf:signal(scaled('freeCashFlow'),config.cashChangeToRevenuePp)};
  const risks=[];
  if(Object.values(v).some(p=>p.revised||/\/A$|정정/.test(p.form||'')))risks.push('정정·비교수치 변경 확인 필요');
  if(prior){const earlier=rows.filter(r=>r.end<=prior.end).slice(-4).map(r=>r.values?.revenue?.value).filter(x=>x>0);if(earlier.length===4&&old.revenue?.value<earlier.reduce((a,b)=>a+b,0)/4*config.lowBaseRatio)risks.push('낮은 전년 매출 기저 확인 필요');}
  if(finite(marginChange)&&Math.abs(marginChange)>=config.unusualMarginChangePp)risks.push('급격한 이익률 변화 · 일회성 손익 확인 필요');
  if(prior&&keys.some(k=>v[k]&&old[k]&&!compare(v[k],old[k])))risks.push('회계 기준·계정·기간 비교 가능성 확인 필요');
  const relevant=filings.filter(f=>Object.values(v).some(p=>p.accession===f.id));
  for(const f of relevant)if(/정정|\/A|합병|인수|회계.{0,8}변경|일회성|매각이익|restructur|acquisition|merger|accounting change|one.time/i.test(f.title||''))risks.push('공시 특이사항 확인 필요');
  if((q.risks||[]).length)risks.push(...q.risks);
  const sample=rows.slice(Math.max(0,i-config.minimumQuarters+1),i+1),enough=sample.length===config.minimumQuarters&&sample.every((r,j)=>(!j||adjacent(r,sample[j-1]))&&['revenue','operatingIncome'].every(k=>finite(r.values?.[k]?.value)&&span(r.values[k])>=70&&span(r.values[k])<=110));
  const profitableSignal=signals.margin==='improving'||signals.profit==='improving',cashBad=signals.cash==='worsening'||signals.fcf==='worsening',profitBad=signals.margin==='worsening'||signals.profit==='worsening';
  // Profit and margin share one domain; FCF cannot double the cash vote.
  const domains={revenue:signals.revenue,profit:profitBad?'worsening':profitableSignal?'improving':signals.profit,cash:signals.cash};
  const positive=Object.keys(domains).filter(k=>domains[k]==='improving'),negative=Object.keys(domains).filter(k=>domains[k]==='worsening');
  const improvement=positive.length>0&&!cashBad&&!profitBad&&signals.revenue!=='worsening';
  const cashReady=signals.cash!=='missing';
  const streak=improvement?(prev?.improving&&adjacent(q,rows[i-1])?prev.streak+1:1):0;
  const window=points.slice(-(config.confirmationQuarters-1)).concat([{domains}]);
  const continuous=window.length===config.confirmationQuarters&&rows.slice(i-config.confirmationQuarters+1,i+1).every((r,j,a)=>!j||adjacent(r,a[j-1]));
  const persistent=direction=>continuous?Object.keys(domains).filter(k=>window.every(p=>p.domains[k]===direction&&!p.risks?.length)):[];
  let state='hold',reason='뚜렷한 변화 신호가 확인되지 않았습니다';
  if(!enough)reason='분기 실적이 부족해 아직 판단할 수 없습니다';
  else if(financial)reason='금융업 별도 판정 기준 준비 전';
  else if(!classificationKnown)reason='업종 확인 전 · 금융업 적용 여부 확인 필요';
  else if(risks.length)reason='확인 필요 · '+[...new Set(risks)].join(' / ');
  else if(i===rows.length-1&&(data.stale||(now-Date.parse(q.end))/86400000>config.stalePeriodDays))reason='최신 공시 재무 갱신 확인 필요';
  else if(improvement){state=persistent('improving').length>=config.minimumIndependentSignals&&cashReady&&streak>=config.confirmationQuarters?'confirmed':'early';reason=state==='confirmed'?`${config.confirmationQuarters}분기 연속 복수 지표 개선`:cashReady?'이번 분기 개선 신호 확인':'개선 신호 · 현금흐름 자료 추가 확인 필요';}
  else if(negative.length){state=persistent('worsening').length>=config.minimumIndependentSignals?'worsening':'slowing';reason=state==='worsening'?`${config.confirmationQuarters}분기 연속 복수 지표 악화`:'일부 지표 둔화 · 지표별 방향을 함께 확인하세요';}
  points.push({end:q.end,label:q.label,metrics,margin,marginChange,revenueYoy:metrics.revenue.yoy,revenueAcceleration:acceleration,signals,domains,priorEnd:prior?.end||null,previousEnd:rows[i-1]?.end||null,previousRevenueYoy:adjacent(q,rows[i-1])?prev?.revenueYoy??null:null,yearAgoMargin:oldMargin,profit,state,labelState:flowLabels[state],reason,risks:[...new Set(risks)],improving:improvement,streak,sample:sample.length,eligible:enough,trend4:points.slice(-3).concat([{revenueYoy:metrics.revenue.yoy,margin,metrics}]).map(p=>({revenueYoy:p.revenueYoy,margin:p.margin,operatingCashFlow:p.metrics.operatingCashFlow.value,freeCashFlow:p.metrics.freeCashFlow.value,eps:p.metrics.eps.value}))});
 }
 const last=points.at(-1),visible=points.slice(-config.displayQuarters);
 const sources=[...new Map(visible.flatMap(p=>Object.values(p.metrics).flatMap(m=>[m.source,m.yearAgoSource,m.previousSource].filter(Boolean).flatMap(s=>[s,...(s.inputs||[])]))).filter(p=>p.url).map(p=>[p.accession,{accession:p.accession,filedAt:p.filedAt,url:p.url,form:p.form}])).values()].sort((a,b)=>String(b.filedAt||'').localeCompare(String(a.filedAt||'')));
 const evidence=[],signed=v=>(v>0?'+':'')+v.toLocaleString('ko-KR',{maximumFractionDigits:1}),pair=(label,a,b,unit,period)=>{if(finite(a)&&finite(b))evidence.push({label,previous:a,current:b,unit,period,text:label+' '+signed(a)+unit+' → '+signed(b)+unit});};
 if(last){pair('매출 YoY',last.previousRevenueYoy,last.revenueYoy,'%',last.previousEnd+' → '+last.end);pair('영업이익률',last.yearAgoMargin,last.margin,'%',last.priorEnd+' → '+last.end);const m=last.metrics.operatingCashFlow;pair('영업현금흐름',m.yearAgoSource?.value,m.value,' '+(m.unit||''),last.priorEnd+' → '+last.end);}
 const descriptors={revenue:['매출 성장률 개선','매출 성장률 둔화'],margin:['영업이익률 상승','영업이익률 하락'],profit:[last?.profit||'영업이익 개선',last?.profit||'영업이익 악화'],cash:['영업현금흐름 개선','영업현금흐름 악화']};
 const desired=['early','confirmed'].includes(last?.state)?'improving':'worsening',signalKey={'매출 YoY':'revenue','영업이익률':'margin','영업현금흐름':'cash'};evidence.sort((a,b)=>Number(last?.signals[signalKey[b.label]]===desired)-Number(last?.signals[signalKey[a.label]]===desired));
 const direction=['early','confirmed'].includes(last?.state)?'improving':'worsening',phrases=last?Object.entries(descriptors).filter(([k])=>last.signals[k]===direction).map(([,v])=>v[direction==='improving'?0:1]):[];
 return {version:config.version,config:{...config},state:last?.state||'hold',label:flowLabels[last?.state||'hold'],reason:last?.reason||'분기 실적이 부족해 아직 판단할 수 없습니다',conclusion:last&&last.state!=='hold'?flowLabels[last.state]+' · '+phrases.slice(0,2).join(', '):last?.reason||'분기 실적이 부족해 아직 판단할 수 없습니다',end:last?.end||null,quarter:last?.label||null,points:visible,sample:last?.sample||0,eligible:!!last?.eligible,evidence,reasons:evidence.map(e=>e.text),sources,updatedAt:data.updatedAt||null,stale:!!data.stale,basis:[...new Set(rows.slice(-config.displayQuarters).flatMap(q=>Object.values(q.values||{}).map(p=>p.basis).filter(Boolean)))],limitations:['일회성 손익·인수합병·회계 변경의 본문 전수 검증은 연결되지 않음. 정량 신호이며 원문 확인 필요.','매출·수익성·현금흐름의 서로 다른 영역이 지속되는지 확인합니다. 영업이익과 이익률은 하나의 영역입니다.','예상 실적 미사용 · 매수·매도 추천 아님'],financial};
}
