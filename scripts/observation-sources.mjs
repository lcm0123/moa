import {cachedResearch} from '../server/research-cache.mjs';
import {request,documentXml,boundedBytes} from '../server/us-kr-evidence.mjs';
import {dartCompanyMap,dartZipXml} from '../server/providers/dart-financials.mjs';
import {businessBlocks} from './competitor-sources.mjs';
import {digest} from '../server/providers/finviz-client.mjs';
import {rules} from '../server/observation-model.mjs';
export const clean=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
// Fixed destinations only. Feed/article URLs are not accepted as arbitrary fetch targets.
export async function publicText(url,allowedHosts){
 const u=new URL(url);if(u.protocol!=='https:'||!allowedHosts.includes(u.hostname)||u.username||u.password)throw Error('출처 호스트 검증 실패');
 const r=await fetch(u,{redirect:'error',headers:{'User-Agent':'MOA research reader'},signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('출처 HTTP '+r.status);
 return new TextDecoder().decode(await boundedBytes(r.body,2000000));
}
export function parseRss(xml){return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,30).map(m=>{const tag=n=>clean(new RegExp(`<${n}(?: [^>]*)?>([\\s\\S]*?)<\\/${n}>`).exec(m[1])?.[1]);return {title:tag('title'),url:tag('link'),publishedAt:tag('pubDate')?new Date(tag('pubDate')).toISOString():null,source:tag('source'),use:'후보 탐색 · 본문/인과 검증 전'};}).filter(r=>r.title&&r.url.startsWith('https://news.google.com/'));}
export async function searchNews(env,query,lang='en'){
 return cachedResearch(env,'observation:rss:'+lang+':'+await digest(query),86400000,async()=>{const u=new URL('https://news.google.com/rss/search');u.searchParams.set('q',query);u.searchParams.set('hl',lang==='ko'?'ko':'en-US');u.searchParams.set('gl',lang==='ko'?'KR':'US');u.searchParams.set('ceid',lang==='ko'?'KR:ko':'US:en');return {query,source:'Google News RSS',retrievedAt:new Date().toISOString(),items:parseRss(await publicText(u.href,['news.google.com']))};});
}
export async function verifyPrimary(e){
 const html=await publicText(e.primary.url,['investors.teradyne.com']),text=clean(html);
 if(!e.primary.identityTerms.every(t=>text.includes(t))||!e.primary.requiredTerms.every(t=>text.toLowerCase().includes(t.toLowerCase()))||!text.includes(e.primary.excerpt))throw Error('기업 발표 본문 검증 실패');
 // Review manifest timestamps must match the actual release page, not just its URL.
 if(e.ticker==='TER'&&!/September 29, 2026\s+9:00am EDT/i.test(text))throw Error('발표 시각 검증 실패');
 return {...e,reviewedAt:undefined,primary:{...e.primary,verified:true,retrievedAt:new Date().toISOString(),hash:await digest(text)}};
}
export async function companyDirectory(env){return cachedResearch(env,'dart:companies',86400000,async()=>({items:dartCompanyMap(await dartZipXml(await request(env,'corpCode.xml',{},true)))}));}
export function discoveredCompanies(searches,directory){
 const titles=searches.flatMap(s=>s.items||[]).map(n=>n.title).join('\n');
 // Match a DART name with boundaries; ticker/symbol guesses are not identities.
 return directory.filter(c=>/^\d{6}$/.test(c.ticker)&&c.name?.length>=3&&new RegExp('(?:^|[^가-힣A-Za-z0-9])'+c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^가-힣A-Za-z0-9])').test(titles)).map(c=>({...c,discoveryMentions:titles.split(c.name).length-1})).sort((a,b)=>b.discoveryMentions-a.discoveryMentions);
}
export function extractBusiness(xml,company,filing,topic,checkedAt){
 if(!/<TITLE[^>]*>[^<]*사업의\s*내용/i.test(xml))return null;
 const blocks=businessBlocks(xml,'KR'),product=new RegExp(topic.krProduct,'i'),ownership=new RegExp(topic.ownership,'i');
 const own=blocks.find(b=>b.text.length<3000&&b.text.split(/(?<=[.!?])\s+/).some(sentence=>product.test(sentence)&&ownership.test(sentence)&&!/(당사(?:의)?\s*고객|않|아니|중단|계획|예정|검토)/.test(sentence)));
 const demand=blocks.find(b=>b.text.length<3000&&product.test(b.text)&&/(수요(?!처)|고속|DRAM|DDR|NAND)/i.test(b.text));
 if(!own||!demand)return null;
 return {version:rules.version,ticker:company.stock_code,name:company.corp_name,corpCode:company.corp_code,exchange:company.corp_cls==='Y'?'KOSPI':company.corp_cls==='K'?'KOSDAQ':null,topic:topic.id,verified:true,receipt:filing.rcept_no,sourceDate:filing.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),checkedAt,availableAt:checkedAt,sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+filing.rcept_no,source:'OpenDART '+filing.report_nm,productEvidence:own,demandEvidence:demand,revenueShare:null,importanceNote:'주력 제품이라는 공시 표현 확인 · 해당 제품 매출 비중 미추출'};
}
export async function fetchBusiness(env,c,topic){
 const company=await request(env,'company.json',{corp_code:c.corpCode});if(company.stock_code!==c.ticker||company.corp_code!==c.corpCode||!['Y','K'].includes(company.corp_cls))throw Error('국내 상장사 식별 불일치');
 const now=new Date(),from=new Date(now);from.setUTCFullYear(from.getUTCFullYear()-2);
 const d=await request(env,'list.json',{corp_code:c.corpCode,bgn_de:from.toISOString().slice(0,10).replaceAll('-',''),end_de:now.toISOString().slice(0,10).replaceAll('-',''),pblntf_ty:'A',last_reprt_at:'Y',page_count:'100',sort:'date',sort_mth:'desc'});
 const f=d.list?.find(f=>/^(?:\[.*?\])?(사업|반기|분기)보고서/.test(f.report_nm)&&f.stock_code===c.ticker&&f.corp_code===c.corpCode);if(!f)throw Error('최신 사업 공시 없음');
 const xml=await documentXml(await request(env,'document.xml',{rcept_no:f.rcept_no},true)),p=extractBusiness(xml,company,f,topic,new Date().toISOString());return p?{...p,hash:await digest(xml)}:null;
}
