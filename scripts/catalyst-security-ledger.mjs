import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import policy from '../config/catalyst-security.json' with {type:'json'};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function sourceIdentity(value){
 const u=new URL(value);u.hash='';u.searchParams.sort();
 // Credentials never enter metadata. DART receipt remains part of identity.
 for(const key of [...u.searchParams.keys()])if(/key|token|secret|auth|signature|password/i.test(key))u.searchParams.delete(key);
 u.username='';u.password='';
 return {normalized_url_hash:sha256(u.href),legacy_hash:sha256(value),domain:u.hostname,source_url:u.href};
}
export class SourceSecurityLedger {
 constructor(root=path.resolve('.sites-runtime/catalyst-security')){
  fs.mkdirSync(root,{recursive:true,mode:0o700});fs.chmodSync(root,0o700);this.file=path.join(root,'sources.sqlite');
  this.db=new DatabaseSync(this.file);fs.chmodSync(this.file,0o600);
  this.db.exec(`PRAGMA busy_timeout=10000;
   CREATE TABLE IF NOT EXISTS sources(normalized_url_hash TEXT PRIMARY KEY,domain TEXT,source_url TEXT,content_sha256 TEXT,security_status TEXT,reason TEXT,first_detected_at TEXT,last_detected_at TEXT,local_path TEXT,metadata TEXT);
   CREATE TABLE IF NOT EXISTS blocks(hash TEXT PRIMARY KEY,kind TEXT,reason TEXT);
   CREATE TABLE IF NOT EXISTS events(timestamp TEXT,source_url_hash TEXT,domain TEXT,provider TEXT,detected_type TEXT,bytes INTEGER,security_flags TEXT,action TEXT);`);
  for(const hash of policy.blockedLegacyUrlHashes)this.db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?,?)').run(hash,'URL','DEFENDER_REPORTED_REMOVAL');
 }
 close(){this.db.close();}
 get(url){return this.db.prepare('SELECT * FROM sources WHERE normalized_url_hash=?').get(sourceIdentity(url).normalized_url_hash);}
 record(url,status,reason,extra={}){
  const i=sourceIdentity(url),old=this.get(url),now=new Date().toISOString();
  this.db.prepare('INSERT OR REPLACE INTO sources VALUES(?,?,?,?,?,?,?,?,?,?)').run(i.normalized_url_hash,i.domain,i.source_url,extra.content_sha256||old?.content_sha256||null,status,reason,old?.first_detected_at||now,now,extra.local_path!==undefined?extra.local_path:old?.local_path||null,JSON.stringify({...JSON.parse(old?.metadata||'{}'),...extra}));
  if(['SECURITY_BLOCKED','MALWARE_REMOVED_BY_OS','DO_NOT_REFETCH'].includes(status)){
   this.db.prepare('INSERT OR REPLACE INTO blocks VALUES(?,?,?)').run(i.normalized_url_hash,'URL',reason);
   const content=extra.content_sha256||old?.content_sha256;if(content)this.db.prepare('INSERT OR REPLACE INTO blocks VALUES(?,?,?)').run(content,'CONTENT',reason);
  }
 }
 assertAllowed(url,contentHash=null,ownPending=false){
  const i=sourceIdentity(url),row=this.get(url);
  const block=this.db.prepare('SELECT hash FROM blocks WHERE hash IN (?,?,?) LIMIT 1').get(i.normalized_url_hash,i.legacy_hash,contentHash||row?.content_sha256||'');
  if(block||['SECURITY_BLOCKED','MALWARE_REMOVED_BY_OS','DO_NOT_REFETCH',...(ownPending?[]:['QUARANTINED'])].includes(row?.security_status))throw Error('SECURITY_BLOCKED_SOURCE');
  if(!ownPending&&row?.local_path&&!fs.existsSync(row.local_path)){
   // Conservative removal classification, not an antivirus diagnosis. We do
   // not know which OS process removed the file; preserve that uncertainty.
   this.record(url,'DO_NOT_REFETCH','FILE_MISSING_REVIEW_REQUIRED',{removal_attribution:'UNCONFIRMED_FILE_DISAPPEARED',local_path:row.local_path});
   throw Error('SECURITY_BLOCKED_SOURCE');
  }
 }
 event(url,{provider='research',detected_type=null,bytes=0,security_flags=[],action}){
  const i=sourceIdentity(url);this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(new Date().toISOString(),i.normalized_url_hash,i.domain,provider,detected_type,bytes,JSON.stringify(security_flags),action);
 }
 metrics(){return this.db.prepare('SELECT action,COUNT(*) count FROM events GROUP BY action').all();}
}
export function withSecurity(env,fn){const ledger=new SourceSecurityLedger(env.CATALYST_SECURITY_ROOT);try{return fn(ledger);}finally{ledger.close();}}
