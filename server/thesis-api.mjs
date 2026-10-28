import {readerSession} from './research-events.mjs';
import {catalystAdmin} from './catalyst-api.mjs';
import {CatalystStore} from './catalyst/store.mjs';
import {listTheses,saveThesis,updateThesis,getThesisDetail,draftThesis,archiveThesis,buildThesisContext} from './catalyst/thesis-store.mjs';
import {getReview,activeThesisReview} from './catalyst/thesis-review.mjs';
import {chatFailure} from './catalyst/chat-limits.mjs';

const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const failures={
 THESIS_INPUT_INVALID:[400,'제목·내용과 입력 항목을 확인해 주세요.'],
 THESIS_ACCESS_DENIED:[403,'내 투자 생각을 열 권한이 필요합니다.'],
 THESIS_ASSET_INVALID:[400,'기업 식별이 확인된 종목을 다시 선택해 주세요.'],
 THESIS_REFERENCE_INVALID:[400,'연결 종목이나 근거가 이 생각의 자료와 일치하지 않습니다.'],
 THESIS_FACT_UNVERIFIED:[400,'사실로 표시할 문장은 저장된 답변의 근거와 일치해야 합니다. 내 생각으로 저장할 수 있습니다.'],
 THESIS_NOT_FOUND:[404,'투자 생각을 찾을 수 없습니다.'],
 THESIS_CHAT_UNAVAILABLE:[404,'초안을 만들 완료된 내 대화를 찾을 수 없습니다.'],
 THESIS_ARCHIVED:[409,'보관한 생각은 수정할 수 없습니다.'],
 THESIS_VERSION_CONFLICT:[409,'다른 화면에서 생각이 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.']
};
export async function thesisApi(request,env){
 if(!env.DB||env.CATALYST_ENABLED==='false')return json({message:'내 투자 생각을 사용할 수 없습니다.'},503);
 const url=new URL(request.url),session=await readerSession(request),send=(value,status=200,headers={})=>json(value,status,{...session.headers,...headers});
 if(env.LOCAL_PREVIEW!==true||!['127.0.0.1','localhost'].includes(url.hostname))return send({message:'현재 내 투자 생각은 로컬 개발 환경에서만 사용할 수 있습니다.'},403);
 if(!await catalystAdmin(request,env))return send({message:'현재 내 투자 생각은 로컬 개발 또는 관리자 접근에서만 사용할 수 있습니다.'},403);
 const store=new CatalystStore(env.DB),owner=session.hash,options={sourceAllowed:env.CATALYST_SOURCE_ALLOWED};
 try{
  const path=url.pathname;
  if(request.method==='GET'){
   const review=/^\/api\/theses\/([a-f0-9-]{36})\/reviews\/([a-f0-9-]{36})$/.exec(path);
   if(review){const r=await getReview(store,review[2],owner,options);return r?.thesisId===review[1]?send(r):send({message:'검토를 찾을 수 없습니다.'},404);}
   if(path==='/api/theses')return send({items:await listTheses(store,owner,{...options,status:url.searchParams.get('status')||'ACTIVE'}),scope:'LOCAL_PRIVATE'});
   if(path==='/api/theses/home')return send({items:await listTheses(store,owner,{...options,limit:3}),scope:'LOCAL_PRIVATE'});
   if(path==='/api/theses/draft')return send(await draftThesis(store,url.searchParams.get('chat'),owner,options));
   const match=/^\/api\/theses\/([a-f0-9-]{36})(\/context)?$/.exec(path);
   if(match){const result=match[2]?await buildThesisContext(store,match[1],owner,options):await getThesisDetail(store,match[1],owner,options);return result?send(result):send({message:'투자 생각을 찾을 수 없습니다.'},404);}
  }
  if(['POST','PATCH'].includes(request.method)){
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({message:'동일 출처 JSON 요청이 필요합니다.'},403);
   const raw=await request.text();if(raw.length>40000)return send({message:'저장할 내용이 너무 깁니다.'},413);
   let body;try{body=JSON.parse(raw);}catch{return send({message:'저장할 내용의 형식을 확인해 주세요.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return send({message:'저장할 내용의 형식을 확인해 주세요.'},400);
   const review=/^\/api\/theses\/([a-f0-9-]{36})\/review$/.exec(path);
   if(review&&request.method==='POST'){
    if(!env.CATALYST_ONESHOT||!env.OPENAI_API_KEY)return send({message:'일회성 리서치 실행 설정이 필요합니다.'},503);
    const thesis=await getThesisDetail(store,review[1],owner,options);if(!thesis)return send({message:'투자 생각을 찾을 수 없습니다.'},404);
    if(thesis.status!=='ACTIVE')return send({message:'보관한 생각은 새 변화 확인을 실행하지 않습니다.'},409);
    if(body.expectedVersion!==undefined&&Number(body.expectedVersion)!==thesis.currentVersion)return send({message:'생각이 수정되었습니다. 최신 버전을 확인해 주세요.'},409);
    try{const j=await activeThesisReview(store,thesis.id,owner)||await env.CATALYST_ONESHOT.submit({executionMode:'thesis',thesisId:thesis.id,readerHash:owner,expectedVersion:thesis.currentVersion});return send({id:j.reviewId,jobId:j.id,status:j.status,shared:!!j.shared},202);}catch(e){const r=chatFailure(e,e.quota);return send(r.body,r.status,r.headers);}
   }
   if(path==='/api/theses'&&request.method==='POST')return send(await saveThesis(store,owner,body,options),201);
   const match=/^\/api\/theses\/([a-f0-9-]{36})(\/archive)?$/.exec(path);
   if(match?.[2]&&request.method==='POST')return send(await archiveThesis(store,match[1],owner,options));
   if(match&&!match[2]&&request.method==='PATCH')return send(await updateThesis(store,match[1],owner,body,options));
  }
  return send({message:'지원하지 않는 요청입니다.'},405);
 }catch(error){const failure=failures[error.message];return send({code:failure?error.message:'THESIS_SAVE_FAILED',message:failure?.[1]||'투자 생각을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},failure?.[0]||500);}
}
