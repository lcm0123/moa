// Feature-retirement boundaries only; isolated fixtures, no live database or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../server/api.mjs';
import {graphDatabase} from './fixtures/catalyst-graph.mjs';
import {persistProfileObservations} from '../server/catalyst/business-profile.mjs';
import {startCatalystRuntime} from '../scripts/catalyst-runtime.mjs';
import {startBusinessProfileRuntime} from '../scripts/business-profile-runtime.mjs';

function forbidNetwork(t){
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('Unexpected external request');};
 t.after(()=>{globalThis.fetch=original;assert.equal(calls,0);});
}

test('retired research and thesis API roots and deep links reject every method before storage or dispatch',async t=>{
 forbidNetwork(t);let touched=0;
 const forbidden=()=>{touched++;throw Error('Retired feature reached a dependency');};
 const paths=['/api/catalyst','/api/catalyst/','/api/catalyst/chat','/api/catalyst/chats/old-chat','/api/catalyst/research','/api/catalyst/results?id=old-analysis','/api/catalyst/runs','/api/theses','/api/theses/','/api/theses/home','/api/theses/draft?chat=old-chat','/api/theses/old-thesis','/api/theses/old-thesis/context','/api/theses/old-thesis/review','/api/theses/old-thesis/reviews/old-review','/api/theses/old-thesis/archive'];
 for(const enabled of ['true','false']){
  const env={LOCAL_PREVIEW:true,CATALYST_ENABLED:enabled,CATALYST_RESEARCH_WORKER_ENABLED:enabled,CATALYST_METADATA_WORKER_ENABLED:enabled,ENABLE_OPENAI_WEB_SEARCH:enabled,CATALYST_SOURCE_ALLOWED:forbidden,CATALYST_WAKE:forbidden,CATALYST_ONESHOT:{submit:forbidden,submitChat:forbidden,submitThesis:forbidden}};
  Object.defineProperty(env,'DB',{get:forbidden});
  for(const path of paths)for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){
   const response=await api(new Request('http://127.0.0.1:4173'+path,{method,headers:{Origin:'http://127.0.0.1:4173','Content-Type':'application/json'},...(['GET','HEAD'].includes(method)?{}:{body:'{"query":"a previously saved question"}'})}),env);
   assert.equal(response.status,410,method+' '+path);
   const body=await response.json();assert.equal(body.status,'removed');assert.equal(body.code,'INVESTMENT_RESEARCH_REMOVED');
   assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
 }
 assert.equal(touched,0);
});

test('retirement does not swallow similarly prefixed unrelated routes',async t=>{
 forbidNetwork(t);
 for(const path of ['/api/catalyst-other','/api/theses-other']){
  const response=await api(new Request('http://localhost'+path),{});
  assert.equal(response.status,404);assert.notEqual((await response.json()).code,'INVESTMENT_RESEARCH_REMOVED');
 }
});

test('shared company business and revenue profile remains readable without research dispatch',async t=>{
 forbidNetwork(t);const c=graphDatabase();t.after(()=>c.sqlite.close());
 const asset={id:'KR:12345678:123456',kind:'KR_STOCK',market:'KR',symbol:'123456',issuerId:'12345678',name:'Fixture',identityStatus:'verified'};
 c.sqlite.prepare('INSERT INTO catalyst_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(asset.id,asset.kind,asset.symbol,asset.name,'KOSDAQ',asset.issuerId,null,null,null,'verified',JSON.stringify(asset),'2026-10-01');
 const source=await c.store.addSource({assetId:asset.id,sourceType:'regulatory',title:'Fixture half-year disclosure',url:'https://fixture.example/filing',body:'제품 A 70 70% 기타 30 30% 합계 100 100%',publishedAt:'2026-08-14',documentId:'fixture',documentHash:'fixture-hash',securityVersion:'security-1',locator:'table:1',authority:{kind:'issuer_document',assetId:asset.id,verified:true,verificationSource:'https://fixture.example'}});
 await persistProfileObservations(c.store,asset,source,[{dimension:'PRODUCT',label:'제품 A',value:70,reportedPercent:70,totalRevenue:100,period:'2026년 반기',scope:'CONSOLIDATED',unit:'백만원',rowQuote:'제품 A 70 70%',locator:'table:1:row:1',tableKey:'table:1',denominatorKind:'COMPANY_TOTAL_REVENUE'}]);
 let dispatched=0;
 const response=await api(new Request('http://localhost/api/business-profile?market=KR&ticker=123456'),{DB:c.db,LOCAL_PREVIEW:true,CATALYST_ENABLED:'false',CATALYST_SOURCE_ALLOWED:()=>true,CATALYST_ONESHOT:{submitProfile(){dispatched++;throw Error('GET must not collect');}}});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.groups.PRODUCT.datasets[0].items[0].percent,70);assert.equal(dispatched,0);
 assert.equal(c.sqlite.prepare('SELECT count(*) n FROM catalyst_usage').get().n,0);
 assert.equal(c.sqlite.prepare('SELECT count(*) n FROM catalyst_research_jobs').get().n,0);
});

test('stock timeline research route and read-state endpoint remain distinct from retired AI research',async t=>{
 forbidNetwork(t);let touched=0;const env={DB:{prepare(){touched++;throw Error('Empty timeline must not query');}},LOCAL_PREVIEW:true};
 const response=await api(new Request('http://localhost/api/research?symbols='),env);
 assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.items,[]);assert.deepEqual(data.reports,[]);assert.equal(touched,0);
 const wrongOrigin=await api(new Request('http://localhost/api/research/read',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'}),env);
 assert.equal(wrongOrigin.status,403);assert.equal(touched,0);
});

test('legacy runtime cannot wake queued research even when old callers provide enabled settings',t=>{
 forbidNetwork(t);let touched=0;
 const stop=startCatalystRuntime(new Proxy({CATALYST_ENABLED:'true',CATALYST_RESEARCH_WORKER_ENABLED:'true',CATALYST_METADATA_WORKER_ENABLED:'true'},{get(){touched++;throw Error('Retired runtime accessed settings or storage');},set(){touched++;throw Error('Retired runtime attached a dispatcher');}}));
 assert.equal(typeof stop,'function');stop();assert.equal(touched,0);
});

test('new startup exposes only manual shared business-profile collection, without waking research',t=>{
 forbidNetwork(t);let touched=0;
 const env={DB:{prepare(){touched++;throw Error('Startup must not query or resume jobs');}},CATALYST_ENABLED:'true',CATALYST_RESEARCH_WORKER_ENABLED:'true',CATALYST_METADATA_WORKER_ENABLED:'true'};
 const stop=startBusinessProfileRuntime(env);
 assert.deepEqual(Object.keys(env.CATALYST_ONESHOT).sort(),['pauseProfileBatch','startProfileBatch','submitProfile']);
 assert.equal(env.CATALYST_WAKE,undefined);assert.equal(typeof env.CATALYST_SOURCE_ALLOWED,'function');
 stop();assert.equal(touched,0);
});
