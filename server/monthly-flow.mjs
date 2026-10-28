import {sectorProvider} from './providers/sectors.mjs';
import {universes} from './providers/constituents.mjs';
import {stockType} from './stock-ranking.mjs';
import {usSecurityTypes} from './providers/us-security-types.mjs';
import {monthlyCalculation} from './monthly-flow-model.mjs';
import {fscPolicy} from './providers/data-go-kr-model.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {getPolicy} from './providers/base.mjs';
import {fetchFscIndexHistory} from './providers/fsc-index-history.mjs';
const pending=new WeakMap(),version='v3';
const parse=s=>{try{return JSON.parse(s);}catch{return null;}};
async function cachedBenchmark(env,market,indexId){
 if(market==='KR'){
  if(!fscPolicy(env,'indices').chart)return {points:[]};
  let row=(await env.DB.prepare('SELECT * FROM fsc_index_history WHERE id=?').bind(indexId).all()).results[0];
  // The exact KOSDAQ150 identity is taken from the already verified FSC response,
  // not substituted with KOSDAQ Composite. Keep the existing home index feed intact.
  if(indexId==='KOSDAQ150'&&env.DATA_GO_KR_SERVICE_KEY&&!(row?.next_attempt>Date.now())){
   const latest=(await env.DB.prepare("SELECT payload FROM fsc_daily_snapshots WHERE operation='indices' ORDER BY base_date DESC LIMIT 1").all()).results[0];
   const match=(parse(latest?.payload)||[]).filter(i=>i.name==='코스닥 150'&&i.classification==='KOSDAQ시리즈');
   if(match.length===1){
    await env.DB.prepare('INSERT INTO fsc_index_history(id) VALUES(?) ON CONFLICT(id) DO NOTHING').bind(indexId).run();
    const now=Date.now(),leaseUntil=now+86400000,lease=await env.DB.prepare('UPDATE fsc_index_history SET next_attempt=? WHERE id=? AND next_attempt<=?').bind(leaseUntil,indexId,now).run();
    if(lease.meta.changes){try{
     const points=await fetchFscIndexHistory(env,match[0]);
     // Keep a late response or failure from replacing a newer worker's result.
     await env.DB.prepare('UPDATE fsc_index_history SET payload=?,covered_through=?,received_at=?,error_code=NULL WHERE id=? AND next_attempt=?').bind(JSON.stringify(points),points.at(-1)?.at||null,new Date().toISOString(),indexId,leaseUntil).run();
    }catch{await env.DB.prepare("UPDATE fsc_index_history SET error_code='HISTORY_SYNC_FAILED' WHERE id=? AND next_attempt=?").bind(indexId,leaseUntil).run();}}
    row=(await env.DB.prepare('SELECT * FROM fsc_index_history WHERE id=?').bind(indexId).all()).results[0];
   }
  }
  return {source:'금융위원회 · 공공데이터포털 / KRX',points:parse(row?.payload)||[],receivedAt:row?.received_at};
 }
 if(env.LOCAL_PREVIEW!==true&&!(getPolicy(env,'FMP_INDICES').display&&getPolicy(env,'FMP_INDICES').chart))return {points:[]};
 const id={SP500:'SPX',NASDAQ100:'NDX',DOW30:'DJI'}[indexId];
 const rows=(await env.DB.prepare('SELECT payload FROM fmp_last_good WHERE cache_key LIKE ? OR cache_key LIKE ?').bind('%:history:'+id,'%:index:'+id).all()).results;
 const records=rows.map(r=>parse(r.payload)).filter(Boolean).sort((a,b)=>(a.receivedAt||'').localeCompare(b.receivedAt||'')),points=new Map();
 for(const r of records)for(const p of r.points||r.history||[])if(Number.isFinite(p.value))points.set(p.at,p);
 return {source:'FMP · 검증된 지수 일봉 캐시',points:[...points.values()].sort((a,b)=>a.at.localeCompare(b.at)),receivedAt:records.at(-1)?.receivedAt};
}
export async function monthlyFlow(env,{market,indexId,month,day},{now=Date.now(),loadFeed=sectorProvider,readBenchmark=cachedBenchmark,readTypes=usSecurityTypes}={}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(universes[indexId]?.market!==market||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month>today.slice(0,7)||month<'2000-01'||day&&(!day.startsWith(month+'-')||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day))return {status:'error',items:[],stocks:[],message:'시장·월·거래일을 확인해 주세요.'};
 if(!env.DB)return {status:'error',items:[],stocks:[],message:'월간 집계 저장소 연결 필요'};
 try{if(market==='US'){requireFinviz(env,'chart','STOCKS');requireFinviz(env,'treemap','STOCKS');}else if(!fscPolicy(env,'stocks').chart||!fscPolicy(env,'stocks').treemap)throw Error();}catch{return {status:'restricted',items:[],stocks:[],message:'과거 가격·가공 수치 표시 권한 확인 필요'};}
 const benchmarkAllowed=market==='KR'?fscPolicy(env,'indices').chart:env.LOCAL_PREVIEW===true||(getPolicy(env,'FMP_INDICES').display&&getPolicy(env,'FMP_INDICES').chart);
 const key=[version,market,indexId,month,day||'latest',benchmarkAllowed?'benchmark':'no-benchmark'].join(':'),row=(await env.DB.prepare('SELECT * FROM monthly_flow_cache WHERE cache_key=?').bind(key).all()).results[0],saved=parse(row?.payload);
 if(saved&&row.expires_at>now)return {...saved,cached:true};
 let jobs=pending.get(env.DB);if(!jobs){jobs=new Map();pending.set(env.DB,jobs);}if(jobs.has(key))return jobs.get(key);
 const task=(async()=>{try{
  const feed=await loadFeed(env,market,indexId);if(feed.status!=='ready')throw Error(feed.message||'구성종목·분류 연결 필요');
  const members=feed.items.flatMap(s=>s.stocks),histories=new Map(),types={},metadata=market==='US'?await readTypes(env):null;
  const start=new Date(Date.parse(month+'-01')-35*86400000).toISOString().slice(0,10),end=month+'-31';
  // Bounded, sequential cache reads. No bulk vendor history fetch on page open.
  for(const stock of members){
   let h;
   if(market==='KR'){
    const r=(await env.DB.prepare("SELECT payload,received_at,operation,isin FROM fsc_stock_history WHERE stock_id=? AND operation='stocks' ORDER BY received_at DESC LIMIT 1").bind(stock.id).all()).results[0];
    if(r&&(!stock.isin||stock.isin===r.isin)){h={bars:parse(r.payload)||[],receivedAt:r.received_at,adjustment:'unverified'};types[stock.id]={type:'STOCK',isEtf:false};}
   }else{types[stock.id]=stockType(stock,metadata);h=await env.READ_STOCK_HISTORY?.(stock.ticker,{from:start,to:end});}
   if(h)histories.set(stock.id,{...h,bars:h.bars.filter(b=>(b.date||b.at)>=start&&(b.date||b.at)<=end)});
  }
  const result=monthlyCalculation({market,indexId,month,day,feed,histories,types,benchmark:await readBenchmark(env,market,indexId),now:new Date(now).toISOString()});
  await env.DB.prepare('INSERT INTO monthly_flow_cache(cache_key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(key,JSON.stringify(result),now+900000).run();
  // Bounded retention, including historical month queries; corrections refresh.
  await env.DB.prepare('DELETE FROM monthly_flow_cache WHERE expires_at<?').bind(now-30*86400000).run();return result;
 }catch{return saved?{...saved,stale:true,message:'조회 실패 · 마지막 월간 집계'}:{status:'error',analysis:'monthly',market,indexId,month,items:[],stocks:[],message:'월간 데이터 연결 실패 · 저장된 일봉·구성종목을 확인해 주세요.'};}})();jobs.set(key,task);try{return await task;}finally{jobs.delete(key);}
}
