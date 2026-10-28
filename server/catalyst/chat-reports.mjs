import {uniqueReports,reportPublication} from '../report-dedup.mjs';
import {rows} from './store.mjs';
import {reportIssuerMatches} from '../security-identity.mjs';

// Read the same ticker matches and deduplication as the report page. No PDF
// download/parsing or new company-name matching happens during a question.
export async function savedChatReports(store,market,ticker,limit=3,issuer=null){
 const found=await rows(store.db,`SELECT r.*,COALESCE(c.kind,r.kind) effective_kind,c.kind manual_kind
  FROM telegram_reports r LEFT JOIN telegram_report_categories c ON c.report_id=r.id
  WHERE r.market=? AND r.ticker=? AND r.deleted=0
    AND COALESCE(c.kind,r.kind)='company'
  ORDER BY r.posted_at DESC LIMIT 24`,market,ticker);
 const matched=found.filter(r=>{try{const p=JSON.parse(r.payload);return p.market===market&&p.ticker===ticker&&p.fields?.ticker?.status==='extracted'&&p.fields.ticker.value===ticker&&(!issuer||reportIssuerMatches({...r,parsed:p},issuer));}catch{return false;}});
 return uniqueReports(matched).sort((a,b)=>String(reportPublication(b.parsed,b.filename).date||b.posted_at).localeCompare(String(reportPublication(a.parsed,a.filename).date||a.posted_at))).slice(0,limit).map(r=>{
  const p=r.parsed,{date,broker}=reportPublication(p,r.filename),fields={};
  for(const key of ['rating','targetPrice','targetPriceRevision']){const f=p.fields?.[key];if(f?.status==='extracted'&&f.value!==null&&f.value!==undefined&&f.evidence)fields[key]={value:f.value,evidence:String(f.evidence).slice(0,240)};}
  return {id:r.id,title:r.title,url:r.source_url,publishedAt:date,postedAt:r.posted_at,observedAt:r.updated_at,
   text:r.raw_text||'',broker,fields,reportPath:'/reports?report='+encodeURIComponent(r.id),
   duplicateSources:r.duplicateSources,
   coverage:'저장된 게시문과 명시적으로 추출한 의견·목표주가. PDF 전체 본문은 포함하지 않습니다.',
   revision:r.revision_at};
 });
}
