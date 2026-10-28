// Authenticated, memory-only coordinator. Dates and IDs come from the server.
// Re-rendering never changes asOf, creates another job, or cancels server work.
export function createReactionGapController({request,render,now=Date.now,schedule=setTimeout,unschedule=clearTimeout,limits={polls:20,durationMs:60000,intervalMs:2000},onAccessLost=()=>{}}){
 let generation=0,active=null,abort=null,timer=null,disposed=false,floorVersion=0,floorResultVersion=0,knownId=null;
 const stop=()=>{generation++;abort?.abort();abort=null;unschedule(timer);timer=null;};
 const output=(value,epoch)=>{if(!disposed&&epoch===generation)render(value);};
 const failure=(error,epoch)=>{
  if(epoch!==generation||disposed)return;
  const code=error?.code||'CONNECTION_FAILED',denied=error?.status===401||error?.status===403||error?.status===404;
  const state=code==='FEATURE_DISABLED'?'OFF':denied?'ACCESS_DENIED':code==='REQUEST_TIMEOUT'?'TIMEOUT':'ERROR';
  output({type:'status',state,reasonCodes:[code]},epoch);
  if(denied||state==='OFF'){active=null;knownId=null;floorVersion=0;floorResultVersion=0;if(denied)onAccessLost();}
 };
 async function begin(){
  if(disposed||!active)return;stop();const epoch=generation,started=now();abort=new AbortController();const signal=abort.signal;
  output({type:'status',state:'WAITING',reasonCodes:[]},epoch);
  const call=(path,body)=>request(path,{body,signal});
  let polls=0;
  async function read(id){
   if(disposed||epoch!==generation)return;
   if(polls>=limits.polls||now()-started>=limits.durationMs){output({type:'status',state:'TIMEOUT',reasonCodes:['POLL_LIMIT']},epoch);return;}
   polls++;
   try{
    const response=await call('/'+encodeURIComponent(id));if(disposed||epoch!==generation)return;
    if(response.id!==id||!Number.isSafeInteger(response.version)||response.responseVersion!=='reaction-gap-response-2')throw Object.assign(Error('Invalid response'),{code:'RESPONSE_INVALID'});
    if(['OFF','ACCESS_DENIED'].includes(response.state)){failure({code:response.state==='OFF'?'FEATURE_DISABLED':'SOURCE_ACCESS_DENIED',status:response.state==='ACCESS_DENIED'?403:undefined},epoch);return;}
    if(response.state==='CANCELLED'){output({type:'status',state:'CANCELLED',reasonCodes:response.reasonCodes||[]},epoch);return;}
    if(response.version<floorVersion){output({type:'status',state:'INVALIDATED',reasonCodes:['OLDER_VERSION']},epoch);return;}
    if(response.result&&(!Number.isSafeInteger(response.resultVersion)||response.resultVersion<1||response.resultVersion>response.version))throw Object.assign(Error('Invalid result version'),{code:'RESPONSE_INVALID'});
    if(response.result&&response.resultVersion<floorResultVersion){output({type:'status',state:'INVALIDATED',reasonCodes:['OLDER_VERSION']},epoch);return;}
    floorVersion=response.version;
    if(response.result)floorResultVersion=Math.max(floorResultVersion,response.resultVersion);
    // A corrected prior snapshot can be invalid while its replacement is still
    // queued. Poll that explicit newer work only; never resurrect the old value.
    const replacement=response.state==='INVALIDATED'&&response.result===null&&Number.isSafeInteger(response.resultVersion)&&response.resultVersion<response.version&&['QUEUED','RUNNING'].includes(response.workState);
    const running=['QUEUED','RUNNING'].includes(response.state)||replacement;
    if(response.result&&response.state!=='INVALIDATED')output({type:'result',response},epoch);
    else output({type:'status',state:replacement?'RUNNING':response.state==='QUEUED'?'WAITING':response.state,reasonCodes:response.reasonCodes?.length?response.reasonCodes:[response.errorCode||'RESULT_NOT_READY']},epoch);
    if(running)timer=schedule(()=>{timer=null;void read(id);},limits.intervalMs);
   }catch(error){failure(error,epoch);}
  }
  try{
   const config=await call('/config?'+new URLSearchParams({sourceJobId:active.id,sourceVersion:String(active.version)}));
   if(disposed||epoch!==generation)return;
   if(!config.enabled){active=null;knownId=null;floorVersion=0;floorResultVersion=0;output({type:'status',state:'OFF',reasonCodes:['FEATURE_DISABLED']},epoch);return;}
   if(config.source?.id!==active.id||config.source?.version!==active.version)throw Object.assign(Error('Invalid source'),{code:'SOURCE_VERSION_CONFLICT'});
   if(config.linked?.id){knownId=config.linked.id;if(Number.isSafeInteger(config.linked.version))floorVersion=Math.max(floorVersion,config.linked.version);await read(knownId);return;}
   // Once linked, a missing result is never reinterpreted as permission to POST.
   if(knownId){await read(knownId);return;}
   if(!config.creation?.allowed){output({type:'status',state:'HELD',reasonCodes:config.creation?.reasonCodes||['CREATION_NOT_ALLOWED']},epoch);return;}
   const descriptor=config.creation.request;
   if(descriptor?.sourceJobId!==active.id||descriptor?.sourceVersion!==active.version||!descriptor.asOf||!descriptor.window)throw Object.assign(Error('Invalid descriptor'),{code:'RESPONSE_INVALID'});
   const made=await call('',descriptor);if(disposed||epoch!==generation)return;
   if(typeof made.id!=='string'||!Number.isSafeInteger(made.version))throw Object.assign(Error('Invalid job'),{code:'RESPONSE_INVALID'});
   knownId=made.id;floorVersion=Math.max(floorVersion,made.version);await read(knownId);
  }catch(error){failure(error,epoch);}
 }
 return {
  update(source){
   if(disposed)return;
   const ready=source&&['COMPLETE','PARTIAL'].includes(source.status)&&source.result&&!['invalidated','cancelled','unavailable'].includes(source.result.inline?.status);
   if(!ready){stop();active=null;knownId=null;floorVersion=0;floorResultVersion=0;render({type:'hidden'});return;}
   const next={id:source.id,version:source.version};if(active?.id===next.id&&active?.version===next.version)return;
   stop();active=next;knownId=null;floorVersion=0;floorResultVersion=0;void begin();
  },
  revalidate(){if(active&&!disposed)void begin();},
  pause(){stop();if(!disposed)render({type:'hidden'});},
  clear(state=null){stop();active=null;knownId=null;floorVersion=0;floorResultVersion=0;if(!disposed)render(state?{type:'status',state,reasonCodes:[]}: {type:'hidden'});},
  dispose(){stop();disposed=true;active=null;knownId=null;floorVersion=0;floorResultVersion=0;render({type:'hidden'});},
 };
}

export async function gapRequest(path,{body,signal,timeoutMs=8000}={}){
 const pending=new AbortController(),stop=()=>pending.abort(signal?.reason);signal?.addEventListener('abort',stop,{once:true});
 if(signal?.aborted)stop();let expired=false;
 const timer=setTimeout(()=>{expired=true;pending.abort();},timeoutMs);
 try{
  const response=await fetch('/api/reaction-gap'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:body?{'Content-Type':'application/json'}:{},credentials:'same-origin',cache:'no-store',signal:pending.signal});
  let value;try{value=await response.json();}catch{throw Object.assign(Error('Invalid response'),{code:'RESPONSE_INVALID',status:response.status});}
  if(!response.ok)throw Object.assign(Error('Reaction gap request failed'),{code:value.code||'CONNECTION_FAILED',status:response.status});
  return value;
 }catch(error){if(expired)throw Object.assign(Error('Request timed out'),{code:'REQUEST_TIMEOUT'});throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
