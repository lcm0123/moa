import {sma} from './technical-indicators.js';
const finite=Number.isFinite;
function period(n){if(!Number.isInteger(n)||n<1||n>500)throw new RangeError('Invalid indicator period');}
// A missing high/low invalidates the full look-back window; never substitute closes.
export function rollingRange(bars,length){
 period(length);let window=[];
 return bars.map(b=>{if(!finite(b.high)||!finite(b.low)||b.high<b.low){window=[];return null;}window.push(b);if(window.length>length)window.shift();return window.length===length?{high:Math.max(...window.map(x=>x.high)),low:Math.min(...window.map(x=>x.low))}:null;});
}
export function ichimoku(bars,conversion=9,base=26,span=52,displacement=26){
 period(displacement);const midpoint=n=>rollingRange(bars,n).map(r=>r?(r.high+r.low)/2:null),tenkan=midpoint(conversion),kijun=midpoint(base),b=midpoint(span),a=tenkan.map((v,i)=>finite(v)&&finite(kijun[i])?(v+kijun[i])/2:null);
 // Positive indices are BAR positions, not guessed calendar dates. No candles are fabricated.
 const lead=values=>[...Array(displacement).fill(null),...values];
 const lag=bars.map((_,i)=>finite(bars[i+displacement]?.close)?bars[i+displacement].close:null);
 return {conversion:tenkan,base:kijun,spanA:lead(a),spanB:lead(b),lagging:lag};
}
export function stochastic(bars,length=14,smoothK=3,smoothD=3){
 const ranges=rollingRange(bars,length),raw=bars.map((b,i)=>{const r=ranges[i];return r&&r.high>r.low&&finite(b.close)?100*(b.close-r.low)/(r.high-r.low):null;});
 const k=sma(raw,smoothK);return {k,d:sma(k,smoothD)};
}
// Wilder RMA: seed with period-length SMA, then (previous*(period-1)+TR)/period.
export function atr(bars,length=14){
 period(length);let previousClose=null,count=0,total=0,average=null;
 return bars.map(b=>{if(!finite(b.high)||!finite(b.low)||!finite(b.close)||b.high<b.low){previousClose=null;count=0;total=0;average=null;return null;}
  const tr=previousClose===null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-previousClose),Math.abs(b.low-previousClose));previousClose=b.close;
  if(average===null){total+=tr;if(++count<length)return null;average=total/length;}else average=(average*(length-1)+tr)/length;return average;
 });
}
// OBV is relative to the first fetched bar (zero origin). A gap breaks the cumulative chain.
// Do not restart after a gap and present the new total as comparable with the old total.
export function obv(bars){
 let previous=null,total=0,broken=false;
 return bars.map(b=>{if(broken||!finite(b.close)||!finite(b.volume)||b.volume<0){broken=true;return null;}if(previous!==null)total+=Math.sign(b.close-previous)*b.volume;previous=b.close;return total;});
}
