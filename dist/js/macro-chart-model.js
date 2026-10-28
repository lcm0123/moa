// Per-point colour applies to the outgoing segment in Lightweight Charts 5.2.
// Keep missing observations blank with one line series, even for decades of daily data.
export function macroLinePoints(history,color='#087f73'){
 return history.map((p,i)=>Number.isFinite(p.value)?{time:p.date,value:p.value,color:i+1<history.length&&!Number.isFinite(history[i+1].value)?'transparent':color}:{time:p.date});
}
