import {catalystAdmin} from './catalyst-api.mjs';
import {readerSession} from './research-events.mjs';
import {CatalystStore,one,rows} from './catalyst/store.mjs';
import {domesticProfileProgress} from './catalyst/profile-domestic-auto.mjs';
import {createNewsJob,readJob,publicJob,updateNewsJob,jobHistory} from './news-companies-store.mjs';
import {safeLink,policy} from './news-companies-model.mjs';
import {feedRequest} from './news-articles.mjs';
import {newsUsage} from './news-usage.mjs';
import {inlineEnabled,inlineRequest,inlinePolicy} from './news-inline-model.mjs';
import {validateInlineDependencies} from './news-inline-publication.mjs';
import {parseConditions} from './news-companies-model.mjs';
import {relationIds} from './news-article-relations.mjs';
import {validateHorizon} from './news-inline-scenarios.mjs';
import {ideaEnabled,ideaExternalEnabled,isIdea,createIdeaJob,refreshIdeaJob,publicIdeaJob,validateIdeaDependencies} from './idea-companies-store.mjs';
const messages={FEATURE_DISABLED:'관련 기업 찾기가 꺼져 있습니다.',CONFIGURATION_REQUIRED:'서버의 OpenAI·Brave 키 또는 실행기 설정이 필요합니다.',ACCESS_REQUIRED:'분석 실행 권한이 필요합니다. 현재 로컬 미리보기 또는 인증된 관리자만 사용할 수 있습니다.',INVALID_INPUT:'기사 URL 또는 80자 이상의 본문을 입력해 주세요.',INVALID_CONDITIONS:'조건 값을 확인해 주세요.',USER_LIMIT:'이 브라우저의 시간당 분석 한도에 도달했습니다. 조건 변경은 추가 호출 없이 가능합니다.',REFRESH_COOLDOWN:'방금 확인한 자료입니다. 1분 뒤 다시 갱신할 수 있습니다.',VERSION_CONFLICT:'다른 요청이 먼저 반영되었습니다. 최신 결과를 다시 불러와 주세요.',RUNNING_CONFLICT:'분석이 진행 중입니다. 완료 후 조건을 변경하거나 취소해 주세요.',NOT_FOUND:'이 브라우저에서 확인할 수 없는 결과입니다.',ARTICLE_ACCESS_DENIED:'기사 접근이 거부되었습니다. 로그인·유료벽 여부를 확인하거나 본문을 붙여 넣어 주세요.',ARTICLE_READ_FAILED:'기사 본문을 확보하지 못했습니다. 본문을 붙여 넣어 다시 시도해 주세요.',AI_RATE_LIMIT:'AI 제공자의 호출 제한입니다.',AI_TIMEOUT:'AI 응답 시간이 초과되었습니다.',AI_TRUNCATED:'AI 응답이 중간에 끝나 검증할 수 없습니다.',AI_SCHEMA_INVALID:'AI 응답 형식을 검증하지 못했습니다.',AI_REFUSAL:'AI가 해당 분석에 응답하지 않았습니다.',EVENT_EVIDENCE_REJECTED:'사건과 원문 근거가 맞지 않아 결과를 보류했습니다.',WORKER_INTERRUPTED:'작업이 중단되었습니다. 이전 결과는 보존되며 자동 유료 재시도는 하지 않습니다.',TIMEOUT:'실행 시간 한도에 도달했습니다.',CANCELLED:'분석을 취소했습니다.',BUSY:'다른 자료 수집이 실행 중입니다. 잠시 후 자동으로 대기 상태를 확인합니다.'};
Object.assign(messages,{INVALID_HORIZON:'분석 기간은 2000~2100년 중 최대 8개 연도로 지정해 주세요.',INVALID_SCENARIO:'시나리오의 기업·연도·통화·숫자를 확인해 주세요. 빈 값은 미확인으로 남습니다.',INVALID_SCENARIO_BASELINE:'추가 변화가 없는 기준 매출과 항목 간 중복 여부를 확인해 주세요.',INVALID_SCENARIO_UNITS:'공정·소재 단위와 고객 승인 여부를 확인해 주세요.',FINANCIAL_EVIDENCE_CHANGED:'공시·매출 근거가 변경되었습니다. 최신 근거 확인 후 다시 계산해 주세요.'});
Object.assign(messages,{INVALID_IDEA_INPUT:'아이디어를 5~4,000자로 입력해 주세요.',INVALID_IDEA_DATE:'기준일은 오늘까지의 올바른 날짜로 입력해 주세요.',INVALID_IDEA_MARKET:'국내 또는 미국 시장을 선택해 주세요.',INVALID_IDEA_CONDITION:'매출 비중 조건은 0~100%로 입력해 주세요.',IDEA_QUEUE_LIMIT:'아이디어 탐색 대기 한도에 도달했습니다. 진행 중인 작업을 확인해 주세요.',IDEA_DISABLED:'아이디어 탐색이 꺼져 있습니다.',INVALID_ACTION:'이 분석에서 지원하지 않는 작업입니다.'});
Object.assign(messages,{IDEA_SCHEMA_REQUIRED:'아이디어 탐색 DB 갱신이 필요합니다. 관리자에게 문의해 주세요.',IDEA_QUEUE_LIMIT:'아이디어 탐색의 대기·실행 한도에 도달했습니다. 진행 중인 작업을 확인하고 잠시 뒤 다시 시도해 주세요.'});
export const newsErrorMessage=code=>messages[code]||'자료를 처리하지 못했습니다. 입력과 연결 상태를 확인해 주세요.';
export async function newsCompaniesApi(request,env){
 const session=await readerSession(request),url=new URL(request.url),path=url.pathname.slice('/api/news-companies'.length),owner=session.hash;
 const send=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...session.headers}});
 const enabled=env.NEWS_COMPANIES_ENABLED==='true',admin=await catalystAdmin(request,env),ready=enabled&&!!env.OPENAI_API_KEY&&!!env.BRAVE_SEARCH_API_KEY&&!!env.NEWS_COMPANIES_RUNTIME;
 if(path==='/config'&&request.method==='GET')return send({enabled,ready:ready&&admin,ideaEnabled:ideaEnabled(env),ideaReady:enabled&&ideaEnabled(env)&&admin&&!!env.DB&&!!env.NEWS_COMPANIES_RUNTIME,ideaExternalReady:ideaExternalEnabled(env)&&enabled&&admin&&!!env.BRAVE_SEARCH_API_KEY&&!!env.NEWS_COMPANIES_RUNTIME,access:admin,reason:!enabled?'FEATURE_DISABLED':!admin?'ACCESS_REQUIRED':!ready?'CONFIGURATION_REQUIRED':null,limits:{searches:policy.maxSearches,documents:policy.maxDocuments,candidates:policy.maxCandidates,runsPerHour:policy.maxRunsPerHour},coreBusinessShare:policy.coreBusinessShare,imageSupported:false});
 if(!enabled)return send({code:'FEATURE_DISABLED',message:messages.FEATURE_DISABLED},503);
 if(!admin)return send({code:'ACCESS_REQUIRED',message:messages.ACCESS_REQUIRED},403);
 if(!env.DB)return send({message:'저장소 연결 필요'},503);
 try{
  if(path==='/article-relations'&&request.method==='GET'){
   const ids=relationIds((url.searchParams.get('ids')||'').split(','));
   if(!inlineEnabled(env))return send({code:'V2_DISABLED'},409);
   return send(await env.NEWS_ARTICLES_RUNTIME.relate(ids));
  }
  if(path==='/usage'&&request.method==='GET')return send({...await newsUsage(env.DB,env),live:await env.NEWS_COMPANIES_RUNTIME?.liveStatus?.(),businessCollection:await domesticProfileProgress(new CatalystStore(env.DB))});
  if(path==='/articles'&&request.method==='GET'){
   if(!env.NEWS_ARTICLES_RUNTIME)return send({code:'FEED_RUNTIME_REQUIRED',message:'뉴스 목록 실행기 연결이 필요합니다.',items:[]},503);
   return send(await env.NEWS_ARTICLES_RUNTIME.list(feedRequest(Object.fromEntries(url.searchParams))));
  }
  if(path==='/article-summaries'&&request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
   if(!env.NEWS_ARTICLES_RUNTIME?.summarize)return send({message:'뉴스 요약 실행기 연결이 필요합니다.'},503);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>1000)return send({message:'요약 요청 크기 초과'},413);
   const body=JSON.parse(raw);if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='articleIds'))throw Error('INVALID_BRIEF_REQUEST');
   return send(await env.NEWS_ARTICLES_RUNTIME.summarize(body.articleIds));
  }
  if(path==='/article-relations'&&request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
   if(!env.NEWS_ARTICLES_RUNTIME?.relate)return send({message:'사업 연결 실행기 연결이 필요합니다.'},503);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>1000)return send({message:'요청 크기 초과'},413);
   const body=JSON.parse(raw);if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='articleIds'))throw Error('INVALID_RELATION_REQUEST');
   return send(await env.NEWS_ARTICLES_RUNTIME.relate(body.articleIds));
  }
  if(path==='/saved-articles'&&request.method==='GET'){
   const found=await rows(env.DB,"SELECT id,title,url,publisher,published_at,payload FROM catalyst_sources WHERE source_type='news' AND title<>'' ORDER BY observed_at DESC LIMIT 30"),items=[];
   for(const s of found){if(!safeLink(s.url)||!await env.CATALYST_SOURCE_ALLOWED?.({...JSON.parse(s.payload),url:s.url,id:s.id}))continue;items.push({id:s.id,title:s.title,url:s.url,publisher:s.publisher,publishedAt:s.published_at});if(items.length>=8)break;}
   return send({items,scope:'기존 저장 뉴스 · 최신 뉴스 전체 목록이 아닙니다.'});
  }
  const id=path.slice(1);if(path&&(!/^[a-f0-9-]{36}$/.test(id)))return send({message:'Not found'},404);
  if(request.method==='GET'){
   if(!id)return send({items:(await rows(env.DB,'SELECT * FROM news_company_jobs WHERE owner=? ORDER BY updated_at DESC LIMIT 10',owner)).map(r=>isIdea(r)?{...publicIdeaJob({...r,result:null})}:publicJob(r))});
   let row=await readJob(env.DB,id,owner);if(!row)throw Error('NOT_FOUND');
   if(isIdea(row)){
    if(!ideaEnabled(env))throw Error('IDEA_DISABLED');
    if(row.status==='RUNNING'){
     const lease=await one(env.DB,"SELECT value FROM catalyst_runtime WHERE key='research-worker-lease'"),held=JSON.parse(lease?.value||'{}');
     if(held.newsJob!==id||held.until<Date.now()){
      await env.DB.prepare("UPDATE news_company_jobs SET status='FAILED',phase='FAILED',error='WORKER_INTERRUPTED',updated_at=? WHERE id=? AND owner=? AND version=? AND status='RUNNING'").bind(new Date().toISOString(),id,owner,row.version).run();
      row=await readJob(env.DB,id,owner);
     }
    }
    const valid=!row.result||await validateIdeaDependencies(env.DB,row,env.CATALYST_SOURCE_ALLOWED||(()=>false));
    if(row.status==='QUEUED')await env.NEWS_COMPANIES_RUNTIME?.start(row).catch(()=>{});
    row=await readJob(env.DB,id,owner);
    return send({...publicIdeaJob(row,{valid}),message:row.error?newsErrorMessage(row.error):null,history:await jobHistory(env.DB,id,owner)});
   }
   if(row.status==='RUNNING'){const lease=await one(env.DB,"SELECT value FROM catalyst_runtime WHERE key='research-worker-lease'"),held=JSON.parse(lease?.value||'{}');if(held.newsJob!==id||held.until<Date.now())await env.DB.prepare("UPDATE news_company_jobs SET status='FAILED',phase='FAILED',error='WORKER_INTERRUPTED' WHERE id=? AND version=? AND status='RUNNING'").bind(id,row.version).run();}
   if(ready&&row.status==='QUEUED'&&!inlineEnabled(env))await env.NEWS_COMPANIES_RUNTIME.start(row).catch(()=>{});
   row=await readJob(env.DB,id,owner);const out=publicJob(row);if(out.result?.inline&&!await validateInlineDependencies(env.DB,row,env.CATALYST_SOURCE_ALLOWED||(()=>false))){out.result.inline={format:'inline-v2',status:'invalidated',message:'사업 근거가 변경되어 이전 연결을 철회했습니다.',candidates:[]};}return send({...out,message:row.error?newsErrorMessage(row.error):null,history:await jobHistory(env.DB,id,owner)});
  }
  if(request.method!=='POST')return send({message:'Method not allowed'},405);
  if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>100000)return send({message:'입력 용량 한도 초과'},413);
  const body=JSON.parse(raw);
  const existing=id?await readJob(env.DB,id,owner):null;
  if(id&&!existing)throw Error('NOT_FOUND');
  if(body.inputType==='IDEA'||isIdea(existing)){
   if(!ideaEnabled(env))throw Error('IDEA_DISABLED');
   if(!env.NEWS_COMPANIES_RUNTIME)throw Error('CONFIGURATION_REQUIRED');
   let job=existing?await refreshIdeaJob(env.DB,owner,id,body,{env}):(await createIdeaJob(env.DB,owner,body,{env})).row;
   if(job.status==='QUEUED')await env.NEWS_COMPANIES_RUNTIME.start(job).catch(()=>{});
   if(job.status==='CANCELLED')env.NEWS_COMPANIES_RUNTIME.cancel(job.id);
   job=await readJob(env.DB,job.id,owner);const valid=!job.result||await validateIdeaDependencies(env.DB,job,env.CATALYST_SOURCE_ALLOWED||(()=>false));return send(publicIdeaJob(job,{valid}),202);
  }
  if(!ready&&(!id||!['conditions','scenarios','cancel'].includes(body.action)))throw Error('CONFIGURATION_REQUIRED');
  let row;if(!id){if(body.articleId){
   let article;
   if(String(body.articleId).startsWith('feed-'))article=await env.NEWS_ARTICLES_RUNTIME?.resolve(body.articleId);
   else {article=await one(env.DB,'SELECT id,url,title,payload FROM catalyst_sources WHERE id=? AND source_type=?',body.articleId,'news');if(article&&!await env.CATALYST_SOURCE_ALLOWED?.({...JSON.parse(article.payload),id:article.id,url:article.url}))article=null;}
   if(!article)throw Error('NOT_FOUND');body.url=article.url;body.title=article.title;body.text='';
  }row=(await createNewsJob(env.DB,owner,body,inlineEnabled(env)?{inlineContext:await inlineRequest({id:'private',url:body.url,title:body.title,feedExcerpt:body.text},{scope:'private:'+owner,constraints:parseConditions(body.conditionsText,body.conditions).conditions,horizon:validateHorizon(body.horizon)})}:{})).row;}
   else row=await updateNewsJob(env.DB,owner,id,body,{allowed:env.CATALYST_SOURCE_ALLOWED||(()=>false)});
  if(row.status==='QUEUED')await env.NEWS_COMPANIES_RUNTIME.start(row).catch(()=>{});
  if(row.status==='CANCELLED')env.NEWS_COMPANIES_RUNTIME?.cancel(row.id);
  return send(publicJob(await readJob(env.DB,row.id,owner)),202);
 }catch(e){const code=/^[A-Z_]+$/.test(e.message)?e.message:'INVALID_REQUEST';return send({code,message:newsErrorMessage(code)},code==='NOT_FOUND'?404:/CONFLICT|COOLDOWN/.test(code)?409:['USER_LIMIT','IDEA_QUEUE_LIMIT'].includes(code)?429:['CONFIGURATION_REQUIRED','IDEA_SCHEMA_REQUIRED'].includes(code)?503:400);}
}
