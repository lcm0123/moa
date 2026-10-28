// Issuer IR content is a separate view: Q4 IDs must never masquerade as SEC accessions.
export async function irContent(db,p,target){
 const contentId=p.get('contentId');
 if(contentId&&!/^[a-f0-9]{64}$/.test(contentId))return {error:'공시 본문 식별자 오류',code:400};
 const common=row=>({...row,content_id:row.id,list_source:row.provider,list_received_at:row.collected_at,relation:['3','4','5','144'].includes(row.form.replace('/A',''))?'third_party':'company',amended:row.form.endsWith('/A'),identity_note:'발행회사 공식 IR 문서 ID · SEC accession과 미결합'});
 if(contentId){
  const row=(await db.prepare('SELECT * FROM sec_ir_filings WHERE id=? AND ticker=? AND cik=?').bind(contentId,target.ticker,target.cik).all()).results[0];
  if(!row)return {error:'해당 종목의 공시 본문이 없습니다.',code:404};
  const v=(await db.prepare('SELECT * FROM sec_ir_versions WHERE id=? AND source_hash=? AND version=?').bind(row.id,row.source_hash,row.version).all()).results[0];
  const offset=Number(p.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>1000000)return {error:'본문 페이지 오류',code:400};
  const chunks=JSON.parse(v.chunks),facts=JSON.parse(v.facts),doc={id:row.id,form:row.form,filename:'공식 IR 게시 본문',source_url:row.document_url,source_hash:row.source_hash,version:row.version,section_count:chunks.length};
  return {status:'ready',filing:common(row),documents:[doc],document:doc,chunks:chunks.slice(offset,offset+30),facts:facts.map(f=>({...f,document_id:doc.id})),offset};
 }
 const args=[target.ticker,target.cik],conditions=['ticker=?','cik=?'];
 for(const key of ['form','topic']){const v=p.get(key);if(v){if(v.length>80)return {error:'필터 오류',code:400};conditions.push(key+'=?');args.push(v);}}
 for(const [key,op]of [['from','>='],['to','<=']]){const v=p.get(key);if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))return {error:'날짜 오류',code:400};conditions.push('filed_date'+op+'?');args.push(v);}}
 const page=Number(p.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)return {error:'페이지 오류',code:400};
 const where=' WHERE '+conditions.join(' AND '),total=(await db.prepare('SELECT COUNT(*) n FROM sec_ir_filings'+where).bind(...args).all()).results[0].n;
 const rows=(await db.prepare('SELECT * FROM sec_ir_filings'+where+' ORDER BY filed_date DESC,source_received_at DESC,id DESC LIMIT 30 OFFSET ?').bind(...args,(page-1)*30).all()).results;
 const forms=(await db.prepare('SELECT DISTINCT form FROM sec_ir_filings WHERE ticker=? AND cik=? ORDER BY form').bind(target.ticker,target.cik).all()).results.map(r=>r.form);
 return {status:total?'ready':'empty',items:rows.map(common),total,forms,page,pages:Math.max(1,Math.ceil(total/30)),message:total?null:'확보된 공시 본문이 아직 없습니다. 전체 공시 목록에서 제출 내역과 SEC 링크를 확인할 수 있습니다.'};
}
