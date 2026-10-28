import {normalizeBars,selectPeriod} from './stock-chart-model.js';
import {sma} from './technical-indicators.js';

export const koreanMAPeriods=[5,20,60,120];
// Chart-facing contract is independent of the upstream provider.
export function koreanChartData(stock,feed){
 const bars=normalizeBars(feed.policy?.chart?stock.history:[]).filter(b=>b.ohlc&&b.open>0&&b.low>0&&b.close>0);
 const movingAverages=Object.fromEntries(koreanMAPeriods.map(period=>[period,sma(bars.map(b=>b.close),period)]));
 return {bars,movingAverages,baseDate:bars.at(-1)?.date||null,source:stock.historySource||feed.source||'연결된 일봉 공급사',receivedAt:stock.historyReceivedAt||null,
  adjustment:stock.historyMeta?.adjustment||'unverified',status:!feed.policy?.chart?'restricted':stock.historyStatus|| (bars.length?'ready':'empty'),
  message:!feed.policy?.chart?'차트 이용 권한 확인 필요':stock.historyError||'확보된 일봉 데이터가 없습니다.',stale:Boolean(stock.historyStale||stock.stale||feed.stale),historyWarning:stock.historyError||null,coverage:stock.historyMeta?.coverage||null};
}
export function koreanVisibleRange(bars,period){
 const selected=selectPeriod(bars,period);return {...selected,from:Math.max(0,bars.length-selected.items.length)-.7,to:bars.length-.3};
}
export function koreanSeriesData(model,colors){
 return {candles:model.bars.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close,color:b.close===b.open?colors.flat:undefined,wickColor:b.close===b.open?colors.flat:undefined})),
  volume:model.bars.map(b=>Number.isFinite(b.volume)?{time:b.date,value:b.volume,color:b.close>b.open?colors.up:b.close<b.open?colors.down:colors.flat}:{time:b.date}),
  averages:Object.fromEntries(koreanMAPeriods.map(period=>[period,model.bars.map((b,i)=>Number.isFinite(model.movingAverages[period][i])?{time:b.date,value:model.movingAverages[period][i]}:{time:b.date})]))};
}
