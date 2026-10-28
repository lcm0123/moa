import {decimal} from './profile-calculations.mjs';
import {clean,norm} from './core.mjs';
const attr=(s,k)=>new RegExp('(?:^|\\s)'+k+'=["\']([^"\']+)["\']','i').exec(s)?.[1];
const tag=(s,k)=>new RegExp('<(?:[\\w-]+:)?'+k+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+k+'>','i').exec(s)?.[1];
// Static, bounded, issuer/context/member-aware reader. Never evaluates markup.
// Labels must be explicit in the document; custom tags are not discarded merely for their namespace.
export function inlineRevenueObservations(source,asset){
 const html=String(source.sectionHtml||'');if(html.length>1500000||/<!DOCTYPE|<!ENTITY/i.test(html))return [];
 const contexts=new Map(),units=new Map(),labels=new Map(),out=[];
 for(const m of html.matchAll(/<(?:\w+:)?label\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?label>/gi)){const id=attr(m[1],'id')||attr(m[1],'name');if(id)labels.set(id,clean(m[2]));}
 for(const m of html.matchAll(/<(?:\w+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?unit>/gi)){const measure=clean(tag(m[2],'measure')||'');if(/^(?:iso4217:)?(?:USD|KRW|EUR|JPY)$/.test(measure))units.set(attr(m[1],'id'),measure.replace('iso4217:',''));}
 for(const m of html.matchAll(/<(?:\w+:)?context\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?context>/gi)){
  const identifier=clean(tag(m[2],'identifier')||''),start=clean(tag(m[2],'startDate')||''),end=clean(tag(m[2],'endDate')||'');
  if(Number(identifier)!==Number(asset.issuerId)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))continue;
  const members=[...m[2].matchAll(/<(?:\w+:)?explicitMember\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?explicitMember>/gi)].map(x=>({axis:attr(x[1],'dimension'),member:clean(x[2])}));
  if(members.length!==1)continue;contexts.set(attr(m[1],'id'),{start,end,...members[0]});
 }
 for(const m of [...html.matchAll(/<(?:ix:nonFraction|([\w-]+):([\w-]+))\b([^>]*)>([\s\S]*?)<\/(?:ix:nonFraction|[\w-]+:[\w-]+)>/gi)].slice(0,5000)){
  const attrs=m[3],concept=attr(attrs,'name')||(m[1]+':'+m[2]),context=contexts.get(attr(attrs,'contextRef')),currency=units.get(attr(attrs,'unitRef'));if(!context||!currency||!/revenue|net.*sales/i.test(concept))continue;
  const label=labels.get(context.member)||attr(attrs,'data-member-label');if(!label)continue;
  const raw=clean(m[4]),n=decimal(raw),scale=Number(attr(attrs,'scale')||0);if(n===null||!Number.isInteger(scale)||Math.abs(scale)>12)continue;
  const digits=n.replace('.',''),places=(n.split('.')[1]||'').length-scale;let amount=places<=0?(BigInt(digits)*10n**BigInt(-places)).toString():digits.padStart(places+1,'0').slice(0,-places)+'.'+digits.padStart(places+1,'0').slice(-places);
  if(attr(attrs,'sign')==='-')amount='-'+amount;amount=decimal(amount);if(amount===null)continue;
  const days=(Date.parse(context.end)-Date.parse(context.start))/86400000,type=days<105?'SINGLE_QUARTER':days<200?'HALF_YEAR':days<290?'YTD':days<380?'ANNUAL':'UNKNOWN';
  const dimension=/geograph|country|region/i.test(context.axis)?'GEOGRAPHY':/product/i.test(context.axis)?'PRODUCT':/segment/i.test(context.axis)?'BUSINESS_SEGMENT':null;if(!dimension||!norm(source.body).includes(norm(raw)))continue;
  const fiscalYear=source.fiscalYear||null,fiscalQuarter=source.fiscalQuarter||null;
  out.push({dimension,label,value:null,amountExact:amount,reportedPercent:null,totalRevenue:null,period:context.start+' ~ '+context.end,explicitPeriod:{start:context.start,end:context.end,type,fiscalYear,fiscalQuarter,dateConfidence:'XBRL_CONTEXT'},unit:currency,multiplier:1,scope:source.consolidationScope||'UNSPECIFIED',rowQuote:raw,locator:(source.locator||source.url)+'#'+attr(attrs,'contextRef')+':'+concept,tableKey:source.id+':xbrl:'+context.end,classificationVersion:'xbrl:'+context.axis+':'+context.member,concept,context,sign:attr(attrs,'sign')||'+',scale,decimals:attr(attrs,'decimals'),revenueDefinition:'UNKNOWN'});
 }return out;
}
