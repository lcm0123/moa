import {at} from './crypto-format.js';
export const validKrwRate=c=>Number.isFinite(c?.rate)&&c.rate>0&&c.base==='USDT'&&c.quote==='KRW';
export const toKrw=(value,c)=>Number.isFinite(value)&&validKrwRate(c)?value*c.rate:null;
export function won(value,compact=false){
 if(!Number.isFinite(value))return '—';
 const abs=Math.abs(value);
 if(compact)for(const [divisor,label] of [[1e12,'조'],[1e8,'억'],[1e4,'만']])if(abs>=divisor)return (value/divisor).toLocaleString('ko-KR',{maximumFractionDigits:2})+label;
 return value.toLocaleString('ko-KR',{maximumFractionDigits:abs>=100?0:abs>=1?2:Math.min(12,Math.max(2,Math.ceil(-Math.log10(abs||1))+2))});
}
export const krwAmount=(value,c,compact=false)=>won(toKrw(value,c),compact);
export function krwBasis(c){return validKrwRate(c)?`원화 환산 · 1 USDT = ${won(c.rate)}원 · ${c.source} · ${at(c.asOf)}${c.stale?' · 환산율 갱신 지연':''}`:'원화 환산율 연결 필요';}
