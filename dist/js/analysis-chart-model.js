import {normalizeBars} from './stock-chart-model.js';
import {koreanChartData} from './korean-chart-model.js';
import {initialChartSettings,normalizeChartSettings,normalizeDrawings,newIndicator} from './stock-chart-state.js';
import {clientId} from './client-id.js';

// Provider-independent chart contract; quotes never replace historical closes.
export const analysisDataAdapters={
 KR:koreanChartData,
 US(stock,feed){const bars=normalizeBars(feed.policy?.chart?stock.history:[]).filter(b=>b.close>0);return {bars,baseDate:bars.at(-1)?.date||null,source:stock.historySource||feed.source||'미국 일봉 공급사',receivedAt:stock.historyReceivedAt||null,adjustment:stock.historyMeta?.adjustment||stock.adjustment||'unverified',status:!feed.policy?.chart?'restricted':bars.length?'ready':'empty',message:!feed.policy?.chart?'차트 이용 권한 확인 필요':stock.historyError||'확보된 일봉 데이터가 없습니다.',stale:!!(stock.historyStale||stock.stale||feed.stale),historyWarning:stock.historyError||null};}
};
export function analysisData(stock,feed){const data=analysisDataAdapters[stock.market]?.(stock,feed);if(!data)throw new Error('지원하지 않는 시장');return {...data,currency:stock.currency||(stock.market==='KR'?'KRW':'USD'),timeZone:stock.market==='KR'?'Asia/Seoul':'America/New_York',market:stock.market};}
const prefix='moa-lightweight-analysis-v1:';
let memoryUser;
export function chartUser(storage){try{storage??=globalThis.localStorage;let id=storage.getItem(prefix+'user');if(!/^[\w-]{1,80}$/.test(id||'')){id=memoryUser||clientId();storage.setItem(prefix+'user',id);}return id;}catch{return memoryUser||=clientId();}}
export function defaultAnalysisSettings(){const settings=initialChartSettings();settings.indicators.splice(1,0,{...newIndicator('sma',60),id:'sma-60',colors:['#7562c7','#d35477','#7562c7']});return settings;}
export function readAnalysisState(user,stockKey,storage){let value,defaults;try{storage??=globalThis.localStorage;value=JSON.parse(storage.getItem(prefix+user+':'+stockKey)||'null');defaults=JSON.parse(storage.getItem(prefix+user+':defaults')||'null');}catch{}return {settings:normalizeChartSettings(value?.settings||defaults||defaultAnalysisSettings()),drawings:normalizeDrawings(value?.drawings)};}
export function saveAnalysisState(user,stockKey,state,storage=globalThis.localStorage){storage.setItem(prefix+user+':'+stockKey,JSON.stringify({settings:normalizeChartSettings(state.settings),drawings:normalizeDrawings(state.drawings)}));}
export function saveAnalysisDefault(user,settings,storage=globalThis.localStorage){storage.setItem(prefix+user+':defaults',JSON.stringify(normalizeChartSettings(settings)));}
