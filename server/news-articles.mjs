import {safeLink} from './news-companies-model.mjs';

// Discovery metadata only. These titles/descriptions must never be analysis evidence.
export const articlePolicy={version:'news-feed-2',ttl:60000,staleTtl:86400000,articleTtl:604800000,retryMs:60000,limit:24};
export const naverEconomyPolicy={version:'economy-1',section:'101'};
export const publisherFeeds=[
 {id:'cnbc',name:'CNBC',url:'https://www.cnbc.com/id/10001147/device/rss/rss.html',hosts:['www.cnbc.com','cnbc.com']},
 {id:'bbc',name:'BBC News',url:'https://feeds.bbci.co.uk/news/business/rss.xml',hosts:['www.bbc.com','www.bbc.co.uk','bbc.com','bbc.co.uk']},
];
export function plainNews(value,maxCharacters=300){
 return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<\/?b\b[^>]*>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|apos|nbsp|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi,e=>{
  const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'};if(named[e.toLowerCase()])return named[e.toLowerCase()];const n=e[2].toLowerCase()==='x'?parseInt(e.slice(3),16):parseInt(e.slice(2),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
 }).replace(/\s+/g,' ').trim().slice(0,maxCharacters);
}
export function articleURL(value){
 const safe=safeLink(value);if(!safe)return null;const u=new URL(safe);
 if(u.port&&u.port!=='443'||u.hostname==='localhost'||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||/\.(local|internal|test|invalid)$/.test(u.hostname))return null;
 u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(ocid|cmpid|__source|fbclid|gclid)$/i.test(key))u.searchParams.delete(key);return u.href;
}
const timestamp=v=>typeof v==='string'&&/\d{2}:\d{2}/.test(v)&&/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(v.trim())&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function normalizeArticleTimes(article){
 const naver=article.provider==='Naver News'||/^https:\/\/(?:n\.news|news)\.naver\.com\//.test(article.naverUrl||article.url||'');
 if(!naver)return article;
 // Old feed caches used publishedAt for Naver pubDate. Reinterpret that field
 // on read without rewriting history or treating it as original publication.
 const providerProvidedAt=timestamp(article.providerProvidedAt)||(article.timeSemanticsVersion===1?null:timestamp(article.publishedAt));
 return {...article,providerProvidedAt,publishedAt:null,modifiedAt:null,eventTime:null,
  collectedAt:timestamp(article.collectedAt)||timestamp(article.fetchedAt),
  timePrecision:'UNKNOWN',providerTimePrecision:providerProvidedAt?'TIMESTAMP':'UNKNOWN',
  providerTimeMeaning:'NAVER_DISTRIBUTION',timeSemanticsVersion:1};
}
// Discovery/freshness only. This clock must never establish event chronology.
export function articleDiscoveryAt(article){const normalized=normalizeArticleTimes(article);return normalized.providerTimeMeaning==='NAVER_DISTRIBUTION'?normalized.providerProvidedAt:normalized.publishedAt||null;}
export function isNaverEconomyArticle(article){
 // Search API has no section parameter. Accept the provider's section link,
 // never keywords, publisher name or caller-supplied category labels.
 const value=articleURL(article.naverUrl||article.url);if(!value)return false;const u=new URL(value);
 const modern=u.hostname==='n.news.naver.com'&&/^\/(?:mnews\/)?article\/\d+\/\d+\/?$/.test(u.pathname);
 const legacy=u.hostname==='news.naver.com'&&u.pathname==='/main/read.naver';
 if(!modern&&!legacy)return false;
 const section=u.searchParams.getAll(modern?'sid':'sid1'),other=u.searchParams.getAll(modern?'sid1':'sid');
 return section.length===1&&section[0]===naverEconomyPolicy.section&&other.every(s=>s===naverEconomyPolicy.section);
}
export function normalizeNaverNews(data){
 if(!Array.isArray(data?.items)||!Number.isFinite(data.total))throw Error('FEED_INVALID_RESPONSE');
 return data.items.slice(0,articlePolicy.limit).flatMap(item=>{
  const originalUrl=articleURL(item.originallink),naver=articleURL(item.link),isNaver=naver&&/^(?:n\.news|news)\.naver\.com$/.test(new URL(naver).hostname),url=isNaver?naver:originalUrl;
  if(!url||!plainNews(item.title)||!isNaverEconomyArticle({naverUrl:isNaver?naver:null,url}))return [];
  return [normalizeArticleTimes({title:plainNews(item.title),feedExcerpt:plainNews(item.description,600),url,originalUrl:originalUrl||url,naverUrl:isNaver?naver:null,publisher:originalUrl?new URL(originalUrl).hostname.replace(/^www\./,''):'네이버 뉴스',providerProvidedAt:timestamp(item.pubDate),publishedAt:null,provider:'Naver News',region:'KR',category:'economy',categorySource:'NAVER_SECTION',sectionId:naverEconomyPolicy.section,trust:'DISCOVERY_ONLY'})];
 });
}
export function parsePublisherNews(xml,feed){
 if(typeof xml!=='string'||!/<rss[\s>]/i.test(xml)||/<!DOCTYPE|<!ENTITY|<script[\s>]/i.test(xml))throw Error('FEED_INVALID_RESPONSE');
 return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,40).flatMap(m=>{
  const tag=(n,max=300)=>plainNews(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`,'i').exec(m[1])?.[1],max);
  const url=articleURL(tag('link'));if(!url||!feed.hosts.includes(new URL(url).hostname)||!tag('title'))return [];
  return [{title:tag('title'),feedExcerpt:tag('description',600),url,originalUrl:url,naverUrl:null,publisher:feed.name,publishedAt:timestamp(tag('pubDate')),provider:feed.name+' RSS',region:'US',trust:'DISCOVERY_ONLY'}];
 });
}
export function uniqueNews(items){
 const seen=new Set();return items.map(normalizeArticleTimes).filter(item=>{const key=articleURL(item.originalUrl||item.url);if(!key||seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(Date.parse(articleDiscoveryAt(b))||0)-(Date.parse(articleDiscoveryAt(a))||0));
}
export function feedRequest(params={}){
 const region=params.region||'KR',q=String(params.q||'').normalize('NFKC').replace(/\s+/g,' ').trim(),publisher=params.publisher||'all';
 if(!['KR','US'].includes(region)||q.length>80||!['all',...publisherFeeds.map(f=>f.id)].includes(publisher))throw Error('INVALID_FEED_REQUEST');
 return {region,q,publisher};
}
