import {kstClock} from './calendar-model.js';
import {economicLabel} from './economic-labels.js';
export const present=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&!['-','—','N/A','NA','null'].includes(String(value).trim());
const number=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
const signed=value=>(value>0?'+':value<0?'−':'')+number(Math.abs(value));
export function economicDifference(actual,expected){
 if(!present(actual)||!present(expected))return null;
 const parse=value=>String(value).trim().replaceAll(',','').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%|[KMBT])?$/i);
 const a=parse(actual),e=parse(expected);if(!a||!e)return null;
 const au=(a[2]||'').toUpperCase(),eu=(e[2]||'').toUpperCase();
 if((au==='%')!==(eu==='%'))return null;
 const units={'':1,K:1e3,M:1e6,B:1e9,T:1e12,'%':1};
 // Bare values and scaled counts cannot safely be combined without a stated unit.
 if((!au&&eu)||(!eu&&au))return null;
 const diff=(Number(a[1])*units[au]-Number(e[1])*units[eu])/units[eu];
 return signed(Math.round(diff*1e8)/1e8)+(eu==='%'?'%p':eu);
}
export function economicMetrics(event){
 const pairs=[];
 if(present(event.actual))pairs.push(['발표',event.actual]);
 if(present(event.expected))pairs.push(['예상',event.expected]);
 const diff=economicDifference(event.actual,event.expected);if(diff!==null)pairs.push(['예상 대비',diff]);
 if(present(event.prior))pairs.push(['이전',event.prior]);
 return pairs;
}
export function economicTooltip(event){
 const released=present(event.actual),first=[economicLabel(event).title,released?'발표 '+event.actual:event.startsAt?kstClock(event.startsAt)+' KST':'시간 미정'].join(' · ');
 const rest=economicMetrics(event).filter(([key])=>key!=='발표').map(([key,value])=>key+' '+value).join(' · ');
 return [first,rest].filter(Boolean);
}
export function usd(value,compact=false){
 if(!Number.isFinite(value))return null;
 return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:compact?2:4,...(compact?{notation:'compact'}:{})}).format(value);
}
export function epsDifference(event){
 const asOf=Date.parse(event.estimateAsOf),released=Date.parse(event.actualPublishedAt||event.startsAt);
 const estimateDay=Number.isFinite(asOf)?new Intl.DateTimeFormat('en-CA',{timeZone:event.market==='KR'?'Asia/Seoul':'America/New_York'}).format(new Date(asOf)):null;
 const confirmed=Number.isFinite(asOf)&&(Number.isFinite(released)?asOf<released:event.originalDate&&estimateDay<event.originalDate);
 return confirmed&&Number.isFinite(event.epsActual)&&Number.isFinite(event.epsEstimate)?Math.round((event.epsActual-event.epsEstimate)*1e6)/1e6:null;
}
export function signedUsd(value){return Number.isFinite(value)?(value>0?'+':value<0?'−':'')+usd(Math.abs(value)):null;}
export function earningsSession(event){return event.session==='BMO'?'BMO · 미국 장 시작 전':event.session==='AMC'?'AMC · 미국 장 마감 후':'발표 시점 미정';}
export function earningsTooltip(event){
 const released=Number.isFinite(event.epsActual)||Number.isFinite(event.revenueActual);
 const pair=(actual,estimate,compact)=>Number.isFinite(actual)&&Number.isFinite(estimate)?'실제/예상 '+usd(actual,compact)+'/'+usd(estimate,compact):Number.isFinite(actual)?'실제 '+usd(actual,compact):Number.isFinite(estimate)?'예상 '+usd(estimate,compact):'';
 const eps=pair(event.epsActual,event.epsEstimate,false),revenue=pair(event.revenueActual,event.revenueEstimate,true),epsLabel=event.epsBasis==='adjusted'?'조정 EPS':event.epsBasis==='GAAP'?'GAAP EPS':'EPS 기준 미확인';
 if(!released)return [[event.name,earningsSession(event)].join(' · '),[eps?epsLabel+' '+eps:null,revenue?'매출 '+revenue:null].filter(Boolean).join(' · ')].filter(Boolean);
 return [[event.name,eps?epsLabel+' '+eps:null].filter(Boolean).join(' · '),revenue?'매출 '+revenue:null].filter(Boolean);
}
export function groupEarnings(items,favorites=[]){
 const saved=new Set(favorites),groups=new Map();
 for(const item of items){const day=item.dateKst||'unconfirmed';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(item);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,events])=>({date,items:events.sort((a,b)=>Number(saved.has('US:'+b.ticker))-Number(saved.has('US:'+a.ticker))||Number(!!b.indices?.length)-Number(!!a.indices?.length)||(b.marketCap??-Infinity)-(a.marketCap??-Infinity)||a.ticker.localeCompare(b.ticker))}));
}

export function filterEarnings(items,query=""){const normalize=v=>String(v??"").normalize("NFKC").toLowerCase().replace(/[\s.\-]/g,"");const q=normalize(query);return !q?items:items.filter(item=>[item.name,item.ticker].some(value=>normalize(value).includes(q)));}

// The current earnings adapter reports market capitalization in USD.
export const earningsLargeCapThreshold=10_000_000_000;
export function earningsLargeCap(item){return Number.isFinite(item.marketCap)&&item.marketCap>=earningsLargeCapThreshold;}
