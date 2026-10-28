import {revenueGrid} from './company-research-profile.mjs';
import {add,decimal,ratio} from './profile-calculations.mjs';
import {clean,norm} from './core.mjs';
import {disclosedColumnPeriod} from './profile-column-period.mjs';

const amount=s=>/^\s*[\d,]+(?:\.\d+)?\s*$/.test(s||'')?decimal(s):null;
const compact=s=>String(s||'').replace(/\s/g,'');
const totalLabel=s=>/^(?:합계|총계|총매출액)$/.test(compact(s));
function currentOrdinalPeriod(source,head,col){
 // Only the current column can inherit an exact official reporting period.
 // Older fiscal ordinals do not establish calendar years or fiscal year ends.
 if(source.sourceType!=='regulatory'||!/^https:\/\/dart\.fss\.or\.kr\//.test(source.url||''))return null;
 const report=/^(반기보고서|사업보고서)\s*\((20\d{2})\.(06|12)\)$/.exec(source.title||'');if(!report||report[1]==='반기보고서'&&report[3]!=='06'||report[1]==='사업보고서'&&report[3]!=='12')return null;
 const ordinals=head.map(h=>{const m=/^제\s*(\d+)\s*기/.exec(String(h||''));return m?+m[1]:null;}),valid=ordinals.filter(n=>n!==null);
 if(new Set(valid).size<2||col!==ordinals.findIndex(n=>n===Math.max(...valid)))return null;
 const h=head[col];if(report[1]==='반기보고서'?!/반기/.test(h):/반기|분기|누적/.test(h))return null;
 if(/전기|전반기|\(전\)|예상|추정/.test(h))return null;
 const p=disclosedColumnPeriod(report[2]+(report[3]==='06'?'년 반기':'년 연간'),source);
 return p?{...p,dateConfidence:'REPORT_TITLE_CURRENT_ORDINAL',reportTitle:source.title,originalColumnLabel:h}:null;
}
const inlineAmountShare=s=>{const m=/^\s*([\d,]+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)\s*$/.exec(s||'');return m?{amount:decimal(m[1]),percent:+m[2],decimals:m[2].split('.')[1]?.length||0}:null;};
function inlineCurrentRows(source,grid,head,labelCol,markup,ti,unit){
 const out=[],periods=head.map((h,i)=>currentOrdinalPeriod(source,head,i)),totals=grid.slice(1).filter(r=>totalLabel(r[labelCol]));if(totals.length!==1)return out;
 for(const [col,period]of periods.entries()){
  if(!period||!/매출/.test(head[col]))continue;
  const total=inlineAmountShare(totals[0][col]);if(!total||Number(total.amount)<=0||total.percent!==100)continue;
  const candidates=grid.slice(1).filter(r=>r!==totals[0]&&r[labelCol]&&!totalLabel(r[labelCol])),known=candidates.map(row=>({row,v:inlineAmountShare(row[col])})).filter(x=>x.v),unknown=candidates.length-known.length;
  if(known.length<2||known.length>20||new Set(known.map(x=>x.row[labelCol])).size!==known.length)continue;
  const sum=known.reduce((s,x)=>add(s,x.v.amount),'0');
  for(const {row,v}of known){
   const expected=ratio(v.amount,total.amount),allowance=.5*10**(-v.decimals)+50/Number(total.amount);
   if(v.percent<0||v.percent>100||!Number.isFinite(expected)||Math.abs(expected-v.percent)>allowance)continue;
   const ri=grid.indexOf(row),rowQuote=norm(clean(markup[ri]?.[1]||''));if(!rowQuote)continue;
   out.push({dimension:'PRODUCT',label:row[labelCol],parent:labelCol>0?row[labelCol-1]:null,metric:'REVENUE_COMPOSITION',value:null,amountExact:v.amount,reportedPercent:v.percent,calculatedShare:null,shareOrigin:'DISCLOSED',totalRevenue:null,totalRevenueExact:total.amount,period:period.label,explicitPeriod:period,scope:'UNSPECIFIED',unit,rowQuote,denominatorKind:'DISCLOSED_TABLE_TOTAL',denominatorLabel:'공시 사업 매출표 합계 · 연결·별도 범위 미확인',revenueDefinition:'DISCLOSED_OPERATING_TABLE',scopeNotes:unknown?[`원문에 금액·비중이 기재되지 않은 ${unknown}개 항목은 0으로 바꾸지 않았습니다.`]:[],headerEvidence:{headers:head,tableTotal:total.amount,sumOfRows:sum,closedTable:unknown===0&&Math.abs(Number(add(sum,total.amount,true)))<=known.length*.5,roundingDifference:add(sum,total.amount,true)},extractionVersion:'operating-revenue-table-3',locator:source.locator+':operating:'+ti+':'+ri+':'+col,tableKey:source.id+':operating:'+ti+':'+col+':PRODUCT'});
  }
 }
 return out;
}
// Issuer operating tables often omit a percent column and use merged product
// headers. A closed, same-table total permits a composition ratio, but does NOT
// establish consolidated financial scope or authorize quarterly subtraction.
export function operatingRevenueTableObservations(source){
 if(!['PRODUCTS','SALES','ORDERS'].includes(source.sectionKind)||!/(?:매출실적|매출액|매출\s*및)/.test(source.body+' '+source.heading))return [];
 // Quantity/amount tables disclose two units. Only the explicitly labelled
 // amount columns may use the money unit; quantity columns are never revenues.
 const unit=/단위\s*[:：]\s*(?:(?:개|대|건|톤|수량)\s*[,·/]\s*)?(백만원|천원|억원|원)(?![가-힣])/.exec(source.body||'')?.[1];if(!unit)return [];
 const out=[];
 for(const [ti,m]of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  if(!norm(source.body).includes(norm(clean(m[0]))))continue;
  const grid=revenueGrid(m[0]),head=grid[0]||[],labelCols=head.flatMap((h,i)=>/품목|제품/.test(compact(h))?[i]:[]),labelCol=labelCols[0];
  if(labelCol===undefined)continue;
  const markup=[...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if(head.some(h=>/비중|비율|%/.test(h))){out.push(...inlineCurrentRows(source,grid,head,labelCol,markup,ti,unit));continue;}
  const subhead=grid[1]||[],quantityColumns=subhead.some(h=>/^수량$/.test(compact(h))),periods=head.map((h,i)=>quantityColumns&&!/^(금액|매출액)$/.test(compact(subhead[i]))?null:disclosedColumnPeriod(h,source)||currentOrdinalPeriod(source,head,i));
  if(!periods.some(Boolean)||new Set(periods.filter(Boolean).map(p=>p.end)).size!==periods.filter(Boolean).length)continue;
  const flowCol=labelCols[1],flow=flowCol!==undefined&&grid.slice(1).some(r=>/^(내수|수출)$/.test(compact(r[flowCol])));
  const totalRows=grid.slice(1).filter(r=>totalLabel(r[labelCol])&&(!flow||/^(소계|합계|총계)$/.test(compact(r[flowCol]))));if(totalRows.length!==1)continue;
  const totalRow=totalRows[0],groups=flow?[
   // Read each product's subtotal once, never its domestic/export components
   // as additional products. This also covers amount-only combined tables.
   {dimension:'PRODUCT',members:grid.slice(1).filter(r=>r[labelCol]&&!totalLabel(r[labelCol])&&(quantityColumns?/^(소계|합계)$/:/^합계$/).test(compact(r[flowCol])))},
   {dimension:'DOMESTIC_EXPORT',members:grid.slice(1).filter(r=>totalLabel(r[labelCol])&&/^(내수|수출)$/.test(compact(r[flowCol])))}
  ]:[{dimension:'PRODUCT',members:grid.slice(1).filter(r=>r!==totalRow&&r[labelCol]&&!/^(합계|총계|소계|-)$/.test(compact(r[labelCol])))}];
  for(const {dimension,members}of groups){
   const labelFor=row=>dimension==='DOMESTIC_EXPORT'?compact(row[flowCol]):row[labelCol];
   if(members.length<2||members.length>20||new Set(members.map(labelFor)).size!==members.length)continue;
  for(const [col,period]of periods.entries()){
   if(!period)continue;const total=amount(totalRow[col]),values=members.map(r=>amount(r[col]));if(!total||Number(total)<=0||values.some(v=>v===null))continue;
   const sum=values.reduce((s,v)=>add(s,v),'0'),precision=Math.max(...values.map(v=>v.split('.')[1]?.length||0),total.split('.')[1]?.length||0),tolerance=members.length*.5*10**(-precision),closed=Math.abs(Number(add(sum,total,true)))<=tolerance&&values.every(v=>Number(v)<=Number(total));
   const notes=String(source.body||'').split(/\n/).filter(s=>/주\s*\d|별도|연결|간접수출|영세율/.test(s)&&s.length<1200);
   // A subsidiary/year-specific footnote cannot label the entire table as CFS/OFS.
   const following=norm(clean(source.sectionHtml.slice(m.index+m[0].length).split(/<table\b/i)[0]||''));
   const declared=/^주\s*\)?\s*위\s*표에\s*기재한\s*매출\s*합계는\s*(별도|연결)재무제표\s*기준으로\s*작성/.exec(following);
   const scope=declared?(declared[1]==='별도'?'SEPARATE':'CONSOLIDATED'):'UNSPECIFIED',denominatorLabel='공시 사업 매출표 합계 · '+(declared?declared[1]+' 기준':'연결·별도 범위 미확인');
   // The exact same-table declaration establishes scope; it does not itself
   // indicate a scope CHANGE. Retain other/ambiguous scope notes and actual
   // reorganization or restatement language as a comparability hold.
   const remainingNotes=notes.map(s=>declared?norm(s).replace(declared[0],''):norm(s));
   const scopeChanged=/(?:사업(?:부문|부)?|부문별|보고(?:부문|범위)|매출(?:표|실적|액)?|재무제표|작성|비교|연결|별도|범위|기준).{0,50}(?:개편|재편|재작성|변경|전환|조정)|(?:개편|재편|재작성|변경|전환).{0,40}(?:사업부|부문|보고|범위|기준|연결|별도)/i.test(norm(source.body));
   const comparabilityReview=scopeChanged||remainingNotes.some(s=>/별도|사업부|연결/.test(s));
   for(const [i,row]of members.entries()){
    const ri=grid.indexOf(row),rowQuote=norm(clean(markup[ri]?.[1]||''));if(!rowQuote)continue;
    const label=labelFor(row),exportGroup=dimension==='DOMESTIC_EXPORT';
    out.push({dimension,label,parent:exportGroup?null:labelCol>0?row[labelCol-1]:null,metric:exportGroup?(label==='수출'?'EXPORT_REVENUE_SHARE':'DOMESTIC_REVENUE_SHARE'):'REVENUE_COMPOSITION',value:null,amountExact:values[i],reportedPercent:null,calculatedShare:closed?ratio(values[i],total):null,shareOrigin:closed?'DERIVED':null,totalRevenue:null,totalRevenueExact:total,period:period.label,explicitPeriod:period,scope,unit,rowQuote,denominatorKind:'DISCLOSED_TABLE_TOTAL',denominatorLabel,revenueDefinition:'DISCLOSED_OPERATING_TABLE',scopeNotes:notes,comparabilityReview,headerEvidence:{headers:head,amountColumnHeader:quantityColumns?subhead[col]:null,tableTotal:total,sumOfRows:sum,closedTable:closed,roundingDifference:add(sum,total,true)},extractionVersion:'operating-revenue-table-4',locator:source.locator+':operating:'+ti+':'+ri+':'+col,tableKey:source.id+':operating:'+ti+':'+col+':'+dimension});
   }
  }
  }
 }
 return out;
}
