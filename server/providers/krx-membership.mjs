import {unavailable} from './base.mjs';
import {fscStocks} from './data-go-kr.mjs';
import {nextFscSync} from './data-go-kr-model.mjs';

// Verified public KRX index screens, 2026-09-26. Separate from the FSC quote API.
export const krxUniverses={KOSPI200:{ind_tp_cd:'1',idx_ind_cd:'028',idx_id:'K2G01P'},KOSDAQ150:{ind_tp_cd:'2',idx_ind_cd:'203',idx_id:'Q5G01P'}};
const base='https://index.krx.co.kr',memberPath='/IDX/03/0304/03040101/mkd03040101T3_01',groupPath='/IDX/03/0303/03030204/mkd03030204_01',classPath='/IDX/03/0303/03030204/mkd03030204_03';
const source='한국거래소 · 지수 구성종목 / GICS',running=new WeakMap();
export const krxPolicy=env=>{const allowed=env.LOCAL_PREVIEW===true||env.KRX_PUBLIC_DISPLAY==='true'&&/^\d{4}-\d{2}-\d{2}$/.test(env.KRX_LICENSE_REVIEWED_AT||'');return {display:allowed,treemap:allowed,chart:false,ranking:false};};
export async function requestKrx(bld,params,{fetcher=fetch}={}){
 const headers={Referer:base+'/main/main.jsp'},u=new URL(base+'/contents/COM/GenerateOTP.jspx');u.search=new URLSearchParams({name:'form',bld});
 const token=await fetcher(u,{headers,signal:AbortSignal.timeout(12000)});if(!token.ok)throw new Error('KRX_HTTP_'+token.status);
 const code=await token.text();if(!code.trim()||code.includes('<')||code.length>1000)throw new Error('KRX_FORMAT');
 const r=await fetcher(base+'/contents/IDX/99/IDX99000001.jspx',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,lang:'ko',...params}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('KRX_HTTP_'+r.status);const data=await r.json();return data;
}
export function normalizeKrxMembers(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>400)throw new Error('KRX_MEMBERS');
 const ids=new Set();return rows.map(r=>{
  if(!/^[0-9][0-9A-Z]{5}$/.test(r.isu_cd)||!r.isu_nm?.trim()||ids.has(r.isu_cd))throw new Error('KRX_IDENTITY');ids.add(r.isu_cd);
  return {id:r.isu_cd,ticker:r.isu_cd,name:r.isu_nm.trim(),market:'KR'};
 });
}
export function normalizeKrxClasses(groups,results){
 const sectors=new Map(groups.filter(g=>/^\d{2}$/.test(g.value)).map(g=>[g.value,g.label])),out=new Map();
 for(const {group,rows} of results){
  if(!Array.isArray(rows)||!sectors.has(group.value.slice(0,2)))throw new Error('KRX_CLASSIFICATION');
  const isIndustry=group.value.length===4;
  for(const row of rows){
   if(!/^[0-9][0-9A-Z]{5}$/.test(row.isu_cd))throw new Error('KRX_IDENTITY');
   const id=row.isu_cd,sectorId=group.value.slice(0,2),prior=out.get(id);
   if(prior&&(prior.sectorCode!==sectorId||isIndustry&&prior.industryCode&&prior.industryCode!==group.value))throw new Error('KRX_CLASS_CONFLICT');
   if(prior?.industryCode&&!isIndustry)continue;
   out.set(id,{id,market:'KR',sectorId:'GICS:'+sectorId,sectorCode:sectorId,sectorName:sectors.get(sectorId),industryCode:isIndustry?group.value:null,industryName:isIndustry?(group.label.match(/\((.+)\)$/)?.[1]||group.label):null,classification:'GICS · 섹터/산업그룹',mappingSource:source});
  }
 }
 return [...out.values()];
}
export async function fetchKrxSnapshot(baseDate,{fetcher=fetch}={}){
 const day=baseDate.replaceAll('-',''),members={};
 for(const [id,params] of Object.entries(krxUniverses))members[id]=normalizeKrxMembers((await requestKrx(memberPath,{...params,compst_isu_tp:'1',schdate:day},{fetcher})).output);
 const groups=(await requestKrx(groupPath,{}, {fetcher})).block1;
 if(!Array.isArray(groups)||groups.length<10||groups.length>60||groups.some(g=>!/^\d{2}(\d{2})?$/.test(g.value)||!g.label))throw new Error('KRX_GROUPS');
 const results=[],queue=[...groups];
 // Bounded concurrency; all mappings use the same FSC quote baseline date.
 await Promise.all([0,1].map(async()=>{while(queue.length){const group=queue.shift(),data=await requestKrx(classPath,{mkt_tp_cd:'ALL',gics_ind_grp_cd:group.value,date:day},{fetcher});results.push({group,rows:data.block1});}}));
 const memberIds=new Set(Object.values(members).flat().map(s=>s.id));
 return {members,classifications:normalizeKrxClasses(groups,results).filter(s=>memberIds.has(s.id))};
}
const read=async(db,day)=>(await db.prepare('SELECT * FROM krx_index_snapshots WHERE base_date=?').bind(day).all()).results[0];
async function sync(env,day){
 const db=env.DB;if(running.has(db))return running.get(db);
 const task=(async()=>{const now=Date.now();let row=await read(db,day);if(row?.next_attempt>now)return row;
  await db.prepare('INSERT INTO krx_index_snapshots(base_date) VALUES(?) ON CONFLICT(base_date) DO NOTHING').bind(day).run();
  const lease=await db.prepare('UPDATE krx_index_snapshots SET next_attempt=? WHERE base_date=? AND next_attempt<=?').bind(now+600000,day,now).run();if(!lease.meta.changes)return read(db,day);
  try{const payload=await fetchKrxSnapshot(day);await db.prepare('UPDATE krx_index_snapshots SET payload=?,received_at=?,next_attempt=?,error_code=NULL WHERE base_date=?').bind(JSON.stringify(payload),new Date(now).toISOString(),nextFscSync(now),day).run();}
  catch{await db.prepare('UPDATE krx_index_snapshots SET error_code=?,next_attempt=? WHERE base_date=?').bind('KRX_SYNC_FAILED',now+3600000,day).run();}
  return read(db,day);
 })();running.set(db,task);try{return await task;}finally{running.delete(db);}
}
async function snapshot(env){
 const policy=krxPolicy(env);if(!policy.display)return unavailable('KRX 구성종목·분류 외부 표시 이용허락 설정 필요','restricted',policy);
 const quotes=await fscStocks(env,{},'treemap');if(quotes.status!=='ready')return quotes;
 if(!env.DB)return unavailable('구성종목 저장소 연결 필요');
 const row=await sync(env,quotes.baseDate);
 if(!row?.received_at)return unavailable(row?.error_code?'구성종목·분류 갱신 실패':'구성종목·분류 확인 중',row?.error_code?'error':'loading',policy);
 return {status:'ready',...JSON.parse(row.payload),baseDate:row.base_date,asOf:row.base_date,observedAt:row.received_at,source,policy,mode:'previous_close',stale:!!row.error_code};
}
export async function krxConstituents(env,indexId){
 const feed=await snapshot(env);if(feed.status!=='ready')return feed;
 const earlier=(await env.DB.prepare('SELECT base_date,payload FROM krx_index_snapshots WHERE base_date<? AND received_at IS NOT NULL ORDER BY base_date DESC LIMIT 1').bind(feed.baseDate).all()).results[0];
 const items=feed.members[indexId]||[],before=earlier?JSON.parse(earlier.payload).members[indexId]||[]:[],old=new Set(before.map(s=>s.id)),current=new Set(items.map(s=>s.id));
 return {...feed,members:undefined,classifications:undefined,items,indexId,verified:true,version:feed.baseDate,effectiveAt:feed.baseDate,changes:earlier?[{date:feed.baseDate,added:items.filter(s=>!old.has(s.id)).map(s=>s.ticker),removed:before.filter(s=>!current.has(s.id)).map(s=>s.ticker)}]:[],changeNote:'조회 기준일의 KRX 실제 구성종목 · 변경 내역은 저장된 이전 기준일과 비교합니다.'};
}
export async function krxClassifications(env,indexId){const feed=await snapshot(env);if(feed.status!=='ready')return feed;const ids=new Set(feed.members[indexId]?.map(s=>s.id));return {...feed,members:undefined,classifications:undefined,items:feed.classifications.filter(s=>ids.has(s.id))};}
export async function fscCapitalization(env){const feed=await fscStocks(env,{},'treemap');return {...feed,items:(feed.items||[]).map(s=>({id:s.id,market:s.market,currency:s.currency,marketCap:s.marketCap,asOf:s.asOf,asOfKind:s.asOfKind}))};}
