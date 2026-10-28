import {hash,norm,config} from './core.mjs';
import {rows,one} from './store.mjs';
import {validateClaim} from './claims.mjs';
import {proposition} from './claim-validation.mjs';
import {verifyStructuredSource} from './structured-evidence.mjs';
import {eventState} from './normalization.mjs';
import {enrichStockIdentity} from './identity-enrichment.mjs';
import {CatalystGraph} from './graph.mjs';
import {businessAssertions} from './business-assertions.mjs';
import {lifecycle,supersedingEvent} from './graph-policy.mjs';

export const metadataVersion='metadata-4.1';
export const companyCategories=['business_segments','products','end_markets','customers','suppliers','capex_exposure','order_exposure'];
export function classifyBusinessFact(claim){
 const p=claim.normalizedProposition,cell=claim.tableEvidence,text=claim.quote||'',verb=p?.predicate||'';
 const base={relationship:'UNKNOWN',exposure_basis:claim.exposureType||'UNKNOWN',revenue_value:null,revenue_ratio:null,period:claim.period,stage:eventState(text)};
 if(p?.category)return {...base,category:p.category,fact_key:p.object,relationship:p.relationship,stage:p.eventState||base.stage};
 if(cell){
  const isRevenue=/매출|revenue|sales/i.test(cell.column_header+' '+cell.row_header);
  if(!isRevenue&&cell.kind!=='product')return null;
  return {...base,category:claim.exposureType==='PRODUCT_REVENUE'||cell.kind==='product'?'products':'business_segments',fact_key:cell.kind==='product'?cell.cell_value:cell.row_header,
   revenue_value:isRevenue&&cell.typed_value?.unit!=='percent'?cell.typed_value?.normalizedValue??null:null,
   revenue_ratio:isRevenue&&cell.typed_value?.unit==='percent'?cell.typed_value?.normalizedValue??null:null,unit:cell.unit,value:cell.cell_value};
 }
 if(!p)return null;
 const fact_key=p.object;
 if(/\bour products\b|\bteam members\b|\bemployees\b|\bmanufactured (?:on|and)\b|\balso offered\b/i.test(fact_key))return null;
 if(/CAPACITY_EXPANSION|INVESTS|plans?|planned|completed/i.test(verb)&&/투자|설비|증설|capacity|capex|capital expenditure|plant|facility/i.test(text))return {...base,category:'capex_exposure',fact_key};
 if(/order|수주|발주/i.test(text)&&/receiv|ORDERED|REPORTED_VALUE/i.test(verb))return {...base,category:'order_exposure',fact_key};
 if(['SUPPLIES_TO','COOPERATES_WITH','NEGOTIATES_CUSTOMER','PURSUES_SUPPLY_CHAIN'].includes(verb))return {...base,category:'customers',fact_key:p.recipient||p.object,relationship:({SUPPLIES_TO:'CONFIRMED_CUSTOMER',COOPERATES_WITH:'COOPERATION',NEGOTIATES_CUSTOMER:'TARGET_CUSTOMER',PURSUES_SUPPLY_CHAIN:'SUPPLY_CHAIN_ENTRY'})[verb]};
 if(verb==='TARGETS_MARKET')return {...base,category:'end_markets',fact_key,relationship:'TARGET_MARKET'};
 if(/^(PRODUCES|SELLS|DEVELOPS|PROVIDES|SUPPLIES|REPORTS_PRODUCTS|manufactures?|produces?|sells?|develops?|provides?|supplies|supply)$/.test(verb)){
  const relationship=/develop|DEVELOPS/.test(verb)?'DEVELOPMENT':base.stage==='PLANNED'?'PLANNED':/주력|principal product|primary product/i.test(text)?'PRIMARY_PRODUCT':/주요 제품|major product/i.test(text)?'MAJOR_PRODUCT':/secondary product|보조 제품/i.test(text)?'SECONDARY_PRODUCT':'UNKNOWN';
  return {...base,category:'products',fact_key,relationship};
 }
 return null;
}
export async function extractStockMetadata(store,asset,source,{now=Date.now(),namespace='production'}={}){
 if(!['KR_STOCK','US_STOCK'].includes(asset.kind)||source.assetId!==asset.id)throw Error('metadata_asset_mismatch');
 const claims=await verifyStructuredSource(store,source,asset,{now}),seen=new Set(claims.map(c=>norm(c.quote)));
 for(const a of businessAssertions(source.body)){
  const c=await validateClaim({id:'business:'+a.ref,type:a.category==='customers'?'customer':a.category==='capex_exposure'?'event':'business',subject_id:asset.id,predicate:a.predicate,value:a.quote,quote:a.quote,source_id:source.id,business_ref:a.ref,freshness_policy_id:a.category==='capex_exposure'?'CAPEX':'COMPANY_BUSINESS'},[source],[asset],'metadata:'+source.id,now);
  await store.saveClaim(c,'metadata:'+source.id);claims.push(c);seen.add(norm(a.quote));
 }
 for(const quote of String(source.body||'').split(/\n|(?<=[.!?。])\s+/).slice(0,600)){
  const p=proposition(quote);if(!p||quote.length>1200||seen.has(norm(quote)))continue;
  const own=[norm(asset.name).toLowerCase(),'we','our company','당사','우리 회사'].includes(p.subject);if(!own)continue;
  const lifecycleEvent=supersedingEvent({quote});
  const proposal={id:'metadata:'+norm(quote),type:lifecycleEvent?'event':p.predicate==='SUPPLIES_TO'?'customer':/INVESTS|CAPACITY_EXPANSION|completed|plans?/i.test(p.predicate)?'event':'business',subject_id:asset.id,predicate:p.predicate,value:quote,quote,source_id:source.id,...(lifecycleEvent?{freshness_policy_id:'CUSTOMER_SUPPLIER'}:{})};
  const c=await validateClaim(proposal,[source],[asset],'metadata:'+source.id,now);if(!classifyBusinessFact(c)&&!lifecycleEvent)continue;
  await store.saveClaim(c,'metadata:'+source.id);claims.push(c);seen.add(norm(quote));if(claims.length>=128)break;
 }
 const facts=[],graph=new CatalystGraph(store.db,{namespace});
 for(const c of claims){
  if(supersedingEvent(c))await graph.applyLifecycleClaim(c,{now});
  const fact=classifyBusinessFact(c);if(!fact||!fact.fact_key)continue;
  const id=await hash([asset.id,fact.category,fact.fact_key,source.id].join('|')),at=new Date(now).toISOString();
  const value={...fact,id,company_id:asset.id,product_id:fact.category==='products'?fact.fact_key:null,verification_status:c.status,claim_ids:[c.id],last_verified_at:at,source_url:source.url,source_id:source.id,source_date:source.publishedAt,quote:c.quote,locator:c.locator,version:metadataVersion};
  await store.db.batch([
   store.db.prepare(`INSERT INTO company_metadata_facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET relationship=excluded.relationship,exposure_basis=excluded.exposure_basis,revenue_value=excluded.revenue_value,revenue_ratio=excluded.revenue_ratio,period=excluded.period,claim_ids=excluded.claim_ids,verification_status=excluded.verification_status,payload=excluded.payload,last_verified_at=excluded.last_verified_at,lifecycle_status='ACTIVE'`).bind(id,asset.id,fact.category,fact.fact_key,fact.relationship,fact.exposure_basis,fact.revenue_value,fact.revenue_ratio,JSON.stringify(fact.period),c.status,JSON.stringify([c.id]),at,source.id,source.publishedAt||null,'ACTIVE',JSON.stringify(value)),
   store.db.prepare('INSERT OR IGNORE INTO company_metadata_claims VALUES(?,?)').bind(id,c.id)
  ]);
  facts.push(value);
  if(fact.category==='products'&&/^(PRODUCES|produces?|manufactures?)$/.test(c.structuredPredicate)&&fact.fact_key.length<=120&&!/\bour products\b|\bwhich\b|\bthat\b|\bthese\b/i.test(fact.fact_key)){
   const from=await graph.node({kind:'COMPANY',label:c.normalizedProposition.subject==='we'?asset.name:c.normalizedProposition.subject,assetId:asset.id}),to=await graph.node({kind:'PRODUCT',label:fact.fact_key});
   const edge={source_node_id:from,target_node_id:to,relation_type:'PRODUCES',freshness_policy_id:'COMPANY_PRODUCT',event_state:c.scope?.eventState||null,status:'VERIFIED'};
   await graph.propose(edge,{claimIds:[c.id]});if(c.status==='VERIFIED')await graph.publish(edge,[c.id],{now});
  }
 }
 // A newer filing supersedes prior metadata, but preserves its facts and evidence.
 if(source.publishedAt&&facts.length)await store.db.prepare("UPDATE company_metadata_facts SET lifecycle_status='SUPERSEDED' WHERE company_id=? AND source_date<? AND source_id<>? AND EXISTS (SELECT 1 FROM company_metadata_facts newer WHERE newer.company_id=company_metadata_facts.company_id AND newer.category=company_metadata_facts.category AND newer.fact_key=company_metadata_facts.fact_key AND newer.source_date>company_metadata_facts.source_date)").bind(asset.id,source.publishedAt,source.id).run();
 // Re-extraction after a stricter parser retires only this source's old projections.
 const retained=new Set(facts.map(f=>f.id));for(const prior of await rows(store.db,"SELECT id FROM company_metadata_facts WHERE company_id=? AND source_id=? AND category NOT LIKE 'profile:%'",asset.id,source.id))if(!retained.has(prior.id)){
  await store.db.prepare("UPDATE company_metadata_facts SET lifecycle_status='EXPIRED' WHERE id=?").bind(prior.id).run();
  // Retiring an extraction is not evidence that the company's business ended.
  // Keep the row, but exclude edges supported only by retired projections.
  await store.db.prepare(`UPDATE catalyst_graph_policy SET lifecycle_status='EXPIRED',lifecycle_event='EXTRACTION_RETIRED',updated_at=?
   WHERE edge_id IN (SELECT e.edge_id FROM catalyst_graph_evidence e JOIN company_metadata_claims c ON c.claim_id=e.claim_id WHERE c.fact_id=?)
   AND NOT EXISTS (SELECT 1 FROM catalyst_graph_evidence e JOIN company_metadata_claims c ON c.claim_id=e.claim_id JOIN company_metadata_facts f ON f.id=c.fact_id WHERE e.edge_id=catalyst_graph_policy.edge_id AND f.lifecycle_status='ACTIVE' AND f.verification_status='VERIFIED')`).bind(new Date(now).toISOString(),prior.id).run();
 }
 return facts;
}
export async function stockMetadata(store,id){
 const facts=await rows(store.db,"SELECT payload,lifecycle_status FROM company_metadata_facts WHERE company_id=? AND lifecycle_status='ACTIVE' ORDER BY category,fact_key LIMIT 256",id);
 const values=facts.map(f=>{const value=JSON.parse(f.payload),policy=value.category==='customers'||value.category==='suppliers'?'CUSTOMER_SUPPLIER':value.category==='capex_exposure'?'CAPEX':value.category==='order_exposure'?'NEW_ORDER':'COMPANY_BUSINESS';return {...value,freshness_policy_id:policy,lifecycle_status:lifecycle({evidence_at:value.source_date,freshness_policy_id:policy,lifecycle_status:f.lifecycle_status})};});
 return {asset_id:id,version:metadataVersion,groups:Object.fromEntries(companyCategories.map(k=>[k,values.filter(f=>f.category===k)])),request:await one(store.db,'SELECT * FROM catalyst_metadata_requests WHERE asset_id=?',id)};
}
export async function collectStockMetadata(env,store,asset,{now=Date.now(),force=false,namespace='production'}={}){
 asset=await enrichStockIdentity(env,store,asset);
 const old=await store.fact(asset.id,'stock_metadata');if(old&&!old.stale&&!force)return stockMetadata(store,asset.id);
 if(!env.CATALYST_TOOLS?.business)throw Error('business_provider_unavailable');
 const started=performance.now(),raw=await env.CATALYST_TOOLS.business(asset),remoteMs=performance.now()-started;
 if(!raw?.body||raw.assetId!==asset.id)throw Error('business_body_unavailable');
 const source=await store.addSource(raw),facts=await extractStockMetadata(store,asset,source,{now,namespace});
 const result={source_id:source.id,source_url:source.url,source_date:source.publishedAt,facts:facts.length,verified:facts.filter(f=>f.verification_status==='VERIFIED').length,remoteMs};
 await store.putFact(asset.id,'stock_metadata',result,[source.id],config.ttl.business);return {...await stockMetadata(store,asset.id),collection:result};
}
