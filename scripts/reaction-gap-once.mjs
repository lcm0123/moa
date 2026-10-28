import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../server/sqlite-adapter.mjs';
import {one} from '../server/catalyst/store.mjs';
import {deliverySourceAllowed} from './catalyst-delivery-security.mjs';
import {failGap} from '../server/reaction-gap/store.mjs';

// Explicit worker only: no dotenv, migration, server or collector imports.
const [id,version,token]=process.argv.slice(2);
if(process.env.REACTION_GAP_ENABLED!=='true'||!/^[a-f0-9-]{36}$/.test(id||'')||!/^\d+$/.test(version||'')||!/^[a-f0-9-]{36}$/.test(token||'')||!process.env.MOA_DB_FILE||!fs.existsSync(process.env.MOA_DB_FILE))throw Error('INVALID_GAP_WORKER');
const sqlite=new DatabaseSync(process.env.MOA_DB_FILE);sqlite.exec('PRAGMA busy_timeout=10000');
const DB=d1Adapter(sqlite);
const row=await one(DB,"SELECT * FROM reaction_gap_jobs WHERE id=? AND version=? AND state='RUNNING' AND lease_token=? AND EXISTS(SELECT 1 FROM catalyst_runtime WHERE key='research-worker-lease' AND json_extract(value,'$.token')=? AND json_extract(value,'$.gapJob')=?)",id,Number(version),token,token,id);
if(!row){sqlite.close();process.exit(0);}
// This phase is storage-only. An accidental future fetch cannot spend a key or
// mutate a provider cache inside the result computation worker.
globalThis.fetch=async()=>{throw Error('REACTION_GAP_NETWORK_DISABLED');};
try{
 const {executeGapJob}=await import('../server/reaction-gap/service.mjs');
 await executeGapJob(DB,row,{now:Date.now(),sourceAllowed:source=>deliverySourceAllowed(process.env,source),requireSharedLease:true});
}catch(error){await failGap(DB,row,/^[A-Z0-9_]{1,80}$/.test(error.message||'')?error.message:'WORKER_FAILED');}
finally{sqlite.close();}
