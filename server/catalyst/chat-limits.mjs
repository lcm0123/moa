import {chatPolicy as policy} from './chat-contract.mjs';
import {rows} from './store.mjs';
import {messages} from './core.mjs';

// A rolling hour per reader, separate from the per-conversation and AI token limits.
export async function chatQuota(store,reader,now=Date.now()){
 const windowMs=3600000,limit=policy.maxRequestsPerHour;
 const requests=await rows(store.db,'SELECT created_at FROM catalyst_dialogue WHERE reader_hash=? AND created_at>? ORDER BY created_at ASC',reader,new Date(now-windowMs).toISOString());
 const used=requests.length,remaining=Math.max(0,limit-used);
 // If a configured limit is lowered, enough older requests must expire first.
 const retryAt=used>=limit?new Date(Date.parse(requests[used-limit].created_at)+windowMs).toISOString():null;
 return {used,limit,remaining,windowMinutes:60,retryAt,retryAfterSeconds:retryAt?Math.max(1,Math.ceil((Date.parse(retryAt)-now)/1000)):0,checkedAt:new Date(now).toISOString()};
}

export function chatFailure(error,quota){
 const code=error.code||error.message;
 if(code==='CHAT_RATE_LIMIT'&&quota){
  const at=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(Math.ceil(Date.parse(quota.retryAt||quota.checkedAt)/1000)*1000));
  return {status:429,headers:{'Retry-After':String(quota.retryAfterSeconds)},body:{code,quota,message:`최근 1시간의 리서치 질문 ${quota.limit}회를 모두 사용했습니다. ${at} KST부터 다시 질문할 수 있습니다. 저장된 답변은 계속 볼 수 있습니다.`}};
 }
 const known={
  CHAT_TURN_LIMIT:[400,`한 대화에서는 ${policy.maxTurns}회까지 질문할 수 있습니다. 새 대화에서 이어서 질문해 주세요. 시간당 이용 한도는 그대로 적용됩니다.`],
  CHAT_INPUT_INVALID:[400,`질문은 1~${policy.maxQuestionCharacters}자로 입력하고 시장 선택을 확인해 주세요.`],
  CHAT_PARENT_UNAVAILABLE:[400,'이 대화를 이어갈 수 없습니다. 본인의 완료된 대화인지 확인해 주세요.'],
  THESIS_UNAVAILABLE:[404,'연결할 내 투자 생각을 찾을 수 없습니다.'],
  THESIS_VERSION_CONFLICT:[409,'생각이 수정되었습니다. 최신 내용을 확인한 뒤 다시 검토해 주세요.'],
  RESEARCH_BUSY:[409,'다른 리서치가 진행 중입니다. 완료 후 다시 시도해 주세요.'],
  ONESHOT_FLAGS_REQUIRED:[503,'리서치 실행 설정을 확인해야 합니다. 관리자에게 문의해 주세요.'],
  budget_limit:[429,messages.budget_limit],rate_limit:[429,messages.rate_limit]
 };
 const knownError=known[code];
 return {status:knownError?.[0]||500,body:{code:knownError?code:'CHAT_REQUEST_FAILED',message:knownError?.[1]||'리서치 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},headers:{}};
}
