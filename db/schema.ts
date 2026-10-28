import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const searchEvents=sqliteTable('search_events',{
 id:text('id').primaryKey(),stockId:text('stock_id').notNull(),name:text('name').notNull(),ticker:text('ticker').notNull(),market:text('market').notNull(),sessionHash:text('session_hash').notNull(),minuteBucket:integer('minute_bucket').notNull(),createdAt:integer('created_at').notNull()
},t=>[index('idx_search_events_created_market').on(t.createdAt,t.market),uniqueIndex('idx_search_events_session_stock_minute').on(t.sessionHash,t.stockId,t.market,t.minuteBucket)]);
export const calendarEvents=sqliteTable('calendar_events',{
 id:text('id').primaryKey(),title:text('title').notNull(),country:text('country').notNull(),importance:text('importance').notNull(),featured:integer('featured').notNull().default(0),startsAt:integer('starts_at'),dateKst:text('date_kst').notNull(),version:integer('version').notNull().default(1),updatedAt:integer('updated_at').notNull()
},t=>[index('idx_calendar_events_date_time').on(t.dateKst,t.startsAt)]);

export const calendarPreferences=sqliteTable('calendar_preferences',{
 id:text('id').primaryKey(),featured:integer('featured').notNull().default(0),updatedAt:integer('updated_at').notNull()
});
export const finvizMemberships=sqliteTable('finviz_memberships',{
 indexId:text('index_id').primaryKey(),version:text('version').notNull(),members:text('members').notNull(),changes:text('changes').notNull(),observedAt:text('observed_at').notNull()
});

export const sectorDailyHistory=sqliteTable('sector_daily_history',{
 id:text('id').primaryKey(),market:text('market').notNull(),indexId:text('index_id').notNull(),day:text('day').notNull(),snapshot:text('snapshot').notNull(),observedAt:text('observed_at').notNull()
},t=>[uniqueIndex('idx_sector_daily_market_index_day').on(t.market,t.indexId,t.day)]);

export const sectorReconstructedHistory=sqliteTable('sector_reconstructed_history',{
 id:text('id').primaryKey(),market:text('market').notNull(),indexId:text('index_id').notNull(),day:text('day').notNull(),snapshot:text('snapshot').notNull(),calculatedAt:text('calculated_at').notNull()
},t=>[uniqueIndex('idx_sector_reconstructed_market_index_day').on(t.market,t.indexId,t.day)]);

export const telegramChannels=sqliteTable('telegram_channels',{
 username:text('username').primaryKey(),title:text('title').notNull(),kind:text('kind').notNull(),channelId:text('channel_id'),status:text('status').notNull(),lastError:text('last_error'),heartbeatAt:text('heartbeat_at'),lastSyncAt:text('last_sync_at'),cursor:integer('cursor').notNull().default(0)
});
export const telegramReports=sqliteTable('telegram_reports',{
 id:text('id').primaryKey(),channelId:text('channel_id').notNull(),messageId:integer('message_id').notNull(),channelUsername:text('channel_username').notNull(),kind:text('kind').notNull(),postedAt:text('posted_at').notNull(),editedAt:text('edited_at'),revisionAt:text('revision_at').notNull(),rawText:text('raw_text').notNull(),filename:text('filename'),payload:text('payload').notNull(),market:text('market'),ticker:text('ticker'),title:text('title'),sourceUrl:text('source_url').notNull(),updatedAt:text('updated_at').notNull(),deleted:integer('deleted').notNull().default(0)
},t=>[uniqueIndex('idx_telegram_message').on(t.channelId,t.messageId),index('idx_telegram_reports_stock').on(t.market,t.ticker,t.postedAt),index('idx_telegram_reports_kind').on(t.kind,t.postedAt)]);
export const telegramReportCategories=sqliteTable('telegram_report_categories',{
 reportId:text('report_id').primaryKey(),kind:text('kind').notNull(),updatedAt:text('updated_at').notNull()
});

export const researchSecurities=sqliteTable('research_securities',{
 key:text('security_key').primaryKey(),id:text('security_id').notNull(),market:text('market').notNull(),ticker:text('ticker').notNull(),issuerId:text('issuer_id'),isin:text('isin'),cusip:text('cusip'),evidence:text('evidence').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('idx_research_security_id').on(t.id)]);
export const researchEvents=sqliteTable('research_events',{
 id:text('id').primaryKey(),key:text('security_key').notNull(),securityId:text('security_id').notNull(),kind:text('kind').notNull(),eventDate:text('event_date').notNull(),publishedAt:text('published_at'),publishedDate:text('published_date'),dataDate:text('data_date'),collectedAt:text('collected_at'),firstSeenAt:text('first_seen_at').notNull(),lastSeenAt:text('last_seen_at').notNull(),hash:text('content_hash').notNull(),revision:integer('revision').notNull().default(1),payload:text('payload').notNull(),mergedInto:text('merged_into')
},t=>[index('idx_research_events_security_date').on(t.key,t.eventDate)]);
export const researchEventSources=sqliteTable('research_event_sources',{
 sourceKey:text('source_key').primaryKey(),eventId:text('event_id').notNull()
});
export const researchEventVersions=sqliteTable('research_event_versions',{
 id:text('id').primaryKey(),eventId:text('event_id').notNull(),revision:integer('revision').notNull(),recordedAt:text('recorded_at').notNull(),payload:text('payload').notNull()
},t=>[uniqueIndex('idx_research_event_version').on(t.eventId,t.revision)]);
export const researchReads=sqliteTable('research_reads',{
 id:text('id').primaryKey(),readerHash:text('reader_hash').notNull(),eventId:text('event_id').notNull(),revision:integer('revision').notNull(),readAt:text('read_at').notNull()
},t=>[uniqueIndex('idx_research_reader_event').on(t.readerHash,t.eventId)]);
export const researchSourceVersions=sqliteTable('research_source_versions',{
 id:integer('id').primaryKey({autoIncrement:true}),source:text('source').notNull(),sourceId:text('source_id').notNull(),publishedAt:text('published_at'),dataDate:text('data_date'),collectedAt:text('collected_at'),recordedAt:text('recorded_at').notNull(),payload:text('payload').notNull()
},t=>[index('idx_research_source_versions').on(t.source,t.sourceId)]);

export const fscStockHistory=sqliteTable('fsc_stock_history',{
 id:text('id').primaryKey(),operation:text('operation').notNull(),stockId:text('stock_id').notNull(),isin:text('isin').notNull(),
 payload:text('payload').notNull().default('[]'),coveredThrough:text('covered_through').notNull().default(''),
 sourceCount:integer('source_count').notNull().default(0),receivedAt:text('received_at'),nextAttempt:integer('next_attempt').notNull().default(0),
 leaseUntil:integer('lease_until').notNull().default(0),errorCode:text('error_code')
});

export const fscIndexHistory=sqliteTable('fsc_index_history',{
 id:text('id').primaryKey(),payload:text('payload').notNull().default('[]'),coveredThrough:text('covered_through').notNull().default(''),
 receivedAt:text('received_at'),nextAttempt:integer('next_attempt').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),errorCode:text('error_code')
});
export const krxIndexSnapshots=sqliteTable('krx_index_snapshots',{
 baseDate:text('base_date').primaryKey(),payload:text('payload').notNull().default('{}'),receivedAt:text('received_at'),nextAttempt:integer('next_attempt').notNull().default(0),errorCode:text('error_code')
});

export * from "./catalyst";
