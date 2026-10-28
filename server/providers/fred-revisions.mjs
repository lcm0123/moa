// The token/generation guard follows the existing reaction-gap publication fence.
// It is deliberately independent of that feature's jobs, flags and private owners.
const first=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results[0]||null;
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const guard='EXISTS(SELECT 1 FROM fred_macro_refresh_fences WHERE cache_key=? AND owner_token=? AND generation=?)';
const owner=fence=>[fence.key,fence.token,fence.generation];

export async function claimFredRefresh(db,key,now){
 const token=crypto.randomUUID();
 const row=await first(db,'INSERT INTO fred_macro_refresh_fences(cache_key,generation,owner_token,requested_at) VALUES(?,1,?,?) ON CONFLICT(cache_key) DO UPDATE SET generation=generation+1,owner_token=excluded.owner_token,requested_at=excluded.requested_at WHERE fred_macro_refresh_fences.requested_at<=excluded.requested_at RETURNING generation',key,token,new Date(now).toISOString());
 return row?{key,token,generation:row.generation}:null;
}

export function exactFredObservations(observations){
 if(!Array.isArray(observations))throw Error('RESPONSE_OBSERVATION_VALUE');
 const seen=new Set();
 return observations.map(p=>{
  // FRED delivers decimal strings. Reject numeric JSON before it can be promoted
  // to an allegedly exact value; chart Number conversion happens only afterwards.
  if(!day(p.date)||seen.has(p.date)||typeof p.value!=='string'||!(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(p.value)||p.value==='.'))throw Error('RESPONSE_OBSERVATION_VALUE');
  seen.add(p.date);
  return {date:p.date,value:p.value,realtime_start:day(p.realtime_start),realtime_end:day(p.realtime_end)};
 });
}

function revisionInsert(db,fence,series,rows,{revision,receivedAt,recordedAt,hash,provenance,baseline=false}){
 return db.prepare(`INSERT OR IGNORE INTO fred_observation_revisions(series_id,observation_date,revision,value_exact,observation_state,provider_realtime_start,provider_realtime_end,received_at,recorded_at,source_identifier,source_hash,provenance)
 SELECT ?,json_extract(j.value,'$.date'),?,json_extract(j.value,'$.value'),CASE WHEN json_extract(j.value,'$.absent')=1 THEN 'ABSENT_FROM_RESPONSE' WHEN json_extract(j.value,'$.value')='.' THEN 'MISSING' ELSE 'VALUE' END,json_extract(j.value,'$.realtime_start'),json_extract(j.value,'$.realtime_end'),?,?,?, ?,?
 FROM json_each(?) j WHERE ${guard}${baseline?' AND NOT EXISTS(SELECT 1 FROM fred_observation_revisions r WHERE r.series_id=? AND r.observation_date=json_extract(j.value,\'$.date\'))':''}`)
 .bind(series,revision,receivedAt,recordedAt,'FRED:series/observations:'+series,hash,provenance,JSON.stringify(rows),...owner(fence),...(baseline?[series]:[]));
}

// Cache, any preserved legacy baseline, and new revisions commit atomically.
// A stale request publishes neither values nor error/cooldown state.
export async function publishFredCache(db,fence,{payload,retrievedAt,nextAttempt,error=null,previous=null,previousAt=null,recordedAt}){
 const statements=[],series=fence.key.startsWith('observations:full:')?fence.key.slice('observations:full:'.length):null;
 if(series&&!error){
  const current=exactFredObservations(payload.observations),currentHash=await digest(JSON.stringify(current));
  let prior=[];
  if(previous?.observations){
   // Existing cache is evidence of a saved value, not a reconstructed release.
   // Do not convert legacy numeric values into supposedly lossless strings.
   // If legacy values are numeric, retain that cache and defer publication;
   // silently skipping them would destroy the only saved prior representation.
   prior=exactFredObservations(previous.observations);
   if(prior.length)statements.push(revisionInsert(db,fence,series,prior,{revision:0,receivedAt:iso(previousAt),recordedAt,hash:await digest(JSON.stringify(prior)),provenance:'EXISTING_CACHE',baseline:true}));
  }
  const before=new Map(prior.map(p=>[p.date,p])),after=new Set(current.map(p=>p.date));
  const changed=current.filter(p=>{const old=before.get(p.date);return !old||old.value!==p.value||old.realtime_start!==p.realtime_start||old.realtime_end!==p.realtime_end;});
  // Absence is preserved explicitly, never relabelled a correction or zero.
  changed.push(...prior.filter(p=>!after.has(p.date)).map(p=>({...p,value:null,absent:true})));
  if(changed.length)statements.push(revisionInsert(db,fence,series,changed,{revision:fence.generation,receivedAt:iso(retrievedAt),recordedAt,hash:currentHash,provenance:'FETCHED'}));
 }
 statements.push(db.prepare(`INSERT INTO fred_macro_cache(cache_key,payload,retrieved_at,next_attempt,error_code) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,retrieved_at=excluded.retrieved_at,next_attempt=excluded.next_attempt,error_code=excluded.error_code`).bind(fence.key,payload===null?null:JSON.stringify(payload),retrievedAt,nextAttempt,error,...owner(fence)));
 const results=await db.batch(statements);
 return results.at(-1).meta.changes===1;
}

export async function readFredCache(db,key){
 const row=await first(db,'SELECT * FROM fred_macro_cache WHERE cache_key=?',key);
 let payload=null;try{payload=JSON.parse(row?.payload||'null');}catch{}
 return {payload,retrievedAt:row?.retrieved_at||null,stale:!!row?.error_code,error:row?.error_code||null};
}
