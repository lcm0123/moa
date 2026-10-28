// The server owns source eligibility, budgets and provider work. GET only reads
// its saved status; this controller can start work only through explicit POST.
const allowedStates=new Set(['READY','IDLE','RUNNING','PARTIAL','FAILED','COOLDOWN','BUSY','RATE_LIMITED','BLOCKED','INTERRUPTED']);
const stoppedStates=new Set(['COOLDOWN','RATE_LIMITED','BLOCKED']);
const running=data=>data?.collection?.state==='RUNNING';
const waiting=data=>data?.collection?.state==='BUSY'||['IDLE','PARTIAL'].includes(data?.collection?.state)&&data?.collection?.business?.state==='BUSY'&&data?.collection?.business?.code==='WORKER_BUSY';
const needsData=data=>data?.needs?.financial===true||data?.needs?.business===true;
const phase=data=>[data?.collection?.state,data?.collection?.financial?.state,data?.collection?.business?.state].join('|');
const canStart=data=>data?.canCollect===true&&needsData(data)&&allowedStates.has(data?.collection?.state)&&!stoppedStates.has(data.collection.state)&&!running(data);
const text=value=>typeof value==='string'?value.slice(0,500):'';

export function createStockEvidenceController({market,ticker,onState=()=>{},onRefresh=()=>{},fetchImpl=globalThis.fetch,
 now=Date.now,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,pollMs=4000,maxPolls=150,maxPollMs=600000,requestTimeoutMs=120000}={}){
 const url='/api/stock-evidence?'+new URLSearchParams({market,ticker});
 const controller=new AbortController();
 let dead=false,data=null,readFlight=null,postFlight=null,startFlight=null,timer=null,autoAttempted=false,pollStart=null,polls=0,pollLimited=false,busyRetries=0;
 const interval=Math.min(5000,Math.max(3000,Number(pollMs)||4000));
 const limit=Math.min(150,Math.max(1,Number(maxPolls)||150));
 const duration=Math.min(600000,Math.max(1,Number(maxPollMs)||600000));
 function stopTimer(){if(timer!==null)clearTimer(timer);timer=null;}
 function emit(client={}){if(!dead)onState({...data,client:{loading:false,action:null,code:null,httpStatus:null,message:null,...client}});}
 function refreshViews(){if(dead)return;try{Promise.resolve(onRefresh()).catch(()=>{});}catch{/* Existing views show their own read errors. */}}
 function failure(error,action){
  if(dead)return;
  const messages={HTTP_404:'자료 보완 경로를 찾지 못했습니다. 서버 버전을 확인해 주세요.',HTTP_503:'자료 보완 서비스에 연결하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.',HTTP_401:'로그인이 필요합니다.',HTTP_403:'자료 보완 권한을 확인해 주세요.',HTTP_429:'요청 제한으로 상태 확인을 멈췄습니다.',INVALID_RESPONSE:'자료 보완 응답 형식을 확인할 수 없습니다.',IDENTITY_MISMATCH:'요청 종목과 자료 보완 응답의 기업 식별자가 다릅니다.',TIMEOUT:'자료 보완 응답 시간이 초과되었습니다.',NETWORK_ERROR:'자료 보완 상태 연결 오류 · 상태를 다시 확인해 주세요.'};
  const code=error.code||'NETWORK_ERROR',message=messages[code]||error.safeMessage||'자료 보완 요청에 실패했습니다. 상태를 다시 확인해 주세요.';
  stopTimer();data=error.packet?{...error.packet,canCollect:false}:{...data,canCollect:false,collection:{...data?.collection,state:'STATUS_ERROR',message}};
  emit({action,code,httpStatus:error.httpStatus||null,message});
 }
 function validPacket(value){
  if(!value||typeof value!=='object'||typeof value.canCollect!=='boolean'||typeof value.needs?.financial!=='boolean'||typeof value.needs?.business!=='boolean'||typeof value.collection?.state!=='string')throw Object.assign(Error(),{code:'INVALID_RESPONSE'});
  if(value.identity?.market&&value.identity.market!==market||value.identity?.ticker&&value.identity.ticker!==ticker)throw Object.assign(Error(),{code:'IDENTITY_MISMATCH'});
  return value;
 }
 async function request(method){
  let response;
  try{response=await fetchImpl(url,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(requestTimeoutMs)]),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});}
  catch(error){throw Object.assign(Error(),{code:error?.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR'});}
  let value;try{value=await response.json();}catch{throw Object.assign(Error(),{code:response.ok?'INVALID_RESPONSE':'HTTP_'+response.status,httpStatus:response.status});}
  if(!response.ok){let packet=null;try{packet=validPacket(value);}catch{}throw Object.assign(Error(),{code:'HTTP_'+response.status,httpStatus:response.status,safeMessage:text(value?.message),packet});}
  return validPacket(value);
 }
 function schedule(){
  stopTimer();if(dead||!running(data)&&!waiting(data)||pollLimited)return;
  if(pollStart===null)pollStart=now();
  if(waiting(data)&&busyRetries>=2){emit({code:'BUSY_RETRY_LIMIT',message:'다른 작업이 계속 진행 중이어서 자동 재요청을 마쳤습니다. 상태를 다시 확인할 수 있습니다.'});return;}
  if(polls>=limit||now()-pollStart>=duration){pollLimited=true;emit({code:'POLL_LIMIT',message:'자동 상태 확인을 마쳤습니다. 수집 작업의 중단을 뜻하지 않습니다. 상태를 다시 확인할 수 있습니다.'});return;}
  const retryAt=Date.parse(data?.collection?.retryAfter),wait=waiting(data)&&data.canCollect!==true&&Number.isFinite(retryAt)?Math.max(interval,retryAt-now()):interval;
  const delay=Math.min(wait,Math.max(1,duration-(now()-pollStart)));
  timer=setTimer(()=>{timer=null;if(dead)return;if(now()-pollStart>=duration){pollLimited=true;emit({code:'POLL_LIMIT',message:'자동 상태 확인 시간이 지났습니다. 상태를 다시 확인해 주세요.'});return;}polls++;void read({poll:true});},delay);
 }
 function apply(next,{posted=false}={}){
  if(dead)return;
  const previous=data;data=next;
  if((running(next)||waiting(next))&&pollStart===null){pollStart=now();polls=0;pollLimited=false;}
  emit();
  if(posted||running(previous)&&!running(next)&&phase(previous)!==phase(next))refreshViews();
  schedule();
 }
 function read({poll=false}={}){
  if(dead)return Promise.resolve(null);
  if(postFlight)return postFlight;
  if(readFlight)return readFlight;
  stopTimer();emit({loading:true,action:'status'});
  readFlight=(async()=>{try{const next=await request('GET');if(dead)return null;apply(next);return next;}catch(error){failure(error,'status');return null;}finally{readFlight=null;}})();
  if(poll)void readFlight.then(next=>{if(dead||next!==data||!waiting(next)||!canStart(next)||busyRetries>=2||pollLimited||now()-pollStart>=duration)return;busyRetries++;stopTimer();void collect();});
  return readFlight;
 }
 function collect(){
  if(dead)return Promise.resolve(null);
  if(postFlight)return postFlight;
  const pendingRead=readFlight;
  stopTimer();
  postFlight=Promise.resolve().then(async()=>{
   try{
    if(pendingRead)await pendingRead;
    if(dead)return null;
    // collect() before start() still validates the read-only server contract.
    if(!data){try{apply(await request('GET'));}catch(error){failure(error,'status');return null;}}
    if(dead||!canStart(data)){schedule();return data;}
    autoAttempted=true;stopTimer();emit({loading:true,action:'collect'});
    const next=await request('POST');if(dead)return null;apply(next,{posted:true});return next;
   }catch(error){failure(error,'collect');return null;}
  }).finally(()=>{postFlight=null;});
  return postFlight;
 }
 function start(){
  if(dead)return Promise.resolve(null);
  if(startFlight)return startFlight;
  startFlight=(async()=>{const result=await read();if(dead)return null;if(result&&!autoAttempted&&canStart(result)){autoAttempted=true;return collect();}return result;})();
  return startFlight;
 }
 function refresh(){
  if(dead)return Promise.resolve(null);
  if(postFlight)return postFlight;
  if(pollLimited){pollLimited=false;pollStart=now();polls=0;}
  return read();
 }
 return {start,collect,refresh,destroy(){dead=true;controller.abort();stopTimer();}};
}
