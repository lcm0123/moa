import {reserveSecRequest,secDenied} from './catalyst-sec-access.mjs';
import {controlledContext,controlledBudget,controlledDocumentBudget,controlledEvent,controlledTransport} from './catalyst-controlled-context.mjs';
import {providerContract} from './catalyst-provider-contracts.mjs';
import {consumeCanaryPermit} from './catalyst-canary-permit.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import policy from '../config/catalyst-security.json' with {type:'json'};
import {SourceSecurityLedger,sourceIdentity} from './catalyst-security-ledger.mjs';
export {policy};
export function writeSanitizerInput(target,data){
 return new Promise((resolve,reject)=>{
  if(target.destroyed||target.writableEnded)return reject(Error('STATIC_PARSER_INPUT_CLOSED'));
  const closed=()=>{cleanup();reject(Error('STATIC_PARSER_INPUT_CLOSED'));};
  const cleanup=()=>{target.off('close',closed);target.off('error',closed);};
  target.once('close',closed);target.once('error',closed);
  target.write(data,error=>{cleanup();error?reject(Error('STATIC_PARSER_INPUT_CLOSED')):resolve();});
 });
}
export function publicAddress(ip){
 const p=ip.split('.').map(Number);
 return isIP(ip)===4&&!([0,10,127].includes(p[0])||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&[0,168].includes(p[1])||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&[18,19].includes(p[1]));
}
export async function checkedAddress(url,resolver=lookup){
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname.includes(':')||u.username||u.password||u.port&&u.port!=='443'||isIP(u.hostname)&&!publicAddress(u.hostname))throw Error('SSRF_BLOCKED');
 const addresses=await resolver(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('SSRF_BLOCKED');return addresses[0];
}
export function detectType(first,mime,{allowArchive=false,url=null}={}){
 const type=mime.split(';')[0].trim().toLowerCase(),text=first.toString('utf8').trimStart();
 if(first.subarray(0,2).toString()==='MZ'||first.subarray(0,4).equals(Buffer.from([127,69,76,70]))||first.subarray(0,2).toString()==='#!')throw Error('MIME_MISMATCH_EXECUTABLE');
 if(first.subarray(0,2).toString()==='PK'){
  if(allowArchive&&providerContract(url)==='DART_OFFICIAL_ARCHIVE'&&['application/zip','application/octet-stream','application/x-msdownload'].includes(type)&&first.subarray(0,4).equals(Buffer.from([80,75,3,4])))return 'ZIP';throw Error('MIME_MISMATCH_ARCHIVE');
 }
 if(first.subarray(0,5).toString()==='%PDF-'){if(type!=='application/pdf')throw Error('MIME_MISMATCH');return 'PDF';}
 if(['text/markdown','text/plain'].includes(type)&&url&&providerContract(url)==='MARKDOWN_PLAINTEXT'&&!first.includes(0))return 'MARKDOWN';
 if(!policy.allowedMimeTypes.includes(type)||type==='application/pdf'||first.includes(0))throw Error('MIME_MISMATCH');
 if(type==='application/json'&&!/^[\[{]/.test(text))throw Error('MIME_MISMATCH');
 return /xml/.test(type)?'XML':type==='application/json'?'JSON':type==='text/plain'?'TEXT':'HTML';
}
async function request(url,address,env){if(/(^|\.)sec.gov$/.test(new URL(url).hostname))await reserveSecRequest(env);return new Promise((resolve,reject)=>{
 const u=new URL(url),req=https.get(u,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':/(^|\.)sec.gov$/.test(u.hostname)?env.SEC_USER_AGENT||'MOA research':'MOA research static reader',Accept:'text/html,application/xml,application/pdf,application/json,text/plain,application/zip','Accept-Encoding':'identity'},lookup:(_host,o,cb)=>o?.all?cb(null,[address]):cb(null,address.address,4)},resolve);
 req.on('error',()=>reject(Error('DOCUMENT_CONNECTION_FAILED')));
});}
export async function safeResponse(url,env,ledger,{resolver=lookup,transport=request,allowArchive=false,ownPending=false,observe=null}={}){
 const chain=[];
 for(let n=0;n<=policy.maxRedirects;n++){
  const validateStart=performance.now();ledger.assertAllowed(url,null,ownPending&&n===0);const address=await checkedAddress(url,resolver);const validationMs=performance.now()-validateStart,fetchStart=performance.now();
  if(transport===request){controlledDocumentBudget();controlledBudget(allowArchive||/(^|\.)sec.gov$/.test(new URL(url).hostname)||/\.pdf(?:$|\?)/i.test(url)?'Official':'Company');}
  const response=await controlledTransport(()=>transport(url,address,env));const observation={domain:new URL(url).hostname,urlHash:sourceIdentity(url).normalized_url_hash,status:response.statusCode,mime:response.headers['content-type']||null,validationMs,fetchHeadersMs:performance.now()-fetchStart};observe?.(observation);controlledEvent({action:'secure_response',...observation});chain.push(url);
  if(response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.destroy();url=new URL(response.headers.location,url).href;continue;}
  if(response.statusCode!==200){response.destroy();if(/(^|\.)sec.gov$/.test(new URL(url).hostname)&&[403,429].includes(response.statusCode)){secDenied(env,response.headers['retry-after']);throw Error('SEC_ACCESS_UNAVAILABLE');}const error=Error('HTTP_'+response.statusCode);error.status=response.statusCode;error.retryAfter=String(response.headers['retry-after']||'').slice(0,100);throw error;}
  if(allowArchive&&providerContract(url)!=='DART_OFFICIAL_ARCHIVE'){response.destroy();throw Error('ARCHIVE_PROVIDER_BLOCKED');}
  return {response,url,chain};
 }throw Error('REDIRECT_LIMIT');
}
export function documentCacheFresh(metadata,now=Date.now()){
 // An OpenDART HTTP-200 XML error is not a filing archive. A brief negative
 // cache prevents a maintenance response from pinning a company for 24 hours.
 // URL/hash blocks and missing-file checks still run before this decision.
 const ttl=metadata.providerContract==='DART_OFFICIAL_ARCHIVE'&&metadata.detected_type==='XML'?300000:policy.safeCacheHours*3600000;
 return metadata.securityVersion===policy.version&&!!metadata.content_sha256&&now-Date.parse(metadata.fetch_time)>=0&&now-Date.parse(metadata.fetch_time)<ttl;
}
async function sanitizeStream(response,file,mime,ledger,url,{env,archive=false}){
 const raw=createHash('sha256'),sanitized=createHash('sha256');let bytes=0,child=null,out=null,done=null,pipeDone=null,timer=null,stderr='',type=null,decoder=null,header=Buffer.alloc(0),flags=[],parserPeakRssMB=null,parserActiveMs=null,securityValidationMs=0;const streamStart=performance.now();
 const open=async()=>{
  const sniffStart=performance.now();type=detectType(header,mime,{allowArchive:archive,url});securityValidationMs+=performance.now()-sniffStart;
  controlledEvent({action:'sanitize_start',type});
  if(bytes>(type==='PDF'?policy.maxPdfBytes:type==='ZIP'?policy.maxArchiveBytes:policy.maxHtmlBytes))throw Error('DOCUMENT_SIZE_LIMIT');
  out=fs.createWriteStream(file,{flags:'wx',mode:0o600});
  if(type==='PDF'||type==='ZIP'){done=new Promise((r,j)=>{out.once('finish',r);out.once('error',j);});done.catch(()=>{});}
  else {
   const charset=/charset\s*=\s*["']?([a-z\d_-]+)/i.exec(mime)?.[1]||/charset\s*=\s*["']?([a-z\d_-]+)/i.exec(header.toString('latin1'))?.[1]||'utf-8';decoder=new TextDecoder(charset,{fatal:true});
   child=spawn(env.MOA_PYTHON||'python',['-X','utf8','scripts/catalyst_safe_parse.py',...(type==='MARKDOWN'?['--markdown']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.on('error',()=>{});
   child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b.toString();});
   child.stdout.on('data',b=>sanitized.update(b));pipeDone=pipeline(child.stdout,out);pipeDone.catch(()=>{});
   done=new Promise((r,j)=>{child.once('error',()=>j(Error('STATIC_PARSER_UNAVAILABLE')));child.once('close',code=>code?j(Error('STATIC_PARSE_FAILED')):r());});done.catch(()=>{});
   timer=setTimeout(()=>child.kill(),policy.parserTimeoutMs);
  }
 };
 const write=async chunk=>{const target=child?child.stdin:out;let data=decoder?decoder.decode(chunk,{stream:true}):chunk;
  if(type==='TEXT'||type==='JSON')data=data.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  // The parser can exit while its stdin is backpressured. Waiting only for
  // drain then hangs forever, even after the parser timeout has killed it.
  await writeSanitizerInput(target,data);};
 try {
  for await(const chunk of response){raw.update(chunk);bytes+=chunk.length;
   if(bytes>(archive?policy.maxArchiveBytes:type==='PDF'?policy.maxPdfBytes:policy.maxHtmlBytes))throw Error('DOCUMENT_SIZE_LIMIT');
   if(!type){header=Buffer.concat([header,chunk]);if(header.length<1024)continue;await open();await write(header);header=null;}
   else await write(chunk);
  }
  if(!type){if(!header.length)throw Error('EMPTY_DOCUMENT');await open();await write(header);header=null;}
  (child?child.stdin:out).end(decoder?.decode()||undefined);await done;if(pipeDone)await pipeDone;
  if(stderr){try{const diagnostics=JSON.parse(stderr.trim());flags=diagnostics.flags||[];parserPeakRssMB=diagnostics.peakRssMB||null;parserActiveMs=diagnostics.parseActiveMs??null;}catch{}}
  const content_sha256=raw.digest('hex');try{ledger.assertAllowed(url,content_sha256,true);}catch(error){error.contentHash=content_sha256;throw error;}
  return {content_sha256,sanitized_hash:child?sanitized.digest('hex'):null,bytes,detected_type:type,flags,parserPeakRssMB,timing:{streamAndSanitizeMs:performance.now()-streamStart,parserActiveMs,securityValidationMs}};
 }finally{clearTimeout(timer);child?.kill();out?.destroy();if(pipeDone)await pipeDone.catch(()=>{});if(child)await done?.catch(()=>{});}
}
export async function secureDocument(url,env={},options={}){
 if(env.CATALYST_ENABLED==='false'||env.CATALYST_RESEARCH_WORKER_ENABLED==='false'){if(!(env.CATALYST_ENABLED==='true'&&controlledContext()?.active)&&!consumeCanaryPermit(options.canaryPermit,url))throw Error('RESEARCH_DISABLED');}
 const ledger=new SourceSecurityLedger(env.CATALYST_SECURITY_ROOT);let file=null,finalUrl=url,result=null,ownAttempt=false;
 try {
  ledger.assertAllowed(url);const cached=ledger.get(url);
  if(['SANITIZED','NORMAL'].includes(cached?.security_status)&&cached.local_path){const m=JSON.parse(cached.metadata);if(documentCacheFresh(m)){controlledEvent({action:'document_cache_hit',urlHash:sourceIdentity(url).normalized_url_hash});return {...m,file:cached.local_path,cached:true};}}
  ledger.db.exec('BEGIN IMMEDIATE');try{ledger.assertAllowed(url);ledger.record(url,'QUARANTINED','RETRIEVAL_PENDING',{local_path:null});ledger.db.exec('COMMIT');ownAttempt=true;}catch(e){ledger.db.exec('ROLLBACK');throw e;}
  const fetched=await safeResponse(url,env,ledger,{...options,ownPending:true});finalUrl=fetched.url;
  const mime=fetched.response.headers['content-type']||'',raw=/application\/(pdf|zip|octet-stream)/i.test(mime)||options.allowArchive&&providerContract(finalUrl)==='DART_OFFICIAL_ARCHIVE';
  const directory=path.resolve(env.CATALYST_CONTENT_ROOT||'.sites-runtime',raw?'quarantine':'research-sanitized');await fsp.mkdir(directory,{recursive:true,mode:0o700});await fsp.chmod(directory,0o700);
  file=path.join(directory,randomUUID()+(raw?'.raw':'.safe'));
  ledger.record(url,'QUARANTINED','FETCH_IN_PROGRESS',{local_path:file});
  result=await sanitizeStream(fetched.response,file,mime,ledger,finalUrl,{env,archive:!!options.allowArchive});
  ledger.assertAllowed(url,result.content_sha256,true);
  if(!fs.existsSync(file))throw Object.assign(Error('FILE_DISAPPEARED_AFTER_WRITE'),{code:'ENOENT'});
  const meta={...result,securityVersion:policy.version,file,url:sourceIdentity(finalUrl).source_url,pdf:result.detected_type==='PDF',mime_type:mime,providerContract:providerContract(finalUrl),trust:'UNTRUSTED_SOURCE',fetch_time:new Date().toISOString(),redirectChain:fetched.chain.map(u=>sourceIdentity(u).source_url),raw_quarantine_path:raw?file:null,provider:options.provider||'research'};
  ledger.record(url,raw?'NORMAL':'SANITIZED',raw?'PRIVATE_RAW_PENDING_PARSE':'STATIC_SANITIZED',{...meta,local_path:file});
  ledger.event(url,{provider:meta.provider,detected_type:result.detected_type,bytes:result.bytes,security_flags:result.flags,action:raw?'QUARANTINED':'SANITIZED'});
  controlledEvent({action:'document_complete',provider:meta.provider,type:result.detected_type,bytes:result.bytes,pythonPeakMB:result.parserPeakRssMB,latencyMs:result.timing.streamAndSanitizeMs});
  return meta;
 }catch(error){
  if(file)await fsp.unlink(file).catch(()=>{});
  const missing=error.code==='ENOENT'||error.message==='FILE_DISAPPEARED_AFTER_WRITE';
  const reason=missing?'FILE_MISSING_REVIEW_REQUIRED':/^[A-Z_0-9]+$/.test(error.message)?error.message:'FETCH_FAILED';
  // Fail closed after a failed persisted attempt; no automatic recovery loop.
  if((file||/MIME|SSRF|BLOCKED/.test(reason))&&!['MALWARE_REMOVED_BY_OS','SECURITY_BLOCKED','DO_NOT_REFETCH',...(!ownAttempt?['QUARANTINED']:[])].includes(ledger.get(url)?.security_status))ledger.record(url,missing?'DO_NOT_REFETCH':/MIME|SSRF/.test(reason)?'SECURITY_BLOCKED':'DO_NOT_REFETCH',reason,{...(result||{}),...(error.contentHash?{content_sha256:error.contentHash}:{}),removal_attribution:missing?'UNCONFIRMED_FILE_DISAPPEARED':null});
  if(!file&&ledger.get(url)?.reason==='RETRIEVAL_PENDING'&&!/MIME|SSRF|BLOCKED/.test(reason))ledger.record(url,'NORMAL',reason,{local_path:null});
  ledger.event(url,{security_flags:[reason],action:'BLOCKED'});controlledEvent({action:'document_blocked',code:reason,urlHash:sourceIdentity(url).normalized_url_hash});throw Error(missing?'SECURITY_BLOCKED_SOURCE':reason);
 }finally{ledger.close();}
}
