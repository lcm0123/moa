import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisData,defaultAnalysisSettings,readAnalysisState,saveAnalysisState,saveAnalysisDefault} from '../dist/js/analysis-chart-model.js';
import {koreanChartEvents} from '../dist/js/korean-chart-events.js';
const history=[{date:'2026-09-22',open:100,high:110,low:90,close:105,volume:1000}];
test('KR and US adapters preserve actual OHLCV and separate quote/date/currency',()=>{
 for(const market of ['KR','US']){
  const data=analysisData({market,price:999,history,historyReceivedAt:'2026-09-26T00:00:00Z'},{policy:{chart:true},source:market+' provider'});
  assert.equal(data.bars[0].close,105);assert.equal(data.baseDate,'2026-09-22');assert.equal(data.receivedAt,'2026-09-26T00:00:00Z');assert.equal(data.currency,market==='KR'?'KRW':'USD');assert.equal(data.adjustment,'unverified');
  assert.equal(analysisData({market,history},{policy:{chart:false}}).bars.length,0);
 }
});
test('analysis defaults, user/market isolation, settings and drawings restoration',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},settings=defaultAnalysisSettings();
 assert.equal(settings.type,'candles');assert.deepEqual(settings.indicators.filter(c=>c.kind==='sma').map(c=>c.period),[20,60]);assert.equal(settings.indicators.filter(c=>c.kind==='volume').length,1);
 settings.period='1m';settings.type='line';const drawings=[{id:'h1',kind:'horizontal',points:[{date:'2026-09-22',price:105}],color:'#123456',width:2}];
 saveAnalysisState('user1','KR:005930',{settings,drawings},storage);
 assert.equal(readAnalysisState('user1','KR:005930',storage).settings.type,'line');assert.deepEqual(readAnalysisState('user1','KR:005930',storage).drawings,drawings);
 for(const [user,key] of [['user2','KR:005930'],['user1','US:005930'],['user1','KR:000660']]){assert.equal(readAnalysisState(user,key,storage).settings.type,'candles');assert.equal(readAnalysisState(user,key,storage).drawings.length,0);}
 saveAnalysisDefault('user1',settings,storage);assert.equal(readAnalysisState('user1','US:NVDA',storage).settings.period,'1m');assert.equal(readAnalysisState('user2','US:NVDA',storage).settings.period,'3m');
});
test('event markers use market timezone and exact trading date, no fabricated weekend bar',()=>{
 const event={id:'e',kind:'earnings',at:'2026-09-22T23:00:00Z',title:'actual event'};
 assert.equal(koreanChartEvents([event],history,'US')[0].barDate,'2026-09-22');assert.equal(koreanChartEvents([event],history,'KR')[0].barDate,null);
 assert.equal(koreanChartEvents([{id:'f',kind:'earnings',originalDate:'2026-09-22',date:'2026-09-23'}],history,'US')[0].barDate,'2026-09-22');
});
