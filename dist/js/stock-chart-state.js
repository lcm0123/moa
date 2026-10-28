import {validDay} from './calendar-model.js';
import {clientId} from './client-id.js';
const PREFIX='moa-stock-chart-v2:',DEFAULT_KEY=PREFIX+'defaults';
export const palette=['#b7791f','#7562c7','#087f73','#d35477','#327fba','#bd651e'];
export const panelIndicatorKinds=['volume','rsi','macd','stochastic','atr','obv'];
export const oscillatorKinds=panelIndicatorKinds.filter(k=>k!=='volume');
const kinds=['sma','ema','bb','ichimoku',...panelIndicatorKinds];
const finite=Number.isFinite,color=(value,fallback)=>/^#[a-f\d]{6}$/i.test(value||'')?value:fallback;
const number=(value,fallback,min,max)=>finite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
export function newIndicator(kind,period){
 return {id:kind+'-'+clientId(),kind,enabled:true,period:period||({rsi:14,stochastic:14,atr:14,ema:12}[kind]||20),deviations:2,fast:12,slow:26,signal:9,conversion:9,base:26,span:52,displacement:26,smoothK:3,smoothD:3,cloud:true,cloudOpacity:16,colors:kind==='ichimoku'?['#327fba','#bd651e','#258b72','#c45868','#7562c7']:[kind==='sma'?'#b7791f':kind==='rsi'?'#7562c7':'#327fba','#d35477','#7562c7'],widths:kind==='ichimoku'?[1.5,1.5,1,1,1.5]:[1.6,1.6,1.2],height:kind==='volume'?95:140,collapsed:false};
}
export function initialChartSettings(){return {interval:'day',period:'3m',type:'candles',grid:true,currentPrice:true,priceHeight:460,indicators:[{...newIndicator('sma',20),id:'sma-20'},{...newIndicator('volume'),id:'volume'}],mobileAux:'rsi'};}
export function normalizeChartSettings(input){
 const d=initialChartSettings(),seen=new Set();
 const indicators=Array.isArray(input?.indicators)?input.indicators.filter(c=>c&&kinds.includes(c.kind)&&typeof c.id==='string'&&/^[\w-]{1,80}$/.test(c.id)&&!seen.has(c.id)&&seen.add(c.id)).slice(0,15).map(c=>{
  const base=newIndicator(c.kind),fast=Math.round(number(c.fast,12,2,499)),slow=Math.max(fast+1,Math.round(number(c.slow,26,3,500)));
  return {...base,id:c.id,enabled:c.enabled!==false,period:Math.round(number(c.period,base.period,1,500)),deviations:number(c.deviations,2,.1,5),fast,slow,signal:Math.round(number(c.signal,9,1,200)),conversion:Math.round(number(c.conversion,9,1,500)),base:Math.round(number(c.base,26,1,500)),span:Math.round(number(c.span,52,1,500)),displacement:Math.round(number(c.displacement,26,1,100)),smoothK:Math.round(number(c.smoothK,3,1,500)),smoothD:Math.round(number(c.smoothD,3,1,500)),cloud:c.cloud!==false,cloudOpacity:number(c.cloudOpacity,16,0,60),colors:base.colors.map((v,i)=>color(c.colors?.[i],v)),widths:base.widths.map((v,i)=>number(c.widths?.[i],v,.5,5)),height:Math.round(number(c.height,base.height,60,350)),collapsed:c.collapsed===true};
 }):d.indicators;
 // Oscillators and volume have a single shared panel each.
 const panels=new Set();const unique=indicators.filter(c=>['sma','ema','bb'].includes(c.kind)||!panels.has(c.kind)&&panels.add(c.kind));
 return {interval:['day','week','month'].includes(input?.interval)?input.interval:d.interval,period:['1m','3m','6m','1y','3y','all'].includes(input?.period)?input.period:d.period,type:['candles','line','area'].includes(input?.type)?input.type:d.type,grid:input?.grid!==false,currentPrice:input?.currentPrice!==false,priceHeight:Math.round(number(input?.priceHeight,460,300,800)),indicators:unique,mobileAux:oscillatorKinds.includes(input?.mobileAux)?input.mobileAux:'rsi'};
}
export function normalizeDrawings(input){
 if(!Array.isArray(input))return [];
 return input.filter(d=>d&&typeof d.id==='string'&&/^[\w-]{1,80}$/.test(d.id)&&['horizontal','trend','range'].includes(d.kind)&&Array.isArray(d.points)&&d.points.length===(d.kind==='horizontal'?1:2)&&d.points.every(p=>validDay(p.date)&&finite(p.price)&&p.price>=0)).slice(0,100).map(d=>({id:d.id,kind:d.kind,points:d.points.map(p=>({date:p.date,price:p.price})),color:color(d.color,'#7562c7'),width:number(d.width,1.5,.5,5)}));
}
export function readChartState(key,storage=globalThis.localStorage){
 let defaults,stored;try{defaults=JSON.parse(storage.getItem(DEFAULT_KEY)||'null');stored=JSON.parse(storage.getItem(PREFIX+key)||'null');}catch{}
 return {settings:normalizeChartSettings(stored?.settings||defaults),drawings:normalizeDrawings(stored?.drawings)};
}
export function saveChartState(key,state,storage=globalThis.localStorage){
 const clean={settings:normalizeChartSettings(state.settings),drawings:normalizeDrawings(state.drawings)};storage.setItem(PREFIX+key,JSON.stringify(clean));return clean;
}
export function saveDefaultChart(settings,storage=globalThis.localStorage){storage.setItem(DEFAULT_KEY,JSON.stringify(normalizeChartSettings(settings)));}
export function drawingIndex(bars,date){
 let best=0;for(let i=0;i<bars.length;i++){if(bars[i].startDate<=date&&bars[i].endDate>=date)return i;if(Math.abs(Date.parse(bars[i].date)-Date.parse(date))<Math.abs(Date.parse(bars[best].date)-Date.parse(date)))best=i;}return best;
}
export function shiftDrawing(drawing,deltaBars,deltaPrice,bars){
 const indices=drawing.points.map(p=>drawingIndex(bars,p.date)),min=Math.min(...indices),max=Math.max(...indices),shift=Math.max(-min,Math.min(bars.length-1-max,Math.round(deltaBars)));
 const priceShift=Math.max(-Math.min(...drawing.points.map(p=>p.price)),deltaPrice);
 return {...drawing,points:drawing.points.map((p,i)=>({date:shift?bars[indices[i]+shift].date:p.date,price:Math.max(0,p.price+priceShift)}))};
}
