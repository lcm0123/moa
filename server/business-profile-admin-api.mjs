import {CatalystStore} from './catalyst/store.mjs';
import {catalystAdmin} from './catalyst-api.mjs';
import {profileProgress,registerProfileUniverse,createProfileRun,retryProfileJob} from './catalyst/profile-queue.mjs';
import {searchBusinessProfiles,businessSearchCoverage} from './catalyst/profile-search.mjs';
import {domesticProfileProgress} from './catalyst/profile-domestic-auto.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function businessProfileAdminApi(request,env){
 const u=new URL(request.url);if(!env.DB)return json({message:'자료 저장소 연결 필요'},503);const store=new CatalystStore(env.DB);
 if(u.pathname==='/api/business-profiles/coverage'&&request.method==='GET')return json(await domesticProfileProgress(store));
 if(u.pathname==='/api/business-profiles/search'&&request.method==='GET'){
  const min=u.searchParams.get('minShare'),share=min===null||min===''?null:Number(min);if(share!==null&&(!Number.isFinite(share)||share<0||share>100))return json({message:'비중 범위를 확인해 주세요.'},400);
  const market=u.searchParams.get('market'),dimension=u.searchParams.get('dimension');if(market&&!['KR','US'].includes(market)||dimension&&!['DESCRIPTION','PRODUCT','BUSINESS_SEGMENT','END_MARKET','GEOGRAPHY','DOMESTIC_EXPORT','CUSTOMER'].includes(dimension))return json({message:'시장과 항목 분류를 확인해 주세요.'},400);
  return json({items:await searchBusinessProfiles(store,(u.searchParams.get('q')||'').slice(0,100),{market,dimension,minShare:share,offset:Math.max(0,Number(u.searchParams.get('offset'))||0),sourceAllowed:env.CATALYST_SOURCE_ALLOWED}),coverage:await businessSearchCoverage(store),source:'저장된 기업 사업정보',notice:'표시된 비중은 원문 항목 범위입니다. 사업부 비중을 좁은 제품 비중으로 바꾸지 않습니다. 비중 조건은 기간·분모·연결 범위가 확인된 값에만 적용합니다.'});
 }
 if(!await catalystAdmin(request,env))return json({message:'관리자 인증이 필요합니다.'},403);
 if(request.method==='GET')return json(await profileProgress(store,{offset:Math.max(0,Number(u.searchParams.get('offset'))||0)}));
 if(request.method!=='POST'||request.headers.get('Origin')!==u.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({message:'동일 출처 JSON 요청이 필요합니다.'},403);
 const text=await request.text();if(text.length>2000)return json({message:'요청이 너무 큽니다.'},413);
 try{const b=JSON.parse(text);
  if(b.action==='register')return json(await registerProfileUniverse(store));
  if(b.action==='create')return json(await createProfileRun(store,b));
  if(b.action==='retry'&&/^[a-f0-9]{64}$/.test(b.id||''))return json(await retryProfileJob(store,b.id));
  if(!/^[a-f0-9-]{36}$/.test(b.id||''))return json({message:'작업 식별자를 확인해 주세요.'},400);
  if(b.action==='start'&&env.CATALYST_ONESHOT?.startProfileBatch)return json(await env.CATALYST_ONESHOT.startProfileBatch(b.id),202);
  if(b.action==='pause'&&env.CATALYST_ONESHOT?.pauseProfileBatch)return json(await env.CATALYST_ONESHOT.pauseProfileBatch(b.id));
  return json({message:'지원되지 않는 작업입니다.'},400);
 }catch(e){return json({message:e.message==='RESEARCH_BUSY'?'다른 수집이 실행 중입니다.':'기업 수·호출 예산·작업 상태를 확인해 주세요.'},e.message==='RESEARCH_BUSY'?409:400);}
}
