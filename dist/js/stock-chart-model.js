import {validDay} from './calendar-model.js';

export const chartPeriods=[['1m','1개월',1],['3m','3개월',3],['6m','6개월',6],['1y','1년',12],['3y','3년',36],['all','전체',null]];
export function normalizeBars(history=[]){
 if(!Array.isArray(history))return [];
 const byDate=new Map();
 for(const bar of history){
  const date=bar.date||bar.at?.slice(0,10),close=bar.close??bar.value;
  if(!validDay(date)||!Number.isFinite(close)||close<0)continue;
  const ohlc=[bar.open,bar.high,bar.low].every(n=>Number.isFinite(n)&&n>=0)&&bar.high>=Math.max(bar.open,close)&&bar.low<=Math.min(bar.open,close);
  byDate.set(date,{date,close,open:ohlc?bar.open:null,high:ohlc?bar.high:null,low:ohlc?bar.low:null,volume:Number.isFinite(bar.volume)&&bar.volume>=0?bar.volume:null,ohlc});
 }
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function subtractMonths(day,months){
 const [y,m,d]=day.split('-').map(Number),target=new Date(Date.UTC(y,m-1-months,1));
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 target.setUTCDate(Math.min(d,last));return target.toISOString().slice(0,10);
}
export function selectPeriod(bars,period){
 const months=chartPeriods.find(p=>p[0]===period)?.[2];
 const cutoff=bars.length&&months?subtractMonths(bars.at(-1).date,months):null;
 const items=cutoff?bars.filter(b=>b.date>=cutoff):bars;
 const first=items[0],last=items.at(-1);
 return {items,cutoff,partial:Boolean(cutoff&&bars[0]?.date>cutoff),start:first?.date,end:last?.date,
  returnPct:items.length>1&&first.close>0?(last.close/first.close-1)*100:null,
  candles:items.length>0&&items.every(b=>b.ohlc),volume:items.some(b=>b.volume!==null)};
}
export function chartGeometry(bars,width,height,candles=false,overlayValues=[]){
 const left=10,right=width<500?65:80,top=20,bottom=height-28,volumeHeight=bars.some(b=>b.volume!==null)?55:0;
 const priceBottom=bottom-(volumeHeight?volumeHeight+26:0),plotWidth=Math.max(1,width-left-right);
 const values=[...bars.flatMap(b=>candles&&b.ohlc?[b.low,b.high]:[b.close]),...overlayValues.filter(Number.isFinite)];
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.08,Math.abs(max)*.005,.01);
 const low=min<0?min-pad:Math.max(0,min-pad),high=max+pad;
 const x=i=>left+plotWidth*(i+.5)/bars.length,y=value=>priceBottom-(value-low)/(high-low)*(priceBottom-top);
 const maxVolume=Math.max(1,...bars.map(b=>b.volume??0));
 return {left,right,top,bottom,priceBottom,plotWidth,volumeHeight,low,high,x,y,maxVolume};
}
export function nearestBar(clientX,rect,geometry,count){
 return Math.max(0,Math.min(count-1,Math.floor((clientX-rect.left-geometry.left)/geometry.plotWidth*count)));
}
