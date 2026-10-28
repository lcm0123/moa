import {norm,clean} from './core.mjs';
import {parseTypedValues,parsePeriod,parseScope} from './typed-values.mjs';
import {exposure} from './normalization.mjs';

export const tableVersion='table-1';
const unitPattern=/(?:단위\s*[:：]?\s*|in\s+)(백만원|천원|억원|원|million USD|thousand USD|USD|%p|%)(?![a-z])/i;
function unitFrom(t){return unitPattern.exec(t)?.[1]||null;}
// A deliberately bounded HTML/XML table reader. Ambiguous merged cells, nested
// tables, or absent headers are retained as gaps, never interpreted as facts.
export function extractTableEvidence(html,{subject,source_location='',scope=null}={}){
 const text=String(html||'').slice(0,6000000),tables=[];
 let count=0;
 for(const [index,m]of [...text.matchAll(/<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi)].slice(0,40).entries()){
  if(count>=2000)break;
  const raw=m[1],table_id='table-'+(index+1),location=source_location+'#'+table_id;
  const prefix=text.slice(Math.max(0,m.index-600),m.index);
  const preceding=clean(/<(?:P|DIV)\b[^>]*>([^<>]*)<\/(?:P|DIV)>\s*$/i.exec(prefix)?.[1]||'');
  const caption=clean(/<CAPTION\b[^>]*>([\s\S]*?)<\/CAPTION>/i.exec(raw)?.[1]||'');
  const tableUnit=unitFrom(caption)||unitFrom(preceding);
  const matrix=[...raw.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)].slice(0,400).map(r=>[...r[1].matchAll(/<(TH|TD|TE)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(c=>({value:clean(c[3]),header:c[1].toUpperCase()==='TH',attrs:c[2]})));
  const unsupported=/<TABLE\b/i.test(raw)||matrix.flat().some(c=>/(?:rowspan|colspan)\s*=\s*["']?(?:[2-9]|\d{2})/i.test(c.attrs));
  const header=matrix[0]||[],cells=[];
  const headersPresent=header.length>1&&header.every(c=>c.value)&&header.some(c=>c.header||/매출|매출액|revenue|sales|분기|Q[1-4]|[1-4]Q|20\d{2}/i.test(c.value));
  for(let r=1;r<matrix.length;r++){
   const row=matrix[r];if(row.length!==header.length)continue;
   for(let col=1;col<Math.min(row.length,30)&&count<2000;col++){
    count++;
    const h=header[col].value,cell=row[col].value;
    const unit=unitFrom(h)||tableUnit;
    const period=parsePeriod(h+' '+caption),cellScope=scope||parseScope(caption+' '+preceding+' '+header[0].value);
    const numeric=/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(cell),values=numeric&&unit?parseTypedValues(cell+' '+unit):[];
    const qualitative=/^(?:주요\s*)?(?:제품|제품·서비스|제품 및 서비스|products?|services?)$/i.test(h)&&!!cell&&cell.length<=180&&!/추진|예정|계획|검토|가능|미정/.test(cell);
    cells.push({table_id,row_header:row[0].value,column_header:h,cell_value:cell,unit,period,scope:cellScope,
     footnote:clean(/<(?:FOOTNOTE|TFOOT)\b[^>]*>([\s\S]*?)<\/(?:FOOTNOTE|TFOOT)>/i.exec(raw)?.[1]||''),
     source_location:location+':row'+(r+1)+':col'+(col+1),subject,
     unit_inheritance:unitFrom(h)?['column_header',h]:tableUnit?[unitFrom(caption)?'caption':'preceding_paragraph',unitFrom(caption)?caption:preceding,table_id,'column:'+col]:[],
     kind:qualitative?'product':'numeric',typed_value:values.length===1?values[0]:null,exposure_type:qualitative?'QUALITATIVE':exposure(row[0].value+' '+h),
     eligible:!!subject&&!unsupported&&headersPresent&&!!row[0].value&&(qualitative||!!unit&&values.length===1)&&period.years.length>0,
     limitation:unsupported?'merged_or_nested_table':!headersPresent?'missing_headers':!unit?'missing_unit':!period.years.length?'missing_period':null});
   }
  }
  tables.push({table_id,caption,version:tableVersion,cells,source_location:location});
 }
 return tables;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateTableEvidence(proposal,source){
 const ref=proposal.table_ref;
 const cell=source?.tables?.flatMap(t=>t.cells||[]).find(c=>c.table_id===ref?.table_id&&c.source_location===ref?.source_location);
 const unknown={status:'UNKNOWN',reason:'원문 표 셀 또는 헤더 문맥 없음'};
 const stage=(v,reason)=>({status:v?'PASS':'FAIL',reason});
 const p=proposal.table_value;
 if(!cell||!p)return {checks:Object.fromEntries(['SUBJECT_MATCH','PREDICATE_MATCH','OBJECT_MATCH','NUMERIC_MATCH','UNIT_MATCH','PERIOD_MATCH','SCOPE_MATCH','SEMANTIC_SUPPORT'].map(k=>[k,unknown])),cell:null};
 const value=parseTypedValues(String(p.value)+' '+String(p.unit||'')),v=value.length===1?value[0]:null;
 const checks={
  SUBJECT_MATCH:stage(p.subject===cell.subject&&proposal.subject_id===cell.subject,'원문 표의 발행인 식별'),
  PREDICATE_MATCH:stage(norm(p.column_header)===norm(cell.column_header),'열 제목 일치'),
  OBJECT_MATCH:stage(norm(p.row_header)===norm(cell.row_header)&&p.exposure_type===cell.exposure_type,'제품·사업부 범위 일치'),
  NUMERIC_MATCH:stage(cell.kind==='product'?norm(p.value)===norm(cell.cell_value):!!v&&v.normalizedValue===cell.typed_value?.normalizedValue&&v.sign===cell.typed_value?.sign,'셀 값·배수·부호 일치'),
  UNIT_MATCH:stage(cell.kind==='product'?!p.unit:!!v&&v.currency===cell.typed_value?.currency&&v.unit===cell.typed_value?.unit,'상속 단위·통화 일치'),
  PERIOD_MATCH:stage(same(p.period,cell.period),'분기·누적·반기·기준일 일치'),
  SCOPE_MATCH:stage(same(p.scope,cell.scope),'연결·별도 범위 일치 · 미확인은 미확인으로 유지'),
  SEMANTIC_SUPPORT:stage(cell.eligible===true&&!cell.footnote,'독립된 행·열 헤더와 수치 · 미해석 각주는 검토 필요')
 };
 return {checks,cell,typedValue:v?[v]:[],period:cell.period,scope:cell.scope,exposureType:cell.exposure_type};
}
