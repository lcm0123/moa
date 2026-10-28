// Formatting only. Market data must come from licensed server-side providers.
export const indexDefinitions={KR:[['KOSPI','코스피'],['KOSDAQ','코스닥'],['KOSPI200','코스피200']],US:[['SPX','S&P 500'],['COMP','나스닥 종합'],['NDX','나스닥100'],['DJI','다우']]};
export const futuresDefinitions={KR:[['KOSPI200_F','코스피200 선물']],US:[['ES','S&P 500 선물'],['NQ','나스닥100 선물'],['YM','다우 선물']]};
export const modeLabels={realtime:'실시간',delayed:'지연 시세',previous_close:'전일 종가',snapshot:'조회 스냅샷 · 시세시각 미제공'};
export function percentage(n){return Number.isFinite(n)?(n>=0?'+':'−')+Math.abs(n).toFixed(2)+'%':'—';}
export function price(s){if(!Number.isFinite(s.price))return '—';return s.currency==='USD'?'$'+s.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):s.price.toLocaleString('ko-KR')+'원';}
export function amount(n,currency){if(!Number.isFinite(n))return '—';return currency==='USD'?'$'+(n/1e6).toLocaleString('en-US',{maximumFractionDigits:1})+'M':(n/1e8).toLocaleString('ko-KR',{maximumFractionDigits:1})+'억';}
export function time(value,full=false){if(!value||!Number.isFinite(Date.parse(value)))return '갱신 이력 없음';return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',...(full?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+' KST';}
export const series=()=>[];

export function dailyQuoteMeta(item){return (item.stale?'갱신 실패 · 마지막 저장값 · ':'')+'전일 기준 · '+item.baseDate+(item.syncedAt?' · 동기화 '+time(item.syncedAt,true):'');}
