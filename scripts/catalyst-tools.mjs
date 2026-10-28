import fs from 'node:fs/promises';
import {secureDocument} from './catalyst-secure-content.mjs';
import {CatalystStore} from '../server/catalyst/store.mjs';
import {searchNews} from './observation-sources.mjs';
import {clean,safeUrl} from '../server/catalyst/core.mjs';
import {cryptoService} from '../server/crypto-api.mjs';
import {requireFinviz} from '../server/providers/finviz-client.mjs';
import {usListingIdentity} from '../server/providers/us-security-types.mjs';
import {issuerDocumentAuthority} from '../server/catalyst/authority.mjs';
import cryptoDocuments from '../config/catalyst-crypto-documents.json' with {type:'json'};
import {BraveResearchSearch} from '../server/catalyst/research-search.mjs';

export function decodeDocumentEntities(text){
 return text.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|apos|quot|lt|gt);/gi,(entity,key)=>{
  const named={nbsp:' ',amp:'&',apos:"'",quot:'"',lt:'<',gt:'>'};
  if(!key.startsWith('#'))return named[key.toLowerCase()]||entity;
  const value=key[1].toLowerCase()==='x'?Number.parseInt(key.slice(2),16):Number(key.slice(1));
  return value>0&&value<=0x10ffff&&!(value>=0xd800&&value<=0xdfff)?String.fromCodePoint(value):entity;
 });
}

export async function finvizPage(env,ticker){
 requireFinviz(env);const url=new URL('https://elite.finviz.com/quote.ashx');url.search=new URLSearchParams({t:ticker,auth:env.FINVIZ_API_KEY.trim()});
 const r=await secureDocument(url.href,env,{provider:'Finviz'});return (await fs.readFile(r.file,'utf8')).split(env.FINVIZ_API_KEY.trim()).join('[redacted]');
}

export function profileSource(profile,asset){
 const blocks=profile.businessParagraphs||(profile.products||[]).flatMap(p=>Object.values(p.evidence||{}).flat()).filter(b=>b?.text);
 const unique=[...new Map(blocks.map(b=>[b.text,b])).values()];
 if(!profile.identityVerified||!profile.documentHash||!safeUrl(profile.sourceUrl)||!unique.length)return null;
 return {assetId:asset.id,sourceType:'business',publisher:profile.source||'기업 공시',title:profile.source||'사업 보고서',url:profile.sourceUrl,publishedAt:profile.sourceDate,observedAt:profile.checkedAt,body:unique.map(b=>b.text).join('\n'),tables:profile.tables,locator:unique.map(b=>b.locator).join(' / ').slice(0,700),originRef:profile.receipt,authority:issuerDocumentAuthority(profile,asset)};
}
export function finvizNewsLinks(html){
 const table=/<table\b[^>]*id=["']news-table["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]||'';
 return [...table.matchAll(/<a\b[^>]*href=["'](https:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({url:safeUrl(m[1].replaceAll('&amp;','&')),title:clean(m[2])})).filter(x=>x.url&&x.title).slice(0,8);
}
export class WebSearchProvider {
 constructor(env,{news=searchNews,broad=new BraveResearchSearch(env)}={}){this.env=env;this.news=news;this.broad=broad;}
 async search(query,{allowBroad=true}={}){
  const language=/[가-힣]/.test(query)?'ko':'en';let result;
  // RSS remains a news-discovery helper and never satisfies broad-search READY.
  try{result=await this.news(this.env,query,language);}catch{result={items:[],status:'NEWS_SEARCH_FAILED'};}
  if(result.items?.length||!allowBroad)return {provider:'Google News RSS · 원문 확인 후 사용',broad:false,ready:false,status:result.status||'ok',items:(result.items||[]).slice(0,6)};
  return this.broad.search({query,language,maxResults:6});
 }
}
export function createCatalystTools(env){
 const search=new WebSearchProvider(env);
 const listingResponses=new Map();
 const listingFetch=async(url,options)=>{if(!listingResponses.has(url)){const response=await fetch(url,options);if(!response.ok)return response;const text=await response.text();if(text.length>3000000)throw Error('METADATA_SIZE');listingResponses.set(url,text);}return new Response(listingResponses.get(url),{headers:{'Content-Type':'text/plain'}});};
 return {
  async read(item){const {createResearchTools}=await import('./catalyst-research-tools.mjs');return createResearchTools(env,new CatalystStore(env.DB),this).read(item);},
  async news(asset,query,{allowBroad=true}={}){
   if(asset?.kind==='US_STOCK'){try{const html=await finvizPage(env,asset.symbol);const items=finvizNewsLinks(html);if(items.length)return {provider:'Finviz 뉴스 원문 링크',items};}catch{}}
   return search.search(asset?`${asset.name} ${asset.symbol} ${query}`:query,{allowBroad});
  },
  search:query=>search.search(query),
  stockIdentity:asset=>usListingIdentity(asset.symbol,{fetcher:listingFetch}),
  async cryptoDocuments(asset,metadata){
   const docs=[];
   for(const entry of cryptoDocuments.filter(d=>d.geckoId===asset.geckoId&&d.symbol===asset.symbol)){
    if(!metadata.homepages.some(url=>{const host=new URL(url).hostname;return host===entry.officialRoot||host.endsWith('.'+entry.officialRoot);}))continue;
    try{
     const response=await secureDocument(entry.url,env,{provider:'Protocol'});const text=await fs.readFile(response.file,'utf8');
     const body=decodeDocumentEntities(entry.url.endsWith('.md')?text.replaceAll('**',''):text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<\/(?:p|div|li)>/gi,'\n').replace(/<[^>]+>/g,' '));
     docs.push({securityVersion:response.securityVersion,assetId:asset.id,url:entry.url,sourceType:'official',title:asset.symbol+' 공식 문서',body,publishedAt:null,observedAt:new Date().toISOString(),authority:{verified:true,kind:'official_domain',assetId:asset.id,verificationSource:metadata.homepages[0]}});
    }catch{}
   }
   return docs;
  },
  async business(asset){
   const {createResearchTools}=await import('./catalyst-research-tools.mjs');const sources=await createResearchTools(env,new CatalystStore(env.DB),this).businessSources(asset);return sources[0]||null;
  },
  async cryptoMetadata(asset){
   if(!asset.geckoId)return null;
   const d=await cryptoService(env).metadata.request('coins/'+encodeURIComponent(asset.geckoId),{localization:false,tickers:false,market_data:true,community_data:false,developer_data:false});
   if(d.id!==asset.geckoId||d.symbol?.toUpperCase()!==asset.symbol)return null;
   const platforms=Object.entries(d.platforms||{}).filter(([chain,address])=>chain&&address).map(([chain,contractAddress])=>({chain,contractAddress}));
   const numeric=n=>Number.isFinite(n)&&n>=0?n:null;
   return {geckoId:d.id,name:d.name,platforms,homepages:(d.links?.homepage||[]).map(safeUrl).filter(Boolean),categories:d.categories||[],description:clean(d.description?.en||''),source:'https://www.coingecko.com/en/coins/'+d.id,asOf:d.last_updated||null,protocolId:'protocol:'+d.id,marketData:{marketCap:numeric(d.market_data?.market_cap?.usd),volume24h:numeric(d.market_data?.total_volume?.usd)},protocolFundamentals:{tvl:numeric(d.market_data?.total_value_locked?.usd),revenue:null,fees:null,users:null},tokenomics:{circulatingSupply:numeric(d.market_data?.circulating_supply),maxSupply:numeric(d.market_data?.max_supply),totalSupply:numeric(d.market_data?.total_supply),fdv:numeric(d.market_data?.fully_diluted_valuation?.usd),unlock:null,emission:null,concentration:null},valueCapture:{feeShare:null,buyback:null,burn:null,staking:null},observedAt:new Date().toISOString()};
  }
 };
}
