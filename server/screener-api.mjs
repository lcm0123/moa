import {finvizCsv,requireFinviz,finvizPolicy,digest,FinvizError} from './providers/finviz-client.mjs';
import {usSecurityTypes} from './providers/us-security-types.mjs';
import {stockType} from './stock-ranking.mjs';
import {parseScreen,screenQuery,screenRows,screenFacets,screenerColumnIds} from './screener-model.mjs';
const states=new WeakMap(),memoryKey={},json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// One universe per server, independent of visitor filter combinations. No collector or timer.
export async function screenerSnapshot(env,{now=Date.now(),loadCsv=finvizCsv,loadTypes=usSecurityTypes}={}){
 const policy=requireFinviz(env,'ranking');const auth=await digest(env.FINVIZ_API_KEY.trim()),key='finviz-screen:v1:'+auth;
 const scope=env.DB||memoryKey;let state=states.get(scope);if(!state||state.key!==key){state={key,until:0,payload:null,error:null,flight:null};states.set(scope,state);}
 if(state.flight)return state.flight;
 if(state.until>now)return {...(state.payload||{items:[]}),stale:!!state.error,message:state.error,policy};
 state.flight=(async()=>{
  if(!state.payload&&env.DB){const saved=(await env.DB.prepare('SELECT * FROM screener_snapshots WHERE cache_key=?').bind(key).all()).results[0];if(saved){try{state.payload=JSON.parse(saved.payload);}catch{}state.until=saved.next_attempt;state.error=saved.error_message;if(state.until>now)return {...(state.payload||{items:[]}),stale:!!state.error,message:state.error,policy};}}
  try{
   const ttl=Math.max(60000,Math.min(3600000,(Number(env.FINVIZ_SCREENER_CACHE_SECONDS)||300)*1000));
   const data=await loadCsv(env,'/export/screener',{v:'152',c:screenerColumnIds},ttl),rows=parseScreen(data.text);
   if(!rows.length)throw new FinvizError('Finviz 스크리너 목록이 비어 있습니다.');
   let metadata=null,typeError=null;try{metadata=await loadTypes(env);}catch{typeError='ETF 분류 연결 실패 · 상품 유형 필터를 사용할 수 없습니다.';}
   const items=rows.map(s=>{const type=stockType(s,metadata);return {...s,isEtf:type?.isEtf??null,securityType:type?.type||null};});
   state.payload={items,receivedAt:data.receivedAt,facets:screenFacets(items),typeAvailable:!!metadata,typeError,typeSource:metadata?.source||null,typeReceivedAt:metadata?.receivedAt||null,typeStale:!!metadata?.stale,unknownTypes:items.filter(s=>s.isEtf===null).length};state.until=now+ttl;state.error=null;
   if(env.DB)await env.DB.prepare('INSERT INTO screener_snapshots(cache_key,payload,received_at,next_attempt,error_message) VALUES(?,?,?,?,NULL) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,received_at=excluded.received_at,next_attempt=excluded.next_attempt,error_message=NULL').bind(key,JSON.stringify(state.payload),data.receivedAt,state.until).run();
  }catch(e){state.error=e instanceof FinvizError?e.message:'스크리너 데이터를 갱신하지 못했습니다.';state.until=now+60000;if(env.DB)await env.DB.prepare('INSERT INTO screener_snapshots(cache_key,payload,received_at,next_attempt,error_message) VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET next_attempt=excluded.next_attempt,error_message=excluded.error_message').bind(key,state.payload?JSON.stringify(state.payload):null,state.payload?.receivedAt||null,state.until,state.error).run();}
  return {...(state.payload||{items:[]}),stale:!!state.error,message:state.error,policy};
 })();try{return await state.flight;}finally{state.flight=null;}
}
export async function screenerApi(request,env){
 if(request.method!=='GET')return json({message:'지원하지 않는 요청입니다.'},405);
 try{
  const filter=screenQuery(new URL(request.url).searchParams),snapshot=await screenerSnapshot(env);
  if(!snapshot.items.length)return json({status:'error',items:[],total:0,message:snapshot.message||'스크리너 데이터를 확인하지 못했습니다.'});
  if(filter.type!=='all'&&!snapshot.typeAvailable)return json({status:'error',items:[],total:0,message:snapshot.typeError});
  const result=screenRows(snapshot.items,filter);
  return json({...result,status:result.total?'ready':'empty',facets:snapshot.facets,universeCount:snapshot.items.length,source:'Finviz Elite Screener',currency:'USD',mode:'snapshot',asOfKind:'received',quoteAsOf:null,receivedAt:snapshot.receivedAt,stale:snapshot.stale,message:snapshot.message,policy:snapshot.policy,typeAvailable:snapshot.typeAvailable,typeError:snapshot.typeError,typeSource:snapshot.typeSource,typeReceivedAt:snapshot.typeReceivedAt,typeStale:snapshot.typeStale,unknownTypes:snapshot.unknownTypes,note:'조회 스냅샷 · 개별 시세 기준시각 미제공 · 가격 USD / 수익률 % / 결측값은 조건 집계에서 제외'});
 }catch(e){return json({status:e.status===400?'invalid':e instanceof FinvizError?e.status:'error',items:[],total:0,message:e.status===400||e instanceof FinvizError?e.message:'스크리너 연결을 확인해 주세요.',policy:finvizPolicy(env)},e.status===400?400:200);}
}
