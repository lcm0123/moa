import {norm} from './core.mjs';
import {eventState} from './normalization.mjs';
export const validationVersion='claim-ledger-2.5';
const scales={thousand:1000,million:1e6,billion:1e9,trillion:1e12,천:1000,만:1e4,백만:1e6,억:1e8,조:1e12};
const money=s=>/USD|US\$|\$/i.test(s)?'USD':/KRW|원|₩/i.test(s)?'KRW':/EUR|€/i.test(s)?'EUR':/JPY|엔|¥/i.test(s)?'JPY':null;
function decimal(s){let [a,b='']=s.replace(/,/g,'').replace(/^[+-]/,'').split('.');a=a.replace(/^0+(?=\d)/,'');b=b.replace(/0+$/,'');return a+(b?'.'+b:'');}
function scaled(value,multiplier){const [a,b='']=value.split('.'),digits=BigInt(a+b)*BigInt(multiplier),str=digits.toString().padStart(b.length+1,'0');return decimal(b?str.slice(0,-b.length)+'.'+str.slice(-b.length):str);}
export function parsePeriod(text){
 const t=norm(text),years=[...new Set(t.match(/\b(?:19|20)\d{2}\b/g)||[])].sort();
 const quarters=[...t.matchAll(/\bQ([1-4])\b|([1-4])\s*분기|\b([1-4])Q\b/gi)].map(m=>'Q'+(m[1]||m[2]||m[3]));
 const frequency=/TTM|trailing twelve|최근\s*12개월/i.test(t)?'ttm':/반기|[12]H\b|H[12]\b|half.year/i.test(t)?'half_year':/annual|yearly|full.year|연간|연도/i.test(t)?'annual':/quarter|분기|\bQ[1-4]\b|\b[1-4]Q\b/i.test(t)?'quarterly':/monthly|월간/i.test(t)?'monthly':/기준일|as.of/i.test(t)?'as_of':null;
 const accumulation=/누적|cumulative|year.to.date|\bYTD\b/i.test(t)?'cumulative':/단일\s*분기|standalone quarter|single quarter/i.test(t)?'single_quarter':null;
 const halves=[...t.matchAll(/\b([12])H\b|\bH([12])\b|(상|하)반기/gi)].map(m=>'H'+(m[1]||m[2]||(m[3]==='상'?'1':'2')));
 const dates=t.match(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g)||[];
 return {years,quarters:[...new Set(quarters)].sort(),frequency,...(accumulation?{accumulation}:{}),...(halves.length?{halves:[...new Set(halves)].sort()}:{}),...(dates.length?{dates:[...new Set(dates)].sort()}:{} )};
}
export function parseScope(text){
 const t=norm(text),consolidation=/consolidated|연결/i.test(t)?'consolidated':/standalone|separate financial|별도|개별재무/i.test(t)?'standalone':null;
 const planned=/plan(?:s|ned|ning)?|propos(?:ed|al)|intend|will|예정|계획|검토/i.test(t),completed=/completed|commissioned|완료|가동을 시작/i.test(t),executed=/executed|invested|집행했다|집행하였다|투자했다|투자하였다/i.test(t);
 const state=eventState(t);
 return {consolidation,execution:planned&&(completed||executed)?'mixed':planned?'planned':completed?'completed':executed?'executed':null,...(state?{eventState:state}:{})};
}
export function parseTypedValues(text){
 const t=norm(text).replaceAll('−','-'),period=parsePeriod(t),scope=parseScope(t),out=[];
 const re=/(?<![\p{L}\p{N}])(?:(USD|KRW|EUR|JPY|US\$|\$|₩|€|¥)\s*)?([+-]?\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|백만|억|조|만|천)?\s*(USD|KRW|EUR|JPY|dollars?|원|엔|%p|percentage points?|퍼센트포인트|%|percent|bp|bps|basis points?|shares?|주|MW|GW|MWh|GWh|tons?|톤)?/giu;
 for(const m of t.matchAll(re)){
  const raw=m[2],suffix=(m[4]||'').toLowerCase(),currency=money((m[1]||'')+' '+(m[4]||''))||(/dollars?/.test(suffix)?'USD':null);
  const adjacent=/^[\p{L}]+/u.exec(t.slice(m.index+m[0].trimEnd().length))?.[0];
  const unit=currency?'currency':/%p|percentage points?|퍼센트포인트/.test(suffix)?'percentage_point':/%|percent/.test(suffix)?'percent':/bp|basis point/.test(suffix)?'basis_point':/share|^주$/.test(suffix)?'shares':suffix||(/^(19|20)\d{2}$/.test(raw)?'year':adjacent?'unknown:'+adjacent:'number');
  const value=decimal(raw),multiplier=scales[(m[3]||'').toLowerCase()]||1,sign=Number(value)===0?0:raw.startsWith('-')?-1:1;
  out.push({value,sign,currency,unit,multiplier,normalizedValue:scaled(value,multiplier),period,scope,raw:m[0].trim()});
 }
 return out;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function compareTypedValues(evidence,claim){
 const e=parseTypedValues(evidence),c=parseTypedValues(claim);
 // Corresponding ordered quantities must agree; no substring matching or swapping
 // values between revenue/profit. Decimal strings avoid floating-point precision loss.
 const numeric=e.length===c.length&&c.every((v,i)=>v.normalizedValue===e[i].normalizedValue&&v.sign===e[i].sign);
 const units=e.length===c.length&&c.every((v,i)=>v.unit===e[i].unit&&v.currency===e[i].currency);
 return {values:c,evidenceValues:e,numeric,units,period:same(parsePeriod(evidence),parsePeriod(claim)),scope:same(parseScope(evidence),parseScope(claim))};
}
