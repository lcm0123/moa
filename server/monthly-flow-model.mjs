import {breadth,monthlySectors} from '../dist/js/monthly-flow-model.js';
const close=b=>b?.adjustedClose??b?.value??b?.close;
export function monthlyCalculation({market,indexId,month,day,feed,histories,benchmark,types={},now=new Date().toISOString()}){
 const start=month+'-01',endLimit=day||month+'-31',seen=new Set(),exclusions=[...(feed.excluded||[])],all=[];
 for(const sector of feed.items||[])for(const member of sector.stocks||[]){if(seen.has(member.id))continue;seen.add(member.id);const type=types[member.id];if(type?.isEtf){exclusions.push({...member,reason:'ETF 제외'});continue;}if(!type){exclusions.push({id:member.id,name:member.name,reason:'종목 유형 미확인'});continue;}all.push({...member,sectorId:sector.id,sectorName:sector.name});}
 const dateSet=new Set();for(const stock of all)for(const b of histories.get(stock.id)?.bars||[])if(Number.isFinite(close(b))&&close(b)>0)dateSet.add(b.date||b.at);
 const dates=[...dateSet].sort(),indexPoints=new Map((benchmark?.points||[]).map(p=>[p.at,p.value]));
 // Prefer the actual benchmark trading calendar. If it is unavailable use only
 // observed stock dates, and disable all benchmark comparisons for missing dates.
 const indexBase=[...indexPoints.keys()].filter(d=>d<start&&d>=new Date(Date.parse(start)-35*86400000).toISOString().slice(0,10)).sort().at(-1);
 const candidateBase=indexBase||dates.filter(d=>d<start).at(-1),previousMonth=new Date(Date.parse(start)-86400000).toISOString().slice(0,7),baseDate=candidateBase?.startsWith(previousMonth)?candidateBase:null,availableDates=dates.filter(d=>d>=start&&d<=month+'-31'&&d<=now.slice(0,10)),endDate=availableDates.filter(d=>d<=endLimit).at(-1);
 const baseIndex=indexPoints.get(baseDate),endIndex=indexPoints.get(endDate),benchmarkReturn=Number.isFinite(baseIndex)&&baseIndex>0&&Number.isFinite(endIndex)?(endIndex/baseIndex-1)*100:null;
 const required=dates.filter(d=>d>=baseDate&&d<=endDate),stocks=[];
 for(const member of all){
  const h=histories.get(member.id),bars=h?.bars||[],points=new Map(bars.map(b=>[b.date||b.at,b])),first=points.get(baseDate),last=points.get(endDate);
  let reason=!baseDate||!endDate?'기준 거래일 없음':!(close(first)>0&&close(last)>0)?'시작일 또는 종료일 종가 없음':null;
  // Never bridge a missing observation or a detected price-basis discontinuity.
  // KR fltRt is a check only, NOT the monthly return calculation.
  if(!reason){for(let i=1;i<required.length;i++){const a=points.get(required[i-1]),b=points.get(required[i]);if(!a||!b){reason='기간 중 일봉 누락';break;}const move=(close(b)/close(a)-1)*100;if(market==='KR'&&(!Number.isFinite(b.changePct)||Math.abs(move-b.changePct)>.06)){reason='가격 기준 변경·조정 확인 필요';break;}if(market==='US'&&h?.adjustment!=='split_adjusted'&&Math.abs(move)>25){reason='큰 가격 불연속·조정 확인 필요';break;}}}
  if(reason){exclusions.push({id:member.id,name:member.name,reason});continue;}
  const changePct=(close(last)/close(first)-1)*100;
  stocks.push({...member,price:close(last),basePrice:close(first),dailyChangePct:null,changePct,excessPct:Number.isFinite(benchmarkReturn)?changePct-benchmarkReturn:null,asOf:endDate,baseDate:endDate,startDate:baseDate,mode:'monthly_close',asOfKind:'date',quoteAvailable:true,historyReceivedAt:h.receivedAt,adjustment:h.adjustment||'unverified'});
 }
 stocks.sort((a,b)=>b.changePct-a.changePct||a.id.localeCompare(b.id));
 const items=monthlySectors(stocks,feed.items||[]),summary=breadth(stocks),leaders=items.filter(s=>s.upRatio>50&&s.median>0).sort((a,b)=>b.upRatio-a.upRatio||b.median-a.median||a.id.localeCompare(b.id));
 const target=(feed.constituents?.total??(seen.size+(feed.excluded?.length||0)))-exclusions.filter(e=>e.reason==='ETF 제외').length;
 return {...feed,items,stocks,excluded:exclusions,status:stocks.length?'ready':'empty',message:stocks.length?'':'동일 기준일의 종가가 부족해 월 누적 성과를 계산할 수 없습니다.',market,indexId,month,analysis:'monthly',mode:'monthly_close',asOfKind:'date',asOf:endDate||null,baseDate:endDate||null,startDate:baseDate||null,requestedDay:day||null,availableDates,target,summary:{...summary,target,outperform:Number.isFinite(benchmarkReturn)?stocks.filter(s=>s.excessPct>1e-9).length:null,leader:leaders[0]?.id||null},benchmark:{name:feed.universe,source:benchmark?.source||null,changePct:benchmarkReturn,startDate:baseDate||null,endDate:endDate||null,receivedAt:benchmark?.receivedAt||null,message:Number.isFinite(benchmarkReturn)?null:'같은 시작·종료일의 실제 지수 종가 연결 필요'},calculatedAt:now,dateZone:market==='KR'?'Asia/Seoul':'America/New_York',calculation:'(선택일 종가 ÷ 전월 마지막 거래일 종가 − 1) × 100 · 섹터 대표값 = 종목 수익률 중간값',adjustmentNote:market==='KR'?'공급 종가 기준 · 일간 등락률과 종가 비율이 다른 구간 제외 · 배당 미포함':'Finviz 공급 종가 기준 · 수정주가 여부 미확인 · 25% 초과 일간 불연속은 검증 전 제외 · 배당 미포함',membershipNote:'현재 구성종목·분류 기준의 과거 성과입니다. 당시 편입·편출은 반영하지 않습니다.',areaNote:'타일 면적은 최근 수집 시가총액 · 선택일의 시가총액이 아닙니다.'};
}
