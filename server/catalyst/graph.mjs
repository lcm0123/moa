import {corroborated} from './evidence-policy.mjs';
import {hash,norm,nodeKinds,relations} from './core.mjs';
import {rows,one} from './store.mjs';
import {validationVersion,validationStages} from './claim-validation.mjs';
import {freshnessPolicy,lifecycle,canonicalCondition,conditionsMatch,supersedingEvent} from './graph-policy.mjs';
import {eventStates} from './normalization.mjs';

export const graphVersion='graph-3';
export const graphStatuses=['PENDING','SUPPORTED','VERIFIED','REJECTED','CONFLICTED'];
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const serial=v=>JSON.stringify(canonical(v));
const label=s=>norm(s).toLowerCase();
const supported=new Set(['SUPPORTED','VERIFIED']);
const english={produces:'PRODUCES',produce:'PRODUCES',manufactures:'PRODUCES',manufacture:'PRODUCES',requires:'REQUIRES',require:'REQUIRES',increases:'INCREASES',increase:'INCREASES',decreases:'DECREASES',decrease:'DECREASES',supplies:'SUPPLIES',supply:'SUPPLIES',uses:'USES',use:'USES'};
async function bindingHash(c){return hash(serial({subject:c.subject,predicate:c.structuredPredicate,value:c.value,status:c.status,proposition:c.normalizedProposition,checks:c.validationChecks,version:c.validationVersion,sourceEvidence:c.sourceEvidence,...(c.evidencePolicy?{evidencePolicy:c.evidencePolicy,corroboration:c.corroboration,policySources:c.policySources}:{})}));}
function exactAssertion(claim,from,to,edge){
 const p=claim.normalizedProposition;if(!p)return false;
 if((from.asset_id||to.asset_id)&&(!['business','customer','revenue_share','protocol_metric','value_capture','tokenomics'].includes(claim.type)||claim.subject!==(from.asset_id||to.asset_id)))return false;
 const relation=english[p.predicate]||p.predicate;
 const subject=p.subject===label(from.label)||(from.asset_id&&from.asset_id===claim.subject&&/^(we|our company|당사|우리 회사)$/.test(p.subject));
 const target=edge.relation_type==='SUPPLIES_TO'?p.recipient:p.object;
 return subject&&relation===edge.relation_type&&target===label(to.label)&&serial(canonicalCondition(p.canonical_condition||p.condition||{}))===serial(edge.condition)&&
  (edge.event_state||null)===(p.eventState||claim.scope?.eventState||null);
}
function usableClaim(c,status,now,edge){
 return c&&c.validationVersion===validationVersion&&supported.has(c.status)&&(status!=='VERIFIED'||c.status==='VERIFIED')&&
  validationStages.every(k=>c.validationChecks?.[k]?.status==='PASS'||(status==='SUPPORTED'&&k==='SOURCE_AUTHORITY'))&&
  (c.sourceEvidence?.some(e=>supported.has(e.status)&&e.sourceId)||corroborated(c))&&Number.isFinite(Date.parse(c.asOf))&&Date.parse(c.asOf)<=now&&now-Date.parse(c.asOf)<=freshnessPolicy({policy_id:edge.freshness_policy_id,relation_type:edge.relation_type,claim_type:c.type,edge_kind:edge.edge_kind}).max_age;
}
export class CatalystGraph {
 constructor(db,{namespace='production'}={}){this.db=db;this.namespace=namespace;}
 async node({kind,label:raw,assetId=null}){
  if(!nodeKinds.includes(kind)||!norm(raw)||norm(raw).length>180)throw Error('invalid_graph_node');
  if(['COMPANY','TOKEN','ASSET'].includes(kind)&&!assetId)throw Error('asset_identity_required');
  const id=await hash([this.namespace,kind,assetId||label(raw)].join('|'));
  await this.db.prepare('INSERT INTO catalyst_graph_nodes VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label').bind(id,kind,norm(raw),assetId,this.namespace,graphVersion,'{}').run();return id;
 }
 async edgeInput(input){
  const from=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=? AND namespace=?',input.source_node_id,this.namespace),to=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=? AND namespace=?',input.target_node_id,this.namespace);
  if(!from||!to||!relations.includes(input.relation_type)||!graphStatuses.includes(input.status||'PENDING'))throw Error('invalid_graph_edge');
  const condition=canonicalCondition(input.canonical_condition||input.condition||{});
  if(!condition||Array.isArray(condition)||typeof condition!=='object'||Object.keys(condition).length>10||Object.values(condition).some(v=>typeof v!=='string'||v.length>180))throw Error('invalid_condition');
  if(input.event_state&&!eventStates.includes(input.event_state))throw Error('invalid_event_state');
  for(const key of ['valid_from','valid_to'])if(input[key]&&!Number.isFinite(Date.parse(input[key])))throw Error('invalid_validity');
  if(input.valid_from&&input.valid_to&&Date.parse(input.valid_from)>=Date.parse(input.valid_to))throw Error('invalid_validity');
  if(input.confidence!==null&&input.confidence!==undefined&&(!Number.isFinite(input.confidence)||input.confidence<0||input.confidence>1))throw Error('invalid_confidence');
  const direction=input.direction||'unclear';if(!['positive','negative','unclear'].includes(direction))throw Error('invalid_direction');
  if(direction==='positive'&&!['INCREASES','BENEFITS_FROM'].includes(input.relation_type)||direction==='negative'&&!['DECREASES','HURT_BY'].includes(input.relation_type))throw Error('unverified_direction');
  const condition_hash=await hash(serial(condition)),id=await hash([from.id,input.relation_type,to.id,condition_hash].join('|'));
  const edge={...input,id,condition,condition_hash,direction,status:input.status||'PENDING',edge_kind:from.asset_id||to.asset_id?'COMPANY':'GENERIC',namespace:this.namespace,canonical_condition:condition,raw_condition_text:input.raw_condition_text||input.condition?.scenario||null,freshness_policy_id:freshnessPolicy({relation_type:input.relation_type,edge_kind:from.asset_id||to.asset_id?'COMPANY':'GENERIC',policy_id:input.freshness_policy_id}).policy_id};
  return {edge,from,to};
 }
 async propose(input,{claimIds=[],runId=null}={}){
  const {edge}=await this.edgeInput({...input,status:'PENDING'}),prior=await one(this.db,'SELECT payload FROM catalyst_candidate_edges WHERE id=?',edge.id),old=prior?JSON.parse(prior.payload):{};
  const payload={...edge,claim_ids:[...new Set([...(old.claim_ids||[]),...claimIds])],run_ids:[...new Set([...(old.run_ids||[]),runId].filter(Boolean))].slice(-20)};
  await this.db.prepare(`INSERT INTO catalyst_candidate_edges VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,graph_version=excluded.graph_version,validation_version=excluded.validation_version`).bind(edge.id,edge.source_node_id,edge.relation_type,edge.target_node_id,edge.condition_hash,'PENDING',graphVersion,validationVersion,new Date().toISOString(),JSON.stringify(payload)).run();
  return {...edge,status:'PENDING'};
 }
 // Explicit server-side promotion only. processRun never calls this method.
 async publish(input,claimIds,{now=Date.now()}={}){
  const {edge,from,to}=await this.edgeInput(input);
  const existing=await one(this.db,'SELECT * FROM catalyst_graph_edges WHERE id=? AND namespace=?',edge.id,this.namespace);
  if(existing?.status==='VERIFIED'&&edge.status==='SUPPORTED')return existing;
  if(!supported.has(edge.status))throw Error('promotion_status_required');
  if(!claimIds?.length)throw Error('evidence_required');
  const evidence=[],dates=[];
  const priorPolicy=await one(this.db,'SELECT lifecycle_status FROM catalyst_graph_policy WHERE edge_id=?',edge.id);
  if(priorPolicy&&['SUPERSEDED','EXPIRED'].includes(priorPolicy.lifecycle_status))throw Error('superseded_edge_requires_new_validity');
  for(const id of [...new Set(claimIds)]){
   const row=await one(this.db,'SELECT c.payload,l.verification_status,l.validation_version FROM catalyst_claims c JOIN catalyst_claim_ledger l ON l.claim_id=c.id WHERE c.id=?',id),c=row?JSON.parse(row.payload):null;
   if(!usableClaim(c,edge.status,now,edge)||row.verification_status!==c.status||row.validation_version!==validationVersion||!exactAssertion(c,from,to,edge))throw Error('edge_evidence_mismatch');
   if(this.namespace==='production'&&c.sourceUrl?.includes('.invalid'))throw Error('fixture_in_production');
   dates.push(c.asOf);evidence.push({id,hash:await bindingHash(c)});
  }
  const at=new Date(now).toISOString();
  const statements=[this.db.prepare(`INSERT INTO catalyst_graph_edges VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,last_verified_at=excluded.last_verified_at,event_state=excluded.event_state,confidence=excluded.confidence,direction=excluded.direction,graph_version=excluded.graph_version,validation_version=excluded.validation_version`).bind(edge.id,from.id,edge.relation_type,to.id,edge.condition_hash,serial(edge.condition),edge.direction,edge.edge_kind,edge.status,edge.valid_from||null,edge.valid_to||null,at,edge.event_state||null,edge.confidence??null,graphVersion,validationVersion,this.namespace)];
  statements.push(this.db.prepare(`INSERT INTO catalyst_graph_policy(edge_id,freshness_policy_id,lifecycle_status,evidence_at,canonical_condition,raw_condition_text,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(edge_id) DO UPDATE SET freshness_policy_id=excluded.freshness_policy_id,evidence_at=excluded.evidence_at,canonical_condition=excluded.canonical_condition,raw_condition_text=excluded.raw_condition_text,updated_at=excluded.updated_at`).bind(edge.id,edge.freshness_policy_id,'ACTIVE',dates.sort()[0],serial(edge.condition),edge.raw_condition_text,at));
  for(const e of evidence)statements.push(this.db.prepare('INSERT INTO catalyst_graph_evidence VALUES(?,?,?,?) ON CONFLICT(edge_id,claim_id) DO UPDATE SET validation_version=excluded.validation_version,binding_hash=excluded.binding_hash').bind(edge.id,e.id,validationVersion,e.hash));
  statements.push(this.db.prepare('UPDATE catalyst_candidate_edges SET status=?,updated_at=? WHERE id=?').bind(edge.status,at,edge.id));
  await this.db.batch(statements);return {...edge,last_verified_at:at,graph_version:graphVersion,validation_version:validationVersion};
 }
 async invalidate(id,event,claimId,{now=Date.now()}={}){
  const row=await one(this.db,'SELECT * FROM catalyst_graph_policy WHERE edge_id=?',id);
  if(!row||!freshnessPolicy({policy_id:row.freshness_policy_id}).invalidate_events.includes(event))throw Error('invalid_lifecycle_event');
  const edge=await one(this.db,'SELECT * FROM catalyst_graph_edges WHERE id=? AND namespace=?',id,this.namespace);
  const claim=await one(this.db,'SELECT c.payload,l.verification_status FROM catalyst_claims c JOIN catalyst_claim_ledger l ON l.claim_id=c.id WHERE c.id=?',claimId);
  if(!edge||!claim||claim.verification_status!=='VERIFIED')throw Error('verified_superseding_evidence_required');
  const c=JSON.parse(claim.payload);
  if(c.asOfKind==='observed'&&!c.effectiveAt)throw Error('lifecycle_event_date_required');
  const subject=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=?',edge.source_node_id);
  const target=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=?',edge.target_node_id);
  if(c.status!=='VERIFIED'||Date.parse(c.asOf)<=Date.parse(row.evidence_at)||Date.parse(c.asOf)>now||c.subject!==subject.asset_id&&c.normalizedProposition?.subject!==label(subject.label))throw Error('superseding_subject_or_time_mismatch');
  // The caller must provide an explicit, source-verified lifecycle assertion, not a generic newer fact.
  if(supersedingEvent(c)!==event)throw Error('lifecycle_assertion_required');
  if(event==='RELATIONSHIP_ENDED'&&label(c.quote.match(/relationship with (.+)\.$/i)?.[1])!==label(target.label))throw Error('superseding_target_mismatch');
  await this.db.prepare('UPDATE catalyst_graph_policy SET lifecycle_status=?,superseded_by_claim_id=?,lifecycle_event=?,updated_at=? WHERE edge_id=?').bind('SUPERSEDED',claimId,event,new Date(now).toISOString(),id).run();
 }
 async applyLifecycleClaim(claim,{now=Date.now()}={}){
  const event=supersedingEvent(claim);if(!event||claim.status!=='VERIFIED')return [];
  const edges=await rows(this.db,"SELECT e.id FROM catalyst_graph_edges e JOIN catalyst_graph_nodes n ON n.id=e.source_node_id WHERE n.asset_id=? AND e.namespace=? LIMIT 100",claim.subject,this.namespace),results=[];
  for(const e of edges){try{await this.invalidate(e.id,event,claim.id,{now});results.push({id:e.id,status:'SUPERSEDED'});}catch{results.push({id:e.id,status:'unchanged',reason:'관계·정책·대상·발행 시점 대조 필요'});}}
  return results;
 }
 async setStatus(id,status){
  if(!['REJECTED','CONFLICTED','PENDING'].includes(status))throw Error('explicit_promotion_required');
  await this.db.batch([this.db.prepare('UPDATE catalyst_graph_edges SET status=? WHERE id=? AND namespace=?').bind(status,id,this.namespace),this.db.prepare('UPDATE catalyst_candidate_edges SET status=? WHERE id=?').bind(status,id)]);
 }
 async evidence(edge,from,to,now){
  const list=await rows(this.db,`SELECT c.payload,l.verification_status,l.validation_version,e.binding_hash FROM catalyst_graph_evidence e JOIN catalyst_claims c ON c.id=e.claim_id JOIN catalyst_claim_ledger l ON l.claim_id=e.claim_id WHERE e.edge_id=?`,edge.id),valid=[];
  for(const r of list){const c=JSON.parse(r.payload);if(!usableClaim(c,edge.status,now,edge)||r.verification_status!==c.status||r.validation_version!==validationVersion||!exactAssertion(c,from,to,edge)||await bindingHash(c)!==r.binding_hash)continue;valid.push(c.id);}
  return valid;
 }
 async paths(start,{maxDepth=3,conditions={},eventState=null,at=Date.now(),includePending=false,causalOnly=true,maxResults=100,maxVisited=256,maxAgeDays=null}={}){
  if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>3||!Number.isFinite(at))throw Error('invalid_graph_search');
  maxResults=Math.max(1,Math.min(100,maxResults));maxVisited=Math.max(1,Math.min(256,maxVisited));
  const root=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=? AND namespace=?',start,this.namespace);if(!root)return {paths:[],truncated:false,visited:0};
  const queue=[{nodes:[root],edges:[],ids:[]}],paths=[],cache=new Map();let visited=0,truncated=false;
  while(queue.length&&paths.length<maxResults&&visited<maxVisited){const path=queue.shift(),from=path.nodes.at(-1);visited++;
   let outgoing=cache.get(from.id);
   if(!outgoing){outgoing=await rows(this.db,"SELECT * FROM catalyst_graph_edges WHERE source_node_id=? AND namespace=? AND status IN ('VERIFIED','SUPPORTED') ORDER BY id LIMIT 129",from.id,this.namespace);
    if(includePending){const pending=await rows(this.db,"SELECT * FROM catalyst_candidate_edges WHERE source_node_id=? AND status='PENDING' ORDER BY id LIMIT 129",from.id);outgoing.push(...pending.map(r=>({...JSON.parse(r.payload),status:'PENDING',claim_ids:[]})));}
    if(outgoing.length>128)truncated=true;cache.set(from.id,outgoing=outgoing.slice(0,128));
   }
   for(const row of outgoing){
    const policy=row.status==='PENDING'?null:await one(this.db,'SELECT * FROM catalyst_graph_policy WHERE edge_id=?',row.id);
    const edge={...row,...policy,condition:typeof row.condition==='string'?JSON.parse(row.condition):row.condition||{}};
    if(path.nodes.some(n=>n.id===edge.target_node_id)||causalOnly&&edge.relation_type==='CORRELATED_WITH')continue;
    if(edge.valid_from&&Date.parse(edge.valid_from)>at||edge.valid_to&&Date.parse(edge.valid_to)<=at)continue;
    if(!conditionsMatch(edge.condition,conditions)||edge.event_state&&edge.event_state!==eventState)continue;
    edge.lifecycle_status=lifecycle(edge,at);if(edge.status!=='PENDING'&&edge.lifecycle_status!=='ACTIVE')continue;
    if(edge.status!=='PENDING'&&(edge.graph_version!==graphVersion||edge.validation_version!==validationVersion||!Number.isFinite(Date.parse(edge.last_verified_at))||Date.parse(edge.last_verified_at)>at||maxAgeDays!==null&&at-Date.parse(edge.last_verified_at)>maxAgeDays*86400000))continue;
    const to=await one(this.db,'SELECT * FROM catalyst_graph_nodes WHERE id=? AND namespace=?',edge.target_node_id,this.namespace);if(!to)continue;
    const ids=edge.status==='PENDING'?[]:await this.evidence(edge,from,to,at);if(edge.status!=='PENDING'&&!ids.length)continue;
    const next={nodes:[...path.nodes,to],edges:[...path.edges,edge],ids:[...new Set([...path.ids,...ids])]},status=next.edges.some(e=>e.status==='PENDING')?'PENDING':next.edges.every(e=>e.status==='VERIFIED')?'VERIFIED':'SUPPORTED';
    const verifiedDates=next.edges.map(e=>e.last_verified_at).filter(Boolean).sort();
    paths.push({nodes:next.nodes,edges:next.edges,verification_status:status,evidence_claim_ids:next.ids,path_depth:next.edges.length,freshness:{oldest_verified_at:verifiedDates[0]||null,as_of:new Date(at).toISOString(),max_age_days:maxAgeDays},conditional:next.edges.some(e=>Object.keys(e.condition).length>0||e.event_state),causal:next.edges.every(e=>e.relation_type!=='CORRELATED_WITH'),namespace:this.namespace});
    if(next.edges.length<maxDepth)queue.push(next);if(paths.length>=maxResults){truncated=true;break;}
   }
  }
  return {paths,truncated:truncated||queue.length>0,visited};
 }
}
