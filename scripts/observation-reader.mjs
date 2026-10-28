import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {clean} from './observation-sources.mjs';
export function publicIPv4(ip){const p=ip.split('.').map(Number);return isIP(ip)===4&&!([0,10,127].includes(p[0])||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&[0,168].includes(p[1])||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&[18,19].includes(p[1]));}
async function htmlAt(url,depth=0){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||depth>3)throw Error('unsafe_url');
 const addresses=await lookup(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw Error('unsafe_host');
 // Pin the verified IP to this request, including every redirect (DNS rebinding guard).
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MOA public research reader','Accept':'text/html,application/xhtml+xml'},lookup:(_h,o,cb)=>o?.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4)},res=>{
   if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();resolve(htmlAt(new URL(res.headers.location,u).href,depth+1));return;}
   if(res.statusCode!==200){res.resume();reject(Error('http_'+res.statusCode));return;}
   if(!/html|text\/plain/.test(res.headers['content-type']||'')){res.resume();reject(Error('unsupported_content'));return;}
   let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>2000000)req.destroy(Error('body_too_large'));else chunks.push(b);});res.on('end',()=>resolve({url:u.href,html:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);
  });req.setTimeout(18000,()=>req.destroy(Error('read_timeout')));req.on('error',reject);
 });
}
export function publicationTime(html){
 const metas=[...html.matchAll(/<meta\b[^>]*>/gi)].map(x=>x[0]);let value;
 for(const m of metas)if(/(?:article:published_time|datePublished|pubdate)/i.test(m)){value=m.match(/content=["']([^"']+)["']/i)?.[1];if(value)break;}
 value||=(html.match(/"datePublished"\s*:\s*"([^"]+)"/i)||[])[1];
 if(!value||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)){
  const times=[...html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi)];
  for(const [,date,label] of times){const zone=clean(label).match(/\b(EDT|EST|UTC|GMT)\b/)?.[1];
   if(/^\d{4}-\d{2}-\d{2}T\d\d:\d\d(?::\d\d)?$/.test(date)&&zone){value=date+({EDT:'-04:00',EST:'-05:00',UTC:'Z',GMT:'Z'}[zone]);break;}
   if(/T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(date)){value=date;break;}
  }
 }
 // Date-only or unknown timezone is NOT guessed into an intraday timestamp.
 return value&&/T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
}
export async function readSource(item,{articleOnly=false}={}){
 try{const r=await htmlAt(item.url),article=articleOnly?/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(r.html)?.[1]:null,main=articleOnly?/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(r.html)?.[1]:null,text=clean(article||main||r.html);if(text.length<300||/^(?:access denied|just a moment|please enable javascript)/i.test(text))throw Error('unreadable_body');return {...item,resolvedUrl:r.url,publisher:new URL(r.url).hostname,publishedAt:publicationTime(r.html),retrievedAt:new Date().toISOString(),text:text.slice(0,22000),truncated:text.length>22000,status:'read'};}
 catch(e){return {...item,status:'read_failed',code:/^(http_\d+|unsafe_url|unsafe_host|unsupported_content|body_too_large|unreadable_body|read_timeout)$/.test(e.message)?e.message:'connection_failed',retrievedAt:new Date().toISOString()};}
}
