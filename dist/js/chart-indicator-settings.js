const key='moa-chart-indicators-v1';
const defaults={sma:[20],bollinger:false,oscillator:'macd'};
let memory=null;
export function normalizeSettings(value){return {sma:Array.isArray(value?.sma)?[5,20,60,120].filter(n=>value.sma.includes(n)):[...defaults.sma],bollinger:value?.bollinger===true,oscillator:value?.oscillator==='rsi'?'rsi':'macd'};}
export function readIndicatorSettings(storage){
 try{const raw=(storage??globalThis.localStorage)?.getItem(key);if(raw)memory=normalizeSettings(JSON.parse(raw));}catch{}
 return normalizeSettings(memory||defaults);
}
export function saveIndicatorSettings(value,storage){
 memory=normalizeSettings(value);try{(storage??globalThis.localStorage)?.setItem(key,JSON.stringify(memory));}catch{}
 return normalizeSettings(memory);
}
