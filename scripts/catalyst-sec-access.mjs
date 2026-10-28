import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import {validSecUserAgent} from '../server/sec-client.mjs';
// Same slots/cooldown as the existing SEC client and Python worker.
export async function reserveSecRequest(env){
 if(!validSecUserAgent(env.SEC_USER_AGENT))throw Error('SEC_USER_AGENT_CONTACT_REQUIRED');
 const file=path.resolve(env.MOA_DB_FILE||'.sites-runtime/search-events.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS sec_runtime(key TEXT PRIMARY KEY,value TEXT)');
 try{
  const start=Date.now()/1000,until=Number(db.prepare("SELECT value FROM sec_runtime WHERE key='sec_cooldown'").get()?.value||0);
  if(until>start)throw Error('SEC_ACCESS_UNAVAILABLE');
  const slot=Number(db.prepare("INSERT INTO sec_runtime(key,value) VALUES('request_slot',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(sec_runtime.value AS REAL),?)+1 AS TEXT) RETURNING value").get(String(start+1),start).value)-1;
  if(slot>start)await new Promise(r=>setTimeout(r,(slot-start)*1000));
  if(Number(db.prepare("SELECT value FROM sec_runtime WHERE key='sec_cooldown'").get()?.value||0)>Date.now()/1000)throw Error('SEC_ACCESS_UNAVAILABLE');
 }finally{db.close();}
}
export function secDenied(env,retryAfter=null){
 const now=Date.now()/1000,seconds=/^\d+$/.test(String(retryAfter||''))?Number(retryAfter):(Date.parse(retryAfter)-Date.now())/1000;
 const until=now+Math.max(900,Math.min(86400,Number.isFinite(seconds)?seconds:900));
 const db=new DatabaseSync(path.resolve(env.MOA_DB_FILE||'.sites-runtime/search-events.sqlite'));
 try{db.prepare("INSERT INTO sec_runtime VALUES('sec_cooldown',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(sec_runtime.value AS REAL),?) AS TEXT)").run(String(until),until);}finally{db.close();}
}
