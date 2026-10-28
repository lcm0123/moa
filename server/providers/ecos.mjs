import {getPolicy} from './base.mjs';

// Verified via ECOS StatisticItemList on 2026-09-27; revalidated on each sync.
export const ecosSeries=Object.freeze({
 USDKRW:{id:'USDKRW',name:'원·달러 환율',stat:'731Y001',item:'0000001',itemName:'원/미국달러(매매기준율)',unit:'원',kind:'fx',basis:'매매기준율 · 1 USD당 KRW'},
 KTB10Y:{id:'KTB10Y',name:'국고채 10년',stat:'817Y002',item:'010210000',itemName:'국고채(10년)',unit:'연%',kind:'yield',basis:'국고채 10년 · 연 수익률'}
});
const source='한국은행 ECOS',sourceUrl='https://ecos.bok.or.kr/',inflight=new WeakMap();
const dateOf=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const validDate=s=>/^\d{8}$/.test(s||'')&&Number.isFinite(Date.parse(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6)))&&new Date(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6)).toISOString().slice(0,10).replaceAll('-','')===s;
const iso=s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6),round=n=>Number(n.toFixed(8));
const fail=code=>Object.assign(new Error('ECOS request failed'),{code});
export function parseEcos(text,service){
 let data;try{data=JSON.parse(text);}catch{throw fail('INVALID_RESPONSE');}
 if(data?.RESULT)throw fail(/^\w+-\d+$/.test(data.RESULT.CODE||'')?data.RESULT.CODE:'INVALID_RESPONSE');
 const result=data?.[service];if(!result||!Array.isArray(result.row)||!Number.isInteger(result.list_total_count))throw fail('INVALID_RESPONSE');return result;
}
export function verifyEcosMetadata(def,rows){
 const matches=rows.filter(r=>r.STAT_CODE===def.stat&&r.ITEM_CODE===def.item&&r.CYCLE==='D');
 if(matches.length!==1)throw fail('IDENTITY_MISMATCH');const r=matches[0];
 if(r.ITEM_NAME!==def.itemName||r.UNIT_NAME!==def.unit||!validDate(r.END_TIME)||!validDate(r.START_TIME))throw fail('IDENTITY_MISMATCH');
 return {statCode:def.stat,statName:r.STAT_NAME,itemCode:def.item,itemName:r.ITEM_NAME,unit:r.UNIT_NAME,cycle:'D',firstDate:iso(r.START_TIME),latestAvailableDate:iso(r.END_TIME)};
}
export function normalizeEcos(def,rows,metadata,syncedAt,today){
 const dates=new Map();
 for(const r of rows){
  if(r.STAT_CODE!==def.stat||r.ITEM_CODE1!==def.item||r.ITEM_NAME1!==def.itemName||r.UNIT_NAME!==def.unit||r.ITEM_CODE2||r.ITEM_CODE3||r.ITEM_CODE4||!validDate(r.TIME))throw fail('IDENTITY_MISMATCH');
  const at=iso(r.TIME);if(at>today)throw fail('FUTURE_DATE');
  if(r.DATA_VALUE===null||String(r.DATA_VALUE).trim()==='')continue;
  if(!/^-?\d+(?:\.\d+)?$/.test(String(r.DATA_VALUE)))throw fail('INVALID_VALUE');
  const value=Number(r.DATA_VALUE);if(!Number.isFinite(value)||(def.kind==='fx'&&value<=0))throw fail('INVALID_VALUE');
  if(dates.has(at)&&dates.get(at)!==value)throw fail('CONFLICTING_DATE');dates.set(at,value);
 }
 const history=[...dates].sort(([a],[b])=>a.localeCompare(b)).map(([at,value])=>({at,value}));if(!history.length)throw fail('NO_DATA');
 const latest=history.at(-1),previous=history.at(-2),change=previous?round(latest.value-previous.value):null;
 return {id:def.id,name:def.name,instrumentType:def.kind,neutral:true,value:latest.value,unit:def.unit,change,
  changePct:previous&&previous.value!==0?round(change/previous.value*100):null,changeBp:previous&&def.kind==='yield'?round(change*100):null,
  previousValue:previous?.value??null,previousDate:previous?.at??null,baseDate:latest.at,asOf:latest.at,asOfKind:'date',syncedAt,
  mode:'daily',source,sourceUrl,basis:def.basis,closeLabel:'일별 공표값',historyKind:'daily',historyAsOf:latest.at,history,metadata};
}
export async function requestEcos(key,service,parts,{fetcher=fetch}={}){
 if(!key?.trim())throw fail('MISSING_KEY');
 // Authentication stays on the server. Never log request URLs or vendor messages.
 const url='https://ecos.bok.or.kr/api/'+[service,key.trim(),'json','kr',...parts].map(encodeURIComponent).join('/')+'/';
 try{const r=await fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fail('HTTP_'+r.status);const text=await r.text();if(text.length>3000000)throw fail('INVALID_RESPONSE');return parseEcos(text,service);
 }catch(e){throw fail(/^(HTTP_\d{3}|[A-Z]+-\d+|INVALID_RESPONSE)$/.test(e.code||'')?e.code:'REQUEST_FAILED');}
}
async function read(db,id){return (await db.prepare('SELECT * FROM ecos_series_cache WHERE series_id=?').bind(id).all()).results[0];}
async function sync(env,def,{now,fetcher}){
 let running=inflight.get(env.DB);if(!running){running=new Map();inflight.set(env.DB,running);}if(running.has(def.id))return running.get(def.id);
 const job=(async()=>{
  const old=await read(env.DB,def.id);if(old?.next_attempt>now)return old;
  try{
   const catalog=await requestEcos(env.ECOS_API_KEY,'StatisticItemList',[1,1000,def.stat],{fetcher});
   if(catalog.row.length!==catalog.list_total_count)throw fail('INCOMPLETE_METADATA');
   const metadata=verifyEcosMetadata(def,catalog.row),today=dateOf(now),end=metadata.latestAvailableDate<today?metadata.latestAvailableDate:today;
   const start=new Date(Date.parse(end)-1096*86400000).toISOString().slice(0,10),rows=[];
   for(let page=0;page<4;page++){
    const data=await requestEcos(env.ECOS_API_KEY,'StatisticSearch',[page*1000+1,(page+1)*1000,def.stat,'D',start.replaceAll('-',''),end.replaceAll('-',''),def.item],{fetcher});
    rows.push(...data.row);if(rows.length===data.list_total_count)break;
    if(!data.row.length||rows.length>data.list_total_count||page===3)throw fail('INCOMPLETE_HISTORY');
   }
   const item=normalizeEcos(def,rows,metadata,new Date(now).toISOString(),today);
   await env.DB.prepare('INSERT INTO ecos_series_cache(series_id,payload,next_attempt,error_code) VALUES(?,?,?,NULL) ON CONFLICT(series_id) DO UPDATE SET payload=excluded.payload,next_attempt=excluded.next_attempt,error_code=NULL').bind(def.id,JSON.stringify(item),now+6*3600000).run();
  }catch(e){
   const code=/^[A-Z_0-9-]+$/.test(e.code||'')?e.code:'SYNC_FAILED';
   await env.DB.prepare('INSERT INTO ecos_series_cache(series_id,next_attempt,error_code) VALUES(?,?,?) ON CONFLICT(series_id) DO UPDATE SET next_attempt=excluded.next_attempt,error_code=excluded.error_code').bind(def.id,now+(/^(HTTP_40[13]|ERROR-100|INFO-200)/.test(code)?24*3600000:30*60000),code).run();
  }return read(env.DB,def.id);
 })();running.set(def.id,job);try{return await job;}finally{running.delete(def.id);}
}
export async function ecosFeed(env,{now=Date.now(),fetcher=fetch}={}){
 const policy=env.LOCAL_PREVIEW?{display:true,chart:true}:getPolicy(env,'ECOS');
 const base={source,provider:'ecos',mode:'daily',policy,items:[],states:[]};
 if(!policy.display)return {...base,status:'restricted',message:'ECOS 표시 권한 설정 필요'};
 if(!env.DB)return {...base,status:'disconnected',message:'ECOS 저장소 연결 필요'};
 const configured=!!env.ECOS_API_KEY?.trim(),items=[],states=[];
 for(const def of Object.values(ecosSeries)){
  const row=configured?await sync(env,def,{now,fetcher}):await read(env.DB,def.id);
  const item=row?.payload?JSON.parse(row.payload):null,stale=!!row?.error_code||!configured||!!item&&now-Date.parse(item.syncedAt)>12*3600000;
  if(item){if(!policy.chart)item.history=[];items.push({...item,stale});}
  states.push({id:def.id,status:item?'ready':!configured?'disconnected':'error',stale,errorCode:row?.error_code||null,message:!configured?'ECOS 키 등록 필요':row?.error_code?'ECOS 갱신 실패 · 마지막 정상 자료 유지':''});
 }
 return {...base,status:items.length?'ready':configured?'error':'disconnected',items,states,stale:states.some(s=>s.stale),message:!configured?'ECOS 키 등록 필요':states.some(s=>s.errorCode)?'일부 경제지표 갱신 실패':'한국은행 일별 공표 자료 · 실시간 아님'};
}
