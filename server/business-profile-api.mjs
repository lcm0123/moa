import {CatalystStore} from './catalyst/store.mjs';
import {profileAsset,readBusinessProfile} from './catalyst/business-profile.mjs';
import {catalystAdmin} from './catalyst-api.mjs';
import {profileProviderState,profileProviderFailure} from './catalyst/profile-provider-state.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function businessProfileApi(request,env){
 const url=new URL(request.url),market=url.searchParams.get('market'),ticker=url.searchParams.get('ticker');
 if(!env.DB)return json({message:'자료 저장소 연결 오류'},503);
 if(!['KR','US'].includes(market)||!(market==='KR'?/^[0-9A-Z]{6}$/:/^[A-Z0-9.^/-]{1,24}$/).test(ticker||''))return json({message:'종목코드를 확인해 주세요.'},400);
 const store=new CatalystStore(env.DB),asset=await profileAsset(store,market,ticker);
 if(!asset)return json({status:'NOT_COLLECTED',message:'기업 식별 정보 연결 필요',groups:{},descriptions:[],additional:[],canCollect:false});
 try{
  if(request.method==='GET'){
   const profile=await readBusinessProfile(store,asset,{sourceAllowed:env.CATALYST_SOURCE_ALLOWED}),provider=await profileProviderState(store,market);
   return json({...profile,provider,collectionMessage:provider?.retryBlocked?provider.message:profileProviderFailure(profile.request?.error,market)?.message||null,canCollect:!provider?.retryBlocked&&!!env.CATALYST_ONESHOT?.submitProfile&&await catalystAdmin(request,env)});
  }
  if(request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')||!await catalystAdmin(request,env))return json({message:'관리자 인증과 동일 출처 요청이 필요합니다.'},403);
   if(!env.CATALYST_ONESHOT?.submitProfile)return json({message:'자료 불러오기 실행 설정이 필요합니다.'},503);
   const provider=await profileProviderState(store,market);if(provider?.retryBlocked)return json({status:'PROVIDER_WAIT',message:provider.message,retryAfter:provider.retryAfter},503);
   const result=await env.CATALYST_ONESHOT.submitProfile(asset);return json(result,202);
  }
  return json({message:'지원하지 않는 요청입니다.'},405);
 }catch(e){return json({status:'FETCH_FAILED',message:e.message==='RESEARCH_BUSY'?'다른 자료를 확인 중입니다. 잠시 후 다시 요청해 주세요.':'자료 확인에 실패했습니다. 마지막 저장자료는 유지됩니다.'},e.message==='RESEARCH_BUSY'?409:500);}
}
