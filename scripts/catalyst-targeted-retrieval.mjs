import {parseDartArchive} from './catalyst-dart-archive.mjs';
import {controlledBudget,controlledEvent} from './catalyst-controlled-context.mjs';
import os from 'node:os';
import {freeMemoryAllowed} from '../server/catalyst/research-memory.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {one,rows} from '../server/catalyst/store.mjs';
import {secureDocument} from './catalyst-secure-content.mjs';
import {withSecurity} from './catalyst-security-ledger.mjs';
export const sectionVersion='sections-security-1';
export const purposeSections={CAPACITY_EXPANSION:['CAPEX','FACILITIES','PRODUCTION_CAPACITY'],PRODUCT_RELATION:['PRODUCTS','BUSINESS','SEGMENTS'],REVENUE_EXPOSURE:['SALES','SEGMENTS'],CUSTOMER:['CUSTOMERS','SALES'],ORDER:['ORDERS'],RISK:['RISKS'],DEEP:['CAPEX','FACILITIES','SALES','ORDERS','CUSTOMERS','PRODUCTION_CAPACITY','RISKS','FINANCIAL_NOTES']};
purposeSections.BUSINESS_REVENUE=['SALES','SEGMENTS','FINANCIAL_NOTES','BUSINESS','PRODUCTS','OTHER'];
export function memoryGuard(env,{pdf=false,large=true}={}){
 const threshold=Number(env.CATALYST_RESEARCH_MEMORY_SOFT_MB)||160;if(env.CATALYST_RESEARCH_PROFILE_GC==='true')globalThis.gc?.();
 const rss=process.memoryUsage().rss/1048576;
 return {allowed:(!large&&!pdf)||(rss<threshold&&freeMemoryAllowed(env,os.freemem())),rssMB:rss,softMB:threshold,code:!freeMemoryAllowed(env,os.freemem())?'SYSTEM_MEMORY_DEFERRED':rss>=threshold?'MEMORY_DEFERRED':null};
}
async function digestFile(file){const hash=createHash('sha256');let bytes=0;for await(const b of fs.createReadStream(file,{highWaterMark:65536})){hash.update(b);bytes+=b.length;}return {hash:hash.digest('hex'),bytes};}
export async function indexDocument(store,file,meta,env={}){
 withSecurity(env,l=>l.assertAllowed(meta.url));
 let stat;try{stat=await fsp.stat(file);}catch(e){if(e.code==='ENOENT'){withSecurity(env,l=>l.record(meta.url,'DO_NOT_REFETCH','FILE_MISSING_REVIEW_REQUIRED',{local_path:file,removal_attribution:'UNCONFIRMED_FILE_DISAPPEARED'}));throw Error('SECURITY_BLOCKED_SOURCE');}throw e;}
 const local=await one(store.db,"SELECT id,document_hash,document_type,issuer_id,filing_date,url,local_path,byte_size,parser_version,last_indexed_at,file_mtime_ms FROM catalyst_filing_documents WHERE local_path=? AND issuer_id=? AND parser_version=? AND byte_size=? AND file_mtime_ms=? AND last_indexed_at<>'INDEXING' LIMIT 1",file,meta.assetId,sectionVersion,stat.size,stat.mtimeMs);
 if(local)return {...local,cached:true,hashBytesRead:0};
 const measured=await digestFile(file),id=createHash('sha256').update(measured.hash+'|'+meta.assetId+'|'+sectionVersion).digest('hex');
 const old=await one(store.db,'SELECT id,document_hash,document_type,issuer_id,filing_date,url,local_path,byte_size,parser_version,last_indexed_at,file_mtime_ms FROM catalyst_filing_documents WHERE id=?',id);if(old&&old.last_indexed_at!=='INDEXING'){await store.db.prepare('UPDATE catalyst_filing_documents SET file_mtime_ms=? WHERE id=?').bind(stat.mtimeMs,id).run();return {...old,cached:true,hashBytesRead:measured.bytes};}
 if(!memoryGuard(env,{pdf:file.endsWith('.pdf'),large:measured.bytes>1000000}).allowed)throw Error('memory_deferred');
 if(meta.pdf||meta.documentType==='PDF'||file.endsWith('.pdf'))controlledBudget('PDF');
 controlledEvent({action:'section_start',pdf:!!meta.pdf});
 const at=new Date().toISOString();
 await store.db.prepare('INSERT OR IGNORE INTO catalyst_filing_documents VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,measured.hash,meta.documentType||'HTML',meta.assetId,meta.publishedAt||null,meta.url,file,measured.bytes,sectionVersion,'INDEXING',stat.mtimeMs).run();
 const child=spawn(env.MOA_PYTHON||'python',['-X','utf8','scripts/catalyst-section-index.py',file,meta.title||'',meta.documentType||'HTML',meta.pdf||meta.documentType==='PDF'||file.endsWith('.pdf')?'PDF':'MARKUP'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
 const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('section_parser_unavailable')));child.once('close',code=>code?reject(Error('section_parser_failed')):resolve());});
 child.stdout.setEncoding('utf8');
 const insert=store.db.prepare('INSERT OR REPLACE INTO catalyst_filing_sections VALUES(?,?,?,?,?,?,?,?,?,?)');
 const timer=setTimeout(()=>child.kill(),90000);let count=0,parserStats=null;
 try{let pending='';for await(const chunk of child.stdout){pending+=chunk.toString('utf8');let end;
   while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
    const s=JSON.parse(line);if(s.stats){parserStats=s.stats;continue;}if(++count>20000)throw Error('section_limit');
    await insert.bind(id,s.ordinal,s.kind,s.heading,s.locator,JSON.stringify(s.table_ids),s.html,s.truncated?1:0,at,s.issuer_scope).run();
   }if(pending.length>1000000)throw Error('section_line_limit');
  }if(pending.trim())throw Error('section_stream_incomplete');await done;
 }catch(e){child.kill();await done.catch(()=>{});if(!fs.existsSync(file)){withSecurity(env,l=>l.record(meta.url,'DO_NOT_REFETCH','FILE_MISSING_REVIEW_REQUIRED',{local_path:file,removal_attribution:'UNCONFIRMED_FILE_DISAPPEARED'}));e=Error('SECURITY_BLOCKED_SOURCE');}await store.db.prepare('DELETE FROM catalyst_filing_sections WHERE document_id=?').bind(id).run();await store.db.prepare('DELETE FROM catalyst_filing_documents WHERE id=?').bind(id).run();throw e;}finally{clearTimeout(timer);}
 if(!fs.existsSync(file)){withSecurity(env,l=>l.record(meta.url,'DO_NOT_REFETCH','FILE_MISSING_REVIEW_REQUIRED',{local_path:file,removal_attribution:'UNCONFIRMED_FILE_DISAPPEARED'}));await store.db.prepare('DELETE FROM catalyst_filing_sections WHERE document_id=?').bind(id).run();throw Error('SECURITY_BLOCKED_SOURCE');}
 // Only the same issuer/document family/section can supersede a claim.
 // Independent new contracts/capex do not supersede unrelated earlier events.
 // Periodic reports replace the same sections; corrections only their original URL.
 if(meta.publishedAt&&(meta.documentType==='PERIODIC'||meta.correctsUrl))await store.db.prepare("UPDATE catalyst_research_claim_lifecycle SET state='STALE',updated_at=? WHERE document_id IN (SELECT id FROM catalyst_filing_documents WHERE issuer_id=? AND document_type=? AND filing_date<? AND (? IS NULL OR url=?)) AND section_kind IN (SELECT kind FROM catalyst_filing_sections WHERE document_id=?)").bind(at,meta.assetId,meta.documentType||'HTML',meta.publishedAt,meta.correctsUrl||null,meta.correctsUrl||null,id).run();
 await store.db.prepare('UPDATE catalyst_filing_documents SET last_indexed_at=? WHERE id=?').bind(at,id).run();
 controlledEvent({action:'section_complete',parserStats,pdf:!!meta.pdf});
 await store.db.prepare("UPDATE catalyst_research_claim_lifecycle SET state='STALE',updated_at=? WHERE document_id IN (SELECT id FROM catalyst_filing_documents WHERE issuer_id=? AND document_hash=? AND parser_version<>?)").bind(at,meta.assetId,measured.hash,sectionVersion).run();
 return {...await one(store.db,'SELECT id,document_hash,document_type,issuer_id,filing_date,url,local_path,byte_size,parser_version,last_indexed_at,file_mtime_ms FROM catalyst_filing_documents WHERE id=?',id),cached:false,parserStats,hashBytesRead:measured.bytes};
}

// Shared fail-closed source security pipeline; raw HTML is never persisted.
export const streamResearchDocument=secureDocument;
export async function retrieveSections(store,documentId,purpose,{maxBytes=120000,maxSections=12}={}){
 const meta=await one(store.db,'SELECT id,document_hash,document_type,issuer_id,filing_date,url,local_path,byte_size,parser_version,last_indexed_at,file_mtime_ms FROM catalyst_filing_documents WHERE id=?',documentId);
 const staticArticle=purpose==='STATIC_ARTICLE'&&meta?.document_type==='HTML';
 const kinds=staticArticle?['OTHER','BUSINESS','PRODUCTS','CAPEX','FACILITIES','PRODUCTION_CAPACITY']:purposeSections[purpose]||purposeSections.PRODUCT_RELATION;
 const order=purpose==='PRODUCT_RELATION'?"CASE WHEN table_ids='[]' THEN 0 ELSE 1 END, ordinal":'ordinal';
 const scope=meta?.document_type==='PERIODIC'&&purpose==='PRODUCT_RELATION'?" AND issuer_scope='ISSUER_BUSINESS'":'';
 const index=await rows(store.db,`SELECT ordinal,kind,heading,locator,table_ids,LENGTH(CAST(html AS BLOB)) bytes,truncated FROM catalyst_filing_sections WHERE document_id=? AND kind IN (${kinds.map(()=>'?')}) ${scope} ${staticArticle?"AND (html LIKE '%<p%' OR html LIKE '%<li%')":''} ORDER BY ${order}`,documentId,...kinds);
 // Interleave the requested kinds so product tables cannot crowd out business
 // paragraphs, or vice versa. This is retrieval coverage, not candidate ranking.
 if(purpose==='PRODUCT_RELATION'){const groups=kinds.map(k=>index.filter(s=>s.kind===k));index.length=0;while(groups.some(g=>g.length))for(const group of groups)if(group.length)index.push(group.shift());}
 const selected=[];let bytes=0;for(const section of index){if(selected.length>=maxSections)break;if(section.truncated||bytes+section.bytes>maxBytes)continue;const s=await one(store.db,'SELECT html FROM catalyst_filing_sections WHERE document_id=? AND ordinal=?',documentId,section.ordinal);selected.push({...section,...s});bytes+=section.bytes;}
 return {document:meta,sections:selected,bytesRead:bytes,availableSections:index.length,truncated:index.length>selected.length};
}
export async function dartDocumentFile(env,receipt,identity={}){
 if(!/^\d{14}$/.test(receipt))throw Error('invalid_receipt');
 const url=new URL('https://opendart.fss.or.kr/api/document.xml');url.search=new URLSearchParams({crtfc_key:env.OPENDART_API_KEY||env.DART_API_KEY||'',rcept_no:receipt});
 if(!memoryGuard(env).allowed)throw Error('memory_deferred');
 const raw=await secureDocument(url.href,env,{allowArchive:true,provider:'OpenDART'});
 if(raw.detected_type!=='ZIP'){
  // DART may return an API error envelope with HTTP 200. Never index it as a report.
  const stat=await fsp.stat(raw.file);if(raw.detected_type==='XML'&&stat.size<2048){const text=await fsp.readFile(raw.file,'utf8'),code=/^\s*(\d{3})/.exec(text.replace(/<[^>]+>/g,''))?.[1];if(code)throw Error('DART_API_'+code);}
  throw Error('DART_ARCHIVE_REQUIRED');
 }
 const file=raw.file+'.safe';
 try {
  const parsed=await parseDartArchive(raw,file,{receipt,...identity},env);
  withSecurity(env,l=>l.record(url.href,'SANITIZED','DART_ARCHIVE_STATIC_VALIDATED',{safe_path:file,dartClassification:parsed.classification,dartIdentity:parsed.identity}));return file;
 } catch(e){
  // Local output failures do not condemn the source. Missing raw files and all
  // document/security rejections retain the existing permanent review block.
  const storageFailure=e.message==='DART_STORAGE_FAILED'&&e.diagnostics?.classification==='DART_STORAGE_FAILED'&&fs.existsSync(raw.file);
  if(!storageFailure){withSecurity(env,l=>l.record(url.href,'DO_NOT_REFETCH',e.message));await fsp.unlink(file).catch(()=>{});}
  throw e;
 }
}
