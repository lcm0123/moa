import {one} from './store.mjs';
import {collectStockMetadata,stockMetadata} from './stock-metadata.mjs';
import {collectCryptoMetadata,cryptoMetadata} from './crypto-metadata.mjs';
import {marketContext} from './market.mjs';
export async function readMetadata(store,asset){
 return {asset:{id:asset.id,symbol:asset.symbol,name:asset.name,kind:asset.kind},metadata:asset.kind==='CRYPTO'?await cryptoMetadata(store,asset.id):await stockMetadata(store,asset.id),market:(await store.cache('market:v6.1:'+asset.id))||null,request:await one(store.db,'SELECT * FROM catalyst_metadata_requests WHERE asset_id=?',asset.id)};
}
export async function requestMetadata(store,asset,{now=Date.now()}={}){
 const old=await one(store.db,'SELECT * FROM catalyst_metadata_requests WHERE asset_id=?',asset.id);
 if(old&&(['queued','running'].includes(old.status)||now-Date.parse(old.requested_at)<60000))return old;
 if((await one(store.db,"SELECT count(*) n FROM catalyst_metadata_requests WHERE status IN ('queued','running')")).n>=12)throw Error('metadata_queue_full');
 await store.db.prepare(`INSERT INTO catalyst_metadata_requests VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET status=excluded.status,requested_at=excluded.requested_at,error_code=NULL`).bind(asset.id,asset.kind,'queued',null,new Date(now).toISOString(),null,null,'{}').run();
 return {asset_id:asset.id,status:'queued'};
}
export async function processMetadataJob(env,store,{now=Date.now()}={}){
 await store.db.prepare("UPDATE catalyst_metadata_requests SET status='queued',error_code='interrupted' WHERE status='running' AND requested_at<?").bind(new Date(now-10*60000).toISOString()).run();
 const job=await one(store.db,"SELECT * FROM catalyst_metadata_requests WHERE status='queued' ORDER BY requested_at LIMIT 1");if(!job)return false;
 const claimed=await store.db.prepare("UPDATE catalyst_metadata_requests SET status='running',requested_at=? WHERE asset_id=? AND status='queued'").bind(new Date(now).toISOString(),job.asset_id).run();if(!claimed.meta.changes)return false;
 const asset=await store.asset(job.asset_id),result={gptCalls:0};let error=null;
 try{result.metadata=asset.kind==='CRYPTO'?await collectCryptoMetadata(env,store,asset,{now}):await collectStockMetadata(env,store,asset,{now});}catch{error='metadata_source_unavailable';}
 try{result.market=await marketContext(env,store,asset,{now});}catch{result.marketError='market_source_unavailable';}
 const status=error?'failed':result.marketError?'partial':'ready';
 await store.db.prepare('UPDATE catalyst_metadata_requests SET status=?,completed_at=?,error_code=?,payload=? WHERE asset_id=?').bind(status,new Date().toISOString(),error,JSON.stringify({gptCalls:0,marketError:result.marketError||null,collection:result.metadata?.collection||null,peakRssMB:globalThis.process?.resourceUsage?.().maxRSS/1024||null}),asset.id).run();
 return true;
}
