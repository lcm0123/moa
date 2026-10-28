import {one} from './store.mjs';
// Reuse the site's collected filing feed; no extra provider request per user.
// Only periodic-report claims are superseded by newer periodic filings. A new
// unrelated contract must not erase an earlier investment event.
export async function invalidateFilingClaims(store,asset){
 let latest=null;
 if(asset.kind==='KR_STOCK')latest=await one(store.db,"SELECT MAX(received_date) at FROM dart_filings WHERE corp_code=? AND ticker=? AND (title LIKE '%사업보고서%' OR title LIKE '%반기보고서%' OR title LIKE '%분기보고서%')",asset.issuerId,asset.symbol);
 if(asset.kind==='US_STOCK')latest=await one(store.db,"SELECT MAX(f.filed_date) at FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession WHERE CAST(i.cik AS INTEGER)=? AND f.form IN ('10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A')",Number(asset.issuerId));
 if(!latest?.at)return 0;
 const changed=await store.db.prepare("UPDATE catalyst_research_claim_lifecycle SET state='STALE',updated_at=? WHERE issuer_id=? AND state='ACTIVE' AND document_id IN (SELECT id FROM catalyst_filing_documents WHERE issuer_id=? AND document_type='PERIODIC' AND filing_date<?)").bind(new Date().toISOString(),asset.id,asset.id,latest.at).run();
 return changed.meta.changes;
}
