import {catalystAdmin} from './catalyst-api.mjs';
import {readerSession} from './research-events.mjs';
import {enqueueGap,refreshGap,getGap,getGapHistory} from './reaction-gap/service.mjs';
import {cancelGap,gate,setGapEnabled} from './reaction-gap/store.mjs';
import {gapSourceLink} from './reaction-gap/link.mjs';

export async function reactionGapApi(request,env){
 const url=new URL(request.url),path=url.pathname.slice('/api/reaction-gap'.length),session=await readerSession(request);
 const send=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...session.headers}});
 if(!await catalystAdmin(request,env))return send({code:'ACCESS_REQUIRED'},403);
 if(env.REACTION_GAP_ENABLED!=='true')return send({code:'FEATURE_DISABLED'},503);
 if(!env.DB)return send({code:'DATABASE_REQUIRED'},503);
 const options={sourceAllowed:env.CATALYST_SOURCE_ALLOWED||(()=>false),now:env.REACTION_GAP_CLOCK?.()??Date.now()};
 try{
  if(path==='/config'&&request.method==='GET'){
   const enabled=(await gate(env.DB)).enabled,base={enabled,stage:3,publicEnabled:false};
   const sourceId=url.searchParams.get('sourceJobId'),version=url.searchParams.get('sourceVersion');
   if(!enabled||sourceId===null&&version===null)return send(base);
   if(!sourceId||!/^\d{1,9}$/.test(version||''))throw Error('INVALID_SOURCE_REFERENCE');
   return send({...base,...await gapSourceLink(env.DB,session.hash,sourceId,Number(version),{...options,runtimeReady:typeof env.REACTION_GAP_RUNTIME?.kick==='function'})});
  }
  const match=path.match(/^\/([a-f0-9-]{36})(\/history)?$/),id=match?.[1];
  if(path&&path!=='/control'&&!match)return send({code:'NOT_FOUND'},404);
  if(request.method==='GET'){
   if(!id)return send({code:'NOT_FOUND'},404);
   if(!(await gate(env.DB)).enabled)throw Error('FEATURE_DISABLED');
   if(match[2])return send(await getGapHistory(env.DB,session.hash,id,options));
   const raw=url.searchParams.get('version'),version=raw===null?null:/^[1-9]\d{0,8}$/.test(raw)?Number(raw):NaN;if(Number.isNaN(version))throw Error('INVALID_VERSION');
   return send(await getGap(env.DB,session.hash,id,{...options,version}));
  }
  if(request.method!=='POST')return send({code:'METHOD_NOT_ALLOWED'},405);
  if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return send({code:'ORIGIN_REQUIRED'},403);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>4000)return send({code:'REQUEST_TOO_LARGE'},413);
  let body;try{body=JSON.parse(raw);}catch{throw Error('INVALID_REQUEST');}
  if(path==='/control'){
   // A local reader cookie permits owned development work, never global stop.
   if(!await catalystAdmin(request,{...env,LOCAL_PREVIEW:false}))return send({code:'ADMIN_REQUIRED'},403);
   if(body?.action!=='disable'||Object.keys(body).length!==1)throw Error('INVALID_ACTION');
   if(env.REACTION_GAP_RUNTIME?.disable)await env.REACTION_GAP_RUNTIME.disable();else await setGapEnabled(env.DB,false,options);
   return send({enabled:false});
  }
  if(match?.[2])return send({code:'METHOD_NOT_ALLOWED'},405);
  if(id&&body?.action==='cancel'){
   if(Object.keys(body).some(k=>k!=='action'))throw Error('INVALID_REQUEST');
   const row=await cancelGap(env.DB,session.hash,id,options);await env.REACTION_GAP_RUNTIME?.cancel?.(id);return send({id:row.id,state:row.state});
  }
  if(!env.REACTION_GAP_RUNTIME?.kick)throw Error('WORKER_REQUIRED');
  let made;
  if(id){if(body?.action!=='refresh'||!Number.isSafeInteger(body.expectedVersion)||Object.keys(body).some(k=>!['action','expectedVersion','request'].includes(k)))throw Error('INVALID_REQUEST');made={row:await refreshGap(env.DB,session.hash,id,body.expectedVersion,body.request,options),shared:false};}
  else made=await enqueueGap(env.DB,session.hash,body,options);
  // Persisted QUEUED survives a busy shared worker; GET never kicks a worker.
  void env.REACTION_GAP_RUNTIME.kick().catch(()=>{});
  return send({id:made.row.id,version:made.row.version,state:made.row.state,shared:made.shared},202);
 }catch(e){
  const known=/^[A-Z0-9_]{1,80}$/.test(e.message||'')?e.message:'INTERNAL_ERROR';
  return send({code:known},known==='NOT_FOUND'?404:known==='SOURCE_ACCESS_DENIED'?403:known==='FEATURE_DISABLED'||known==='WORKER_REQUIRED'?503:known.endsWith('CONFLICT')?409:known==='INTERNAL_ERROR'?500:400);
 }
}
