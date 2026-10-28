import settings from '../config/earnings-inflection.json' with {type:'json'};
import normalization from '../config/earnings-flow.json' with {type:'json'};
import {detectEarningsFlow} from './earnings-flow.mjs';
const finite=Number.isFinite;
const metric=(p,k)=>p?.metrics?.[k];
// The existing provider-normalized point model supplies exact periods, units,
// taxonomy/basis checks, YoY/QoQ calculations and original filing provenance.
export function calculateEarningsInflection(data,{config=settings,now=Date.now(),filings=[]}={}){
 const base=detectEarningsFlow(data,{now,filings,config:{...normalization,minimumQuarters:config.minimumQuarters,displayQuarters:config.displayQuarters}});
 const points=base.points;for(let i=0;i<points.length;i++){const q=points[i],prev=points[i-1];q.growthChanges={};for(const k of ['revenue','operatingIncome','eps']){const a=metric(q,k)?.yoy,b=metric(prev,k)?.yoy;q.growthChanges[k]=finite(a)&&finite(b)&&q.previousEnd===prev?.end?a-b:null;}}
 const last=points.at(-1),trend=points.slice(-config.trendQuarters),first=trend[0],recent=trend.slice(1),signals={};
 const trendOf=fn=>{const a=trend.map(fn);return a.length===config.trendQuarters&&a.every(finite)?a:null;};
 const direction=(values,step)=>!values?0:values.slice(1).every((v,i)=>v-values[i]>=step)?1:values.slice(1).every((v,i)=>v-values[i]<=-step)?-1:0;
 const revenue=direction(trendOf(p=>p.revenueYoy),config.growthChangePp),profit=direction(trendOf(p=>metric(p,'operatingIncome').yoy),config.growthChangePp),margin=direction(trendOf(p=>p.margin),config.marginChangePp),eps=direction(trendOf(p=>metric(p,'eps').yoy),config.growthChangePp);
 const profitDelta=p=>{const m=metric(p,'operatingIncome'),r=metric(p,'revenue')?.value;return finite(m?.yoyChange)&&r>0?m.yoyChange/r*100:null;};
 const positiveProfit=recent.length===config.trendQuarters-1&&recent.every(p=>finite(profitDelta(p))&&profitDelta(p)>=config.profitChangeRevenuePp);
 const negativeProfit=recent.length===config.trendQuarters-1&&recent.every(p=>finite(profitDelta(p))&&profitDelta(p)<=-config.profitChangeRevenuePp);
 const add=(id,label,active,rule)=>{signals[id]={id,label,active:!!active,points:active?config.weights[id]:0,rule};};
 add('revenueAcceleration','매출 성장 가속',revenue===1,'최근 3분기 매출 YoY가 매 분기 '+config.growthChangePp+'%p 이상 상승');
 add('operatingProfitAcceleration','영업이익 성장 가속',profit===1,'양수 비교 기준의 영업이익 YoY가 최근 3분기 연속 상승');
 add('marginExpansion','영업이익률 상승',margin===1,'최근 3분기 영업이익률이 매 분기 '+config.marginChangePp+'%p 이상 상승');
 add('epsAcceleration','EPS 성장 가속',eps===1,'양수 비교 기준의 EPS YoY가 최근 3분기 연속 상승');
 add('lossReduction','적자폭 축소',positiveProfit&&recent.every(p=>metric(p,'operatingIncome').value<0&&metric(p,'operatingIncome').yearAgoSource?.value<0),'최근 2분기 모두 전년 동기 영업손실 금액보다 손실 축소');
 add('profitTurnaround','전년 동기 대비 흑자전환',positiveProfit&&metric(last,'operatingIncome')?.value>0&&metric(last,'operatingIncome')?.yearAgoSource?.value<0,'최근 2분기 이익 금액 개선, 최신 분기 전년 동기 적자에서 흑자로 전환');
 add('growthSlowdown','매출 성장률 둔화',revenue===-1,'최근 3분기 매출 YoY가 매 분기 '+config.growthChangePp+'%p 이상 하락');
 add('profitDeterioration','영업이익 감소',negativeProfit&&recent.every(p=>metric(p,'operatingIncome').value>=0&&metric(p,'operatingIncome').yearAgoSource?.value>0),'최근 2분기 모두 전년 동기 대비 영업이익 금액 감소');
 add('marginContraction','영업이익률 하락',margin===-1,'최근 3분기 영업이익률이 매 분기 '+config.marginChangePp+'%p 이상 하락');
 add('epsDeterioration','EPS 감소',eps===-1,'EPS YoY가 최근 3분기 연속 하락');
 add('lossExpansion','적자폭 확대',negativeProfit&&recent.every(p=>metric(p,'operatingIncome').value<0&&metric(p,'operatingIncome').yearAgoSource?.value<0),'최근 2분기 모두 전년 동기보다 영업손실 금액 확대');
 add('lossTurnaround','전년 동기 대비 적자전환',negativeProfit&&metric(last,'operatingIncome')?.value<0&&metric(last,'operatingIncome')?.yearAgoSource?.value>=0,'최근 2분기 이익 금액 악화, 최신 분기 전년 동기 흑자에서 적자로 전환');
 const coreUp=(positiveProfit||margin===1)&&!negativeProfit&&margin!==-1,coreDown=negativeProfit||margin===-1;
 add('continuedImprovement','최근 2개 구간 연속 개선',coreUp&&(revenue===1||eps===1),'핵심 이익 지표와 매출 또는 EPS 추세가 함께 개선');
 add('continuedDeterioration','최근 2개 구간 연속 악화',coreDown&&(revenue===-1||eps===-1),'핵심 이익 지표와 매출 또는 EPS 추세가 함께 악화');
 add('growthAcceleration','매출·영업이익 동반 가속',revenue===1&&profit===1,'매출과 영업이익 YoY의 동반 가속 보너스');
 const limitations=[];
 if(!last?.eligible||!trendOf(p=>p.revenueYoy)||!trendOf(p=>p.margin))limitations.push('연속 분기 또는 같은 기준의 전년 비교 자료가 부족합니다.');
 if(base.financial)limitations.push('금융업은 별도 계산 기준이 필요합니다.');
 if(!data.profile?.sector&&!data.profile?.industry&&!data.profile?.sic&&!data.profile?.industryCode)limitations.push('기업 업종 확인이 필요합니다.');
 if(data.stale||(last&&(now-Date.parse(last.end))/86400000>normalization.stalePeriodDays))limitations.push('재무 자료 갱신이 지연되어 점수 표시를 보류합니다.');
 const basis=trend.map(p=>metric(p,'revenue')?.source?.basis);if(new Set(basis).size>1)limitations.unshift('최근 비교 구간의 연결·별도 기준이 달라 점수를 산출하지 않습니다.');
 const warnings=[...new Set(trend.flatMap(p=>p.risks))];limitations.push(...warnings);
 const complete=limitations.length===0,score=complete?Object.values(signals).reduce((n,s)=>n+s.points,0):null;
 const gate=score>0&&!coreUp?'매출·EPS 신호만으로 개선을 확정하지 않습니다. 영업이익·이익률의 지속 개선이 필요합니다.':score<0&&!coreDown?'영업이익·이익률의 지속 악화가 확인되지 않았습니다.':null;
 const label=score===null?'자료 확인 필요':gate?'판정 보류':config.bands.find(b=>score>=b.min).label;
 const active=Object.values(signals).filter(s=>s.active),summary=score===null?limitations[0]:score===0&&active.length?'개선·악화 신호가 엇갈려 합산 점수는 0입니다.':gate||active.filter(s=>score>0?s.points>0:score<0?s.points<0:false).slice(0,2).map(s=>s.label).join(' · ')||'최근 비교 구간에서 지속적인 방향 변화가 확인되지 않았습니다.';
 const evidence=[['매출 YoY',p=>p.revenueYoy,'%'],['영업이익 YoY',p=>metric(p,'operatingIncome').yoy,'%'],['영업이익률',p=>p.margin,'%'],['EPS YoY',p=>metric(p,'eps').yoy,'%']].map(([label,fn,unit])=>{const sameBasis=new Set(basis).size===1;return {label,from:first&&sameBasis?fn(first):null,to:last&&sameBasis?fn(last):null,unit,fromEnd:first?.end,toEnd:last?.end};});
 return {version:config.version,config,score,label,gate,summary,signals,evidence,points,quarter:base.quarter,end:base.end,sources:base.sources,updatedAt:data.updatedAt,stale:!!data.stale,basis:base.basis,limitations,coverage:{quarters:points.length,trend:trend.length,eps:!!trendOf(p=>metric(p,'eps').yoy)},method:'최근 3분기 두 구간의 변화 · YoY는 전년 같은 분기 대비 · 음수 기저는 손익 금액으로 비교'};
}
