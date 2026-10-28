export const PERIODS=[['hour','1시간'],['day','24시간'],['week','7일'],['month','30일']];
export function usdt(v,compact=false){return dollars(v,compact).replace('$','');}
export const finite=Number.isFinite;
const formatters=new Map();
export function dollars(v,compact=false){if(!finite(v))return '—';const abs=Math.abs(v),digits=abs>=1?2:Math.min(12,Math.max(4,Math.ceil(-Math.log10(abs||1))+3)),key=compact?'compact':digits+':'+(abs>=1);if(!formatters.has(key))formatters.set(key,new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',...(compact?{notation:'compact',maximumFractionDigits:2}:{minimumFractionDigits:abs>=1?2:0,maximumFractionDigits:digits})}));return formatters.get(key).format(v);}
export const pct=v=>finite(v)?(v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(2)+'%':'—';
export const tone=v=>!finite(v)?'missing':v>0?'up':v<0?'negative':'neutral-text';
export const at=v=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))+' KST':'수신 기록 없음';
export const ret=(c,p)=>finite(c.returns?.[p])?c.returns[p]:null;
export function loadStars(demo=false){try{return new Set(JSON.parse(localStorage.getItem('moa.crypto.watch.v1'+(demo?'.demo':''))||'[]').filter(v=>typeof v==='string'));}catch{return new Set();}}
export function saveStars(stars,demo=false){localStorage.setItem('moa.crypto.watch.v1'+(demo?'.demo':''),JSON.stringify([...stars]));dispatchEvent(new Event('crypto-watch-change'));}
