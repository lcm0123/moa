export const WATCHLIST_KEY='moa-watchlist-v1';
const KEY=WATCHLIST_KEY;
export const validWatchKey=key=>typeof key==='string'&&/^(KR|US):[A-Za-z0-9.^_/-]{1,30}$/.test(key);
export function readWatchlist(storage){try{const value=JSON.parse((storage||globalThis.localStorage).getItem(KEY)||'[]');return Array.isArray(value)?[...new Set(value.filter(validWatchKey))].slice(0,100):[];}catch{return [];}}
export function saveWatchlist(values,storage,expected){
 const clean=[...new Set(values.filter(validWatchKey))];if(clean.length>100)throw new Error('관심종목은 최대 100개까지 등록할 수 있어요.');
 storage=storage||globalThis.localStorage;
 if(expected&&JSON.stringify(readWatchlist(storage))!==JSON.stringify(expected))throw new Error('다른 화면에서 관심종목이 변경되었습니다. 최신 목록에서 다시 시도해 주세요.');
 storage.setItem(KEY,JSON.stringify(clean));globalThis.dispatchEvent?.(new Event('moa-watchlist'));return clean;
}
export function moveWatchlist(key,direction,storage){const before=readWatchlist(storage),values=[...before],from=values.indexOf(key),to=from+direction;if(from<0||![-1,1].includes(direction)||to<0||to>=values.length)return values;[values[from],values[to]]=[values[to],values[from]];return saveWatchlist(values,storage,before);}
export function toggleWatchlist(market,ticker,storage){
 const key=market+':'+ticker;if(!validWatchKey(key))throw new Error('종목을 확인해 주세요.');
 const before=readWatchlist(storage),values=new Set(before);if(values.has(key))values.delete(key);else values.add(key);
 saveWatchlist([...values],storage,before);return values.has(key);
}
