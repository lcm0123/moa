import {privateResearchPath} from './private-research-path.mjs';
import http from 'node:http';
import path from 'node:path';
import {stat,realpath,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.wasm':'application/wasm','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream','.txt':'text/plain; charset=utf-8'};
export function productionEnvironment(input,services={}){
 const url=new URL(input.MOA_PUBLIC_ORIGIN||'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('MOA_PUBLIC_ORIGIN must be the public HTTP(S) origin, without a path or credentials.');
 // These flags must remain boolean false even if .env contains local overrides.
 return {...input,...services,MOA_PUBLIC_ORIGIN:url.origin,LOCAL_PREVIEW:false,LOCAL_CALENDAR_ADMIN:false};
}
export function createProductionServer({env,assetsRoot,api,health}){
 const base=path.resolve(assetsRoot),origin=env.MOA_PUBLIC_ORIGIN;
 const respond=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({message}));};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
  try{
   if(privateResearchPath(req.url))return respond(res,404,'Not found');
   if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.length>8192)return respond(res,400,'Invalid request');
   // Never trust client Host/X-Forwarded-* headers for API origin/admin checks.
   const url=new URL(req.url,origin);
   if(url.pathname==='/healthz'){
    if(!['GET','HEAD'].includes(req.method))return respond(res,405,'Method not allowed');
    try{await health();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok'}));}catch{respond(res,503,'Service unavailable');}return;
   }
   if(url.pathname.startsWith('/api/')){
    if(['POST','PATCH','PUT','DELETE'].includes(req.method)&&req.headers.origin!==origin)return respond(res,403,'Invalid request origin');
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>(url.pathname.startsWith('/api/news-companies')?100000:16384))return respond(res,413,'Request too large');chunks.push(chunk);}
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const response=await api(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==='HEAD'||!response.body){await response.body?.cancel();res.end();return;}
    if(response.headers.get('content-type')?.includes('text/event-stream'))res.flushHeaders();
    // Streaming + backpressure; pipeline destroys/cancels the upstream on disconnect.
    await pipeline(Readable.fromWeb(response.body),res);return;
   }
   if(!['GET','HEAD'].includes(req.method))return respond(res,405,'Method not allowed');
   const pathname=decodeURIComponent(url.pathname);
   if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(p=>p.startsWith('.'))||/^\/(?:server|client)(?:\/|$)/.test(pathname))return respond(res,404,'Not found');
   let file=path.resolve(base,'.'+pathname);
   if(!file.startsWith(base+path.sep)&&file!==base)return respond(res,404,'Not found');
   let info;try{info=await stat(file);}catch{}
   if(!info?.isFile()){
    if(path.extname(pathname))return respond(res,404,'Not found');
    file=path.join(base,'index.html');
   }
   const real=await realpath(file),realBase=await realpath(base);
   if(!real.startsWith(realBase+path.sep))return respond(res,404,'Not found');
   const type=mime[path.extname(file)];if(!type)return respond(res,404,'Not found');
   const bytes=await readFile(real);res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{if(!res.headersSent)respond(res,500,'Service unavailable');else res.destroy();}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 return server;
}
