export type Intent = 'FORWARD_IMPACT' | 'MOVE_ANALYSIS' | 'RELATED_ASSET_SEARCH' | 'CROSS_ASSET_ANALYSIS';
export type ClaimType = 'event' | 'business' | 'transmission' | 'value_capture' | 'customer' | 'revenue_share' | 'protocol_metric' | 'tokenomics' | 'attribution';
export type Status = 'VERIFIED' | 'SUPPORTED' | 'INFERRED' | 'UNVERIFIED' | 'CONFLICTED' | 'RUMOR';
export interface ProposedClaim { id:string; type:ClaimType; subject_id:string; predicate:string; value:string; source_id:string; quote:string; }
export interface TypedValue { value:string; sign:-1|0|1; currency:string|null; unit:string; multiplier:number; normalizedValue:string; period:ClaimPeriod; scope:ClaimScope; raw:string; }
export type EventState='PLANNED'|'ANNOUNCED'|'APPROVED'|'ORDERED'|'UNDER_CONSTRUCTION'|'INSTALLED'|'RAMPING'|'IN_PRODUCTION'|'COMPLETED';
export type ExposureType='PRODUCT_REVENUE'|'SEGMENT_REVENUE'|'QUALITATIVE'|'UNKNOWN';
export interface ClaimPeriod {years:string[]; quarters:string[]; frequency:string|null; accumulation?:'cumulative'|'single_quarter'; halves?:string[]; dates?:string[];}
export interface ClaimScope {consolidation:string|null; execution:string|null; eventState?:EventState;}
export interface TableCell {table_id:string;row_header:string;column_header:string;cell_value:string;unit:string|null;period:ClaimPeriod;scope:ClaimScope;footnote:string;source_location:string;unit_inheritance:string[];subject:string;exposure_type:ExposureType;eligible:boolean;}
export type GraphStatus='PENDING'|'SUPPORTED'|'VERIFIED'|'REJECTED'|'CONFLICTED';
export interface GraphEdge {id:string;source_node_id:string;target_node_id:string;relation_type:string;status:GraphStatus;condition:Record<string,string>;direction:'positive'|'negative'|'unclear';valid_from:string|null;valid_to:string|null;last_verified_at:string;event_state:EventState|null;confidence:number|null;graph_version:string;validation_version:string;}
export interface GraphPath {nodes:{id:string;kind:string;label:string}[];edges:GraphEdge[];verification_status:GraphStatus;evidence_claim_ids:string[];path_depth:number;conditional:boolean;freshness:{oldest_verified_at:string|null;as_of:string;max_age_days:number};}
export type ValidationStage = 'SUBJECT_MATCH'|'PREDICATE_MATCH'|'OBJECT_MATCH'|'NUMERIC_MATCH'|'UNIT_MATCH'|'PERIOD_MATCH'|'SCOPE_MATCH'|'SEMANTIC_SUPPORT'|'SOURCE_AUTHORITY';
export interface ValidationCheck {status:'PASS'|'FAIL'|'UNKNOWN';reason:string;}
export interface ClaimEvidence {sourceId:string;quote:string;locator:string|null;independenceKey:string;status:Status;checks:Record<ValidationStage,ValidationCheck>;version:string;}
export interface ClaimLedger {subject:string;predicate:string;object:string;typedValue:TypedValue[];period:ClaimPeriod;scope:ClaimScope;effectiveAt:string|null;status:Status;validationVersion:string;validationChecks:Record<ValidationStage,ValidationCheck>;sourceEvidence:ClaimEvidence[];}
export interface PathEdge { from:string; relation:string; to:string; claim_id:string; }
export interface Candidate { asset_id:string; product:string; relationship:string; direction:'positive'|'negative'|'unclear'; claim_ids:string[]; path:PathEdge[]; reason_ko:string; }
export interface Analysis { intent:Intent; catalyst_type:string; title_ko:string; claims:ProposedClaim[]; candidates:Candidate[]; uncertainties:string[]; search_targets:string[]; conflict:boolean; }
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('object required');return v as Record<string,unknown>;};
const text=(v:unknown,max=1200):string=>{if(typeof v!=='string'||v.length>max)throw Error('invalid string');return v;};
const list=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('invalid array');return v;};
const choice=<T extends string>(v:unknown,allowed:readonly T[]):T=>{const s=text(v,100);if(!allowed.includes(s as T))throw Error('invalid enum');return s as T;};
const claimTypes:readonly ClaimType[]=['event','business','transmission','value_capture','customer','revenue_share','protocol_metric','tokenomics','attribution'];
const intents:readonly Intent[]=['FORWARD_IMPACT','MOVE_ANALYSIS','RELATED_ASSET_SEARCH','CROSS_ASSET_ANALYSIS'];
const relations=['INCREASES','DECREASES','REQUIRES','USED_IN','PRODUCES','SUPPLIES','DEPENDS_ON','RUNS_ON','BENEFITS_FROM','HURT_BY','COMPETES_WITH','CORRELATED_WITH'] as const;
export function parseAnalysis(input:unknown):Analysis {
 const v=object(input);
 const claims=list(v.claims,12).map(item=>{const c=object(item);return {id:text(c.id,80),type:choice(c.type,claimTypes),subject_id:text(c.subject_id,180),predicate:text(c.predicate,180),value:text(c.value,900),source_id:text(c.source_id,80),quote:text(c.quote)};});
 if(new Set(claims.map(c=>c.id)).size!==claims.length)throw Error('duplicate claim identifier');
 const candidates=list(v.candidates,6).map(item=>{const c=object(item);return {asset_id:text(c.asset_id,180),product:text(c.product,160),relationship:choice(c.relationship,['SAME_CATALYST','SECOND_ORDER','SAME_NARRATIVE','SAME_ECOSYSTEM','TOKENOMICS_SIMILAR']),direction:choice(c.direction,['positive','negative','unclear'] as const),claim_ids:list(c.claim_ids,12).map(x=>text(x,80)),path:list(c.path,3).map(item=>{const p=object(item);return {from:text(p.from,180),relation:choice(p.relation,relations),to:text(p.to,180),claim_id:text(p.claim_id,80)};}),reason_ko:text(c.reason_ko,500)};});
 if(typeof v.conflict!=='boolean')throw Error('invalid conflict flag');
 return {intent:choice(v.intent,intents),catalyst_type:choice(v.catalyst_type,['FUNDAMENTAL','TOKENOMICS','REGULATION','LISTING','PARTNERSHIP','ECOSYSTEM','TECHNOLOGY','MACRO','FLOW','DERIVATIVES','NARRATIVE','TECHNICAL','COMPANY_SPECIFIC','UNKNOWN']),title_ko:text(v.title_ko,200),claims,candidates,uncertainties:list(v.uncertainties,12).map(x=>text(x,400)),search_targets:list(v.search_targets,6).map(x=>text(x,180)),conflict:v.conflict};
}

export type LifecycleStatus='ACTIVE'|'STALE'|'SUPERSEDED'|'EXPIRED';
export interface CanonicalCondition {eventType:string;subjectType:string;subjectId:string;stage:string;scope:string;}
export interface RelationFreshnessPolicy {policy_id:string;relation_type:string[];claim_type:string[];max_age:number;event_driven:boolean;invalidate_events:string[];description:string;}
export type ProductRelationship='PRIMARY_PRODUCT'|'MAJOR_PRODUCT'|'SECONDARY_PRODUCT'|'DEVELOPMENT'|'PLANNED'|'UNKNOWN';
export type CustomerRelationship='CONFIRMED_CUSTOMER'|'TARGET_CUSTOMER'|'COOPERATION'|'SUPPLY_CHAIN_ENTRY'|'UNKNOWN';
export interface CompanyProduct {company_id:string;product_id:string;relationship:ProductRelationship;exposure_basis:ExposureType;revenue_value:string|null;revenue_ratio:string|null;period:ClaimPeriod;verification_status:Status;claim_ids:string[];last_verified_at:string;}
export type CryptoEntityKind='BLOCKCHAIN'|'PROTOCOL'|'TOKEN'|'DEPLOYMENT'|'EXCHANGE_PAIR';
export type TokenValueCapture='FEE_SHARE'|'BUYBACK'|'BURN'|'STAKING'|'COLLATERAL'|'REQUIRED_USE'|'GOVERNANCE_ONLY'|'NONE'|'UNKNOWN';
export interface ProtocolMetadata {protocol_id:string;name:string;category:string|null;official_domain:string|null;chains:string[];status:string;last_verified_at:string;}
export interface TokenProtocolRelationship {token_id:string;protocol_id:string;utility:string|null;governance:boolean|null;staking:boolean|null;fee_capture:boolean|null;buyback:boolean|null;burn:boolean|null;collateral_use:boolean|null;required_demand:boolean|null;verification_status:Status;}
export type MetricQuality='VERIFIED'|'PARTIAL'|'UNAVAILABLE';
export interface MarketWindow {asset:string;window:string;return:number|null;benchmarkReturn:number|null;excessReturn:number|null;volumeChange:number|null;relativeVolume:number|null;abnormalReturn:number|null;dataQuality:Record<string,MetricQuality>;asOf:string|null;}
export type ResearchMarket='ALL'|'KR'|'US'|'CRYPTO';
export type ResearchMode='normal'|'newIndustry'|'deep';
export type ResearchStage='queued'|'planner'|'event'|'technical'|'discovery'|'prefilter'|'deep'|'complete'|'limited'|'failed';
export interface ResearchSearchRequest {query:string;language:'ko'|'en';recency:'day'|'week'|'month'|'year'|null;domainHints:string[];maxResults:number;}
export interface ResearchPlan {intent:string;questionMode:'ACTUAL'|'CONDITIONAL';eventHypotheses:string[];entities:string[];industries:string[];subIndustries:string[];eventTypes:string[];researchQuestions:string[];processTargets:string[];productTargets:string[];equipmentTargets:string[];materialTargets:string[];protocolTargets:string[];narrativeTargets:string[];candidateDiscoveryQueries:string[];officialSourceQueries:string[];eventQueries:string[];technicalQueries:string[];freshnessRequired:boolean;marketTargets:Exclude<ResearchMarket,'ALL'>[];unknowns:string[];discoveredSuggestions:{name:string;market:Exclude<ResearchMarket,'ALL'>;productHypothesis:string}[];}
