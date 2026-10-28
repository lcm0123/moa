import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBars,selectPeriod} from '../dist/js/stock-chart-model.js';
import {aggregateBars,bucketKey,configuredSeries,comparisonSeries,dailyComparisonPoints} from '../dist/js/stock-chart-analysis.js';
import {initialChartSettings,newIndicator,normalizeChartSettings,normalizeDrawings,readChartState,saveChartState,saveDefaultChart,shiftDrawing} from '../dist/js/stock-chart-state.js';
import {analysisGeometry,analysisMarkup} from '../dist/js/stock-chart-renderer.js';
import {chartWindow,zoomWindow} from '../dist/js/market-chart-model.js';
const bar=(date,open,high,low,close,volume)=>({date,open,high,low,value:close,volume});
const sample=normalizeBars([bar('2023-12-29',10,15,9,14,100),bar('2024-01-02',14,17,12,16,200),bar('2024-01-03',16,21,15,19,300),bar('2024-01-05',19,20,11,12,400),bar('2024-01-08',13,15,10,14,500),bar('2024-02-01',14,18,13,17,600),bar('2024-02-29',18,20,14,19,700)]);
test('weekly OHLCV uses first open, extrema, final close and total volume across actual trading days',()=>{
 const weeks=aggregateBars(sample,'week');assert.equal(bucketKey('2024-01-01','week'),'2024-01-01');assert.equal(bucketKey('2023-12-31','week'),'2023-12-25');
 assert.deepEqual(weeks[1],{date:'2024-01-05',startDate:'2024-01-02',endDate:'2024-01-05',samples:3,open:14,high:21,low:11,close:12,volume:900,ohlc:true});
 assert.equal(weeks.length,5);assert.equal(weeks.at(-1).date,'2024-02-29');
});
test('monthly aggregation handles year/leap boundaries and does not invent absent months',()=>{
 const months=aggregateBars(sample,'month');assert.deepEqual(months.map(b=>b.date),['2023-12-29','2024-01-08','2024-02-29']);
 assert.equal(months[1].open,14);assert.equal(months[1].high,21);assert.equal(months[1].low,10);assert.equal(months[1].close,14);assert.equal(months[1].volume,1400);
 assert.equal(months[2].samples,2);assert.equal(months[2].volume,1300);
 const missing=aggregateBars(normalizeBars([bar('2024-01-02',2,3,1,2,10),{date:'2024-01-03',value:3}]),'week')[0];assert.equal(missing.volume,null);assert.equal(missing.open,null);assert.equal(missing.ohlc,false);
});
test('configurable SMA200 and EMA are calculated on full history before a one-month viewport',()=>{
 const daily=normalizeBars(Array.from({length:450},(_,i)=>({date:new Date(Date.UTC(2023,0,i+1)).toISOString().slice(0,10),value:i+1}))),bars=aggregateBars(daily),settings=[newIndicator('sma',200),newIndicator('ema',12)];
 const series=configuredSeries(bars,settings),window=selectPeriod(bars,'1m'),start=bars.length-window.items.length;
 assert.equal(series[0].values[198],null);assert.equal(series[0].values[199],100.5);assert.equal(series[0].values[start],start+1-99.5);assert.ok(series[1].values[start]>0);
 const weeks=aggregateBars(daily,'week'),weekly=configuredSeries(weeks,[newIndicator('sma',5)],'week')[0];assert.equal(weekly.label,'SMA 5주');assert.equal(weekly.values[3],null);assert.equal(weekly.values[4],weeks.slice(0,5).reduce((sum,b)=>sum+b.close,0)/5);
});
test('comparison has one common actual baseline and preserves missing dates without filling',()=>{
 const bars=aggregateBars(normalizeBars([{date:'2024-01-01',value:100},{date:'2024-01-02',value:110},{date:'2024-01-03',value:120},{date:'2024-01-04',value:130}]));
 const a={key:'A',label:'A',color:'#7562c7',bars:normalizeBars([{date:'2024-01-02',value:20},{date:'2024-01-04',value:22}])};
 const b={key:'B',label:'B',color:'#123456',bars:normalizeBars([{date:'2024-01-01',value:30},{date:'2024-01-02',value:40},{date:'2024-01-03',value:44}])};
 const result=comparisonSeries(bars,[a,b],'day');assert.equal(result.baseDate,'2024-01-02');assert.deepEqual(result.series.map(s=>s.values[1]),[0,0,0]);assert.equal(result.series[1].values[2],null);assert.equal(result.series[2].values[3],null);assert.equal(result.series[0].values[0],null);assert.ok(Math.abs(result.series[1].values[3]-10)<1e-10);
 assert.equal(comparisonSeries(bars,[{...a,bars:[]}],'day').baseDate,null);
 assert.deepEqual(dailyComparisonPoints({historyKind:'intraday',points:[{at:'2024-01-02',value:100}]}),[]);
 assert.equal(dailyComparisonPoints({historyKind:'daily',points:[{at:'2024-01-02T12:00:00Z',value:100},{at:'2024-01-03',value:101}]}).length,1);
});
test('settings and drawings persist per stock, defaults do not copy drawings, resets preserve separate drawings',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const settings=initialChartSettings();assert.deepEqual(settings.indicators.map(c=>c.kind),['sma','volume']);settings.type='area';settings.interval='week';settings.indicators.push(newIndicator('ema',26));
 const drawings=[{id:'a',kind:'trend',points:[{date:'2024-01-02',price:14},{date:'2024-01-05',price:19}],color:'#123456',width:2}];
 saveChartState('US:FSLY',{settings,drawings},storage);assert.equal(readChartState('US:FSLY',storage).settings.type,'area');assert.deepEqual(readChartState('US:FSLY',storage).drawings,drawings);
 assert.equal(readChartState('US:NVDA',storage).settings.type,'candles');saveDefaultChart(settings,storage);assert.equal(readChartState('US:NVDA',storage).settings.type,'area');assert.deepEqual(readChartState('US:NVDA',storage).drawings,[]);
 saveChartState('US:FSLY',{settings:initialChartSettings(),drawings},storage);assert.equal(readChartState('US:FSLY',storage).settings.type,'candles');assert.deepEqual(readChartState('US:FSLY',storage).drawings,drawings);
 assert.equal(normalizeChartSettings({indicators:[{...newIndicator('macd'),fast:100,slow:26}]}).indicators[0].slow,101);assert.deepEqual(normalizeDrawings([{...drawings[0],points:[{date:'2024-02-30',price:10}]}]),[]);
});
test('drawing movement preserves relative positions, clamps date/price bounds and keeps source objects immutable',()=>{
 const bars=aggregateBars(sample),original={id:'line',kind:'trend',points:[{date:'2024-01-02',price:14},{date:'2024-01-05',price:12}],color:'#123456',width:1};
 const moved=shiftDrawing(original,1,3,bars);assert.deepEqual(moved.points,[{date:'2024-01-03',price:17},{date:'2024-01-08',price:15}]);assert.equal(original.points[0].price,14);
 assert.equal(shiftDrawing(original,-100,0,bars).points[0].date,'2023-12-29');assert.equal(shiftDrawing(original,0,-100,bars).points[1].price,0);
});
test('renderer shares one x scale across price, volume, oscillators and uses independent quote',()=>{
 const bars=aggregateBars(sample),settings=initialChartSettings();settings.indicators.push(newIndicator('rsi',2),newIndicator('macd'));
 const series=configuredSeries(bars,settings.indicators),g=analysisGeometry({bars,series,settings,width:900,quote:99});assert.ok(g.high>99);assert.equal(g.panels.length,3);assert.equal(g.panels[0].kind,'volume');assert.equal(g.panels[1].kind,'rsi');
 const html=analysisMarkup({g,bars,allBars:bars,start:0,series,settings,drawings:[],selectedDrawing:null,draft:null,quote:99,comparison:null,uid:'test'});assert.ok(html.includes('99'));assert.ok(!html.includes('NaN'));assert.ok(html.includes('sc-crosshair'));assert.ok(html.includes('30'));assert.ok(html.includes('70'));
 const mobile=analysisGeometry({bars,series,settings,width:360,quote:99});assert.deepEqual(mobile.panels.map(p=>p.kind),['volume','rsi']);
 settings.indicators[1].collapsed=true;const collapsed=analysisGeometry({bars,series,settings,width:900,quote:99});assert.equal(collapsed.panels[0].top,collapsed.panels[0].bottom);
 const narrow=analysisGeometry({bars,series,settings,width:900,quote:99,priceScale:.5});assert.ok(narrow.high-narrow.low<g.high-g.low);
});
test('zoom and panning stay within fetched history and preserve anchor across pinch factors',()=>{
 const base={start:100,count:100},zoom=zoomWindow(500,base,.5,.25);assert.equal(zoom.count,50);assert.ok(Math.abs((base.start+25)-(zoom.start+zoom.count*.25))<=1);
 assert.deepEqual(chartWindow(500,-100,100),{start:0,count:100});assert.deepEqual(chartWindow(500,490,100),{start:400,count:100});assert.deepEqual(zoomWindow(500,base,100),{start:0,count:500});
});
