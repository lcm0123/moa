import test from 'node:test';
import assert from 'node:assert/strict';
import {clientId} from '../dist/js/client-id.js';
import {chartUser,readAnalysisState,saveAnalysisState} from '../dist/js/analysis-chart-model.js';
import {newIndicator} from '../dist/js/stock-chart-state.js';
import {requestChannel} from '../dist/js/market-client.js';

test('HTTP without randomUUID opens new chart preferences, keeps distinct IDs and restores drawings',t=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const random=crypto.getRandomValues.bind(crypto);
 t.mock.getter(globalThis,'crypto',()=>({getRandomValues:random}));
 const id=chartUser(storage);
 assert.match(id,/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
 assert.equal(chartUser(storage),id);
 assert.equal(new Set(Array.from({length:1000},()=>newIndicator('sma').id)).size,1000);
 for(const key of ['KR:052690','US:AAPL']){
  const state=readAnalysisState(id,key,storage);
  state.drawings=[{id:'draw-'+clientId(),kind:'horizontal',points:[{date:'2026-09-25',price:100}],color:'#123456',width:2}];
  saveAnalysisState(id,key,state,storage);
  assert.deepEqual(readAnalysisState(chartUser(storage),key,storage).drawings,state.drawings);
 }
});
test('blocked storage and unavailable crypto do not prevent opening a stock chart',t=>{
 t.mock.getter(globalThis,'crypto',()=>undefined);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage denied');}});
 t.after(()=>delete globalThis.localStorage);
 const first=chartUser();assert.equal(chartUser(),first);
 assert.equal(readAnalysisState(first,'KR:052690').settings.type,'candles');
 assert.equal(new Set(Array.from({length:100},()=>clientId())).size,100);
});
test('a renderer exception never turns a successful quote into an empty provider error',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({status:'ready',items:[{id:'AAPL'}]}));
 const delivered=[];
 await assert.rejects(requestChannel('render-regression','/api/stock',null,feed=>{delivered.push(feed);throw new Error('chart render failure');}),/chart render failure/);
 assert.equal(delivered.length,1);assert.equal(delivered[0].status,'ready');assert.equal(delivered[0].items[0].id,'AAPL');
});
test('network/JSON failures still yield one error, superseded requests do not overwrite data',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('not JSON'));
 const received=[];
 await requestChannel('network-regression','/api/stock',null,d=>received.push(d));
 assert.equal(received.length,1);assert.equal(received[0].status,'error');
 let finishFirst;
 t.mock.method(globalThis,'fetch',async url=>url==='/first'?new Promise(resolve=>{finishFirst=resolve;}):Response.json({status:'ready',items:[{id:'new'}]}));
 const selected=[];
 const first=requestChannel('race','/first',null,d=>selected.push(d));
 await requestChannel('race','/second',null,d=>selected.push(d));
 finishFirst(Response.json({status:'ready',items:[{id:'old'}]}));await first;
 assert.deepEqual(selected.map(d=>d.items[0].id),['new']);
});
