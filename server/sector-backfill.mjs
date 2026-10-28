import {universes} from './providers/constituents.mjs';
import {historyPolicy} from './sector-history.mjs';

export const reconstructionCalculation='현재 구성종목·섹터 분류 기준 · 제공 일봉 종가의 전 거래일 대비 등락률 동일 비중 평균 · 공식 섹터지수 아님';
export function reconstructionPolicy(env){
 const history=historyPolicy(env);let enabled=env.LOCAL_PREVIEW===true;
 if(!enabled){try{enabled=JSON.parse(env.SECTOR_HISTORY_POLICY||'{}').reconstruct===true;}catch{}}
 return {store:history.store&&enabled,display:history.display&&enabled};
}
// Do not apply today's market caps to old prices. Preserve the observed journal
// separately; these records explicitly describe a retrospective, equal-weight basket.
export function reconstructSectorDays({indexId,membership,classifications,histories,from,to,now=new Date().toISOString()}){
 const market=universes[indexId]?.market;
 if(!market||membership.status!=='ready'||classifications.status!=='ready')throw new Error('확인된 구성종목·섹터 분류가 필요합니다.');
 const seen=new Set(),mapping=new Map(classifications.items.map(c=>[c.id,c])),memberById=new Map(membership.items.map(m=>[m.id,m]));
 const groups=new Map(),members=[];
 for(const member of membership.items){
  if(seen.has(member.id))continue;seen.add(member.id);
  const c=mapping.get(member.id);if(!c?.sectorId||!c?.sectorName)throw new Error('섹터 분류가 없는 구성종목이 있어 과거 계산을 보류합니다.');
  members.push(member);
  if(!groups.has(c.sectorId))groups.set(c.sectorId,{id:c.sectorId,name:c.sectorName,classification:c.classification,ids:[]});
  groups.get(c.sectorId).ids.push(member.id);
 }
 const dates=new Set(),barsByStock=new Map();
 for(const member of members){
  const bars=histories.get(member.id)?.bars||[],unique=new Set();
  for(const bar of bars){if(unique.has(bar.date))throw new Error('중복 일봉 날짜를 확인해 주세요.');unique.add(bar.date);if(bar.date<=to)dates.add(bar.date);}
  barsByStock.set(member.id,new Map(bars.map(b=>[b.date,b])));
 }
 const ordered=[...dates].sort(),records=[];
 for(let i=market==='KR'?0:1;i<ordered.length;i++){
  const day=ordered[i],previous=ordered[i-1];if(day<from||day>to)continue;
  const sectors=[];
  for(const group of groups.values()){
   let total=0;const stocks=[];
   for(const id of group.ids){const bars=barsByStock.get(id),bar=bars.get(day),close=bar?.value??bar?.close,prior=bars.get(previous)?.value??bars.get(previous)?.close;if(!Number.isFinite(close)||close<=0)continue;const change=market==='KR'?bar.changePct:Number.isFinite(prior)&&prior>0?(close/prior-1)*100:null;if(Number.isFinite(change)){total+=change;const m=memberById.get(id);stocks.push({id,ticker:m.ticker||id,name:m.name||m.ticker||id,market,currency:market==='KR'?'KRW':'USD',industryName:mapping.get(id).industryName||null,price:close,previousClose:Number.isFinite(prior)?prior:null,changePct:change});}}
   const count=stocks.length;stocks.forEach(s=>s.weight=1/count);
   sectors.push({id:group.id,name:group.name,classification:group.classification,changePct:count?total/count:null,stockCount:count,totalStockCount:group.ids.length,missingCount:group.ids.length-count,marketCap:null,stocks});
  }
  // A partial sector cannot be silently treated as a zero-return sector.
  if(sectors.some(s=>s.changePct===null))continue;
  sectors.sort((a,b)=>b.changePct-a.changePct||a.id.localeCompare(b.id));
  const strong=sectors.slice(0,3).map(s=>s.id),weak=[...sectors].reverse().filter(s=>!strong.includes(s.id)).slice(0,3).map(s=>s.id),stockCount=sectors.reduce((n,s)=>n+s.stockCount,0);
  records.push({day,market,indexId,universe:universes[indexId].name,kind:'reconstructed',sectors,strong,weak,stockCount,totalStockCount:members.length,missingCount:members.length-stockCount,coverage:stockCount/members.length,
   source:'Finviz Elite 일봉',mode:'historical_close',sourceAsOf:null,observedAt:now,calculation:reconstructionCalculation,recordBasis:'미국 거래일 · 과거 재계산',membershipVersion:membership.version,membershipObservedAt:membership.observedAt||membership.asOf,
   adjustmentNote:'공급된 Close 기준 · 배당 포함 총수익률 아님 · 가격 조정 방식 미확인',coverageNote:'현재 구성종목 중 해당 거래일과 직전 거래일의 일봉이 모두 있는 종목만 평균에 포함합니다. 과거 편입·편출과 당시 섹터 변경은 반영하지 않습니다.',
   ...(market==='KR'?{source:'금융위원회 · 공공데이터포털 주식 일봉 / KRX 구성종목·GICS',sourceAsOf:day,recordBasis:'한국 거래일 · 과거 재계산',calculation:'현재 구성종목·GICS 분류 기준 · 공공데이터 일별 등락률(fltRt)의 동일 비중 평균 · 공식 섹터지수 아님',coverageNote:'해당 날짜의 종가와 공급사 일간 등락률이 있는 종목만 포함합니다. 과거 편입·편출과 당시 섹터 변경은 반영하지 않습니다.',adjustmentNote:'공급사 fltRt 사용 · 종가 비율로 임의 재계산하지 않음 · 배당 포함 총수익률 아님'}:{})});
 }
 return records;
}
export async function saveReconstructedDays(env,records){
 if(!reconstructionPolicy(env).store)throw new Error('과거 재계산 저장 권한 설정 필요');
 if(!env.DB)throw new Error('섹터 기록 저장소 연결 필요');
 for(const record of records)await env.DB.prepare('INSERT INTO sector_reconstructed_history(id,market,index_id,day,snapshot,calculated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,calculated_at=excluded.calculated_at').bind(record.market+':'+record.indexId+':'+record.day,record.market,record.indexId,record.day,JSON.stringify(record),record.observedAt).run();
 return records.length;
}
export async function readReconstructedHistory(env,market,indexId,month){
 if(!reconstructionPolicy(env).display)return {status:'restricted',items:[],message:'과거 재계산 표시 권한 설정 필요'};
 if(universes[indexId]?.market!==market)return {status:'error',items:[],message:'시장과 구성종목 지수를 확인해 주세요.'};
 if(!env.DB)return {status:'error',items:[],message:'섹터 기록 저장소 연결 필요'};
 try{
  const rows=await env.DB.prepare('SELECT snapshot FROM sector_reconstructed_history WHERE market=? AND index_id=? AND day>=? AND day<=? ORDER BY day').bind(market,indexId,month+'-01',month+'-31').all();
  const range=await env.DB.prepare('SELECT MIN(day) AS first_day,MAX(day) AS last_day,COUNT(*) AS days FROM sector_reconstructed_history WHERE market=? AND index_id=?').bind(market,indexId).all();
  const items=rows.results.map(row=>JSON.parse(row.snapshot));
  return {status:items.length?'ready':'empty',items,market,indexId,month,basis:'reconstructed',calculation:items[0]?.calculation||reconstructionCalculation,dateBasis:market==='KR'?'한국 거래일':'미국 거래일',range:range.results[0],message:items.length?'':'이 달에 복원된 일봉 기록이 없습니다. 휴장일과 데이터가 없는 날은 비워 둡니다.'};
 }catch{return {status:'error',items:[],message:'과거 섹터 기록을 불러오지 못했습니다.'};}
}
