import {subtractMonths} from '../dist/js/stock-chart-model.js';
import {lastCompletedUsDay} from '../dist/js/us-market-session.js';
export function priceChanges(bars,now=Date.now()){
 const through=lastCompletedUsDay(now),points=bars.filter(b=>/^\d{4}-\d\d-\d\d$/.test(b.date)&&b.date<=through&&Number.isFinite(b.value)&&b.value>0).sort((a,b)=>a.date.localeCompare(b.date)),last=points.at(-1);
 if(!last||Date.parse(through)-Date.parse(last.date)>7*86400000)return null;
 const result={asOf:last.date,adjustment:'제공 종가 · 배당 미포함 · 분할 조정 미확인'};
 for(const months of [1,3]){const cutoff=subtractMonths(last.date,months),prior=points.filter(b=>b.date<=cutoff).at(-1);result['month'+months]=prior&&Date.parse(cutoff)-Date.parse(prior.date)<=7*86400000?(last.value/prior.value-1)*100:null;}
 return result;
}
export async function addManagerPrices(env,data){
 if(data.status!=='ready'||!env.READ_STOCK_HISTORY)return {...data,priceAvailability:{enabled:false,reason:'최근 일봉 가격 이력이 연결되지 않았습니다.'}};
 const byTicker=new Map();for(const row of data.items){if(row.ticker&&!byTicker.has(row.ticker)){const h=await env.READ_STOCK_HISTORY(row.ticker);byTicker.set(row.ticker,h?priceChanges(h.bars):null);}}
 return {...data,items:data.items.map(r=>({...r,priceChanges:byTicker.get(r.ticker)||null})),priceAvailability:{enabled:[...byTicker.values()].some(Boolean),reason:'제공 일봉이 있는 종목만 정렬 · 배당 미포함 · 분할 조정 미확인'}};
}
