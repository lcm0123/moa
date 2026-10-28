import {BraveResearchSearch,searchRequest} from './research-search.mjs';

export const EXA_SEARCH_ENDPOINT='https://api.exa.ai/search';
export const TAVILY_SEARCH_ENDPOINT='https://api.tavily.com/search';
export const TAVILY_EXTRACT_ENDPOINT='https://api.tavily.com/extract';
const text=(v,n=500)=>String(v||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
export function canonicalSearchURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href;}catch{return null;}
}
export function normalizeSearchItems(raw,{provider,purpose,query,maxResults=8,domainHints=[]}){
 if(!Array.isArray(raw))throw Error('PROVIDER_INVALID_RESPONSE');
 return dedupSearchItems(raw.map(x=>{const url=canonicalSearchURL(x.url);if(!url)return null;const domain=new URL(url).hostname;return {
  provider,purpose,query:text(query,400),title:text(x.title,250),url,canonicalUrl:url,domain,
  snippet:text(x.snippet||x.description||x.content||x.highlights?.join(' ')),publishedHint:x.publishedDate||x.publishedHint||x.published_date||x.page_age||null,
  sourceTypeHint:/product|technical|process|technology/i.test(url)?'technical_candidate':'unknown',
  officialDomainCandidate:domainHints.some(h=>domain===h||domain.endsWith('.'+h)),providerScore:Number.isFinite(x.score)?x.score:null,
  retrievedAt:new Date().toISOString(),discoveredBy:[provider],trust:'DISCOVERY_ONLY',evidence:false,
 };}).filter(Boolean)).slice(0,maxResults);
}
export function dedupSearchItems(items){const map=new Map();for(const item of items){const key=canonicalSearchURL(item.url);if(!key)continue;const prev=map.get(key);if(prev){prev.discoveredBy=[...new Set([...prev.discoveredBy,...(item.discoveredBy||[item.provider])])];}else map.set(key,{...item,url:key,canonicalUrl:key,discoveredBy:item.discoveredBy||[item.provider]});}return [...map.values()];}

export class BraveAdapter extends BraveResearchSearch {
 constructor(env,fetcher=fetch){super(env,fetcher);this.name='Brave';}
 async search(input){const start=performance.now(),r=await super.search(input);return {...r,endpoint:'https://api.search.brave.com/res/v1/web/search',httpStatus:r.ready?200:null,latencyMs:performance.now()-start,items:normalizeSearchItems(r.items,{...searchRequest(input),purpose:input.purpose,provider:this.name})};}
}
class JSONSearch {
 constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher;}
 get configured(){return !!this.env[this.key]?.trim();}
 async request(endpoint,body){
  if(!this.configured)return {status:'PROVIDER_KEY_MISSING',ready:false,broad:true,items:[],httpStatus:null,latencyMs:0,provider:this.name,endpoint};
  const start=performance.now();let r;
  try{r=await this.fetcher(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...this.auth()},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});}catch{throw Error('PROVIDER_CONNECTION_FAILED');}
  if(!r.ok){await r.body?.cancel();const e=Error('PROVIDER_HTTP_'+r.status);e.httpStatus=r.status;throw e;}
  const data=await r.json();return {provider:this.name,broad:true,ready:true,httpStatus:r.status,latencyMs:performance.now()-start,endpoint,data};
 }
}
export class ExaAdapter extends JSONSearch {
 name='Exa';key='EXA_API_KEY';
 auth(){return {'x-api-key':this.env[this.key].trim()};}
 async search(input){const p=searchRequest(input),days={day:1,week:7,month:31,year:366}[p.recency],r=await this.request(EXA_SEARCH_ENDPOINT,{query:p.query,type:'auto',numResults:p.maxResults,...(p.domainHints.length?{includeDomains:p.domainHints}:{}),...(days?{startPublishedDate:new Date(Date.now()-days*86400000).toISOString()}:{}),contents:{highlights:{maxCharacters:500}}});
  if(!r.ready)return r;const items=normalizeSearchItems(r.data.results,{...p,purpose:input.purpose,provider:this.name});delete r.data;return {...r,items,toolCalls:1};
 }
}
export class TavilySearchAdapter extends JSONSearch {
 name='TavilySearch';key='TAVILY_API_KEY';
 auth(){return {Authorization:'Bearer '+this.env[this.key].trim()};}
 async search(input){const p=searchRequest(input),r=await this.request(TAVILY_SEARCH_ENDPOINT,{query:p.query,search_depth:'basic',max_results:p.maxResults,topic:'general',include_answer:false,include_raw_content:false,include_images:false,auto_parameters:false,...(p.recency?{time_range:p.recency}:{}),include_domains:p.domainHints});
  if(!r.ready)return r;const items=normalizeSearchItems(r.data.results,{...p,purpose:input.purpose,provider:this.name});delete r.data;return {...r,items,toolCalls:1};
 }
}
export class TavilyExtractAdapter extends TavilySearchAdapter {
 name='TavilyExtract';
 constructor(env,fetcher=fetch,{validateURL=async()=>{throw Error('EXTRACT_SECURITY_VALIDATOR_REQUIRED');}}={}){super(env,fetcher);this.validateURL=validateURL;}
 async extract({urls,purpose='PAGE_EXTRACTION',maxCharacters=12000}){
  if(!Array.isArray(urls)||!urls.length||urls.length>5)throw Error('EXTRACT_BATCH_LIMIT');
  const allowed=[...new Set(urls.map(canonicalSearchURL))];if(allowed.includes(null))throw Error('EXTRACT_URL_INVALID');
  for(const url of allowed)await this.validateURL(url);
  const r=await this.request(TAVILY_EXTRACT_ENDPOINT,{urls:allowed,extract_depth:'basic',format:'text',include_images:false,include_favicon:false});if(!r.ready)return r;
  if(!Array.isArray(r.data.results))throw Error('PROVIDER_INVALID_RESPONSE');
  const sections=[];for(const x of r.data.results){const url=canonicalSearchURL(x.url);if(!allowed.includes(url))continue;await this.validateURL(url);
   const content=text(x.raw_content,Math.min(60000,Math.max(100,maxCharacters)));if(content)sections.push({url,purpose,provider:this.name,trust:'UNTRUSTED_SOURCE',verification:'UNVERIFIED',evidence:false,content,retrievedAt:new Date().toISOString()});
  }
  delete r.data;return {...r,sections,items:[],normalizedCount:sections.length};
 }
}
