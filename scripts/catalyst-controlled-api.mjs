import https from 'node:https';
import {createHash} from 'node:crypto';
import {safeResponse,checkedAddress} from './catalyst-secure-content.mjs';
import {SourceSecurityLedger,sourceIdentity} from './catalyst-security-ledger.mjs';
import {controlledContext,controlledBudget,controlledEvent} from './catalyst-controlled-context.mjs';
import {reserveSecRequest} from './catalyst-sec-access.mjs';
import {validChatRequest,validChatTokenRequest} from '../server/catalyst/chat-contract.mjs';

// Exact structured API contracts. These envelopes discover sources or plan work;
// none can be used as document evidence. Article/filing bodies use secureDocument.
export function apiContract(url,options={}){
 const u=new URL(url),method=(options.method||'GET').toUpperCase();
 if(u.username||u.password)throw Error('CONTROLLED_API_CONTRACT_DENIED');
 if(method==='POST'&&['https://api.exa.ai','https://api.tavily.com'].includes(u.origin)){
  const b=JSON.parse(options.body||'{}');
  if(u.origin==='https://api.exa.ai'&&u.pathname==='/search'&&typeof b.query==='string'&&b.type==='auto'&&b.numResults<=8&&!b.contents?.text&&!b.contents?.summary)return {provider:'Exa',type:'JSON'};
  if(u.origin==='https://api.tavily.com'&&u.pathname==='/search'&&typeof b.query==='string'&&b.search_depth==='basic'&&b.max_results<=8&&b.include_answer===false&&b.include_raw_content===false)return {provider:'TavilySearch',type:'JSON'};
  if(u.origin==='https://api.tavily.com'&&u.pathname==='/extract'&&Array.isArray(b.urls)&&b.urls.length>=1&&b.urls.length<=5&&b.format==='text'&&b.extract_depth==='basic')return {provider:'TavilyExtract',type:'JSON',extractURLs:b.urls};
  throw Error('CONTROLLED_API_CONTRACT_DENIED');
 }
 if(u.origin==='https://api.search.brave.com'&&u.pathname==='/res/v1/web/search'&&method==='GET')return {provider:'Brave',type:'JSON'};
 if(u.origin==='https://news.google.com'&&u.pathname==='/rss/search'&&method==='GET')return {provider:'GoogleNews',type:'RSS'};
 if(u.origin==='https://naverapihub.apigw.ntruss.com'&&u.pathname==='/search/v1/news'&&method==='GET'&&[...u.searchParams.keys()].every(k=>['query','display','start','sort','format'].includes(k))&&[...u.searchParams.keys()].length===new Set(u.searchParams.keys()).size&&u.searchParams.get('query')?.length<=80&&u.searchParams.get('query')?.trim()&&Number.isInteger(Number(u.searchParams.get('display')))&&Number(u.searchParams.get('display'))>=1&&Number(u.searchParams.get('display'))<=24&&u.searchParams.get('start')==='1'&&u.searchParams.get('sort')==='date'&&u.searchParams.get('format')==='json')return {provider:'NaverNews',type:'JSON'};
 if(method==='GET'&&['https://www.cnbc.com/id/10001147/device/rss/rss.html','https://feeds.bbci.co.uk/news/business/rss.xml'].includes(u.href))return {provider:'PublisherNews',type:'RSS'};
 if(u.origin==='https://opendart.fss.or.kr'&&['/api/list.json','/api/company.json'].includes(u.pathname)&&method==='GET')return {provider:'DART',type:'JSON'};
 if(u.origin==='https://data.sec.gov'&&/^\/submissions\/CIK\d{10}(?:-submissions-\d{3})?\.json$/.test(u.pathname)&&!u.search&&method==='GET')return {provider:'SEC',type:'JSON'};
 if(u.origin==='https://www.sec.gov'&&/^\/Archives\/edgar\/data\/\d+\/\d+\/FilingSummary\.xml$/.test(u.pathname)&&!u.search&&method==='GET')return {provider:'SEC',type:'FILING_INDEX'};
 if(u.origin==='https://elite.finviz.com'&&u.pathname==='/export/latest-filings'&&method==='GET')return {provider:'Market',type:'CSV'};
 if(u.origin==='https://www.nasdaqtrader.com'&&['/dynamic/SymDir/nasdaqlisted.txt','/dynamic/SymDir/otherlisted.txt'].includes(u.pathname)&&method==='GET'&&!u.search)return {provider:'Listing',type:'DIRECTORY'};
 if(u.origin==='https://api.openai.com'&&u.pathname==='/v1/responses/input_tokens'&&method==='POST'){
  if(!validChatTokenRequest(JSON.parse(options.body||'{}')))throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
  return {provider:'TokenCount',type:'JSON'};
 }
 if(u.origin==='https://api.openai.com'&&u.pathname==='/v1/responses'&&method==='POST'){
  const body=JSON.parse(options.body||'{}'),name=body.text?.format?.name;
  if(['news_event','news_candidates','news_audit','news_briefs','news_briefs_audit','idea_interpretation'].includes(name)){
   if(body.tools?.length||body.tool_choice||body.store!==false||body.max_output_tokens>5500||typeof body.input!=='string'||body.input.length>65000||body.text.format.strict!==true||body.text.format.type!=='json_schema')throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
   if(name.startsWith('news_briefs')&&(body.max_output_tokens>2200||body.input.length>18000))throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
   if(name==='idea_interpretation'&&(body.max_output_tokens>1400||body.input.length>18000))throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
   return {provider:'NewsAI',type:'JSON'};
  }
  if(['free_research_answer','thesis_review_answer'].includes(name)){
   if(!validChatRequest(body))throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
   return {provider:'Review',type:'JSON'};
  }
  if(body.tools?.length||body.tool_choice||!['research_planner','research_review','beneficiary_plan','beneficiary_extract'].includes(name))throw Error('CONTROLLED_AI_TOOL_FORBIDDEN');
  return {provider:['research_planner','beneficiary_plan'].includes(name)?'Planner':'Review',type:'JSON'};
 }
 throw Error('CONTROLLED_API_CONTRACT_DENIED');
}
export function dartRedirectAllowed(initial,target,hop){
 const a=new URL(initial),b=new URL(target);
 // No credential forwarding to another host, login page, or arbitrary document.
 return hop<=2&&a.origin==='https://opendart.fss.or.kr'&&['/api/list.json','/api/company.json'].includes(a.pathname)&&
  b.origin===a.origin&&!b.username&&!b.password&&b.pathname===a.pathname&&
  [...a.searchParams].every(([k,v])=>b.searchParams.get(k)===v)&&[...b.searchParams.keys()].every(k=>a.searchParams.has(k));
}
export async function validateExtractURL(url,env){const ledger=new SourceSecurityLedger(env.CATALYST_SECURITY_ROOT);try{ledger.assertAllowed(url);await checkedAddress(url);}finally{ledger.close();}}
export async function secureStructuredApi(url,options,env){
 const contract=apiContract(url,options),ledger=new SourceSecurityLedger(env.CATALYST_SECURITY_ROOT),start=performance.now();let status=null,requested=false,hop=0;
 try{
  for(const candidate of contract.extractURLs||[])await validateExtractURL(candidate,env);
  if(contract.provider.startsWith('Tavily')){const state=controlledContext(),soft=Number(env.TAVILY_CREDIT_SOFT_LIMIT);if(soft>0&&state&&(state.counts.TavilySearch||0)+(state.counts.TavilyExtract||0)>=Math.floor(soft))throw Error('TAVILY_SOFT_LIMIT');}
  ledger.assertAllowed(url);controlledBudget(contract.provider);
  const transport=async(target,address)=>{
   if(hop&&!(contract.provider==='DART'&&dartRedirectAllowed(String(url),target,hop))){controlledEvent({action:'api_redirect_blocked',provider:contract.provider,targetHost:new URL(target).hostname,targetPath:new URL(target).pathname,hop});throw Error('API_REDIRECT_BLOCKED');}
   if(hop)controlledEvent({action:'api_redirect_allowed',provider:contract.provider,targetHost:new URL(target).hostname,hop});
   hop++;
   if(contract.provider==='SEC')await reserveSecRequest(env);
   requested=true;
   return new Promise((resolve,reject)=>{
    const timeoutSignal=AbortSignal.timeout(Math.max(1000,Math.min(90000,Number(options.timeoutMs)||90000))),signal=options.signal?AbortSignal.any([options.signal,timeoutSignal]):timeoutSignal;
    const req=https.request(target,{method:options.method||'GET',headers:{'User-Agent':'MOA research/1.0',Accept:contract.type==='JSON'?'application/json':'text/plain',...Object.fromEntries(new Headers(options.headers||{})),'Accept-Encoding':'identity'},signal,lookup:(_h,o,cb)=>o?.all?cb(null,[address]):cb(null,address.address,4)},resolve);
    req.on('error',error=>{
     // Keep only a bounded transport code, never request headers, keys or URLs.
     const networkCode=/^[A-Z][A-Z_0-9]{1,60}$/.test(error.code||'')?error.code:'UNKNOWN';
     controlledEvent({provider:contract.provider,action:'api_connection_failed',networkCode});
     reject(Error(['EACCES','EPERM'].includes(networkCode)?'STRUCTURED_API_NETWORK_DENIED':'STRUCTURED_API_CONNECTION_FAILED'));
    });req.end(options.body||undefined);
   });
  };
  const {response}=await safeResponse(String(url),env,ledger,{transport,observe:o=>{status=o.status;}});
  const mime=String(response.headers['content-type']||'');
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw Error('API_ENCODING_REJECTED');}
  if(!(contract.type==='JSON'?/application\/json/i:['RSS','FILING_INDEX'].includes(contract.type)?/(?:xml|rss)/i:/(?:csv|plain|octet-stream)/i).test(mime)){response.destroy();throw Error('API_MIME_MISMATCH');}
  let size=0;const chunks=[];for await(const chunk of response){size+=chunk.length;if(size>2_000_000){response.destroy();throw Error('API_SIZE_LIMIT');}chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),hash=createHash('sha256').update(bytes).digest('hex');ledger.assertAllowed(url,hash);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(contract.type==='JSON'){const data=JSON.parse(text);if(contract.provider==='DART'&&(!data||!/^\d{3}$/.test(data.status)||typeof data.message!=='string'))throw Error('DART_API_ENVELOPE_INVALID');}
  if(contract.type==='RSS'&&(!/<rss[\s>]/i.test(text)||/<!DOCTYPE|<!ENTITY|<script[\s>]/i.test(text)))throw Error('API_SIGNATURE_MISMATCH');
  if(contract.type==='FILING_INDEX'&&(!/<FilingSummary[\s>]/.test(text)||/<!DOCTYPE|<!ENTITY|<script[\s>]/i.test(text)))throw Error('API_SIGNATURE_MISMATCH');
  if(contract.type==='CSV'&&(!text.includes('Filing Date')||/^\s*</.test(text)))throw Error('API_SIGNATURE_MISMATCH');
  if(contract.type==='DIRECTORY'&&(!/^Symbol\||^ACT Symbol\|/.test(text)||!text.includes('Security Name|')||!text.includes('File Creation Time:')||/<script|<!DOCTYPE|<!ENTITY/i.test(text)))throw Error('API_SIGNATURE_MISMATCH');
  ledger.event(url,{provider:contract.provider,detected_type:contract.type,bytes:size,security_flags:['DISCOVERY_OR_CONTROL_ONLY','NOT_DOCUMENT_EVIDENCE'],action:'STRUCTURED_API_VALIDATED'});
  controlledEvent({provider:contract.provider,action:'api_complete',requested,status,bytes:size,latencyMs:performance.now()-start,urlHash:sourceIdentity(url).normalized_url_hash});
  return new Response(bytes,{status:status||200,headers:{'Content-Type':mime}});
 }catch(e){controlledEvent({provider:contract.provider,action:'api_failed',requested,status,code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'API_FAILED',latencyMs:performance.now()-start});throw e;}
 finally{ledger.close();}
}
export function installControlledFetch(env){
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(!controlledContext()?.active)throw Error('CONTROLLED_CONTEXT_REQUIRED');
  return secureStructuredApi(String(url),options,env);
 };
 return ()=>{globalThis.fetch=previous;};
}
