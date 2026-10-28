import {securityKey} from './security-identity.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {irContent} from './sec-ir-api.mjs';
import {attachInsiderSummary} from './sec-insider-summary.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const coverage='회사 submissions의 recent·과거 목록과 SEC 소유자 포함 피드를 수집합니다. 제3자 공시는 원문 issuer/subject CIK를 확인한 범위이며 전체 관련 공시를 보장하지 않습니다.';
const sourceFields='s.provider AS list_source,s.received_at AS list_received_at,s.description_en,s.metadata_summary,s.document_url,(SELECT d.source_url FROM sec_documents d WHERE d.accession=f.accession AND d.source_hash=f.source_hash ORDER BY d.created_at DESC LIMIT 1) AS summary_source_url';
export async function secFilingsApi(request,env){
 if(request.method==='POST'){
  return json({status:'read_only',message:'종목 화면에서는 저장된 공시만 조회합니다. 신규 수집은 기존 수집 작업에서 관리합니다.'},405);
 }
 if(request.method!=='GET')return json({message:'Method not allowed'},405);
 const p=new URL(request.url).searchParams,ticker=p.get('ticker')?.toUpperCase();if(!securityKey('US',ticker))return json({message:'미국 종목 티커를 확인해 주세요.'},400);
 if(!env.DB)return json({status:'unavailable',items:[],message:'공시 저장소 연결 필요'});
 const finviz=(env.SEC_FILINGS_PROVIDER||'finviz')==='finviz';
 if(finviz){try{requireFinviz(env);}catch(error){return json({status:error.status||'error',items:[],total:0,message:error.message});}}
 try{
  const now=new Date().toISOString();
  // UI reads must not register collection demand or change worker priorities.
  const target=(await env.DB.prepare('SELECT * FROM sec_targets WHERE ticker=?').bind(ticker).all()).results[0]||{};
  const heartbeat=(await env.DB.prepare("SELECT value FROM sec_runtime WHERE key='collector_heartbeat'").all()).results[0]?.value;
  const workerActive=!!heartbeat&&Date.now()-Date.parse(heartbeat)<600000;
  const syncSeconds=Number(finviz?(env.FINVIZ_FILINGS_SYNC_SECONDS||300):(env.SEC_SYNC_SECONDS||900));
  const meta={source:finviz?'Finviz Elite · SEC 공시 목록':'SEC EDGAR',coverage:finviz?'Finviz 종목별 Latest Filings Export에서 확인한 공시 목록입니다. 전체 SEC 공시의 완전성·실시간 반영은 보장하지 않습니다. 한국어 유형 안내는 본문 내용 요약과 구분합니다.':coverage,collectionMode:'polling',syncIntervalSeconds:Math.max(finviz?60:300,Number.isFinite(syncSeconds)?syncSeconds:finviz?300:900),target:{cik:target.cik,name:target.name,syncedAt:target.synced_at,error:target.error,coverage:target.coverage?JSON.parse(target.coverage):null},workerActive,workerHeartbeat:heartbeat||null,userAgentConfigured:/@/.test(env.SEC_USER_AGENT||''),now};
  if(!target.cik)return json({...meta,status:target.error?'mapping_error':'not_collected',items:[],total:0,message:target.error?'기업 식별자 확인에 실패했습니다.':'저장된 기업 식별자·공시 자료가 없습니다. 이 화면에서 새 수집을 시작하지 않습니다.'});
  if(p.get('view')==='content'||p.has('contentId')){
   const content=await irContent(env.DB,p,target);
   if(content.error)return json({message:content.error},content.code);
   return json({...meta,...content,source:'발행회사 공식 IR · 공시 본문',coverage:'공식 IR에서 확보한 본문만 표시합니다. IR 문서 ID로 보존하며 SEC 공시 번호가 없으면 Finviz 목록과 임의로 결합하지 않습니다. 전체 공시 목록은 별도 보기로 유지합니다. 전체 관련 공시 수집을 보장하지 않습니다.'});
  }
  let insiderCache=null,insiderError='';
  try{const rows=(await env.DB.prepare('SELECT key,value FROM sec_runtime WHERE key IN (?,?)').bind('finviz_insiders:'+ticker,'finviz_insiders_error:'+ticker).all()).results;insiderCache=JSON.parse(rows.find(r=>r.key==='finviz_insiders:'+ticker)?.value||'null');insiderError=rows.find(r=>r.key==='finviz_insiders_error:'+ticker)?.value||'';}catch{}
  const enrich=f=>attachInsiderSummary(f,insiderCache,target.cik,insiderError);
  const accession=p.get('accession');
  if(accession){if(!/^\d{10}-\d{2}-\d{6}$/.test(accession))return json({message:'공시 식별자 오류'},400);
   const filing=(await env.DB.prepare("SELECT f.*,i.relation,i.evidence,"+sourceFields+" FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession LEFT JOIN sec_filing_sources s ON s.accession=f.accession AND s.provider='Finviz Elite' AND s.ticker=? WHERE f.accession=? AND i.cik=? AND i.relation!='unverified' AND f.topic!='manager'").bind(ticker,accession,target.cik).all()).results[0];if(!filing)return json({message:'해당 종목에 연결된 공시가 없습니다.'},404);
   const docs=(await env.DB.prepare('SELECT id,filename,form,source_url,source_hash,version,section_count,created_at FROM sec_documents WHERE accession=? ORDER BY created_at DESC,filename').bind(accession).all()).results;
   const docId=p.get('document')||docs.find(d=>d.source_hash===filing.source_hash)?.id||docs[0]?.id;const doc=docs.find(d=>d.id===docId);
   const offset=Number(p.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>1000000)return json({message:'본문 페이지 오류'},400);
   const chunks=doc?(await env.DB.prepare('SELECT * FROM sec_chunks WHERE document_id=? ORDER BY ordinal LIMIT 30 OFFSET ?').bind(doc.id,offset).all()).results:[];
   const progress=doc?(await env.DB.prepare('SELECT state,COUNT(*) count FROM sec_chunks WHERE document_id=? GROUP BY state').bind(doc.id).all()).results:[];
   const facts=(await env.DB.prepare('SELECT f.* FROM sec_facts f JOIN sec_documents d ON f.document_id=d.id WHERE f.accession=? AND f.version=? AND d.source_hash=? LIMIT 40').bind(accession,filing.version||'',filing.source_hash||'').all()).results;
   return json({...meta,status:'ready',filing:enrich(filing),documents:docs,document:doc,chunks,offset,progress,facts:facts.map(f=>({...f,details:JSON.parse(f.details)}))});
  }
  const args=[ticker,target.cik],conditions=["i.cik=?","i.relation!='unverified'","f.topic!='manager'"];
  for(const [key,column]of [['form','f.form'],['topic','f.topic']]){const v=p.get(key);if(v){if(v.length>80)return json({message:'필터 오류'},400);conditions.push(column+'=?');args.push(v);}}
  for(const [key,op]of [['from','>='],['to','<=']]){const value=p.get(key);if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))return json({message:'날짜 오류'},400);conditions.push('f.filed_date'+op+'?');args.push(value);}}
  const page=Number(p.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)return json({message:'페이지 오류'},400);
  const base=" FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession LEFT JOIN sec_filing_sources s ON s.accession=f.accession AND s.provider='Finviz Elite' AND s.ticker=? WHERE "+conditions.join(' AND '),total=(await env.DB.prepare('SELECT COUNT(*) count'+base).bind(...args).all()).results[0].count;
  const items=(await env.DB.prepare('SELECT f.*,i.relation,'+sourceFields+base+' ORDER BY f.filed_date DESC,f.accepted_at DESC,f.accession DESC LIMIT 30 OFFSET ?').bind(...args,(page-1)*30).all()).results;
  const forms=(await env.DB.prepare("SELECT DISTINCT f.form FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE i.cik=? AND i.relation!='unverified' AND f.topic!='manager' ORDER BY f.form").bind(target.cik).all()).results.map(r=>r.form);
  return json({...meta,status:total?'ready':'empty',items:items.map(enrich),total,forms,page,pages:Math.max(1,Math.ceil(total/30))});
 }catch{return json({status:'error',items:[],message:'SEC 공시 저장소를 확인해 주세요. 마이그레이션과 작업자 로그에서 상태를 확인할 수 있습니다.'},500);}
}
