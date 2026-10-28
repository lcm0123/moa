import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {one} from '../server/catalyst/store.mjs';
import {beneficiaryFilingSections,researchHtml} from './catalyst-research-tools.mjs';
import {deliverySourceAllowed} from './catalyst-delivery-security.mjs';
import {sourceIdentity} from './catalyst-security-ledger.mjs';
import policy from '../config/catalyst-security.json' with {type:'json'};

// Replay an already accepted issuer document through the same bounded section
// selector and parsers. This cannot download, register a source authority, or
// change a security decision. Historical receipt contents do not gain a new
// observation date when the local extraction algorithm changes.
export async function storedKoreanProfileSources(env,store,asset,report){
 if(asset.market!=='KR'||!/^\d{14}$/.test(report?.rcept_no||'')||report.corp_code!==asset.issuerId)return [];
 const url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+report.rcept_no;
 const witness=await one(store.db,"SELECT payload FROM catalyst_sources WHERE asset_id=? AND url=? AND json_extract(payload,'$.securityVersion')=? AND json_extract(payload,'$.originRef')=? AND json_extract(payload,'$.documentId') IS NOT NULL ORDER BY observed_at DESC LIMIT 1",asset.id,url,policy.version,report.rcept_no);
 if(!witness)return [];
 const source=JSON.parse(witness.payload);if(!deliverySourceAllowed(env,source))throw Error('SECURITY_BLOCKED_SOURCE');
 const doc=await one(store.db,"SELECT * FROM catalyst_filing_documents WHERE id=? AND issuer_id=? AND url=? AND parser_version='sections-security-1' AND last_indexed_at<>'INDEXING'",source.documentId,asset.id,url);
 if(!doc||source.documentHash!==doc.document_hash||!doc.local_path.endsWith('.safe'))return [];
 const api='https://opendart.fss.or.kr/api/document.xml?rcept_no='+report.rcept_no,identity=sourceIdentity(api),securityFile=path.join(env.CATALYST_SECURITY_ROOT||'.sites-runtime/catalyst-security','sources.sqlite');
 if(!fs.existsSync(securityFile))return [];
 const db=new DatabaseSync(securityFile,{readOnly:true});
 try{
  const ledger=db.prepare('SELECT * FROM sources WHERE normalized_url_hash=?').get(identity.normalized_url_hash),m=JSON.parse(ledger?.metadata||'{}');
  if(!ledger||!['NORMAL','SANITIZED'].includes(ledger.security_status)||db.prepare('SELECT hash FROM blocks WHERE hash IN (?,?,?,?) LIMIT 1').get(identity.normalized_url_hash,identity.legacy_hash,doc.document_hash,ledger.content_sha256||''))throw Error('SECURITY_BLOCKED_SOURCE');
  if(m.securityVersion!==policy.version||m.safe_path!==doc.local_path||!m.dartIdentity?.receipt||!m.dartIdentity?.issuer||!m.dartIdentity?.title||!m.dartIdentity?.structure)return [];
  if(ledger.local_path&&!fs.existsSync(ledger.local_path))throw Error('SECURITY_BLOCKED_SOURCE');
 }finally{db.close();}
 let stat;try{stat=fs.statSync(doc.local_path);}catch{throw Error('SECURITY_BLOCKED_SOURCE');}
 if(stat.size!==doc.byte_size||stat.mtimeMs!==doc.file_mtime_ms||stat.size>policy.maxUncompressedBytes)throw Error('CACHED_DOCUMENT_CHANGED');
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(doc.local_path,{highWaterMark:65536}))hash.update(chunk);
 if(hash.digest('hex')!==doc.document_hash)throw Error('CACHED_DOCUMENT_CHANGED');
 const picked=await beneficiaryFilingSections(store,doc.id,'BENEFICIARY_MATERIALITY'),date=report.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const results=picked.map(s=>({...researchHtml(s.html),securityVersion:policy.version,url,title:report.report_nm,assetId:asset.id,sourceType:'regulatory',publisher:'OpenDART',publishedAt:date,observedAt:source.observedAt||doc.last_indexed_at,originRef:report.rcept_no,documentId:doc.id,documentHash:doc.document_hash,sectionKind:s.kind,heading:s.heading,sectionHtml:s.html,sectionTruncated:!!s.truncated,locator:url+'#'+s.locator,retrieval:{indexCached:true,replayedFromAcceptedSource:source.id,replayedAt:new Date().toISOString(),networkRequests:0}}));
 if(results.some(s=>!deliverySourceAllowed(env,s)))throw Error('SECURITY_BLOCKED_SOURCE');
 return results;
}
