import {verifyMetadata,transformObservations,observationAge} from '../macro/model.mjs';
import {enrichSeries} from '../macro/analysis.mjs';
import {fetchFullObservations} from '../macro/history.mjs';
import {claimFredRefresh,exactFredObservations,publishFredCache,readFredCache} from './fred-revisions.mjs';
const states=new WeakMap(),HOUR=3600000;
function state(db){if(!states.has(db))states.set(db,{flights:new Map(),tail:Promise.resolve(),calls:[],blockedUntil:0});return states.get(db);}
const safeError=(code)=>Object.assign(new Error(code),{code});
// One shared queue, at most 2 HTTP attempts/request, at least 350ms between calls.
// Budgets also cover diagnostic calls in this process; denied/auth failures never retry.
async function request(env,endpoint,params,{fetcher=fetch,now=Date.now()}={}){
 const s=state(env.DB),run=async()=>{
  const clock=Date.now();s.calls=s.calls.filter(t=>clock-t<HOUR);
  const budget=Math.max(16,Math.min(120,Number(env.FRED_MAX_CALLS_PER_HOUR)||90));
  if(s.blockedUntil>clock||s.calls.length>=budget)throw safeError('RATE_LIMIT');
  const key=String(env.FRED_API_KEY||'').trim();if(!key)throw safeError('KEY_MISSING');
  const url=new URL('https://api.stlouisfed.org/fred/'+endpoint);url.search=new URLSearchParams({...params,api_key:key,file_type:'json'}).toString();
  for(let attempt=0;attempt<2;attempt++){
   const gap=350-(Date.now()-(s.calls.at(-1)||0));if(gap>0)await new Promise(r=>setTimeout(r,gap));
   s.calls.push(Date.now());let res;
   try{res=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});}catch{if(attempt===0)continue;throw safeError('NETWORK');}
   if(res.status===429){s.blockedUntil=Date.now()+HOUR;throw safeError('HTTP_429');}
   if(res.status===400)throw safeError('HTTP_400');
   if(res.status===401||res.status===403){s.blockedUntil=Date.now()+HOUR;throw safeError('HTTP_'+res.status);}
   if(res.status>=500&&attempt===0)continue;
   if(!res.ok)throw safeError('HTTP_'+res.status);
   const text=await res.text();if(text.length>3000000)throw safeError('RESPONSE_SIZE');let body;
   try{body=JSON.parse(text);}catch{throw safeError('RESPONSE_FORMAT');}
   // Never surface vendor error text: it can echo the URL containing the key.
   if(body.error_code)throw safeError('API_ERROR');return body;
  }
 };
 const p=s.tail.then(run,run);s.tail=p.catch(()=>{});return p;
}
async function cached(env,key,ttl,loader,{now=Date.now(),fallbackKey,clock=Date.now}={}){
 const s=state(env.DB);if(s.flights.has(key))return s.flights.get(key);
 const work=(async()=>{
  let row=(await env.DB.prepare('SELECT * FROM fred_macro_cache WHERE cache_key=?').bind(key).all()).results[0];
  if(!row&&fallbackKey){const old=(await env.DB.prepare('SELECT * FROM fred_macro_cache WHERE cache_key=?').bind(fallbackKey).all()).results[0];if(old)row={...old,next_attempt:0};}
  let previous=null;try{previous=JSON.parse(row?.payload||'null');}catch{}
  const pack=(payload,error=null)=>({payload,retrievedAt:row?.retrieved_at||null,stale:!!error||!env.FRED_API_KEY,error});
  if(row?.next_attempt>now)return pack(previous,row.error_code);
  if(!env.FRED_API_KEY)return pack(previous,'KEY_MISSING');
  const fence=await claimFredRefresh(env.DB,key,now);
  if(!fence)return readFredCache(env.DB,key);
  // The first SELECT is not a claim. Another process may have published while
  // this request was waiting for ownership; never restore that old snapshot on
  // failure, and do not issue another request if its new cache is already fresh.
  const current=(await env.DB.prepare('SELECT * FROM fred_macro_cache WHERE cache_key=?').bind(key).all()).results[0];
  if(current){
   row=current;previous=null;try{previous=JSON.parse(row.payload||'null');}catch{}
   if(row.next_attempt>now)return pack(previous,row.error_code);
  }
  try{
   const payload=await loader(previous),retrievedAt=new Date(clock()).toISOString();
   const published=await publishFredCache(env.DB,fence,{payload,retrievedAt,nextAttempt:now+ttl,previous,previousAt:row?.retrieved_at||null,recordedAt:retrievedAt});
   if(!published)return readFredCache(env.DB,key);
   return {payload,retrievedAt,stale:false,error:null};
  }catch(e){
   const error=/^(HTTP_\d+|KEY_MISSING|NETWORK|RESPONSE_\w+|RATE_LIMIT|API_ERROR|METADATA_MISMATCH|DISCONTINUED|USAGE_UNVERIFIED|OBSERVATIONS_EMPTY|RELEASE_MISSING)$/.test(e.code||e.message)?e.code||e.message:'DATA_ERROR';
   const invalid=['METADATA_MISMATCH','DISCONTINUED','USAGE_UNVERIFIED'].includes(error),payload=invalid?null:previous;
   if(key.startsWith('meta:'))console.warn('[FRED metadata]',key.slice(5),error);
   const published=await publishFredCache(env.DB,fence,{payload,retrievedAt:row?.retrieved_at||null,nextAttempt:now+(['HTTP_400','HTTP_401','HTTP_403','METADATA_MISMATCH','DISCONTINUED'].includes(error)?24*HOUR:HOUR),error,recordedAt:new Date(clock()).toISOString()});
   if(!published)return readFredCache(env.DB,key);
   return {payload,retrievedAt:row?.retrieved_at||null,stale:true,error};
  }
 })();s.flights.set(key,work);try{return await work;}finally{s.flights.delete(key);}
}
export async function fredMetadata(env,def,options={}){
 if(!env.DB)return {payload:null,error:'STORAGE_MISSING',stale:true};
 const approved=String(env.FRED_APPROVED_SERIES||'').split(',').map(s=>s.trim()).includes(def.id);
 return cached(env,(approved?'meta:approved:':'meta:v2:')+def.id,24*HOUR,async()=>{
  const m=(await request(env,'series',{series_id:def.id},options)).seriess?.[0];
  const tags=(await request(env,'series/tags',{series_id:def.id},options)).tags||[];
  return verifyMetadata(def,m,tags,{approved});
 },options);
}
export async function fredSeries(env,def,options={}){
 const meta=await fredMetadata(env,def,options);if(!meta.payload)return {id:def.id,hidden:true,error:meta.error};
 const now=options.now||Date.now();
 const result=await cached(env,'observations:full:'+def.id,def.frequency==='D'?HOUR:6*HOUR,async previous=>{
  const observations=exactFredObservations(await fetchFullObservations(params=>request(env,'series/observations',params,options),{id:def.id,start:meta.payload.observationStart,end:new Date(now).toISOString().slice(0,10)}));
  if(!observations.some(o=>o.value!=='.'&&Number.isFinite(Number(o.value))))throw safeError('OBSERVATIONS_EMPTY');
  const latest=observations.filter(o=>o.value!=='.').at(-1),prior=previous?.observations?.filter(o=>o.value!=='.').at(-1);
  return {observations,historyComplete:true,newObservationReceived:!!prior&&latest.date>prior.date,revisionDetected:!!previous&&JSON.stringify(previous.observations.map(o=>[o.date,o.value]))!==JSON.stringify(observations.map(o=>[o.date,o.value]))&&latest.date===prior?.date,lastChangeDetectedAt:!prior||latest.date!==prior.date||latest.value!==prior.value?new Date(now).toISOString():previous.lastChangeDetectedAt};
 },{...options,fallbackKey:'observations:'+def.id});
 const calculated=transformObservations(def,result.payload?.observations||[],{years:'all',now});
 const extended=enrichSeries(def,calculated,transformObservations(def,result.payload?.observations||[],{years:11,now}),{contextYears:options.years>=10?10:5});
 const delayed=calculated.latest?observationAge(def,calculated.latest.date,now)>def.maxAgeDays:false;
 return {...def,...calculated,...extended,historyComplete:result.payload?.historyComplete===true,metadata:meta.payload,metadataRetrievedAt:meta.retrievedAt,retrievedAt:result.retrievedAt,fredUpdatedAt:meta.payload.lastUpdated,stale:meta.stale||result.stale,error:result.error||meta.error,delayed,lastChangeDetectedAt:result.payload?.lastChangeDetectedAt||null,newObservationReceived:result.payload?.newObservationReceived||false,revisionDetected:result.payload?.revisionDetected||false,replayEligibility:'HELD_PROVIDER_VINTAGE_UNVERIFIED'};
}
export async function fredSchedule(env,id,options={}){
 const release=await cached(env,'release:'+id,30*24*HOUR,async()=>{
  const r=(await request(env,'series/release',{series_id:id},options)).releases?.[0];if(!Number.isInteger(r?.id))throw safeError('RELEASE_MISSING');return {id:r.id,name:r.name};
 },options);if(!release.payload)return {status:'unavailable',error:release.error};
 const now=options.now||Date.now(),today=new Date(now).toISOString().slice(0,10),from=new Date(now-7*86400000).toISOString().slice(0,10),to=new Date(now+90*86400000).toISOString().slice(0,10);
 const dates=await cached(env,'schedule:'+release.payload.id,6*HOUR,async()=>{
  const body=await request(env,'release/dates',{release_id:String(release.payload.id),realtime_start:from,realtime_end:to,include_release_dates_with_no_data:'true',sort_order:'asc',limit:'100'},options);
  if(!Array.isArray(body.release_dates))throw safeError('RELEASE_MISSING');return body.release_dates.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)).map(x=>x.date);
 },options);
 return {status:dates.payload?'ready':'unavailable',name:release.payload.name,dates:dates.payload||[],nextDate:dates.payload?.find(d=>d>=today)||null,retrievedAt:dates.retrievedAt,stale:dates.stale,error:dates.error,note:'자료군의 발표 예정일입니다. 개별 시리즈의 새 관측값 수신 여부와 다르며 발표 시각은 제공하지 않습니다.'};
}
