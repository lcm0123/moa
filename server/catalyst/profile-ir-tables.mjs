import {revenueGrid} from './company-research-profile.mjs';
import {clean,norm} from './core.mjs';
import {decimal,ratio,add} from './profile-calculations.mjs';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const money=s=>decimal(String(s||'').replace(/^\$\s*/,''));
const iso=d=>d.toISOString().slice(0,10);
function period(year,month,day,length,fy,q){
 // Avoid inventing 52/53-week fiscal start dates from a calendar-month label.
 if(day!==new Date(Date.UTC(year,month,0)).getUTCDate())return null;
 return {start:iso(new Date(Date.UTC(year,month-length,1))),end:iso(new Date(Date.UTC(year,month-1,day))),type:length===3?'SINGLE_QUARTER':length===12?'ANNUAL':length===6?'HALF_YEAR':'YTD',fiscalYear:fy,fiscalQuarter:q,label:`FY ${fy||year}${length===3?' Q'+(q||'?'):length===12?' 연간':' '+length+'개월 누적'}`,dateConfidence:'EXPLICIT_TABLE_HEADER'};
}
export function englishSegmentObservations(source){
 const output=[],fyMatch=/\bFY\s*(20\d{2}|\d{2})\s*Q([1-4])\b/i.exec(source.body||''),fy=fyMatch?Number(fyMatch[1])+(fyMatch[1].length===2?2000:0):null,q=fyMatch?Number(fyMatch[2]):null;
 for(const [ti,m] of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  const grid=revenueGrid(m[0]);if(grid.length<4||!norm(source.body).includes(norm(clean(m[0]))))continue;
  const headers=grid.slice(0,2),unit=/\bIn millions\b/i.test(headers.flat().join(' '))&&grid.some(r=>r.some(c=>c.startsWith('$')))?'USD million':null;if(!unit)continue;
  const years=headers[1],top=headers[0],data=[];let label=null;
  for(let ri=2;ri<grid.length;ri++){const r=grid[ri];if(r[0]==='ElementName'&&r[1]){label=r[1];continue;}if(label&&/^(Revenue|Net sales|Net revenue)$/.test(r[1])&&/RevenueFromContractWithCustomer|SalesRevenueNet/.test(r[0]))data.push({label,row:r,ri,concept:r[0]});}
  const total=data.find(r=>/^Total$/i.test(r.label));if(!total)continue;
  for(let col=2;col<years.length;col++){
   const year=/^20\d{2}$/.test(years[col])?Number(years[col]):null,h=top[col]||'',match=/(Three|Six|Nine|Twelve) Months Ended\s+([A-Za-z]+)\s+(\d{1,2})/.exec(h);if(!year||!match)continue;
   const month=months.indexOf(match[2])+1,length={Three:3,Six:6,Nine:9,Twelve:12}[match[1]],fyForColumn=fy&&source.periodEnd?fy+year-Number(source.periodEnd.slice(0,4)):null,p=period(year,month,+match[3],length,fyForColumn,q);if(!month||!p)continue;
   const denominator=money(total.row[col]),items=data.filter(r=>r!==total&&money(r.row[col])!==null);if(!denominator||!items.length)continue;
   const reconciles=items.reduce((sum,r)=>add(sum,money(r.row[col])),'0')===denominator;
   for(const r of items){const amount=money(r.row[col]),quote=norm(clean([...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)][r.ri]?.[1]||''));if(!quote)continue;
    output.push({dimension:'BUSINESS_SEGMENT',label:r.label,parent:null,value:null,amountExact:amount,reportedPercent:null,calculatedShare:reconciles?ratio(amount,denominator):null,shareOrigin:reconciles?'DERIVED':null,totalRevenueExact:reconciles?denominator:null,period:p.label,explicitPeriod:p,scope:/consolidated/i.test(source.body)?'CONSOLIDATED':'UNSPECIFIED',unit,denominatorKind:reconciles?'COMPANY_TOTAL_REVENUE':'UNKNOWN',denominatorLabel:reconciles?'동일 표의 Total Revenue · 사업부 합계 일치':'총매출 범위 확인 필요',revenueDefinition:'EXTERNAL_CUSTOMER',rowQuote:quote,locator:source.locator+':segment:'+ti+':'+r.ri+':'+col,tableKey:source.id+':segment:'+ti+':'+col,extractionVersion:'official-ir-1',concept:r.concept,headerEvidence:headers,classificationVersion:'segment-original-label-v1'});
   }
  }
 }return output;
}
export function reportedQuarterSegmentObservations(source){
 const text=source.body||'',ending=/(?:first|second|third|fourth) quarter ended ([A-Za-z]+) (\d{1,2}), (20\d{2})/i.exec(text);if(!ending)return [];
 const month=months.findIndex(m=>m.toLowerCase()===ending[1].toLowerCase())+1,year=+ending[3],p=period(year,month,+ending[2],3,source.fiscalYear||null,source.fiscalQuarter||null);if(!p||p.end!==source.periodEnd)return [];
 const out=[];for(const [i,line] of text.split('\n').entries()){
  const m=/^(?:The )?(.{2,100}?(?:Division|Businesses|Corporation(?: \([A-Z]+\))?)) posted KRW ([\d,.]+) (trillion|billion|million) in consolidated revenue\b/.exec(line);
  if(!m||!/for the (?:first|second|third|fourth) quarter/i.test(line)||/expects|will|forecast/i.test(line))continue;
  out.push({dimension:'BUSINESS_SEGMENT',label:m[1],parent:null,value:null,amountExact:decimal(m[2]),reportedPercent:null,totalRevenue:null,period:p.label,explicitPeriod:p,scope:'CONSOLIDATED',entityScope:source.assetId+':SEGMENT',unit:'KRW '+m[3],revenueDefinition:'SEGMENT_REPORTED_BASIS',denominatorKind:'UNKNOWN',denominatorLabel:'사업부 연결 매출 · 내부거래 조정 범위 미확인',rowQuote:line,locator:source.locator+':reported-segment:'+i,tableKey:source.id+':reported-segment',extractionVersion:'official-ir-1'});
 }return out;
}
