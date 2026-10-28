// Closing-price indicators. Missing/warm-up observations remain null, never zero-filled.
const finite=Number.isFinite;
function periodCheck(period){if(!Number.isInteger(period)||period<1)throw new RangeError('Invalid indicator period');}
export function sma(values,period){
 periodCheck(period);let window=[],sum=0;
 return values.map(value=>{if(!finite(value)){window=[];sum=0;return null;}window.push(value);sum+=value;if(window.length>period)sum-=window.shift();return window.length===period?sum/period:null;});
}
export function ema(values,period){
 periodCheck(period);let count=0,sum=0,previous=null;const alpha=2/(period+1);
 return values.map(value=>{
  if(!finite(value)){count=0;sum=0;previous=null;return null;}
  if(previous===null){sum+=value;if(++count<period)return null;previous=sum/period;}
  else previous+=(value-previous)*alpha;
  return previous;
 });
}
export function macd(values,fastPeriod=12,slowPeriod=26,signalPeriod=9){
 const fast=ema(values,fastPeriod),slow=ema(values,slowPeriod);
 const line=values.map((_,i)=>finite(fast[i])&&finite(slow[i])?fast[i]-slow[i]:null),signal=ema(line,signalPeriod);
 return {line,signal,histogram:line.map((v,i)=>finite(v)&&finite(signal[i])?v-signal[i]:null)};
}
export function rsi(values,period=14){
 periodCheck(period);let previous=null,count=0,gain=0,loss=0;
 return values.map(value=>{
  if(!finite(value)){previous=null;count=0;gain=0;loss=0;return null;}
  if(previous===null){previous=value;return null;}
  const delta=value-previous;previous=value;const up=Math.max(0,delta),down=Math.max(0,-delta);
  if(count<period){gain+=up;loss+=down;if(++count<period)return null;gain/=period;loss/=period;}
  else{gain=(gain*(period-1)+up)/period;loss=(loss*(period-1)+down)/period;}
  // A genuinely flat valid window is neutral; this is not a warm-up value.
  return gain===0&&loss===0?50:loss===0?100:gain===0?0:100-100/(1+gain/loss);
 });
}
export function bollinger(values,period=20,deviations=2){
 const middle=sma(values,period);let window=[];const upper=[],lower=[];
 values.forEach((value,i)=>{if(!finite(value))window=[];else{window.push(value);if(window.length>period)window.shift();}
  const deviation=middle[i]===null?null:Math.sqrt(window.reduce((sum,v)=>sum+(v-middle[i])**2,0)/period);
  upper.push(deviation===null?null:middle[i]+deviations*deviation);lower.push(deviation===null?null:middle[i]-deviations*deviation);
 });return {middle,upper,lower};
}
export function calculateIndicators(bars){
 const closes=bars.map(b=>b.close),averages=Object.fromEntries([5,20,60,120].map(n=>[n,sma(closes,n)])),bands=bollinger(closes),oscillator=macd(closes),strength=rsi(closes);
 return bars.map((bar,i)=>({...bar,indicators:{sma:Object.fromEntries([5,20,60,120].map(n=>[n,averages[n][i]])),bb:{middle:bands.middle[i],upper:bands.upper[i],lower:bands.lower[i]},macd:oscillator.line[i],signal:oscillator.signal[i],histogram:oscillator.histogram[i],rsi:strength[i]}}));
}
// Start a new path after missing data instead of connecting across unavailable sections.
export function indicatorPath(values,x,y){
 let drawing=false;return values.map((value,i)=>{if(!finite(value)){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return command+x(i).toFixed(2)+' '+y(value).toFixed(2);}).join(' ');
}
