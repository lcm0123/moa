import {kstDate,validDay} from '../dist/js/calendar-model.js';
import {universes} from './providers/constituents.mjs';

export const calculation='관측 시가총액으로 가중한 종목 등락률 평균 · 자체 계산 · 공식 섹터지수 아님';
export function historyPolicy(env){
 if(env.LOCAL_PREVIEW===true)return {store:true,display:true};
 try{const p=JSON.parse(env.SECTOR_HISTORY_POLICY||'{}');return {store:p.store===true,display:p.display===true};}catch{return {store:false,display:false};}
}
export function summarizeSectors(data,market,indexId,now=Date.now()){
 if(universes[indexId]?.market!==market||data.indexId!==indexId||data.status!=='ready'||data.stale||!data.items?.length)throw new Error('최신 섹터 데이터 연결 후 기록합니다.');
 if(data.excluded?.length)throw new Error('분류·시가총액이 누락된 종목이 있어 기록을 보류합니다.');
 const seen=new Set();
 const sectors=data.items.map(sector=>{
  if(!sector.id||!sector.name||!sector.stocks?.length)throw new Error('섹터 분류를 확인한 뒤 기록합니다.');
  let total=0,weighted=0;
  for(const stock of sector.stocks){
   if(seen.has(stock.id)||stock.market!==market||stock.quoteAvailable!==true||!Number.isFinite(stock.changePct)||!Number.isFinite(stock.marketCap)||stock.marketCap<=0)throw new Error('가격·등락률이 누락된 종목이 있어 기록을 보류합니다.');
   seen.add(stock.id);total+=stock.marketCap;weighted+=stock.marketCap*stock.changePct;
  }
  const changePct=weighted/total;if(!Number.isFinite(changePct))throw new Error('등락률 계산에 필요한 데이터가 없습니다.');
  const stocks=sector.stocks.map(s=>({id:s.id,ticker:s.ticker||s.id,name:s.name||s.ticker||s.id,market,currency:s.currency||(market==='US'?'USD':'KRW'),industryName:s.industryName||null,price:Number.isFinite(s.price)?s.price:null,changePct:s.changePct,marketCap:s.marketCap,weight:s.marketCap/total}));
  return {id:sector.id,name:sector.name,classification:sector.classification,changePct,marketCap:total,stockCount:stocks.length,stocks};
 }).sort((a,b)=>b.changePct-a.changePct||a.id.localeCompare(b.id));
 if(new Set(sectors.map(s=>s.id)).size!==sectors.length||seen.size!==data.constituents?.total)throw new Error('전체 구성종목이 확인된 경우에만 기록합니다.');
 const observedAt=data.asOfKind==='received'?data.asOf:new Date(now).toISOString();
 if(!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>now+60000)throw new Error('관측 날짜를 확인한 뒤 기록합니다.');
 const strong=sectors.slice(0,3).map(s=>s.id);
 const weak=[...sectors].reverse().filter(s=>!strong.includes(s.id)).slice(0,3).map(s=>s.id);
 const dateBased=market==='KR'&&data.mode==='previous_close'&&validDay(data.baseDate);
 return {day:dateBased?data.baseDate:kstDate(observedAt),market,indexId,universe:universes[indexId].name,sectors,strong,weak,observedAt,
  source:data.source,sourceAsOf:data.asOfKind==='received'?null:data.asOf,mode:data.mode,asOfKind:data.asOfKind||'quote',
  membershipVersion:data.constituents.version,stockCount:seen.size,calculation,recordBasis:dateBased?'공급사 시세 기준일 · 전일 기준 종가':'한국시간 관측일 · 당일 마지막 관측값'};
}
export async function recordSectorSnapshot(env,data,market,indexId,now=Date.now()){
 if(!historyPolicy(env).store)return {status:'restricted',message:'섹터 기록 저장 권한 설정 필요'};
 if(!env.DB)return {status:'error',message:'섹터 기록 저장소 연결 필요'};
 let snapshot;try{snapshot=summarizeSectors(data,market,indexId,now);}catch(e){return {status:'incomplete',message:e.message};}
 try{
  const id=market+':'+indexId+':'+snapshot.day;
  await env.DB.prepare('INSERT INTO sector_daily_history(id,market,index_id,day,snapshot,observed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,observed_at=excluded.observed_at WHERE excluded.observed_at>sector_daily_history.observed_at').bind(id,market,indexId,snapshot.day,JSON.stringify(snapshot),snapshot.observedAt).run();
  return {status:'saved',day:snapshot.day};
 }catch{return {status:'error',message:'섹터 기록을 저장하지 못했습니다.'};}
}
export async function readSectorHistory(env,market,indexId,month){
 if(!historyPolicy(env).display)return {status:'restricted',items:[],message:'섹터 기록 표시 권한 설정 필요'};
 if(!env.DB)return {status:'error',items:[],message:'섹터 기록 저장소 연결 필요'};
 try{
  const result=await env.DB.prepare('SELECT snapshot FROM sector_daily_history WHERE market=? AND index_id=? AND day>=? AND day<=? ORDER BY day').bind(market,indexId,month+'-01',month+'-31').all();
  const items=result.results.map(row=>JSON.parse(row.snapshot));
  return {status:items.length?'ready':'empty',items,market,indexId,month,calculation,timeZone:'Asia/Seoul',automatic:env.LOCAL_PREVIEW===true,intervalMinutes:5};
 }catch{return {status:'error',items:[],message:'섹터 기록을 불러오지 못했습니다.'};}
}
