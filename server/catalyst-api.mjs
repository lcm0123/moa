import {readerSession} from './research-events.mjs';
import {CatalystStore,rows,one} from './catalyst/store.mjs';
import {chatPolicy} from './catalyst/chat-contract.mjs';
import {publicChat,ownedChat,chatHistory} from './catalyst/chat-store.mjs';
import {chatQuota,chatFailure} from './catalyst/chat-limits.mjs';
import {prepareThesisFollowup} from './catalyst/thesis-review.mjs';
import {searchAssets} from './catalyst/assets.mjs';
import {enqueue,publicRun,publicAsset} from './catalyst/service.mjs';
import {usageOverview} from './catalyst/ai.mjs';
import {hash,config,CatalystError} from './catalyst/core.mjs';
import {CatalystGraph,graphVersion} from './catalyst/graph.mjs';
import {readMetadata,requestMetadata} from './catalyst/metadata-jobs.mjs';
import {readResearch,researchMetrics} from './catalyst/research-store.mjs';
import {researchDelivery} from './catalyst/research-delivery.mjs';
import {queryIntent,beneficiaryQuestion} from './catalyst/query-policy.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export async function catalystAdmin(request,env){
 const url=new URL(request.url);if(env.LOCAL_PREVIEW===true&&['127.0.0.1','localhost'].includes(url.hostname))return true;
 const key=env.CATALYST_ADMIN_TOKEN;if(!key||key.length<32)return false;const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'');return !!supplied&&supplied.length<512&&(await hash(supplied))===(await hash(key));
}
export async function catalystApi(request,env){
 if(!env.DB||env.CATALYST_ENABLED==='false')return json({message:'촉매 분석이 비활성화되어 있습니다.'},503);
 const url=new URL(request.url),path=url.pathname,store=new CatalystStore(env.DB),session=await readerSession(request),send=(v,s=200,headers={})=>json(v,s,{...session.headers,...headers});
 try{
  if(path==='/api/catalyst/chat'||path.startsWith('/api/catalyst/chat/')){
   if(!chatPolicy.enabled||env.CATALYST_FREE_RESEARCH_ENABLED==='false')return send({message:'자유 리서치가 비활성화되어 있습니다.'},503);
   if(!await catalystAdmin(request,env))return send({message:'리서치 실행 권한이 필요합니다.'},403);
   if(path==='/api/catalyst/chat'&&request.method==='GET')return send({items:await chatHistory(store,session.hash),quota:await chatQuota(store,session.hash)});
   if(path==='/api/catalyst/chat'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
    if(!env.CATALYST_ONESHOT||!env.OPENAI_API_KEY)return send({message:'일회성 리서치 실행 설정이 필요합니다.'},503);
    const raw=await request.text();if(raw.length>2000)return send({message:'질문이 너무 깁니다.'},413);
    let body;try{body=JSON.parse(raw);}catch{return send({message:'질문 형식을 확인해 주세요.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return send({message:'질문 형식을 확인해 주세요.'},400);
    try{if(body.thesisId&&(env.LOCAL_PREVIEW!==true||!['127.0.0.1','localhost'].includes(url.hostname)))return send({message:'내 투자 생각은 로컬 개발 환경에서만 사용할 수 있습니다.'},403);const thesisContext=body.thesisId?await prepareThesisFollowup(store,body.thesisId,session.hash,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}):null;const job=await env.CATALYST_ONESHOT.submit({thesisContext,query:body.query,market:body.market,parentId:body.parentId,readerHash:session.hash,executionMode:'free'});return send({id:job.id,status:job.status,shared:!!job.shared},202);}catch(e){const failure=chatFailure(e,e.quota||(e.message==='CHAT_RATE_LIMIT'?await chatQuota(store,session.hash):null));return send(failure.body,failure.status,failure.headers);}
   }
   const match=/^\/api\/catalyst\/chat\/([a-f0-9-]{36})(\/cancel)?$/.exec(path);
   if(!match||!await ownedChat(store,match[1],session.hash))return send({message:'대화를 찾을 수 없습니다.'},404);
   if(match[2]&&request.method==='POST'&&request.headers.get('Origin')===url.origin)return send(await env.CATALYST_ONESHOT.cancel(match[1]),202);
   if(!match[2]&&request.method==='GET')return send(await publicChat(store,match[1],session.hash,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}));
   return send({message:'지원하지 않는 요청입니다.'},405);
  }
  if(path==='/api/catalyst/results'&&request.method==='GET'){
   const result=await researchDelivery(store,{id:url.searchParams.get('id'),query:url.searchParams.get('q'),market:url.searchParams.get('market')||'ALL',sourceAllowed:env.CATALYST_SOURCE_ALLOWED});
   return result?send(result):send({message:'일치하는 저장 분석이 없습니다. 질문을 바꾸거나 관리자가 새 분석을 요청할 수 있습니다.'},404);
  }
  if(path==='/api/catalyst/research'||path.startsWith('/api/catalyst/research/')){
   if(!await catalystAdmin(request,env))return send({message:'관리자 인증이 필요합니다.'},403);
   const privateId=/^\/api\/catalyst\/research\/([a-f0-9-]{36})/.exec(path)?.[1];
   if(privateId&&await one(store.db,'SELECT job_id FROM catalyst_dialogue WHERE job_id=?',privateId))return send({message:'대화 전용 경로를 이용해 주세요.'},404);
   if(path==='/api/catalyst/research'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
    if(!env.CATALYST_ONESHOT||!env.OPENAI_API_KEY)return send({message:'관리자 일회성 분석 실행 설정이 필요합니다.'},503);
    const text=await request.text();if(text.length>4000)return send({message:'질문이 너무 깁니다.'},413);
    let body;try{body=JSON.parse(text);}catch{return send({message:'질문 형식을 확인해 주세요.'},400);}
    if(['CONDITIONAL_ANALYSIS','BENEFICIARY_DISCOVERY'].includes(queryIntent(body?.query))&&!beneficiaryQuestion(body?.query))return send({code:'RESEARCH_TOPIC_REQUIRED',message:'살펴볼 산업·제품 또는 경제 변화를 함께 입력해 주세요. 예: 금리가 내려가면 관련 기업은?'},422);
    if(body.market==='CRYPTO')return send({message:'가상화폐는 기존 Protocol / Token Value Capture 분석을 사용합니다. 주식 사업 비중 분석은 실행하지 않습니다.'},422);
    try{const job=await env.CATALYST_ONESHOT.submit(body);return send({id:job.id,status:job.status,shared:!!job.shared},202);}catch(e){return send({message:e.message==='RESEARCH_BUSY'?'다른 분석이 진행 중입니다. 완료 후 다시 요청해 주세요.':e.message==='RESUME_LIMIT'?'중단된 작업의 재개 한도에 도달했습니다. 새 분석이 필요하면 다시 요청해 주세요.':'질문·시장·모드 또는 실행 설정을 확인해 주세요.'},e.message==='RESEARCH_BUSY'?409:400);}
   }
   const metrics=/^\/api\/catalyst\/research\/([a-f0-9-]{36})\/metrics$/.exec(path);
   if(metrics&&request.method==='GET')return send(await researchMetrics(store,metrics[1]));
   const execution=/^\/api\/catalyst\/research\/([a-f0-9-]{36})\/(execution|cancel)$/.exec(path);
   if(execution&&env.CATALYST_ONESHOT){
    if(execution[2]==='execution'&&request.method==='GET')return send(await env.CATALYST_ONESHOT.status(execution[1]));
    if(execution[2]==='cancel'&&request.method==='POST'&&request.headers.get('Origin')===url.origin)return send(await env.CATALYST_ONESHOT.cancel(execution[1]),202);
   }
   const id=/^\/api\/catalyst\/research\/([a-f0-9-]{36})$/.exec(path)?.[1];
   if(id&&request.method==='GET'){const result=await readResearch(store,id);return result?send(result):send({message:'조사 기록을 찾을 수 없습니다.'},404);}
   return send({message:'지원하지 않는 요청입니다.'},405);
  }
  if(path==='/api/catalyst/config'&&request.method==='GET')return send({enabled:true,freeResearch:chatPolicy.enabled&&env.CATALYST_FREE_RESEARCH_ENABLED!=='false',ready:!!env.OPENAI_API_KEY&&!!env.CATALYST_ONESHOT,admin:await catalystAdmin(request,env),model:env.CATALYST_AI_MODEL||config.model,version:config.version,webSearch:env.BRAVE_SEARCH_API_KEY?'Brave':'기존 뉴스·공시',openAIWebSearch:env.ENABLE_OPENAI_WEB_SEARCH==='true'});
  if(path==='/api/catalyst/assets'&&request.method==='GET'){const query=(url.searchParams.get('q')||'').slice(0,100);return send({items:(await searchAssets(store,query)).map(publicAsset)});}
  if(path==='/api/catalyst/metadata'){
   const id=(url.searchParams.get('asset')||'').slice(0,200),asset=await store.asset(id);if(!asset)return send({message:'자산 식별자를 확인해 주세요.'},404);
   if(request.method==='GET')return send(await readMetadata(store,asset));
   if(request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin||!await catalystAdmin(request,env))return send({message:'관리자 인증과 동일 출처 요청이 필요합니다.'},403);
    if(!env.CATALYST_WAKE||env.CATALYST_METADATA_WORKER_ENABLED==='false')return send({message:'메타데이터 작업자 연결 필요'},503);
    const result=await requestMetadata(store,asset);env.CATALYST_WAKE();return send(result,202);
   }
  }
  if(path==='/api/catalyst/usage'&&request.method==='GET'){if(!await catalystAdmin(request,env))return send({message:'관리자 인증이 필요합니다.'},403);return send(await usageOverview(store,env));}
  if(path==='/api/catalyst/graph'&&request.method==='GET'){
   if(!await catalystAdmin(request,env))return send({message:'관리자 인증이 필요합니다.'},403);
   const node=url.searchParams.get('node');
   if(!node)return send({version:graphVersion,nodes:await rows(env.DB,"SELECT id,kind,label FROM catalyst_graph_nodes WHERE namespace='production' ORDER BY label LIMIT 50"),message:'검증된 관계만 탐색합니다. 기업 순위는 산출하지 않습니다.'});
   if(!/^[a-f0-9]{64}$/.test(node))return send({message:'노드 식별자를 확인해 주세요.'},400);
   let conditions;try{const raw=url.searchParams.get('conditions')||'{}';if(raw.length>2000)throw Error();conditions=JSON.parse(raw);if(!conditions||Array.isArray(conditions)||typeof conditions!=='object')throw Error();}catch{return send({message:'조건 형식을 확인해 주세요.'},400);}
   return send(await new CatalystGraph(env.DB).paths(node,{conditions}));
  }
  if(path==='/api/catalyst/runs'&&request.method==='POST'){
   if(!await catalystAdmin(request,env))return send({message:'관리자 인증이 필요합니다.'},403);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'요청 출처를 확인해 주세요.'},403);
   if(!env.CATALYST_WAKE)return send({message:'분석 작업자가 연결되지 않았습니다.'},503);
   const text=await request.text();if(text.length>4000)return send({message:'질문이 너무 깁니다.'},413);
   let body;try{body=JSON.parse(text);}catch{return send({message:'질문 형식을 확인해 주세요.'},400);}return send(publicRun(await enqueue(env,session.hash,body)),202);
  }
  if(path==='/api/catalyst/runs'&&request.method==='GET')return send({items:(await rows(env.DB,'SELECT payload FROM catalyst_runs WHERE reader_hash=? ORDER BY created_at DESC LIMIT 10',session.hash)).map(r=>{const v=JSON.parse(r.payload);return {id:v.id,query:v.query,state:v.state,createdAt:v.createdAt};})});
  const id=/^\/api\/catalyst\/runs\/([0-9a-f-]{36})$/.exec(path)?.[1];if(id&&request.method==='GET'){const run=await store.run(id,session.hash);return run?send(publicRun(run)):send({message:'분석 기록을 찾을 수 없습니다.'},404);}
  return send({message:'지원하지 않는 요청입니다.'},405);
 }catch(e){return send({code:e instanceof CatalystError?e.code:'processing_failed',message:e instanceof CatalystError?e.message:'분석 요청을 처리하지 못했습니다.'},e instanceof CatalystError?(e.code==='rate_limit'?429:400):500);}
}
