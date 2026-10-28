import policy from '../../config/business-profile.json' with {type:'json'};

export const profileProviderKey=market=>'business-profile-provider:'+market;
export function profileProviderFailure(error,market){
 if(market==='KR'&&/^(?:DART_API_(?:010|011|012)|DART_HTTP_(?:401|403))$/.test(error))return {state:'ACCESS_DENIED',code:error,message:'DART 인증·접근 설정 확인이 필요해 전체 수집을 잠시 보류했습니다.'};
 if(market==='KR'&&error==='DART_HTTP_429')return {state:'RATE_LIMITED',code:error,message:'DART 요청 제한으로 수집을 보류했습니다.'};
 if(market==='KR'&&/^(?:DART_CONNECTION_FAILED|DART_HTTP_5\d\d)$/.test(error))return {state:'CONNECTION_ERROR',code:error,message:'DART 연결 오류로 잠시 대기합니다. 기존 자료는 유지합니다.'};
 if(market==='KR'&&error==='DART_API_800')return {state:'MAINTENANCE',code:error,message:'DART 시스템 점검으로 수집이 중단됐습니다. 미공개 자료라는 뜻은 아닙니다.'};
 if(market==='KR'&&error==='DART_API_020')return {state:'RATE_LIMITED',code:error,message:'DART 호출 한도에 도달해 수집을 보류했습니다.'};
 return null;
}
export async function recordProfileProviderFailure(store,market,error,now=Date.now()){
 const failure=profileProviderFailure(error,market);if(!failure)return null;
 const value={...failure,checkedAt:new Date(now).toISOString(),retryAfter:new Date(now+policy.providerCooldownMs).toISOString()};
 await store.runtime(profileProviderKey(market),value);return value;
}
export async function profileProviderState(store,market,now=Date.now()){
 const saved=await store.runtime(profileProviderKey(market));
 return saved?{...saved,retryBlocked:Date.parse(saved.retryAfter)>now}:null;
}
