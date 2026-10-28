import {requestFscPage,createFscRequestBudget,fscFailureCode,fscAuthenticationFailure,fscCredentialVersion,fscHasCredentialColumn} from './data-go-kr.mjs';
import {fscOperations,fscPolicy,normalizeFscItem,dateBefore,nextFscSync} from './data-go-kr-model.mjs';
import requestPolicy from '../../config/fsc-request-policy.json' with {type:'json'};

const inflight=new WeakMap();
const read=async(db,id)=>(await db.prepare('SELECT * FROM fsc_stock_history WHERE id=?').bind(id).all()).results[0]||null;
export function historyOperation(stock){return Object.keys(fscOperations).find(op=>op!=='indices'&&fscOperations[op].type===stock.type);}
export function historyFailureMessage(code){return /^(HTTP_40[13]|FSC_(20|30|31))$/.test(code||'')?'과거 일봉 접근 권한 확인 필요':/^(HTTP_429|FSC_2[23])$/.test(code||'')?'과거 일봉 호출 한도 초과':'과거 일봉 갱신 실패 · 마지막 저장 자료';}

// Official V2 guide: an exact isinCd with no beginBasDt retrieves all available
// history. endBasDt is exclusive; pin it to the next day to keep pages stable.
export async function fetchFscFullHistory(env,stock,operation,{fetcher=fetch,now=Date.now(),budget=createFscRequestBudget()}={}){
 const at=new Date(now).toISOString(),params={isinCd:stock.isin,endBasDt:dateBefore(stock.baseDate,-1).replaceAll('-',''),numOfRows:'10000',pageNo:'1'};
 const first=await requestFscPage(env,operation,params,{fetcher,budget});
 if(first.page!==1||!first.total||first.total>requestPolicy.maxRows)throw Object.assign(new Error('Invalid history count'),{code:!first.total?'NO_HISTORY':'INCOMPLETE_HISTORY'});
 const rows=[...first.items];
 for(let page=2;rows.length<first.total;page++){
  if(page>requestPolicy.maxHistoryPages)throw new Error('INCOMPLETE_HISTORY');
  const next=await requestFscPage(env,operation,{...params,pageNo:String(page)},{fetcher,budget});
  if(next.page!==page||next.total!==first.total||next.size!==first.size||!next.items.length)throw new Error('INCOMPLETE_HISTORY');rows.push(...next.items);
 }
 if(rows.length!==first.total)throw new Error('INCOMPLETE_HISTORY');
 const dates=new Set(),bars=[];
 for(const raw of rows){
  const s=normalizeFscItem(raw,operation,at);
  if(s.isin!==stock.isin||s.id!==stock.id||s.market!=='KR'||s.currency!=='KRW'||s.baseDate>stock.baseDate||dates.has(s.baseDate))throw new Error('INVALID_HISTORY_IDENTITY');
  dates.add(s.baseDate);bars.push({date:s.baseDate,open:s.open,high:s.high,low:s.low,close:s.price,volume:s.volume,turnover:s.turnover,changePct:s.changePct,fscExact:s.fscExact});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));
 return {bars,total:first.total,receivedAt:at,coveredThrough:stock.baseDate};
}

export async function syncFscStockHistory(env,stock,{fetcher=fetch,now=Date.now(),requireDailyReturns=false,budget=createFscRequestBudget()}={}){
 const db=env.DB,operation=historyOperation(stock);
 if(!db||!operation||!stock.isin||!stock.baseDate||!fscPolicy(env,fscOperations[operation].family).chart)return null;
 const id=operation+':'+stock.isin;
 let running=inflight.get(db);if(!running){running=new Map();inflight.set(db,running);}if(running.has(id))return running.get(id);
 const task=(async()=>{
  let row=await read(db,id);
  if(!env.DATA_GO_KR_SERVICE_KEY?.trim())return row;
  const hasCredential=await fscHasCredentialColumn(db,'fsc_stock_history'),fingerprint=await fscCredentialVersion(env);
  // Old schemas remain readable. If they cannot track the failed credential,
  // an operator must clear that failure; silently retrying is not safe.
  if(fscAuthenticationFailure(row?.error_code)&&(!hasCredential||row.credential_version===fingerprint))return row;
  const changedCredential=hasCredential&&row?.credential_version!==fingerprint;
  const refreshShape=requireDailyReturns&&row?.received_at&&!JSON.parse(row.payload).some(b=>Number.isFinite(b.changePct));
  if(!changedCredential&&row?.next_attempt>now&&(row.error_code||!refreshShape&&row.covered_through>=stock.baseDate))return row;
  await db.prepare('INSERT INTO fsc_stock_history(id,operation,stock_id,isin) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,operation,stock.id,stock.isin).run();
  const leaseUntil=now+600000;
  const lease=await db.prepare(`UPDATE fsc_stock_history SET lease_until=?${hasCredential?',credential_version=?':''} WHERE id=? AND lease_until<=? AND (next_attempt<=? OR ?=1 OR (error_code IS NULL AND (covered_through<? OR ?=1)))`).bind(leaseUntil,...(hasCredential?[fingerprint]:[]),id,now,now,changedCredential?1:0,stock.baseDate,refreshShape?1:0).run();
  if(!lease.meta.changes)return read(db,id);
  try{
   const result=await fetchFscFullHistory(env,stock,operation,{fetcher,now,budget});
   // Replace only complete results while this worker still owns the lease.
   await db.prepare('UPDATE fsc_stock_history SET payload=?,covered_through=?,source_count=?,received_at=?,next_attempt=?,lease_until=0,error_code=NULL WHERE id=? AND lease_until=?').bind(JSON.stringify(result.bars),result.coveredThrough,result.total,result.receivedAt,nextFscSync(now),id,leaseUntil).run();
  }catch(e){
   const code=fscFailureCode(e,'HISTORY_SYNC_FAILED'),delay=Math.max(fscAuthenticationFailure(code)||/^(HTTP_429|FSC_2[23])$/.test(code)?86400000:3600000,e.retryAfterMs||0);
   await db.prepare('UPDATE fsc_stock_history SET error_code=?,next_attempt=?,lease_until=0 WHERE id=? AND lease_until=?').bind(code,now+delay,id,leaseUntil).run();
  }
  return read(db,id);
 })();running.set(id,task);try{return await task;}finally{running.delete(id);}
}
