import {hash,config} from './core.mjs';
import {canonicalIdentity} from './identity.mjs';
import {groupSources} from './source-lineage.mjs';
import {extractTableEvidence} from './table-evidence.mjs';
export const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const one=async(db,sql,...args)=>(await rows(db,sql,...args))[0]||null;
export class CatalystStore {
 constructor(db){this.db=db;}
 async cache(key){const r=await one(this.db,'SELECT payload,created_at,expires_at FROM catalyst_cache WHERE cache_key=?',key);return r?{value:JSON.parse(r.payload),at:r.created_at,stale:r.expires_at<=Date.now()}:null;}
 async putCache(key,value,ttl){await this.db.prepare('INSERT INTO catalyst_cache VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at').bind(key,JSON.stringify(value),new Date().toISOString(),Date.now()+ttl).run();}
 async saveRun(run){run.updatedAt=new Date().toISOString();await this.db.prepare('UPDATE catalyst_runs SET state=?,stage=?,payload=?,updated_at=? WHERE id=?').bind(run.state,run.stage,JSON.stringify(run),run.updatedAt,run.id).run();}
 async run(id,reader){const r=await one(this.db,'SELECT payload FROM catalyst_runs WHERE id=? AND reader_hash=?',id,reader);return r?JSON.parse(r.payload):null;}
 async addSource(s){
  const body=String(s.body||s.text||'').slice(0,60000),digest=await hash(body),now=new Date().toISOString();
  const tables=s.rawDocument?extractTableEvidence(s.rawDocument,{subject:s.assetId,source_location:s.url}):s.tables;
  const id=await hash(s.url+'|'+digest+(tables?.length?'|'+await hash(JSON.stringify(tables)):''));
  const value=groupSources([{...s,rawDocument:undefined,tables,id,body,contentHash:digest,observedAt:s.observedAt||s.retrievedAt||now}])[0];
  const statements=[this.db.prepare('INSERT INTO catalyst_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,independence_key=excluded.independence_key').bind(id,s.assetId||null,s.sourceType||'news',s.publisher||new URL(s.url).hostname,s.title||'',s.url,s.publishedAt||null,s.effectiveAt||null,value.observedAt,s.fiscalPeriod||null,digest,value.independenceKey,body,s.locator||null,s.originRef||null,JSON.stringify({...value,body:undefined}))];
  for(const c of tables?.flatMap(t=>t.cells)||[])statements.push(this.db.prepare('INSERT OR IGNORE INTO catalyst_table_cells VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,c.source_location,c.table_id,c.row_header,c.column_header,c.cell_value,c.unit,JSON.stringify(c.period),JSON.stringify(c.scope),c.footnote,JSON.stringify(c.unit_inheritance),JSON.stringify(c)));
  await this.db.batch(statements);return value;
 }
 async saveSourceLineage(sources){
  const grouped=groupSources(sources);
  for(const s of grouped)await this.db.prepare('INSERT INTO catalyst_source_lineage VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET independence_key=excluded.independence_key,original_url=excluded.original_url,content_hash=excluded.content_hash,version=excluded.version').bind(s.id,s.independenceKey,s.originalSourceUrl||s.originUrl||null,s.contentHash||await hash(s.body||''),s.lineageVersion).run();
  return grouped;
 }
 async saveClaim(c,runId){
  const now=new Date().toISOString(),statements=[this.db.prepare('INSERT INTO catalyst_claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,source_ids=excluded.source_ids,checked_at=excluded.checked_at').bind(c.id,runId,c.type,c.subject,c.predicate,JSON.stringify(c.value??null),c.status,c.confidence,c.asOf||null,JSON.stringify(c.sourceIds),c.quote||'',JSON.stringify(c),config.version,now)];
  statements.push(this.db.prepare('INSERT INTO catalyst_claim_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(claim_id) DO UPDATE SET subject=excluded.subject,predicate=excluded.predicate,object=excluded.object,typed_value=excluded.typed_value,period=excluded.period,scope=excluded.scope,effective_at=excluded.effective_at,verification_status=excluded.verification_status,validation_version=excluded.validation_version,validation_checks=excluded.validation_checks,independent_source_count=excluded.independent_source_count,checked_at=excluded.checked_at').bind(c.id,c.subject,c.structuredPredicate||c.predicate,c.object||c.value,JSON.stringify(c.typedValue||[]),JSON.stringify(c.period||{}),JSON.stringify(c.scope||{}),c.effectiveAt||null,c.status,c.validationVersion,JSON.stringify(c.validationChecks),c.independentSourceCount||0,now));
  statements.push(this.db.prepare('DELETE FROM catalyst_claim_sources WHERE claim_id=?').bind(c.id));
  statements.push(this.db.prepare('INSERT INTO catalyst_claim_context VALUES(?,?,?,?,?,?) ON CONFLICT(claim_id) DO UPDATE SET event_state=excluded.event_state,exposure_type=excluded.exposure_type,normalized_proposition=excluded.normalized_proposition,table_evidence=excluded.table_evidence,version=excluded.version').bind(c.id,c.scope?.eventState||null,c.exposureType||'UNKNOWN',JSON.stringify(c.normalizedProposition||null),JSON.stringify(c.tableEvidence||null),c.validationVersion));
  for(const e of c.sourceEvidence||[])if(e.sourceId)statements.push(this.db.prepare('INSERT INTO catalyst_claim_sources VALUES(?,?,?,?,?,?,?,?)').bind(c.id,e.sourceId,e.quote,e.locator||null,e.independenceKey,e.status,e.version,JSON.stringify(e.checks)));
  await this.db.batch(statements);
 }
 async asset(id){const a=await one(this.db,'SELECT id,kind,symbol,name,exchange,issuer_id,chain,contract_address,identity_status,payload FROM catalyst_assets WHERE id=?',id);if(!a)return null;const value={...JSON.parse(a.payload),id:a.id,kind:a.kind,symbol:a.symbol,name:a.name,exchange:a.exchange||null,issuerId:a.issuer_id||null,chain:a.chain||null,contractAddress:a.contract_address||null,identityStatus:a.identity_status};return {...value,canonicalIdentity:canonicalIdentity(value)};}
 async fact(id,category){const f=await one(this.db,'SELECT payload,expires_at FROM catalyst_facts WHERE asset_id=? AND category=?',id,category);return f?{...JSON.parse(f.payload),stale:f.expires_at<Date.now()}:null;}
 async putFact(id,category,value,sources,ttl){await this.db.prepare('INSERT INTO catalyst_facts VALUES(?,?,?,?,?,?) ON CONFLICT(asset_id,category) DO UPDATE SET payload=excluded.payload,source_ids=excluded.source_ids,verified_at=excluded.verified_at,expires_at=excluded.expires_at').bind(id,category,JSON.stringify(value),JSON.stringify(sources),new Date().toISOString(),Date.now()+ttl).run();}
 async runtime(key,value){if(value!==undefined)await this.db.prepare('INSERT INTO catalyst_runtime VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),new Date().toISOString()).run();const r=await one(this.db,'SELECT value FROM catalyst_runtime WHERE key=?',key);return r?JSON.parse(r.value):null;}
}
