import {revenueGrid} from './company-research-profile.mjs';
import {add,decimal,ratio} from './profile-calculations.mjs';
import {clean,norm} from './core.mjs';
const compact=s=>String(s||'').replace(/\s/g,'');
const signed=s=>{const text=compact(s).replace(/^[△▲−]/,'-');return /^-?[\d,]+(?:\.\d+)?$/.test(text)?decimal(text):null;};
const totalLabel=s=>/^(합계|총계|총매출액)$/.test(compact(s));
const adjustmentLabel=s=>/(?:부문간|부문등간|연결|내부거래).{0,30}(?:제거|조정)|intersegment.*eliminat/i.test(compact(s));
const absolute=s=>s.startsWith('-')?s.slice(1):s;
const signedRatio=(value,total)=>{const n=ratio(absolute(value),total);return n===null?null:(value.startsWith('-')?-1:1)*n;};
// A negative revenue observation is accepted only in an explicitly reconciled
// issuer segment table. Ratios remain the source's rounded disclosures. This is
// gross segment revenue plus elimination, not a non-negative portfolio mix.
export function adjustedRevenueTableObservations(source){
 if(!['PRODUCTS','SALES','ORDERS','SEGMENTS'].includes(source.sectionKind))return [];
 const date=/\((20\d{2})\.(03|06|09|12)\)/.exec(source.title||''),unit=/단위\s*[:：]\s*(백만원|천원|억원|원)/.exec(source.body||'')?.[1];
 if(!date||!unit||!/사업보고서|반기보고서|분기보고서/.test(source.title||''))return [];
 const month=+date[2],period={start:date[1]+'-01-01',end:`${date[1]}-${date[2]}-${new Date(Date.UTC(+date[1],month,0)).getUTCDate()}`,type:month===12?'ANNUAL':'YTD',fiscalYear:+date[1],fiscalQuarter:month/3,label:date[1]+'년 '+(month===12?'연간':month===6?'반기':month+'월 누적'),dateConfidence:'REPORT_LABEL'};
 const out=[];
 for(const [ti,m]of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  if(!norm(source.body).includes(norm(clean(m[0]))))continue;
  const grid=revenueGrid(m[0]),head=grid[0]||[],headers=head.map(compact),labelCol=headers.findIndex(x=>/^(부문|사업부문|사업구분)$/.test(x)),amountCol=headers.indexOf('매출액'),pctCol=headers.findIndex(x=>/^(매출)?(비중|비율)$/.test(x));
  if(labelCol<0||amountCol<1||pctCol<1||headers.some(h=>/영업이익|총자산/.test(h)))continue;
  const rowMarkup=[...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const parsed=grid.slice(1).map((row,index)=>{const rawPct=compact(row[pctCol]),pctExact=rawPct.endsWith('%')?signed(rawPct.slice(0,-1)):null;return {row,index:index+1,label:row[labelCol],amount:signed(row[amountCol]),pct:pctExact===null?null:Number(pctExact),pctPrecision:(rawPct.replace(/[%△▲−-]/g,'').split('.')[1]||'').length,quote:norm(clean(rowMarkup[index+1]?.[1]||''))};});
  const totals=parsed.filter(r=>totalLabel(r.label));if(totals.length!==1||totals[0].amount===null||Number(totals[0].amount)<=0||totals[0].pct!==100)continue;
  const total=totals[0],members=parsed.filter(r=>r!==total);if(members.length<2||members.length>20||members.some(r=>!r.label||r.amount===null||!Number.isFinite(r.pct)||!r.quote))continue;
  if(new Set(members.map(r=>compact(r.label))).size!==members.length)continue;
  const adjustments=members.filter(r=>r.amount.startsWith('-'));
  if(!adjustments.length||adjustments.length>4||adjustments.some(r=>r.pct>=0||!adjustmentLabel(r.row.join(' ')))||members.some(r=>!r.amount.startsWith('-')&&r.pct<0))continue;
  const sum=members.reduce((n,r)=>add(n,r.amount),'0'),roundingDifference=add(sum,total.amount,true),precision=Math.max(...members.map(r=>r.amount.split('.')[1]?.length||0),total.amount.split('.')[1]?.length||0),tolerance=members.length*.5*10**(-precision);
  if(Math.abs(Number(roundingDifference))>tolerance)continue;
  if(members.some(r=>!Number.isFinite(signedRatio(r.amount,total.amount))||Math.abs(signedRatio(r.amount,total.amount)-r.pct)>.5*10**(-r.pctPrecision)+100/Number(total.amount)))continue;
  const gross=members.filter(r=>!r.amount.startsWith('-')).reduce((n,r)=>add(n,r.amount),'0'),adjustment=adjustments.reduce((n,r)=>add(n,r.amount),'0'),shareSum=Number(members.reduce((n,r)=>add(n,String(r.pct)),'0'));
  const notes=String(source.body||'').split(/\n/).filter(s=>/내부거래|부문.*제거|△|부\(-\)/.test(s)&&s.length<1200);
  for(const r of members){
   const isAdjustment=r.amount.startsWith('-');
   out.push({dimension:'BUSINESS_SEGMENT',label:r.label,parent:null,metric:'REVENUE_COMPOSITION',value:null,amountExact:r.amount,reportedPercent:r.pct,calculatedShare:null,shareOrigin:'DISCLOSED',totalRevenue:null,totalRevenueExact:total.amount,period:period.label,explicitPeriod:period,scope:'UNSPECIFIED',unit,rowQuote:r.quote,denominatorKind:'DISCLOSED_TABLE_TOTAL',denominatorLabel:'부문 매출·내부거래 조정 포함 공시 합계',revenueDefinition:'SEGMENT_WITH_INTERSEGMENT',isAdjustment,adjustmentType:isAdjustment?'INTERSEGMENT_ELIMINATION':null,scopeNotes:notes,comparabilityReview:true,headerEvidence:{headers:head,closedTable:true,signedTable:true,netReconciled:true,tableTotal:total.amount,sumOfRows:sum,grossRevenue:gross,adjustmentAmount:adjustment,roundingDifference,reportedShareTotal:100,sumReportedShares:shareSum,shareRoundingDifference:Number(add(String(shareSum),'100',true)),percentDecimals:r.pctPrecision,percentTolerance:.5*10**(-r.pctPrecision)+100/Number(total.amount),totalRowQuote:total.quote},extractionVersion:'adjusted-revenue-table-1',legacyTableKey:source.id+':table'+(ti+1),locator:source.locator+':adjusted:'+ti+':'+r.index,tableKey:source.id+':adjusted:'+ti});
  }
 }
 return out;
}
