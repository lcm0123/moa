// Shared by the server and the existing ranking/map views. No daily-return sums.
export function median(values){const a=values.filter(Number.isFinite).sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;}
export function breadth(stocks){const values=stocks.map(s=>s.changePct).filter(Number.isFinite),up=values.filter(v=>v>1e-9).length,down=values.filter(v=>v< -1e-9).length;return {used:values.length,up,down,flat:values.length-up-down,upRatio:values.length?up/values.length*100:null,median:median(values)};}
export function monthlySectors(stocks,definitions=[]){return definitions.map(s=>{const members=stocks.filter(x=>x.sectorId===s.id),stats=breadth(members);return {...s,stocks:members,industries:undefined,...stats,changePct:stats.median,marketCap:members.reduce((n,x)=>n+(x.marketCap||0),0)};}).filter(s=>s.used);}
export function filterMonthlyFlow(data,filter='all'){
 const stocks=(data?.stocks||[]).filter(s=>filter==='up'?s.changePct>1e-9:filter==='down'?s.changePct< -1e-9:filter==='flat'?Math.abs(s.changePct)<=1e-9:filter==='above-median'?s.changePct>=data.summary.median:filter==='underperform'?Number.isFinite(s.excessPct)&&s.excessPct<=1e-9:filter==='outperform'?Number.isFinite(s.excessPct)&&s.excessPct>1e-9:filter.startsWith('sector:')?s.sectorId===filter.slice(7):true);
 return {...data,stocks,items:monthlySectors(stocks,data?.items||[]),filter,filteredCount:stocks.length};
}
export function monthLabel(month,baseDate){return Number(month?.slice(5))+'월 누적 · '+(baseDate||'기준일 데이터 없음');}
