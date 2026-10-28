import defaults from '../config/earnings-surprise.json' with {type:'json'};
export const metricLabels={operatingIncome:'영업이익',revenue:'매출',netIncome:'순이익',eps:'EPS'};
export const statusLabels={STRONG_BEAT_EXPANSION:'강한 상회 확대',BEAT_STREAK:'상회 지속',TURNED_TO_BEAT:'상회 전환',BEAT_DECELERATING:'상회폭 축소',NEUTRAL:'중립',TURNED_TO_MISS:'하회 전환',MISS_STREAK:'하회 지속',MISS_EXPANDING:'하회 확대',INSUFFICIENT:'추세 판단 자료 부족'};
const finite=Number.isFinite;
const days=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
const pct=n=>(n>0?'+':'')+n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';
const dayDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&finite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const preciseInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&finite(Date.parse(value));
// A supplier's current actual/estimate pair is not proof of a pre-release
// consensus. For date-only releases, the whole estimate day must be earlier in
// the company's market timezone; a same-day unknown timestamp cannot qualify.
export function preAnnouncementEstimate(metric,quarter,market){
 const asOf=metric.estimateAsOf??quarter.estimateAsOf,reportAt=quarter.reportTimePrecision==='instant'&&preciseInstant(quarter.reportAt)?quarter.reportAt:null;
 if(preciseInstant(asOf)&&reportAt)return Date.parse(asOf)<Date.parse(reportAt);
 if(!dayDate(quarter.reportDate))return false;
 const estimateDate=dayDate(asOf)?asOf:preciseInstant(asOf)?new Intl.DateTimeFormat('en-CA',{timeZone:market==='KR'?'Asia/Seoul':'America/New_York'}).format(new Date(asOf)):null;
 return estimateDate!==null&&estimateDate<quarter.reportDate;
}
export function calculateSurprisePct(actual,estimate,{metric='revenue',currency='USD',config=defaults}={}){
 if(!finite(actual)||!finite(estimate))return {surprisePct:null,calculationPct:null,event:null,reason:'실제치 또는 예상치 미제공'};
 const event=metric!=='revenue'&&estimate<0&&actual>0?'PROFIT_SURPRISE':metric!=='revenue'&&estimate>0&&actual<0?'LOSS_SURPRISE':null;
 if(event)return {surprisePct:null,calculationPct:null,event,reason:event==='PROFIT_SURPRISE'?'예상 적자 → 실제 흑자':'예상 흑자 → 실제 적자'};
 const floor=metric==='eps'?config.nearZero.eps:config.nearZero[currency];
 if(!finite(floor)||Math.abs(estimate)<=Math.max(floor,Math.abs(actual)*config.nearZero.relative))return {surprisePct:null,calculationPct:null,event:null,reason:'예상치가 0에 가까워 비율 산출 제외'};
 const value=(actual-estimate)/Math.abs(estimate)*100;
 return {surprisePct:value,calculationPct:Math.max(-config.clampPct,Math.min(config.clampPct,value)),event:null,reason:null};
}
export function calculateQuarterComposite(metrics,market,config=defaults){
 const eligible=Object.entries(config.weights[market]).filter(([key])=>finite(metrics[key]?.calculationPct)),total=eligible.reduce((n,[,w])=>n+w,0);
 return {compositeSurprise:total?eligible.reduce((n,[k,w])=>n+metrics[k].calculationPct*w/total,0):null,weights:Object.fromEntries(eligible.map(([k,w])=>[k,w/total]))};
}
export function detectSurpriseStatus(values,config=defaults){
 const [a,b,c]=values.slice(-3),last=values.at(-1),prior=values.at(-2),z=config.neutralPct,d=config.expansionPp;
 if(values.length<2||!finite(last)||!finite(prior))return 'INSUFFICIENT';
 if(prior< -z&&last>=0)return 'TURNED_TO_BEAT';
 if(prior>=0&&last< -z)return 'TURNED_TO_MISS';
 if(values.length>=3&&[a,b,c].every(finite)){
  if(a>z&&b>a+d&&c>b+d&&c>=config.strongBeatPct)return 'STRONG_BEAT_EXPANSION';
  if(a>z&&b>z&&c>z&&a>b+d&&b>c+d)return 'BEAT_DECELERATING';
  if(a< -z&&b<a-d&&c<b-d)return 'MISS_EXPANDING';
  if([a,b,c].every(n=>n>z))return 'BEAT_STREAK';
  if([a,b,c].every(n=>n< -z))return 'MISS_STREAK';
 }
 return 'NEUTRAL';
}
const direction=(m,c)=>m?.event==='PROFIT_SURPRISE'?1:m?.event==='LOSS_SURPRISE'?-1:finite(m?.surprisePct)?(m.surprisePct>c.neutralPct?1:m.surprisePct< -c.neutralPct?-1:0):null;
export function detectSurpriseSignals(points,core,market,config=defaults){
 const last=points.at(-1),m=last?.metrics||{},values=points.map(p=>p.metrics[core]?.calculationPct??null),v=values.slice(-3),signals=[];
 let beats=0,misses=0;for(const n of values.slice().reverse()){if(finite(n)&&n>config.neutralPct)beats++;else break;}for(const n of values.slice().reverse()){if(finite(n)&&n< -config.neutralPct)misses++;else break;}
 const add=(id,label,active)=>{if(active)signals.push({id,label});};
 const expansion=v.length===3&&v.every(finite)&&v[0]>0&&v[1]>v[0]+config.expansionPp&&v[2]>v[1]+config.expansionPp;
 const contraction=v.length===3&&v.every(n=>finite(n)&&n>0)&&v[0]>v[1]+config.expansionPp&&v[1]>v[2]+config.expansionPp;
 const status=detectSurpriseStatus(values,config),rd=direction(m.revenue,config),pd=direction(m[market==='US'?'eps':'operatingIncome'],config);
 add('consecutiveBeats',`${beats}회 연속 상회`,beats>=2);add('consecutiveMisses',`${misses}회 연속 하회`,misses>=2);
 add('beatExpansion','상회폭 확대',expansion);add('beatDecelerating','상회폭 축소',contraction);add('missExpansion','하회폭 확대',status==='MISS_EXPANDING');
 add('turnedToBeat','상회 전환',status==='TURNED_TO_BEAT');add('turnedToMiss','하회 전환',status==='TURNED_TO_MISS');
 add('revenueBeat','매출 상회',rd===1);add('profitBeat','영업이익 상회',direction(m.operatingIncome,config)===1);add('epsBeat','EPS 상회',direction(m.eps,config)===1);
 add(market==='US'?'epsAndRevenueBeat':'revenueAndProfitBeat',market==='US'?'EPS·매출 동반 상회':'매출·영업이익 동반 상회',rd===1&&pd===1);
 add('profitOnly',market==='US'?'EPS 상회 · 매출 하회':'영업이익 상회 · 매출 하회',rd===-1&&pd===1);
 add('revenueOnly',market==='US'?'매출 상회 · EPS 하회':'매출 상회 · 영업이익 하회',rd===1&&pd===-1);
 for(const [key,metric] of Object.entries(m)){add('profitSurprise',metricLabels[key]+' 예상 적자 → 실제 흑자',metric.event==='PROFIT_SURPRISE');add('lossSurprise',metricLabels[key]+' 예상 흑자 → 실제 적자',metric.event==='LOSS_SURPRISE');}
 const scoreParts=[],push=(reason,points)=>{if(points)scoreParts.push({reason,points});},n=last?.metrics[core]?.calculationPct,w=config.score;
 if(finite(n)){const abs=Math.abs(n);push('최근 '+metricLabels[core]+' 예상 대비',abs<=config.neutralPct?0:Math.sign(n)*(abs>=config.strongBeatPct?w.strong:abs>=config.mediumBeatPct?w.medium:w.small));}
 push('연속 상회',beats>=3?w.threeStreak:beats===2?w.twoStreak:0);push('연속 하회',misses>=3?-w.threeStreak:misses===2?-w.twoStreak:0);
 push('최근 두 구간 상회폭 확대',expansion?w.expansion:0);push('최근 두 구간 상회폭 축소',contraction?w.deceleration:0);push('매출·핵심 이익 동반 방향',rd===pd&&[1,-1].includes(rd)?rd*w.joint:0);
 push('핵심 이익 부호 전환',m[core]?.event==='PROFIT_SURPRISE'?w.turnaround:m[core]?.event==='LOSS_SURPRISE'?-w.turnaround:0);
 const reaction=last?.priceReaction,move=reaction?.day1??null,coreDirection=direction(m[core],config);
 add('EARNINGS_BEAT_PRICE_DOWN','실적 상회에도 주가 하락',coreDirection===1&&finite(move)&&move<=-config.priceWarningPct);
 add('MISS_PRICE_UP','실적 하회에도 주가 상승',coreDirection===-1&&finite(move)&&move>=config.priceWarningPct);
 return {signals,scoreParts,score:finite(n)||m[core]?.event?scoreParts.reduce((s,p)=>s+p.points,0):null};
}
export function generateSurpriseSummary(latest,core,status){
 const m=latest?.metrics[core];if(!m)return '비교할 실제치와 컨센서스가 없습니다.';
 const fact=finite(m.surprisePct)?`최근 ${metricLabels[core]} 실적은 예상 대비 ${pct(m.surprisePct)}입니다.`:m.reason||'비교 자료가 없습니다.';
 const descriptions={STRONG_BEAT_EXPANSION:'최근 세 번의 발표에서 상회폭이 커졌습니다.',BEAT_STREAK:'최근 세 번 이상 예상치를 상회했습니다.',TURNED_TO_BEAT:'직전 하회에서 상회·예상 부합으로 전환했습니다.',BEAT_DECELERATING:'상회하고 있지만 최근 상회폭은 줄었습니다.',TURNED_TO_MISS:'직전 예상 부합·상회에서 하회로 전환했습니다.',MISS_STREAK:'최근 세 번 이상 예상치를 하회했습니다.',MISS_EXPANDING:'최근 세 번의 발표에서 하회폭이 커졌습니다.',NEUTRAL:'뚜렷한 연속 확대·전환 패턴은 없습니다.',INSUFFICIENT:'추세 비교 자료가 부족합니다.'};
 return fact+' '+descriptions[status];
}
// Caller supplies verified exchange sessions, never assumes weekdays are sessions.
// day0 is the first affected session: BMO=release day, AMC=following session.
export function calculatePostEarningsPriceReaction(event,bars,{tradingDates=[],now=Date.now(),priceBasis='미확인'}={}){
 const empty={day0:null,day1:null,day3:null,day5:null,dates:{},basis:priceBasis};
 if(!['BMO','AMC'].includes(event.session))return {...empty,reason:'발표 전·후장 구분 미확인'};
 const dates=[...new Set(tradingDates)].sort(),first=dates.findIndex(d=>event.session==='AMC'?d>event.reportDate:d>=event.reportDate);
 if(first<1)return {...empty,reason:'거래일·기준 종가 미확인'};
 const map=new Map(bars.filter(b=>finite(b.value??b.close)).map(b=>[b.date||b.at,b.value??b.close])),baseDate=dates[first-1],base=map.get(baseDate);
 if(!(base>0))return {...empty,reason:'발표 전 기준 종가 없음'};
 const result={...empty,baseDate,baseClose:base,firstSession:dates[first],reason:null};
 for(const n of [0,1,3,5]){const date=dates[first+n];if(!date||Date.parse(date+'T23:59:59Z')>=now)continue;if(dates.slice(first,first+n+1).some(d=>!(map.get(d)>0)))continue;result['day'+n]=(map.get(date)/base-1)*100;result.dates['day'+n]=date;}
 return result;
}
export function calculateEarningsSurprise(input,{config=defaults,now=Date.now()}={}){
 const market=input.market,weights=config.weights[market],dedup=new Map();
 for(const row of input.quarters||[]){if(!row.reportDate||!finite(Date.parse(row.reportDate))||Date.parse(row.reportDate)>now)continue;const key=row.period||row.reportDate,old=dedup.get(key);if(!old||String(row.collectedAt||'')>String(old.collectedAt||''))dedup.set(key,row);}
 const points=[...dedup.values()].sort((a,b)=>a.reportDate.localeCompare(b.reportDate)).slice(-config.displayPeriods).map(q=>{
  const metrics={};for(const key of ['revenue','operatingIncome','netIncome','eps']){const m=q[key]||{},sameBasis=m.paired===true&&m.actualBasis===m.estimateBasis&&m.unit&&m.actualBasis&&!['UNKNOWN','UNSPECIFIED'].includes(m.actualBasis),beforeRelease=preAnnouncementEstimate(m,q,market),compatible=sameBasis&&beforeRelease;
   metrics[key]={...m,estimateTimingVerified:beforeRelease,...(compatible?calculateSurprisePct(m.actual,m.estimate,{metric:key,currency:q.currency,config}):{surprisePct:null,calculationPct:null,event:null,reason:sameBasis?'발표 전 예상치 기준시각 미확인 · 서프라이즈 계산 보류':'동일 기준의 실제치·예상치 미제공'})};}
  return {...q,metrics,...calculateQuarterComposite(metrics,market,config)};
 });
 const latest=points.at(-1),core=Object.keys(weights).find(k=>finite(latest?.metrics[k]?.surprisePct)||latest?.metrics[k]?.event)||Object.keys(weights)[0];
 // A missing publication/window/basis breaks a streak. Never skip missing results.
 let comparable=[];for(const q of points){const previous=comparable.at(-1),gap=previous?days(q.reportDate,previous.reportDate):0;if(previous&&(gap>config.maxPublicationGapDays||gap<config.minPublicationGapDays||q.metrics[core].actualBasis!==previous.metrics[core].actualBasis))comparable=[];comparable.push(q);}
 const status=detectSurpriseStatus(comparable.map(q=>q.metrics[core]?.calculationPct??null),config),signals=detectSurpriseSignals(comparable,core,market,config);
 return {version:config.version,market,ticker:input.ticker,status,label:statusLabels[status],core,coreLabel:metricLabels[core],latest:latest||null,points,...signals,summary:generateSurpriseSummary(latest,core,status),config,updatedAt:input.updatedAt||null,periodBasis:input.periodBasis||'fiscal_quarter',limitations:input.limitations||[]};
}
