import {requestFscPage,createFscRequestBudget,fscFailureCode,fscAuthenticationFailure,fscCredentialVersion,fscHasCredentialColumn} from './data-go-kr.mjs';
import {normalizeFscItem,fscPolicy,dateBefore,nextFscSync} from './data-go-kr-model.mjs';
import requestPolicy from '../../config/fsc-request-policy.json' with {type:'json'};

const supported=new Set(['KOSPI','KOSDAQ','KOSPI200']),inflight=new WeakMap();
const read=async(db,id)=>(await db.prepare('SELECT * FROM fsc_index_history WHERE id=?').bind(id).all()).results[0]||null;
export async function fetchFscIndexHistory(env,index,{fetcher=fetch,now=Date.now(),budget=createFscRequestBudget()}={}){
 const params={idxNm:index.name,endBasDt:dateBefore(index.baseDate,-1).replaceAll('-',''),numOfRows:'10000',pageNo:'1'};
 const first=await requestFscPage(env,'indices',params,{fetcher,budget}),rows=[...first.items];
 if(first.page!==1||!first.total||first.total>requestPolicy.maxRows)throw new Error(!first.total?'NO_HISTORY':'INCOMPLETE_HISTORY');
 for(let page=2;rows.length<first.total;page++){
  if(page>requestPolicy.maxHistoryPages)throw new Error('INCOMPLETE_HISTORY');
  const next=await requestFscPage(env,'indices',{...params,pageNo:String(page)},{fetcher,budget});
  if(next.page!==page||next.total!==first.total||next.size!==first.size||!next.items.length)throw new Error('INCOMPLETE_HISTORY');rows.push(...next.items);
 }
 if(rows.length!==first.total)throw new Error('INCOMPLETE_HISTORY');
 const dates=new Set(),points=rows.map(raw=>{
  const item=normalizeFscItem(raw,'indices',new Date(now).toISOString());
  if(item.id!==index.id||item.baseDate>index.baseDate||dates.has(item.baseDate))throw new Error('INVALID_HISTORY_IDENTITY');
  dates.add(item.baseDate);return {at:item.baseDate,value:item.value,fscExact:item.fscExact};
 });
 return points.sort((a,b)=>a.at.localeCompare(b.at));
}
export async function syncFscIndexHistory(env,index,{fetcher=fetch,now=Date.now(),budget=createFscRequestBudget()}={}){
 const db=env.DB;if(!db||!supported.has(index.id)||!index.baseDate||!fscPolicy(env,'indices').chart)return null;
 let running=inflight.get(db);if(!running){running=new Map();inflight.set(db,running);}if(running.has(index.id))return running.get(index.id);
 const task=(async()=>{
  let row=await read(db,index.id);
  if(!env.DATA_GO_KR_SERVICE_KEY?.trim())return row;
  const hasCredential=await fscHasCredentialColumn(db,'fsc_index_history'),fingerprint=await fscCredentialVersion(env);
  if(fscAuthenticationFailure(row?.error_code)&&(!hasCredential||row.credential_version===fingerprint))return row;
  const changedCredential=hasCredential&&row?.credential_version!==fingerprint;
  if(!changedCredential&&row?.next_attempt>now&&(row.error_code||row.covered_through>=index.baseDate))return row;
  await db.prepare('INSERT INTO fsc_index_history(id) VALUES(?) ON CONFLICT(id) DO NOTHING').bind(index.id).run();
  const leaseUntil=now+600000;
  const lease=await db.prepare(`UPDATE fsc_index_history SET lease_until=?${hasCredential?',credential_version=?':''} WHERE id=? AND lease_until<=? AND (next_attempt<=? OR ?=1 OR (error_code IS NULL AND covered_through<?))`).bind(leaseUntil,...(hasCredential?[fingerprint]:[]),index.id,now,now,changedCredential?1:0,index.baseDate).run();
  if(!lease.meta.changes)return read(db,index.id);
  try{
   const points=await fetchFscIndexHistory(env,index,{fetcher,now,budget});
   // Do not publish after another worker has reclaimed the expired lease.
   await db.prepare('UPDATE fsc_index_history SET payload=?,covered_through=?,received_at=?,next_attempt=?,lease_until=0,error_code=NULL WHERE id=? AND lease_until=?').bind(JSON.stringify(points),index.baseDate,new Date(now).toISOString(),nextFscSync(now),index.id,leaseUntil).run();
  }catch(e){
   const code=fscFailureCode(e,'HISTORY_SYNC_FAILED'),delay=Math.max(fscAuthenticationFailure(code)||/^(HTTP_429|FSC_2[23])$/.test(code)?86400000:3600000,e.retryAfterMs||0);
   await db.prepare('UPDATE fsc_index_history SET error_code=?,next_attempt=?,lease_until=0 WHERE id=? AND lease_until=?').bind(code,now+delay,index.id,leaseUntil).run();
  }
  return read(db,index.id);
 })();running.set(index.id,task);try{return await task;}finally{running.delete(index.id);}
}
export async function withFscIndexHistory(env,feed){
 if(feed.status!=='ready'||!feed.policy?.chart)return feed;
 const items=await Promise.all(feed.items.map(async index=>{
  if(!supported.has(index.id))return index;
  const row=await syncFscIndexHistory(env,index),history=JSON.parse(row?.payload||'[]');
  return {...index,history,historyKind:'daily',historyAsOf:history.at(-1)?.at||null,historySyncedAt:row?.received_at||null,historyStale:!!row?.error_code,closeLabel:'전일 기준 종가'};
 }));return {...feed,items};
}
