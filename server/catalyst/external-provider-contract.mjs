import {safeUrl} from './core.mjs';
import {untrustedSource} from './untrusted-source.mjs';
// Contract only: no Exa/Tavily adapter is connected and no network runs here.
export function externalDiscovery(provider,items){
 if(!['EXA','TAVILY'].includes(provider)||!Array.isArray(items)||items.length>30)throw Error('PROVIDER_CONTRACT_INVALID');
 return items.map(item=>{const url=safeUrl(item.url);if(!url)throw Error('PROVIDER_URL_INVALID');return {provider,kind:'URL_CANDIDATE',url,title:String(item.title||'').slice(0,300),snippet:String(item.snippet||'').slice(0,1000),security:'UNTRUSTED',requiresSecureFetch:true};});
}
export function externalExtract(provider,{url,text}){
 if(!['EXA','TAVILY'].includes(provider)||!safeUrl(url)||typeof text!=='string'||new TextEncoder().encode(text).length>60000)throw Error('PROVIDER_CONTRACT_INVALID');
 return {provider,kind:'EXTRACTED_TEXT',url:safeUrl(url),text,contentType:'text/plain',security:'UNTRUSTED',verified:false,rawHtmlStorage:false,modelInput:untrustedSource({url:safeUrl(url),text})};
}
