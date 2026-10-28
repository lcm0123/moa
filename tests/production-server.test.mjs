import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProductionServer,productionEnvironment} from '../server/node-http.mjs';
import {calendarApi} from '../server/calendar-api.mjs';
import {reportCategoryApi} from '../server/reports.mjs';
import {requireFinviz} from '../server/providers/finviz-client.mjs';

test('production cannot inherit preview/admin bypasses and requires a plain public origin',()=>{
 const env=productionEnvironment({MOA_PUBLIC_ORIGIN:'https://moa.example/',LOCAL_PREVIEW:true,LOCAL_CALENDAR_ADMIN:true});
 assert.equal(env.LOCAL_PREVIEW,false);assert.equal(env.LOCAL_CALENDAR_ADMIN,false);assert.equal(env.MOA_PUBLIC_ORIGIN,'https://moa.example');
 for(const origin of ['', 'file:///secret','https://key@moa.example','https://moa.example/path','https://moa.example/?key=hidden'])assert.throws(()=>productionEnvironment({MOA_PUBLIC_ORIGIN:origin}));
 assert.throws(()=>requireFinviz({...env,FINVIZ_API_KEY:'test-only'},'display'),e=>e.status==='restricted');
});

test('public requests cannot modify calendar or report classification even with a forged loopback URL',async()=>{
 const env=productionEnvironment({MOA_PUBLIC_ORIGIN:'https://moa.example',LOCAL_PREVIEW:true,LOCAL_CALENDAR_ADMIN:true});
 const headers={'Origin':'http://127.0.0.1','Content-Type':'application/json'};
 assert.equal((await calendarApi(new Request('http://127.0.0.1/api/calendar',{method:'POST',headers,body:'{}'}),env)).status,403);
 assert.equal((await reportCategoryApi(new Request('http://127.0.0.1/api/reports/1/category',{method:'PATCH',headers,body:'{}'}),env,'1')).status,403);
});

async function fixture(t,handler,health=()=>{}){
 const root=await mkdtemp(path.join(os.tmpdir(),'moa-http-'));await writeFile(path.join(root,'index.html'),'<h1>MOA</h1>');await mkdir(path.join(root,'js'));await writeFile(path.join(root,'js/app.js'),'export const brand="MOA";');await writeFile(path.join(root,'.env'),'not-a-public-file');
 const server=createProductionServer({env:productionEnvironment({MOA_PUBLIC_ORIGIN:'https://moa.example'}),assetsRoot:root,api:handler||(()=>new Response('{}')),health});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const local='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('moa-http-'));await rm(root,{recursive:true,force:true});});return local;
}

test('serves SPA and assets but no dotfiles, server bundle, traversal or unknown files',async t=>{
 const local=await fixture(t);
 assert.match(await (await fetch(local+'/stock/US/AAPL')).text(),/MOA/);
 assert.match((await fetch(local+'/js/app.js')).headers.get('content-type'),/javascript/);
 for(const file of ['/.env','/%2eenv','/server/index.js','/client/index.html','/js/missing.js','/..%5c.env'])assert.equal((await fetch(local+file)).status,404,file);
 const head=await fetch(local+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('configured origin survives forwarded headers; cross-origin writes and oversized requests are blocked',async t=>{
 let calls=0;
 const local=await fixture(t,request=>{calls++;return new Response(JSON.stringify({url:request.url}),{headers:{'Content-Type':'application/json'}});});
 const data=await (await fetch(local+'/api/check',{headers:{Host:'attacker.example','X-Forwarded-Host':'127.0.0.1'}})).json();
 assert.equal(data.url,'https://moa.example/api/check');
 assert.equal((await fetch(local+'/api/check',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'})).status,403);
 assert.equal((await fetch(local+'/api/check',{method:'POST',headers:{Origin:'https://moa.example'},body:'a'.repeat(17000)})).status,413);
 assert.equal(calls,1);
 assert.equal((await fetch(local+'/api/check',{method:'POST',headers:{Origin:'https://moa.example'},body:'{}'})).status,200);
});

test('streams API responses without converting SSE to an accumulated buffer',async t=>{
 const local=await fixture(t,()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));c.close();}}),{headers:{'Content-Type':'text/event-stream'}}));
 const response=await fetch(local+'/api/stream');assert.equal(response.headers.get('content-type'),'text/event-stream');assert.equal(await response.text(),'data: {"ok":true}\n\n');
});

test('health reports database failure without disclosing errors',async t=>{
 const local=await fixture(t,null,()=>{throw new Error('private information');});
 const response=await fetch(local+'/healthz');assert.equal(response.status,503);assert.equal((await response.json()).message,'Service unavailable');
});
