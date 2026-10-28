import {fscStocks} from './providers/data-go-kr.mjs';
import {fscPolicy} from './providers/data-go-kr-model.mjs';
import {constituentsProvider} from './providers/constituents.mjs';
import {classificationsProvider} from './providers/classifications.mjs';
import {syncFscStockHistory} from './providers/fsc-stock-history.mjs';
import {reconstructionPolicy,reconstructSectorDays,saveReconstructedDays} from './sector-backfill.mjs';

const running=new WeakMap(),indices=['KOSPI200','KOSDAQ150'];
const read=async db=>(await db.prepare("SELECT * FROM sector_history_jobs WHERE id='KR'").all()).results[0];
export async function koreanHistoryProgress(env){
 if(!env.DB)return null;
 const row=await read(env.DB),job=row?JSON.parse(row.payload):null;
 return job?.status==='running'&&row.lease_until<Date.now()?{...job,status:'paused',message:'수집 중단 · 다음 실행에서 저장된 일봉부터 재개'}:job;
}
export function refreshKoreanSectorHistory(env){
 if(!env.DB||!env.DATA_GO_KR_SERVICE_KEY||!reconstructionPolicy(env).store||!fscPolicy(env,'stocks').chart)return Promise.resolve();
 if(running.has(env.DB))return running.get(env.DB);
 const task=collect(env).catch(()=>{}).finally(()=>running.delete(env.DB));running.set(env.DB,task);return task;
}
async function collect(env){
 const db=env.DB,now=Date.now();
 await db.prepare("INSERT INTO sector_history_jobs(id) VALUES('KR') ON CONFLICT(id) DO NOTHING").run();
 const row=await read(db);if(row.lease_until>now||row.next_attempt>now)return;
 const lock=await db.prepare("UPDATE sector_history_jobs SET lease_until=? WHERE id='KR' AND lease_until<=?").bind(now+600000,now).run();if(!lock.meta.changes)return;
 let progress={status:'running',completed:0,total:0,missing:0,startedAt:new Date(now).toISOString(),message:'국내 구성종목과 일봉 확인 중'};
 const update=async()=>{progress.updatedAt=new Date().toISOString();await db.prepare("UPDATE sector_history_jobs SET payload=?,lease_until=? WHERE id='KR'").bind(JSON.stringify(progress),Date.now()+600000).run();};
 let retry=3600000;
 try{
  await update();
  const quotes=await fscStocks(env,{},'treemap');if(quotes.status!=='ready'||quotes.stale)throw new Error('현재 기준일의 국내 시세 연결 필요');
  const datasets=[];
  for(const indexId of indices){const membership=await constituentsProvider(env,indexId),classifications=await classificationsProvider(env,'KR',indexId);if(membership.status!=='ready'||classifications.status!=='ready'||membership.stale||classifications.stale)throw new Error('국내 구성종목·섹터 분류 연결 필요');datasets.push({indexId,membership,classifications});}
  const signature=JSON.stringify([quotes.baseDate,...datasets.map(d=>[d.indexId,d.membership.version])]),previous=JSON.parse(row.payload);
  if(previous.signature===signature&&previous.status==='ready'){
   await db.prepare("UPDATE sector_history_jobs SET payload=?,lease_until=0,next_attempt=? WHERE id='KR'").bind(row.payload,Date.now()+3600000).run();return;
  }
  progress.signature=signature;progress.baseDate=quotes.baseDate;
  const ids=[...new Set(datasets.flatMap(d=>d.membership.items.map(m=>m.id)))],stocks=new Map(quotes.items.map(s=>[s.id,s])),histories=new Map();
  progress.total=ids.length;await update();let cursor=0,stop=false,errors=0;
  async function worker(){while(cursor<ids.length&&!stop){
   const id=ids[cursor++],stock=stocks.get(id);
   if(stock?.isin){
    const result=await syncFscStockHistory(env,stock,{requireDailyReturns:true});
    if(result?.error_code){errors++;if(/^(HTTP_40[13]|HTTP_429|FSC_(20|22|23|30|31))$/.test(result.error_code)){stop=true;retry=86400000;}if(errors>=5)stop=true;}
    const bars=JSON.parse(result?.payload||'[]').filter(b=>Number.isFinite(b.changePct));
    if(bars.length)histories.set(id,{bars,receivedAt:result.received_at});else progress.missing++;
   }else progress.missing++;
   progress.completed++;progress.message='국내 일봉 수집 '+progress.completed+' / '+progress.total;await update();
   await new Promise(resolve=>setTimeout(resolve,200));
  }}
  // At most two verified per-ISIN requests; completed histories are reused after restart.
  const workers=await Promise.allSettled([worker(),worker()]);
  const failed=workers.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  if(stop)throw new Error('공급처 제한 또는 오류 · 저장된 일봉을 유지하고 재시도 대기');
  progress.message='국내 섹터별 거래일 기록 계산 중';await update();
  let days=0;
  for(const dataset of datasets){const records=reconstructSectorDays({...dataset,histories,from:'1900-01-01',to:quotes.baseDate});if(!records.length)throw new Error('전체 섹터의 일간 등락률이 확인되는 거래일이 없습니다.');await saveReconstructedDays(env,records);days+=records.length;}
  progress.status=progress.missing?'partial':'ready';progress.days=days;progress.message=progress.missing?'일부 종목의 일봉이 없어 포함 종목만 계산했습니다.':'국내 과거 섹터 기록 저장 완료';retry=progress.missing?3600000:86400000;
 }catch(error){progress.status='error';progress.message=['현재 기준일의 국내 시세 연결 필요','국내 구성종목·섹터 분류 연결 필요','공급처 제한 또는 오류 · 저장된 일봉을 유지하고 재시도 대기','전체 섹터의 일간 등락률이 확인되는 거래일이 없습니다.'].includes(error.message)?error.message:'국내 과거 기록 갱신 실패 · 마지막 저장 기록 유지';}
 finally{progress.updatedAt=new Date().toISOString();if(progress.status!=='running')await db.prepare("UPDATE sector_history_jobs SET payload=?,lease_until=0,next_attempt=? WHERE id='KR'").bind(JSON.stringify(progress),Date.now()+retry).run();}
}
export function startKoreanSectorHistory(env){void refreshKoreanSectorHistory(env);const timer=setInterval(()=>void refreshKoreanSectorHistory(env),30*60000);timer.unref?.();return ()=>clearInterval(timer);}
