import {revenueGrid} from './company-research-profile.mjs';
import {decimal,ratio} from './profile-calculations.mjs';
import {norm,clean} from './core.mjs';
import {disclosedColumnPeriod} from './profile-column-period.mjs';
const money=s=>{const m=/^\s*([+-]?[\d,]+(?:\.\d+)?)\s*(?:\((\d+(?:\.\d+)?)\s*%\))?\s*$/.exec(s);return m?{amountExact:decimal(m[1]),percent:m[2]?Number(m[2]):null}:null;};
// All explicit year columns are retained. Ambiguous labels are left to coverage, never dated by collection time.
export function periodTableObservations(source){
 const out=[],titleDate=/\((20\d{2})\.(03|06|09|12)\)/.exec(source.title||'');
 for(const [ti,m]of [...String(source.sectionHtml||'').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].slice(0,12).entries()){
  const grid=revenueGrid(m[0]),heads=grid.slice(0,/매출액|비율/.test(grid[1]?.join(' ')||'')?2:1),all=norm(clean(m[0]));if(!norm(source.body).includes(all))continue;
  const unit=/단위\s*[:：]\s*(백만원|천원|억원|원)/.exec(source.body)?.[1];if(!unit||!titleDate)continue;
  const header=heads.map(r=>r.join(' ')).join(' ');if(!/매출/.test(header+' '+source.heading))continue;
  const first=heads[0],normalized=first.map(x=>x.replaceAll(' ','')),productCols=normalized.map((x,i)=>/품목|제품/.test(x)?i:-1).filter(i=>i>=0),labelCol=productCols[0]??normalized.findIndex(x=>/부문|구분/.test(x));if(labelCol<0)continue;
  const rowMarkup=[...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)],scope=/연결재무/.test(source.body)?'CONSOLIDATED':/별도재무/.test(source.body)?'SEPARATE':'UNSPECIFIED';
  for(let col=labelCol+1;col<Math.min(first.length,25);col++){
   const h=heads.map(r=>r[col]||'').join(' '),year=/(?<!\d)(20\d{2})(?!\d)/.exec(h)?.[1];if(!year||/비율|비중|%/.test(h)&&!/매출액/.test(h))continue;
   const explicitPeriod=disclosedColumnPeriod(h,source);if(!explicitPeriod)continue;
   const totalRows=grid.filter(r=>/^(합계|총계|총매출액)$/.test((r[labelCol]||'').replaceAll(' ','')));const total=totalRows.length===1?money(totalRows[0][col])?.amountExact:null;
   for(let ri=1;ri<grid.length;ri++){
    const row=grid[ri],baseLabel=row[labelCol],flow=productCols.length>1?row[productCols[1]]?.replaceAll(' ',''):null,label=/^(수출|내수)$/.test(flow)?flow:baseLabel;if(!label||/^(합계|총계|총매출액|소계|-)$/.test(label.replaceAll(' ',''))||/^(합계|총계|총매출액|소계)$/.test((baseLabel||'').replaceAll(' ',''))||flow==='소계'||row===totalRows[0])continue;
    const value=money(row[col]);if(!value)continue;
    const dimension=/수출|내수/.test(label)?'DOMESTIC_EXPORT':/지역|국가/.test(header+' '+source.heading)?'GEOGRAPHY':/사업부문/.test(first[labelCol])?'BUSINESS_SEGMENT':'PRODUCT';
    const adjacentPct=/비중|비율|%/.test(heads.map(r=>r[col+1]||'').join(' '))?Number(String(row[col+1]||'').replace('%','')):null;
    const reported=value.percent??(Number.isFinite(adjacentPct)&&row[col+1]!==''?adjacentPct:null);
    if(reported!==null&&(reported<0||reported>100||total&&Math.abs(ratio(value.amountExact,total)-reported)>.55))continue;
    const rowQuote=norm(clean(rowMarkup[ri]?.[1]||''));if(!rowQuote)continue;
    out.push({dimension,label,parent:dimension==='DOMESTIC_EXPORT'?baseLabel:labelCol>0?row[labelCol-1]:null,metric:dimension==='DOMESTIC_EXPORT'?(label==='수출'?'EXPORT_REVENUE_SHARE':'DOMESTIC_REVENUE_SHARE'):'REVENUE_COMPOSITION',value:null,amountExact:value.amountExact,reportedPercent:reported,totalRevenue:total?Number(total):null,totalRevenueExact:total,period:explicitPeriod.label,explicitPeriod,scope,unit,rowQuote,denominatorKind:total?'COMPANY_TOTAL_REVENUE':'UNKNOWN',denominatorLabel:total?'공시 매출표 합계':null,revenueDefinition:'UNKNOWN',extractionVersion:'profile-period-3',locator:source.locator+':history:'+ti+':'+ri+':'+col,tableKey:source.id+':history:'+ti+':'+col});
   }
  }
 }return out;
}
