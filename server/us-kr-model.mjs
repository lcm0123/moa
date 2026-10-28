import calendar from '../config/us-kr-calendar.json' with {type:'json'};
import rules from '../config/us-kr-topics.json' with {type:'json'};
export {rules,calendar};
export const version=rules.version;
export const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b),n=a.length;return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null;};
export function sessionPair(now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 if(day<calendar.from||day>calendar.through)return null;
 const us=calendar.sessions.XNYS.filter(s=>Date.parse(s.close)+30*60000<=now).at(-1);
 if(!us)return null;
 const nextUs=calendar.sessions.XNYS.find(s=>Date.parse(s.open)>Date.parse(us.close));
 const kr=calendar.sessions.XKRX.find(s=>Date.parse(s.open)>Date.parse(us.close));
 return kr?{us,kr,nextUs,canCollect:now<Date.parse(nextUs?.open||0)}:null;
}
export function industryAnalysis(snapshot,pair){
 if(!pair?.canCollect||snapshot.stale||!snapshot.typeAvailable)throw Error('정규장 마감 후 최신 산업·상품유형 응답 필요');
 const at=Date.parse(snapshot.receivedAt);
 if(at<Date.parse(pair.us.close)+30*60000||at>=Date.parse(pair.nextUs.open))throw Error('해당 정규장 마감 이후 조회 자료가 아닙니다');
 // Index membership is observed, not retrospectively reconstructed. Share-class
 // duplicates across indices are one ticker; unknown security types are excluded.
 const stocks=[...new Map(snapshot.items.filter(s=>s.indices?.length&&s.isEtf===false&&!['ETF','ETN','ELW','PREFERRED_STOCK'].includes(s.securityType)).map(s=>[s.ticker,s])).values()];
 const valid=stocks.filter(s=>s.industry&&Number.isFinite(s.changePct)&&s.price>0),benchmark=median(valid.map(s=>s.changePct));
 if(!stocks.length||valid.length/stocks.length<rules.minCoverage)throw Error('산업 분석 시세 커버리지 부족');
 const groups=new Map();for(const s of valid){if(!groups.has(s.industry))groups.set(s.industry,[]);groups.get(s.industry).push(s);}
 const industries=[...groups].map(([name,members])=>{
  const count=members.length,targetCount=stocks.filter(s=>s.industry===name).length,coverage=count/targetCount,up=members.filter(s=>s.changePct>0).length,flat=members.filter(s=>s.changePct===0).length,ret=median(members.map(s=>s.changePct));
  const weighted=members.every(s=>s.marketCap>0)?members.reduce((n,s)=>n+s.changePct*s.marketCap,0)/members.reduce((n,s)=>n+s.marketCap,0):null;
  const positive=members.filter(s=>s.changePct>0&&s.marketCap>0).map(s=>s.marketCap*s.changePct).sort((a,b)=>b-a),total=positive.reduce((a,b)=>a+b,0),topTwoShare=total>0?positive.slice(0,2).reduce((a,b)=>a+b,0)/total:null;
  const rv=members.map(s=>s.relativeVolume).filter(n=>Number.isFinite(n)&&n>=0),broad=ret>0&&up/count>=0.6&&(topTwoShare===null||topTwoShare<0.75);
  return {name,sector:members[0].sector,count,targetCount,coverage,up,flat,down:count-up-flat,upRatio:up/count,returnPct:ret,weightedReturn:weighted,excess:ret-benchmark,relativeVolume:median(rv),volumeCount:rv.length,topTwoShare,
   pattern:count<rules.minIndustryCount||coverage<rules.minCoverage?'판단 자료 부족':broad?'산업 전반 상승':up?'일부 종목 주도':'상승 확산 미확인',eligible:count>=rules.minIndustryCount&&coverage>=rules.minCoverage&&ret>0,
   stocks:members.map(s=>({ticker:s.ticker,name:s.name,changePct:s.changePct,price:s.price,volume:s.volume,relativeVolume:s.relativeVolume,marketCap:s.marketCap}))};
 }).sort((a,b)=>b.returnPct-a.returnPct);
 return {version,sessionDate:pair.us.date,closeAt:pair.us.close,targetDate:pair.kr.date,targetOpen:pair.kr.open,targetClose:pair.kr.close,observedAt:snapshot.receivedAt,classificationAt:snapshot.receivedAt,industries,benchmark,count:valid.length,targetCount:stocks.length,
  universe:rules.universe,source:'Finviz Elite Screener',basis:'정규장 마감 후 Price·Change 스냅샷 · 개별 체결시각 미제공',benchmarkLabel:'분석 대상 종목 수익률 중간값 · 공식 시장지수 아님'};
}
export function nextDayReactions(snapshots,evidence,stockBars,indexBars,exchange,topic,now=Date.now()){
 const samples=[];const benchmark=exchange==='KOSPI'?'KOSPI':exchange==='KOSDAQ'?'KOSDAQ':null;
 if(!benchmark)return {status:'insufficient',count:0,samples:[],reason:'국내 시장 지수 식별 미확인'};
 for(const s of snapshots){
  if(!rules.validBacktestVersions.includes(s.version))continue;
  const cutoff=Date.parse(s.targetOpen);if(!Number.isFinite(cutoff)||!s.targetClose||Date.parse(s.targetClose)>now||Date.parse(s.classificationAt)>cutoff||Date.parse(s.observedAt)>cutoff)continue;
  const available=evidence.filter(e=>e.version===s.version&&Date.parse(e.availableAt)<=cutoff&&Date.parse(e.checkedAt)<=cutoff).sort((a,b)=>b.receipt.localeCompare(a.receipt));
  const receipt=available[0]?.receipt,e=available.find(e=>e.receipt===receipt&&e.status==='verified'&&(!topic||e.topic===topic));if(!e)continue;
  const signal=s.industries.find(i=>i.eligible&&e.industries.some(r=>r.name===i.name));if(!signal)continue;
  const bar=stockBars.find(p=>(p.date||p.at)===s.targetDate),index=indexBars.find(p=>(p.date||p.at)===s.targetDate);
  // FSC reported daily change handles the supplier's ex-date base; do not
  // substitute a raw unadjusted close ratio across stock splits.
  if(!Number.isFinite(bar?.changePct)||!Number.isFinite(index?.changePct))continue;
  samples.push({usDate:s.sessionDate,date:s.targetDate,returnPct:bar.changePct,indexReturn:index.changePct,excess:bar.changePct-index.changePct,receipt:e.receipt,classificationVersion:s.version});
 }
 const unique=[...new Map(samples.sort((a,b)=>a.usDate.localeCompare(b.usDate)).map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 return {status:unique.length>=rules.minBacktestSamples?'ready':'insufficient',count:unique.length,up:unique.filter(s=>s.returnPct>0).length,median:median(unique.map(s=>s.returnPct)),excessMedian:median(unique.map(s=>s.excess)),from:unique[0]?.date||null,to:unique.at(-1)?.date||null,benchmark,samples:unique,reason:unique.length<rules.minBacktestSamples?'판단 자료 부족 · 당시 공시·분류와 다음 거래일 시세가 확인된 표본 '+unique.length+'/'+rules.minBacktestSamples+'개':''};
}
