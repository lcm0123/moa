import {fscOperations,fscPolicy,fscSource} from './data-go-kr-model.mjs';
import {normalizeBars} from '../../dist/js/stock-chart-model.js';
import {syncFscStockHistory,historyFailureMessage} from './fsc-stock-history.mjs';

// A daily-history adapter returns source OHLCV only. It never uses a live quote
// to fill a close, creates missing sessions, or requests an unverified endpoint.
export async function storedFscDaily(env,stock){
 const operation=Object.keys(fscOperations).find(key=>fscOperations[key].type===stock.type);
 if(!operation||operation==='indices'||!fscPolicy(env,fscOperations[operation].family).chart)return {status:'restricted',bars:[]};
 if(!env.DB)return {status:'error',bars:[],message:'일봉 저장소 연결 필요'};
 const cache=await syncFscStockHistory(env,stock);
 const rows=(await env.DB.prepare(`SELECT s.base_date,s.synced_at,j.value FROM fsc_daily_snapshots s, json_each(s.payload) j
 WHERE s.operation=? AND json_extract(j.value,'$.id')=? AND s.base_date<=?
 ORDER BY s.base_date DESC LIMIT 5000`).bind(operation,stock.id,stock.baseDate).all()).results;
 const bars=[];
 for(const row of rows){
  let item;try{item=JSON.parse(row.value);}catch{continue;}
  // An exact ISIN match is required across dates, including ticker reuse.
  if(!stock.isin||item.isin!==stock.isin||item.market!=='KR'||item.currency!=='KRW'||item.baseDate!==row.base_date)continue;
  bars.push({date:row.base_date,open:item.open,high:item.high,low:item.low,close:item.price,volume:item.volume,collectedAt:row.synced_at});
 }
 // The complete per-security history is independent of whole-market snapshots.
 // Latest saved daily snapshots may extend it while a provider call is failing.
 const combined=new Map();for(const b of cache?JSON.parse(cache.payload):[])if(b.date<=stock.baseDate)combined.set(b.date,b);
 for(const b of bars)if(!combined.has(b.date)||b.collectedAt>=cache?.received_at)combined.set(b.date,b);
 const history=[...combined.values()].sort((a,b)=>a.date.localeCompare(b.date));
 return {status:history.length?'ready':cache?.error_code?'error':'empty',bars:history,source:fscSource,
  receivedAt:[cache?.received_at,...bars.map(b=>b.collectedAt)].filter(Boolean).sort().at(-1)||null,adjustment:'unverified',mode:'previous_close',
  stale:!!cache?.error_code,message:cache?.error_code?historyFailureMessage(cache.error_code):null,
  coverage:{complete:!!cache?.received_at,sourceCount:cache?.source_count||0,checkedThrough:cache?.covered_through||null}};
}

export const koreanHistoryAdapters={data_go_kr:storedFscDaily};
export async function attachKoreanDailyHistory(env,stock,feed,adapters=koreanHistoryAdapters){
 if(stock.market!=='KR')return stock;
 if(!feed.policy?.chart)return {...stock,history:[],historyStatus:'restricted',historyError:'차트 이용 권한 확인 필요'};
 try{
  const adapter=adapters[stock.provider||feed.provider];
  const result=adapter?await adapter(env,stock,feed):{bars:stock.history||[],source:stock.historySource||feed.source,receivedAt:stock.historyReceivedAt,adjustment:stock.adjustment,mode:feed.mode};
  const history=normalizeBars(result.bars).filter(b=>b.ohlc&&b.close>0&&b.open>0&&b.low>0);
  return {...stock,history,historySource:result.source||feed.source,historyReceivedAt:result.receivedAt||null,
   historyStatus:result.status==='error'||result.status==='restricted'?result.status:history.length?'ready':'empty',historyError:result.message||null,historyStale:!!result.stale,
   historyMeta:{interval:'1d',timeZone:'Asia/Seoul',baseDate:history.at(-1)?.date||null,startDate:history[0]?.date||null,count:history.length,adjustment:result.adjustment||'unverified',mode:result.mode||'unknown',coverage:result.coverage||null}};
 }catch{return {...stock,history:[],historyStatus:'error',historyError:'저장된 일봉을 불러오지 못했습니다.'};}
}
