import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {sourceIdentity} from './catalyst-security-ledger.mjs';
import policy from '../config/catalyst-security.json' with {type:'json'};

// A page view must not mutate the security ledger or fetch missing files.
export function deliverySourceAllowed(env,source){
 const file=path.join(env.CATALYST_SECURITY_ROOT||'.sites-runtime/catalyst-security','sources.sqlite');
 if(!fs.existsSync(file))return false;
 let db;
 try{
  const identity=sourceIdentity(source.url);if(policy.blockedLegacyUrlHashes.includes(identity.legacy_hash))return false;
  db=new DatabaseSync(file,{readOnly:true});
  const row=db.prepare('SELECT * FROM sources WHERE normalized_url_hash=?').get(identity.normalized_url_hash);
  if(row&&['SECURITY_BLOCKED','MALWARE_REMOVED_BY_OS','DO_NOT_REFETCH','QUARANTINED'].includes(row.security_status))return false;
  if(row?.local_path&&!fs.existsSync(row.local_path))return false;
  return !db.prepare('SELECT hash FROM blocks WHERE hash IN (?,?,?,?) LIMIT 1').get(identity.normalized_url_hash,identity.legacy_hash,source.documentHash||'',row?.content_sha256||'');
 }catch{return false;}finally{db?.close();}
}
