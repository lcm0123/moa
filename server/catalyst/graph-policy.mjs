import {config,norm} from './core.mjs';

export const lifecycles=['ACTIVE','STALE','SUPERSEDED','EXPIRED'];
// Durations are milliseconds. Evidence dates, never refresh/lookup dates, start TTL.
export function freshnessPolicy({relation_type,claim_type,category,policy_id,edge_kind}={}){
 const policies=config.relationFreshnessPolicies;
 if(policy_id){const p=policies.find(p=>p.policy_id===policy_id);if(!p)throw Error('unknown_freshness_policy');return p;}
 const id=category||(['CUSTOMER_OF','SUPPLIER_OF','SUPPLIES_TO'].includes(relation_type)?'CUSTOMER_SUPPLIER':
 claim_type==='customer'?'CUSTOMER_SUPPLIER':claim_type==='tokenomics'?'CRYPTO_TOKENOMICS':claim_type==='protocol_metric'?'CRYPTO_PROTOCOL_METRIC':
 claim_type==='value_capture'||relation_type==='GOVERNANCE_OF'?'CRYPTO_TOKENOMICS':
 edge_kind==='COMPANY'||['business','revenue_share'].includes(claim_type)?'COMPANY_BUSINESS':
 relation_type==='USED_IN'?'PRODUCT_USED_IN_PROCESS':['REQUIRES','DEPENDS_ON','PART_OF'].includes(relation_type)?'TECHNICAL_PROCESS':'EVENT_FACT');
 return policies.find(p=>p.policy_id===id)||policies.find(p=>p.policy_id==='MARKET_MOVE');
}
export function lifecycle(edge,at=Date.now()){
 if(['SUPERSEDED','EXPIRED'].includes(edge.lifecycle_status))return edge.lifecycle_status;
 if(edge.valid_to&&Date.parse(edge.valid_to)<=at)return 'EXPIRED';
 const p=freshnessPolicy({policy_id:edge.freshness_policy_id,relation_type:edge.relation_type,edge_kind:edge.edge_kind});
 const date=Date.parse(edge.evidence_at||edge.last_verified_at);
 return !Number.isFinite(date)||date>at||at-date>p.max_age?'STALE':'ACTIVE';
}
const fields=['eventType','subjectType','subjectId','stage','scope'];
const aliases={
 eventType:{'증설':'CAPACITY_EXPANSION','capacity expansion':'CAPACITY_EXPANSION','expansion':'CAPACITY_EXPANSION'},
 subjectType:{industry:'INDUSTRY',산업:'INDUSTRY',company:'COMPANY',기업:'COMPANY'},
 subjectId:{'fc-bga':'FC_BGA','fc bga':'FC_BGA','fc_bga':'FC_BGA'},
 stage:{'설비투자':'CAPEX',capex:'CAPEX',생산:'PRODUCTION',production:'PRODUCTION'},
 scope:{'신규 라인':'NEW_LINE','new line':'NEW_LINE','new_line':'NEW_LINE'}
};
export function canonicalCondition(input={}){
 if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length>10)throw Error('invalid_condition');
 if(!Object.keys(input).length)return {};
 // Backward-compatible parser of one explicit legacy phrase. No free-text key matching.
 if(input.scenario){const text=norm(input.scenario).toLowerCase();
  if(/^(?:fc-bga 신규 라인 증설|fc-bga new line capacity expansion)$/.test(text))return {eventType:'CAPACITY_EXPANSION',subjectType:'INDUSTRY',subjectId:'FC_BGA',stage:'CAPEX',scope:'NEW_LINE'};
  if(/^(?:new production line expansion|신규 생산 라인 증설)$/.test(text))return {eventType:'CAPACITY_EXPANSION',subjectType:'PROCESS',subjectId:'PRODUCTION_LINE',stage:'CAPEX',scope:'NEW_LINE'};
  return Object.fromEntries(fields.map(k=>[k,'UNKNOWN']));
 }
 if(Object.keys(input).some(k=>!fields.includes(k)))throw Error('invalid_condition_field');
 return Object.fromEntries(fields.map(k=>{const v=norm(input[k]||'UNKNOWN');if(v.length>180)throw Error('invalid_condition');return [k,aliases[k]?.[v.toLowerCase()]||v.toUpperCase()];}));
}
export function conditionsMatch(required,actual){
 const a=canonicalCondition(required),b=canonicalCondition(actual);
 return !Object.keys(a).length||fields.every(k=>a[k]&&a[k]!=='UNKNOWN'&&b[k]!== 'UNKNOWN'&&a[k]===b[k]);
}
export function supersedingEvent(claim){
 const text=norm(claim?.quote);
 if(/^[^.]+ (?:ended|terminated) (?:its |the )?(?:customer|supplier|supply) relationship with [^.]+\.$/i.test(text))return 'RELATIONSHIP_ENDED';
 if(/^[^.]+ executed governance proposal [^.]+\.$/i.test(text))return 'GOVERNANCE_EXECUTED';
 if(/^[^.]+ (?:repealed|amended) regulation [^.]+\.$/i.test(text))return /repealed/i.test(text)?'REPEALED':'AMENDED';
 return null;
}
