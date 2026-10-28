import {catalog,byId,topics,selectionConfig,fieldDefinitions} from './macro/catalog.mjs';
import {classify,candidatesFor,selectIndicators,summaryFor} from './macro/model.mjs';
import {buildHub} from './macro/analysis.mjs';
import {fredSeries,fredSchedule} from './providers/fred.mjs';
import {ecosFeed} from './providers/ecos.mjs';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function usageStats(db,now){
 if(!db)return {counts:{},visitors:0};const since=new Date(now-30*86400000).toISOString().slice(0,10);
 // The same anonymous browser contributes at most once per series/action in a 30-day window.
 const rows=await db.prepare('SELECT series_id,COUNT(DISTINCT visitor_hash || action) AS n FROM macro_usage WHERE day>=? GROUP BY series_id').bind(since).all();
 const count=(await db.prepare('SELECT COUNT(DISTINCT visitor_hash) AS n FROM macro_usage WHERE day>=?').bind(since).all()).results[0];
 return {counts:Object.fromEntries(rows.results.map(r=>[r.series_id,r.n])),visitors:count.n};
}
async function recordUsage(request,env,url){
 if(!env.DB)return json({status:'unavailable'},503);
 if(request.headers.get('origin')!==url.origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Invalid origin'},403);
 if(/bot|crawler|spider|headless|curl|python|wget/i.test(request.headers.get('user-agent')||''))return json({status:'ignored'});
 const text=await request.text();if(text.length>1024)return json({error:'Request too large'},413);
 let body;try{body=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400);}
 if(!Array.isArray(body.ids)||body.ids.length>selectionConfig.maxCore||body.ids.some(id=>!byId[id])||!['view','click'].includes(body.action))return json({error:'Invalid event'},400);
 const matched=request.headers.get('cookie')?.match(/(?:^|;\s*)moa_macro=([a-f0-9-]{36})(?:;|$)/),visitor=matched?.[1]||crypto.randomUUID();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('moa-macro-v1:'+visitor)),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');const day=new Date().toISOString().slice(0,10);
 for(const id of new Set(body.ids))await env.DB.prepare('INSERT OR IGNORE INTO macro_usage(day,visitor_hash,series_id,action) VALUES(?,?,?,?)').bind(day,hash,id,body.action).run();
 await env.DB.prepare('DELETE FROM macro_usage WHERE day<?').bind(new Date(Date.now()-31*86400000).toISOString().slice(0,10)).run();
 return json({status:'recorded'},200,matched?{}:{'Set-Cookie':`moa_macro=${visitor}; Path=/api/macro; HttpOnly; SameSite=Strict; Max-Age=2592000${url.protocol==='https:'?'; Secure':''}`});
}
export async function exploreMacro(env,question,params={},options={}){
 const now=options.now||Date.now(),analysis=classify(question,params),base={analysis,topics,fieldMenu:Object.entries(topics).map(([id,name])=>({id,name,...fieldDefinitions[id],candidateCount:catalog.filter(s=>s.topics.includes(id)).length})),core:[],related:[],retrievedAt:new Date(now).toISOString()};
 if(analysis.needsTopic)return {...base,status:'clarify',message:'질문의 주제를 확정하기 어렵습니다. 살펴볼 주제를 선택해 주세요.'};
 if(analysis.needsRegion)return {...base,status:'clarify',message:analysis.region==='mixed'?'미국과 한국을 나누어 조회합니다. 먼저 지역을 선택해 주세요.':'미국과 한국 중 어느 지역을 살펴볼까요?'};
 if(analysis.region==='KR'){
  // Only connected Korean series may answer Korean questions; no US fallback.
  const ids=[];if(analysis.topics.includes('trade')&&/달러|환율|환전|dollar|fx/i.test(question))ids.push('USDKRW');if(analysis.topics.includes('rates'))ids.push('KTB10Y');
  const feed=ids.length?await ecosFeed(env):null;
  const domestic=(feed?.items||[]).filter(s=>ids.includes(s.id));
  return {...base,status:domestic.length?'domestic':'unavailable',domestic,message:domestic.length?'현재 연결된 한국은행 ECOS 일별 자료입니다. 다른 한국 주제는 데이터 연결이 필요합니다.':'한국 지표 데이터 연결 필요. 현재 한국 물가·고용·경기 시리즈는 연결되어 있지 않습니다.'};
 }
 const candidates=candidatesFor(analysis);if(!candidates.length)return {...base,status:'unavailable',message:'이 분야의 검증된 지표 후보가 아직 없습니다.'};
 if(!env.DB)return {...base,status:'unavailable',message:'매크로 캐시 저장소 연결 필요'};
 const items=await Promise.all(candidates.map(def=>fredSeries(env,def,{...options,years:analysis.years}))),valid=items.filter(s=>!s.hidden),usage=await usageStats(env.DB,now),selected=selectIndicators(valid,analysis,usage,now);
 const core=await Promise.all(selected.core.map(async s=>({...s,schedule:await fredSchedule(env,s.id,options)})));
 const hidden=items.filter(s=>s.hidden).map(s=>({...s,topics:byId[s.id].topics})),hub=buildHub(core,selected.related,analysis,hidden);
 const hasData=core.some(s=>s.latest);
 return {...base,...selected,core,hub,status:hasData?'ready':'unavailable',configured:!!env.FRED_API_KEY,hiddenCount:hidden.length,unavailableIndicators:hidden.map(s=>({id:s.id,name:byId[s.id].name,sourceUrl:byId[s.id].sourceUrl,error:s.error,explicit:analysis.explicit.includes(s.id)})),message:hasData?null:!env.FRED_API_KEY?'FRED_API_KEY 연결 필요. 서버 설정 후 다시 확인해 주세요.':'FRED 응답을 확인하지 못했습니다. 연결 상태와 잠시 후 재시도를 확인해 주세요.',summary:summaryFor(core,analysis),selectionNote:selected.usageEnabled?'질문 관련성·대표성·인기도·최신성·익명 이용 빈도 기준':'이용 기록이 부족해 조회·클릭 점수는 제외하고 나머지 가중치를 재정규화했습니다.',usageThreshold:selectionConfig.minimumUsageVisitors,notes:['기본 결과는 관련 분야 최대 3개, 지표 최대 6개입니다. 부족한 분야를 무관한 지표로 채우지 않습니다.','발표 예정일과 실제 새 관측값 수신을 따로 확인합니다.','전체 차트는 FRED 최초 관측부터 현재 수정된 시계열을 사용합니다. 과거 당시 알려진 값으로 하는 백테스트가 아닙니다.']};
}
export async function macroApi(request,env){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/api/macro/usage'&&request.method==='POST')return await recordUsage(request,env,url);
  if(url.pathname!=='/api/macro'||request.method!=='GET')return json({error:'Not found'},404);
  const question=(url.searchParams.get('q')||'').trim();if(!question||question.length>300)return json({error:'질문은 1~300자로 입력해 주세요.'},400);
  return json(await exploreMacro(env,question,Object.fromEntries(url.searchParams)));
 }catch{return json({status:'error',message:'매크로 데이터를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);}
}
