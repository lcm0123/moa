import {sma,ema,bollinger,macd,rsi} from './technical-indicators.js';
import {ichimoku,stochastic,atr,obv} from './extended-indicators.js';
import {normalizeBars} from './stock-chart-model.js';
export const intervalLabel={day:'일봉',week:'주봉',month:'월봉'};
export function bucketKey(date,interval){
 if(interval==='month')return date.slice(0,7);
 if(interval==='week'){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
 return date;
}
// Aggregate the entire fetched history before selecting a visible window.
export function aggregateBars(daily,interval='day'){
 if(interval==='day')return daily.map(b=>({...b,startDate:b.date,endDate:b.date,samples:1}));
 const groups=new Map();for(const b of daily){const key=bucketKey(b.date,interval);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
 return [...groups.values()].map(group=>{
  const first=group[0],last=group.at(-1),ohlc=group.every(b=>b.ohlc),volume=group.every(b=>Number.isFinite(b.volume));
  return {date:last.date,startDate:first.date,endDate:last.date,samples:group.length,open:ohlc?first.open:null,high:ohlc?Math.max(...group.map(b=>b.high)):null,low:ohlc?Math.min(...group.map(b=>b.low)):null,close:last.close,volume:volume?group.reduce((sum,b)=>sum+b.volume,0):null,ohlc};
 });
}
export function configuredSeries(bars,indicators,interval='day'){
 const values=bars.map(b=>b.close),series=[],unit={day:'일',week:'주',month:'개월'}[interval];
 const add=(c,suffix,label,data,index=0,panel='price')=>series.push({id:c.id+suffix,owner:c.id,label,values:data,color:c.colors[index]||c.colors[0],width:c.widths[index]||c.widths[0],panel});
 for(const c of indicators.filter(c=>c.enabled)){
  if(c.kind==='sma'||c.kind==='ema')add(c,'',c.kind.toUpperCase()+' '+c.period+unit,(c.kind==='sma'?sma:ema)(values,c.period));
  if(c.kind==='bb'){const b=bollinger(values,c.period,c.deviations);add(c,'-mid','BB 중심 '+c.period,b.middle);add(c,'-upper','BB 상단 ×'+c.deviations,b.upper,1);add(c,'-lower','BB 하단 ×'+c.deviations,b.lower,2);}
  if(c.kind==='rsi')add(c,'','RSI '+c.period,rsi(values,c.period),0,'rsi');
  if(c.kind==='macd'){const m=macd(values,c.fast,c.slow,c.signal);add(c,'-macd','MACD '+c.fast+','+c.slow,m.line,0,'macd');add(c,'-signal','시그널 '+c.signal,m.signal,1,'macd');add(c,'-hist','히스토그램',m.histogram,2,'histogram');}
  if(c.kind==='ichimoku'){const m=ichimoku(bars,c.conversion,c.base,c.span,c.displacement);[['conversion','전환선 '+c.conversion],['base','기준선 '+c.base],['spanA','선행스팬 A'],['spanB','선행스팬 B '+c.span],['lagging','후행스팬']].forEach(([key,label],i)=>{add(c,'-'+key,label,m[key],i,'ichimoku');series.at(-1).component=key;});}
  if(c.kind==='stochastic'){const m=stochastic(bars,c.period,c.smoothK,c.smoothD);add(c,'-k','스토캐스틱 %K',m.k,0,'stochastic');add(c,'-d','스토캐스틱 %D',m.d,1,'stochastic');}
  if(c.kind==='atr')add(c,'','ATR '+c.period,atr(bars,c.period),0,'atr');
  if(c.kind==='obv')add(c,'','OBV',obv(bars),0,'obv');
 }
 return series;
}
// All comparison lines start on the SAME actual common date. Missing dates stay null.
export function comparisonSeries(main,comparisons,interval){
 const sources=comparisons.map(c=>({...c,lookup:new Map(aggregateBars(c.bars,interval).map(b=>[b.date,b.close]))}));
 const first=main.find(b=>b.close>0&&sources.every(s=>s.lookup.get(b.date)>0));
 if(!first)return {baseDate:null,series:[]};
 return {baseDate:first.date,series:[{id:'base',label:'현재 종목',color:'#087f73',width:2,values:main.map(b=>b.date<first.date?null:(b.close/first.close-1)*100)},...sources.map(s=>({id:s.key,label:s.label,color:s.color,width:2,values:main.map(b=>b.date<first.date||!s.lookup.has(b.date)?null:(s.lookup.get(b.date)/s.lookup.get(first.date)-1)*100)}))]};
}
export function dailyComparisonPoints(payload){
 if(payload.historyKind&&payload.historyKind!=='daily')return [];
 return normalizeBars((payload.points||[]).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.at||'')).map(p=>({date:p.at,value:p.value})));
}
