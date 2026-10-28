import policy from '../../config/catalyst-beneficiary.json' with {type:'json'};
import {one} from './store.mjs';
// Durable atomic reservations include failures; retries/restarts cannot reset
// the limit. Uses the existing DB cache table, no resident process/migration.
export async function reserveBeneficiaryCall(store,jobId,feature){
 const key='beneficiary:ai-calls:'+jobId,at=new Date().toISOString();
 const row=await one(store.db,`INSERT INTO catalyst_cache(cache_key,payload,created_at,expires_at) VALUES(?,?,?,?)
 ON CONFLICT(cache_key) DO UPDATE SET payload=json_set(payload,'$.total',json_extract(payload,'$.total')+1,'$.'||?,COALESCE(json_extract(payload,'$.'||?),0)+1)
 WHERE json_extract(payload,'$.total')<? AND COALESCE(json_extract(payload,'$.'||?),0)<? RETURNING payload`,key,JSON.stringify({total:1,[feature]:1}),at,8640000000000000,feature,feature,policy.aiCallLimit,feature,feature==='BENEFICIARY_PLAN'?1:policy.deepLimit);
 if(!row)throw Error('BENEFICIARY_AI_CALL_LIMIT');return JSON.parse(row.payload);
}
