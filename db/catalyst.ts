// SQL migration 0040 is authoritative; declarations support schema inspection.
import {sqliteTable,text,integer,real,index,uniqueIndex,primaryKey} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const catalystAssets=sqliteTable('catalyst_assets',{
 id:text('id').primaryKey(),
 kind:text('kind').notNull(),
 symbol:text('symbol').notNull(),
 name:text('name').notNull(),
 exchange:text('exchange'),
 issuerId:text('issuer_id'),
 chain:text('chain'),
 contractAddress:text('contract_address'),
 protocolId:text('protocol_id'),
 identityStatus:text('identity_status').notNull(),
 payload:text('payload').notNull(),
 updatedAt:text('updated_at').notNull()
},t=>[index('catalyst_assets_symbol').on(t.symbol,t.kind)]);
export const catalystIdentifiers=sqliteTable('catalyst_identifiers',{
 namespace:text('namespace').notNull(),
 value:text('value').notNull(),
 assetId:text('asset_id').notNull(),
 validFrom:text('valid_from').notNull().default(""),
 validTo:text('valid_to'),
 sourceUrl:text('source_url')
},t=>[primaryKey({columns:[t.namespace,t.value,t.assetId,t.validFrom]}),index('catalyst_identifier_asset').on(t.assetId)]);
export const catalystSources=sqliteTable('catalyst_sources',{
 id:text('id').primaryKey(),
 assetId:text('asset_id'),
 sourceType:text('source_type').notNull(),
 publisher:text('publisher').notNull(),
 title:text('title').notNull(),
 url:text('url').notNull(),
 publishedAt:text('published_at'),
 effectiveAt:text('effective_at'),
 observedAt:text('observed_at').notNull(),
 fiscalPeriod:text('fiscal_period'),
 contentHash:text('content_hash').notNull(),
 independenceKey:text('independence_key').notNull(),
 body:text('body').notNull(),
 locator:text('locator'),
 originRef:text('origin_ref'),
 payload:text('payload').notNull()
},t=>[index('catalyst_source_hash').on(t.contentHash),index('catalyst_source_asset_date').on(t.assetId,t.publishedAt)]);
export const catalystClaims=sqliteTable('catalyst_claims',{
 id:text('id').primaryKey(),
 runId:text('run_id'),
 claimType:text('claim_type').notNull(),
 subjectId:text('subject_id').notNull(),
 predicate:text('predicate').notNull(),
 objectValue:text('object_value').notNull(),
 status:text('status').notNull(),
 confidence:text('confidence').notNull(),
 asOf:text('as_of'),
 sourceIds:text('source_ids').notNull(),
 quote:text('quote').notNull(),
 payload:text('payload').notNull(),
 version:text('version').notNull(),
 checkedAt:text('checked_at').notNull()
},t=>[index('catalyst_claim_subject').on(t.subjectId,t.claimType,t.status)]);
export const catalystNodes=sqliteTable('catalyst_nodes',{
 id:text('id').primaryKey(),
 kind:text('kind').notNull(),
 label:text('label').notNull(),
 assetId:text('asset_id'),
 payload:text('payload').notNull()
});
export const catalystEdges=sqliteTable('catalyst_edges',{
 id:text('id').primaryKey(),
 fromId:text('from_id').notNull(),
 toId:text('to_id').notNull(),
 relation:text('relation').notNull(),
 status:text('status').notNull(),
 claimIds:text('claim_ids').notNull(),
 validFrom:text('valid_from'),
 validTo:text('valid_to'),
 version:text('version').notNull(),
 payload:text('payload').notNull()
},t=>[index('catalyst_edges_from').on(t.fromId,t.relation,t.status)]);
export const catalystFacts=sqliteTable('catalyst_facts',{
 assetId:text('asset_id').notNull(),
 category:text('category').notNull(),
 payload:text('payload').notNull(),
 sourceIds:text('source_ids').notNull(),
 verifiedAt:text('verified_at').notNull(),
 expiresAt:integer('expires_at').notNull()
},t=>[primaryKey({columns:[t.assetId,t.category]})]);
export const catalystRuns=sqliteTable('catalyst_runs',{
 id:text('id').primaryKey(),
 readerHash:text('reader_hash').notNull(),
 query:text('query').notNull(),
 assetId:text('asset_id'),
 intent:text('intent').notNull(),
 state:text('state').notNull(),
 stage:text('stage').notNull(),
 payload:text('payload').notNull(),
 cacheKey:text('cache_key').notNull(),
 createdAt:text('created_at').notNull(),
 updatedAt:text('updated_at').notNull(),
 leaseUntil:integer('lease_until').notNull().default(0)
},t=>[uniqueIndex('catalyst_runs_active').on(t.readerHash,t.cacheKey).where(sql`state IN ('queued','running')`),index('catalyst_runs_reader').on(t.readerHash,t.createdAt)]);
export const catalystCache=sqliteTable('catalyst_cache',{
 cacheKey:text('cache_key').primaryKey(),
 payload:text('payload').notNull(),
 createdAt:text('created_at').notNull(),
 expiresAt:integer('expires_at').notNull()
});
export const catalystReservations=sqliteTable('catalyst_reservations',{
 id:text('id').primaryKey(),
 runId:text('run_id').notNull(),
 day:text('day').notNull(),
 amount:integer('amount').notNull(),
 state:text('state').notNull(),
 createdAt:integer('created_at').notNull(),
 completedAt:integer('completed_at')
},t=>[index('catalyst_reservations_day').on(t.day,t.createdAt)]);
export const catalystUsage=sqliteTable('catalyst_usage',{
 id:text('id').primaryKey(),
 runId:text('run_id').notNull(),
 model:text('model').notNull(),
 inputTokens:integer('input_tokens').notNull(),
 cachedInputTokens:integer('cached_input_tokens').notNull(),
 outputTokens:integer('output_tokens').notNull(),
 totalTokens:integer('total_tokens').notNull(),
 reasoningEffort:text('reasoning_effort').notNull(),
 feature:text('feature').notNull(),
 latencyMs:integer('latency_ms').notNull(),
 httpStatus:integer('http_status'),
 result:text('result').notNull(),
 createdAt:text('created_at').notNull()
},t=>[index('catalyst_usage_date').on(t.createdAt)]);
export const catalystRuntime=sqliteTable('catalyst_runtime',{
 key:text('key').primaryKey(),
 value:text('value').notNull(),
 updatedAt:text('updated_at').notNull()
});
export const catalystBusinessIndex=sqliteTable('catalyst_business_index',{
 assetId:text('asset_id').notNull(),
 term:text('term').notNull(),
 sourceId:text('source_id').notNull()
},t=>[primaryKey({columns:[t.assetId,t.term,t.sourceId]}),index('catalyst_business_term').on(t.term,t.assetId)]);
export const catalystAssetIdentity=sqliteTable('catalyst_asset_identity',{
 assetId:text('asset_id').primaryKey(),canonicalKey:text('canonical_key'),market:text('market'),symbol:text('symbol').notNull(),
 exchange:text('exchange'),issuerId:text('issuer_id'),chain:text('chain'),contractAddress:text('contract_address'),
 completeness:text('completeness').notNull(),sourceUrl:text('source_url'),version:text('version').notNull(),updatedAt:text('updated_at').notNull()
},t=>[index('catalyst_identity_key').on(t.canonicalKey)]);
export const catalystAliases=sqliteTable('catalyst_aliases',{
 alias:text('alias').notNull(),assetId:text('asset_id').notNull(),aliasType:text('alias_type').notNull(),sourceUrl:text('source_url'),version:text('version').notNull()
},t=>[primaryKey({columns:[t.alias,t.assetId,t.aliasType]})]);
export const catalystClaimLedger=sqliteTable('catalyst_claim_ledger',{
 claimId:text('claim_id').primaryKey(),subject:text('subject').notNull(),predicate:text('predicate').notNull(),object:text('object').notNull(),
 typedValue:text('typed_value').notNull(),period:text('period').notNull(),scope:text('scope').notNull(),effectiveAt:text('effective_at'),
 verificationStatus:text('verification_status').notNull(),validationVersion:text('validation_version').notNull(),validationChecks:text('validation_checks').notNull(),
 independentSourceCount:integer('independent_source_count').notNull().default(0),checkedAt:text('checked_at').notNull()
});
export const catalystClaimSources=sqliteTable('catalyst_claim_sources',{
 claimId:text('claim_id').notNull(),sourceId:text('source_id').notNull(),quote:text('quote').notNull(),locator:text('locator'),independenceKey:text('independence_key').notNull(),
 verificationStatus:text('verification_status').notNull(),validationVersion:text('validation_version').notNull(),validationChecks:text('validation_checks').notNull()
},t=>[primaryKey({columns:[t.claimId,t.sourceId]}),index('catalyst_claim_source_lookup').on(t.sourceId,t.claimId)]);
export const catalystSourceLineage=sqliteTable('catalyst_source_lineage',{
 sourceId:text('source_id').primaryKey(),independenceKey:text('independence_key').notNull(),originalUrl:text('original_url'),contentHash:text('content_hash').notNull(),version:text('version').notNull()
});
export const catalystTableCells=sqliteTable('catalyst_table_cells',{
 sourceId:text('source_id').notNull().references(()=>catalystSources.id),sourceLocation:text('source_location').notNull(),tableId:text('table_id').notNull(),
 rowHeader:text('row_header').notNull(),columnHeader:text('column_header').notNull(),cellValue:text('cell_value').notNull(),unit:text('unit'),
 period:text('period').notNull(),scope:text('scope').notNull(),footnote:text('footnote').notNull(),unitInheritance:text('unit_inheritance').notNull(),payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.sourceId,t.sourceLocation]})]);
export const catalystClaimContext=sqliteTable('catalyst_claim_context',{
 claimId:text('claim_id').primaryKey().references(()=>catalystClaims.id),eventState:text('event_state'),exposureType:text('exposure_type').notNull(),
 normalizedProposition:text('normalized_proposition'),tableEvidence:text('table_evidence'),version:text('version').notNull()
});
export const catalystGraphNodes=sqliteTable('catalyst_graph_nodes',{
 id:text('id').primaryKey(),kind:text('kind').notNull(),label:text('label').notNull(),assetId:text('asset_id').references(()=>catalystAssets.id),namespace:text('namespace').notNull(),graphVersion:text('graph_version').notNull(),payload:text('payload').notNull()
},t=>[index('catalyst_graph_node_lookup').on(t.namespace,t.kind,t.label)]);
export const catalystCandidateEdges=sqliteTable('catalyst_candidate_edges',{
 id:text('id').primaryKey(),sourceNodeId:text('source_node_id').notNull().references(()=>catalystGraphNodes.id),relationType:text('relation_type').notNull(),targetNodeId:text('target_node_id').notNull().references(()=>catalystGraphNodes.id),conditionHash:text('condition_hash').notNull(),
 status:text('status').notNull(),graphVersion:text('graph_version').notNull(),validationVersion:text('validation_version').notNull(),updatedAt:text('updated_at').notNull(),payload:text('payload').notNull()
},t=>[uniqueIndex('catalyst_candidate_canonical').on(t.sourceNodeId,t.relationType,t.targetNodeId,t.conditionHash)]);
export const catalystGraphEdges=sqliteTable('catalyst_graph_edges',{
 id:text('id').primaryKey(),sourceNodeId:text('source_node_id').notNull().references(()=>catalystGraphNodes.id),relationType:text('relation_type').notNull(),targetNodeId:text('target_node_id').notNull().references(()=>catalystGraphNodes.id),conditionHash:text('condition_hash').notNull(),condition:text('condition').notNull(),direction:text('direction').notNull(),edgeKind:text('edge_kind').notNull(),status:text('status').notNull(),
 validFrom:text('valid_from'),validTo:text('valid_to'),lastVerifiedAt:text('last_verified_at').notNull(),eventState:text('event_state'),confidence:real('confidence'),graphVersion:text('graph_version').notNull(),validationVersion:text('validation_version').notNull(),namespace:text('namespace').notNull()
},t=>[uniqueIndex('catalyst_graph_canonical').on(t.sourceNodeId,t.relationType,t.targetNodeId,t.conditionHash),index('catalyst_graph_outgoing').on(t.sourceNodeId,t.status,t.validTo)]);
export const catalystGraphEvidence=sqliteTable('catalyst_graph_evidence',{
 edgeId:text('edge_id').notNull().references(()=>catalystGraphEdges.id),claimId:text('claim_id').notNull().references(()=>catalystClaimLedger.claimId),validationVersion:text('validation_version').notNull(),bindingHash:text('binding_hash').notNull()
},t=>[primaryKey({columns:[t.edgeId,t.claimId]})]);

// Phase 3.1–6 on-demand metadata. Category views are defined in migration 0046.
export const catalystGraphPolicy=sqliteTable('catalyst_graph_policy',{
 edgeId:text('edge_id').primaryKey(),
 freshnessPolicyId:text('freshness_policy_id').notNull(),
 lifecycleStatus:text('lifecycle_status').notNull(),
 evidenceAt:text('evidence_at').notNull(),
 canonicalCondition:text('canonical_condition').notNull(),
 rawConditionText:text('raw_condition_text'),
 supersededByClaimId:text('superseded_by_claim_id'),
 lifecycleEvent:text('lifecycle_event'),
 updatedAt:text('updated_at').notNull()
});
export const catalystMetadataRequests=sqliteTable('catalyst_metadata_requests',{
 assetId:text('asset_id').primaryKey(),
 kind:text('kind').notNull(),
 status:text('status').notNull(),
 sourceRevision:text('source_revision'),
 requestedAt:text('requested_at').notNull(),
 completedAt:text('completed_at'),
 errorCode:text('error_code'),
 payload:text('payload').notNull()
});
export const companyMetadataFacts=sqliteTable('company_metadata_facts',{
 id:text('id').primaryKey(),
 companyId:text('company_id').notNull(),
 category:text('category').notNull(),
 factKey:text('fact_key').notNull(),
 relationship:text('relationship').notNull(),
 exposureBasis:text('exposure_basis').notNull(),
 revenueValue:text('revenue_value'),
 revenueRatio:text('revenue_ratio'),
 period:text('period'),
 verificationStatus:text('verification_status').notNull(),
 claimIds:text('claim_ids').notNull(),
 lastVerifiedAt:text('last_verified_at').notNull(),
 sourceId:text('source_id').notNull(),
 sourceDate:text('source_date'),
 lifecycleStatus:text('lifecycle_status').notNull(),
 payload:text('payload').notNull()
});
export const catalystBlockchains=sqliteTable('catalyst_blockchains',{
 chainId:text('chain_id').primaryKey(),
 name:text('name').notNull(),
 sourceUrl:text('source_url'),
 lastVerifiedAt:text('last_verified_at').notNull()
});
export const catalystProtocols=sqliteTable('catalyst_protocols',{
 protocolId:text('protocol_id').primaryKey(),
 name:text('name').notNull(),
 category:text('category'),
 officialDomain:text('official_domain'),
 chains:text('chains').notNull(),
 status:text('status').notNull(),
 lastVerifiedAt:text('last_verified_at').notNull(),
 payload:text('payload').notNull()
});
export const catalystTokens=sqliteTable('catalyst_tokens',{
 tokenId:text('token_id').primaryKey(),
 assetId:text('asset_id').notNull(),
 symbol:text('symbol').notNull(),
 name:text('name').notNull(),
 native:integer('native').notNull(),
 providerIds:text('provider_ids').notNull(),
 lastVerifiedAt:text('last_verified_at').notNull()
});
export const catalystDeployments=sqliteTable('catalyst_deployments',{
 deploymentId:text('deployment_id').primaryKey(),
 tokenId:text('token_id').notNull(),
 chainId:text('chain_id').notNull(),
 contractAddress:text('contract_address'),
 standard:text('standard'),
 verificationStatus:text('verification_status').notNull(),
 sourceUrl:text('source_url'),
 lastVerifiedAt:text('last_verified_at').notNull()
});
export const catalystExchangePairs=sqliteTable('catalyst_exchange_pairs',{
 pairId:text('pair_id').primaryKey(),
 tokenId:text('token_id').notNull(),
 exchange:text('exchange').notNull(),
 base:text('base').notNull(),
 quote:text('quote').notNull(),
 marketType:text('market_type').notNull(),
 sourceUrl:text('source_url')
});
export const catalystTokenProtocols=sqliteTable('catalyst_token_protocols',{
 tokenId:text('token_id').notNull(),
 protocolId:text('protocol_id').notNull(),
 verificationStatus:text('verification_status').notNull(),
 claimIds:text('claim_ids').notNull(),
 payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.tokenId,t.protocolId]})]);
export const catalystTokenValueCapture=sqliteTable('catalyst_token_value_capture',{
 tokenId:text('token_id').notNull(),
 captureType:text('capture_type').notNull(),
 verificationStatus:text('verification_status').notNull(),
 claimIds:text('claim_ids').notNull(),
 payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.tokenId,t.captureType]})]);
export const catalystCryptoObservations=sqliteTable('catalyst_crypto_observations',{
 entityId:text('entity_id').notNull(),
 category:text('category').notNull(),
 asOf:text('as_of').notNull(),
 sourceUrl:text('source_url').notNull(),
 payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.entityId,t.category]})]);
export const companyMetadataClaims=sqliteTable('company_metadata_claims',{
 factId:text('fact_id').notNull(),
 claimId:text('claim_id').notNull()
},t=>[primaryKey({columns:[t.factId,t.claimId]})]);

// Phase 7–10 research diagnostics only; no score/ranking storage.
export const catalystResearchJobs=sqliteTable('catalyst_research_jobs',{
 id:text('id').primaryKey(),researchKey:text('research_key').notNull(),query:text('query').notNull(),
 marketFilter:text('market_filter').notNull(),mode:text('mode').notNull(),status:text('status').notNull(),stage:text('stage').notNull(),
 plan:text('plan'),result:text('result'),errorCode:text('error_code'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
 leaseUntil:integer('lease_until').notNull().default(0),attempts:integer('attempts').notNull().default(0),version:text('version').notNull()
},t=>[uniqueIndex('catalyst_research_active').on(t.researchKey).where(sql`status IN ('queued','running')`),index('catalyst_research_lookup').on(t.researchKey,t.createdAt)]);
export const catalystResearchSteps=sqliteTable('catalyst_research_steps',{
 id:integer('id').primaryKey({autoIncrement:true}),jobId:text('job_id').notNull().references(()=>catalystResearchJobs.id),stage:text('stage').notNull(),action:text('action').notNull(),provider:text('provider'),
 input:text('input').notNull(),output:text('output').notNull(),durationMs:integer('duration_ms').notNull(),toolCostUSD:real('tool_cost_usd'),createdAt:text('created_at').notNull()
},t=>[index('catalyst_research_step_job').on(t.jobId,t.id)]);
export const catalystResearchCandidates=sqliteTable('catalyst_research_candidates',{
 jobId:text('job_id').notNull().references(()=>catalystResearchJobs.id),assetId:text('asset_id').notNull().references(()=>catalystAssets.id),status:text('status').notNull(),origins:text('origins').notNull(),payload:text('payload').notNull(),updatedAt:text('updated_at').notNull()
},t=>[primaryKey({columns:[t.jobId,t.assetId]})]);
export const catalystResearchEvidence=sqliteTable('catalyst_research_evidence',{
 jobId:text('job_id').notNull().references(()=>catalystResearchJobs.id),sourceId:text('source_id').notNull().references(()=>catalystSources.id),stage:text('stage').notNull(),assetId:text('asset_id').notNull().default(''),payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.jobId,t.sourceId,t.stage,t.assetId]})]);
export const catalystResearchClaims=sqliteTable('catalyst_research_claims',{
 jobId:text('job_id').notNull().references(()=>catalystResearchJobs.id),claimId:text('claim_id').notNull().references(()=>catalystClaimLedger.claimId),stage:text('stage').notNull(),assetId:text('asset_id').notNull().default(''),payload:text('payload').notNull()
},t=>[primaryKey({columns:[t.jobId,t.claimId,t.stage]})]);
export const catalystResearchSearchUsage=sqliteTable('catalyst_research_search_usage',{
 id:text('id').primaryKey(),jobId:text('job_id').notNull().references(()=>catalystResearchJobs.id),provider:text('provider').notNull(),query:text('query').notNull(),resultCount:integer('result_count').notNull(),toolCalls:integer('tool_calls').notNull(),estimatedToolCostUSD:real('estimated_tool_cost_usd'),costStatus:text('cost_status').notNull(),latencyMs:integer('latency_ms').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull()
});
