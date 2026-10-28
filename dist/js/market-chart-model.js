import {subtractMonths} from './stock-chart-model.js';
export const marketPeriods=[['1m','1개월',1],['3m','3개월',3],['6m','6개월',6],['1y','1년',12],['3y','3년',36],['all','전체',null]];
export function marketPoints(history=[]){
 const points=new Map();
 for(const p of history){const at=p.at,value=p.value;if(!Number.isFinite(value)||value<0||!Number.isFinite(Date.parse(at)))continue;const t=Date.parse(at);if(points.has(t)&&points.get(t).value!==value)return [];points.set(t,{at,value,t});}
 return [...points.values()].sort((a,b)=>a.t-b.t);
}
export function chartWindow(total,start,count){
 const size=Math.min(total,Math.max(Math.min(total,2),Math.round(count)));
 return {start:Math.max(0,Math.min(total-size,Math.round(start))),count:size};
}
export function periodWindow(points,id){
 const months=marketPeriods.find(p=>p[0]===id)?.[2];
 const cutoff=points.length&&months?Date.parse(subtractMonths(points.at(-1).at.slice(0,10),months)):-Infinity;
 const index=points.findIndex(p=>p.t>=cutoff);return chartWindow(points.length,Math.max(0,index),points.length-Math.max(0,index));
}
export function zoomWindow(total,window,factor,anchor=.5){
 const next=chartWindow(total,window.start,window.count*factor);
 return chartWindow(total,window.start+(window.count-next.count)*Math.max(0,Math.min(1,anchor)),next.count);
}
export function dateWindow(points,from,to){
 const start=Date.parse(from),end=Date.parse(to)+86400000-1;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)return null;
 const indices=points.map((p,i)=>p.t>=start&&p.t<=end?i:-1).filter(i=>i>=0);
 return indices.length?{start:indices[0],count:indices.length}:null;
}
