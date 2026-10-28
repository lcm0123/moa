import {eventHash} from './research-events.mjs';
import {verifiedReportKey,reportIssuerMatches} from './security-identity.mjs';
import {reportIdentity,reportPublication} from './report-dedup.mjs';
import {reportTargetInfo} from './report-target.mjs';
import {filingGroup,dartTypes,dartUrl,rows,dartDay} from './dart-filings.mjs';
import {requireFinviz} from './providers/finviz-client.mjs';
import {validDay,wallTimeToInstant} from '../dist/js/calendar-model.js';
import {acquireNotificationLease,releaseNotificationLease,notificationLeaseFence} from './notification-lease.mjs';

const instant=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function sourceAllowed(env,source){
 if(source==='earnings')return false;
 if(source==='report')return env.LOCAL_PREVIEW===true||env.TELEGRAM_REPORTS_PUBLIC_DISPLAY==='true';
 if(source==='sec'&&(env.SEC_FILINGS_PROVIDER||'finviz')==='finviz'){try{requireFinviz(env);return true;}catch{return false;}}
 return true;
}
export function publicationStart(e){
 if(instant(e.publishedAt))return Date.parse(e.publishedAt);
 // A date-only source has an uncertain time. Use the earliest possible time
 // for the push-age limit, never pretend collection time is publication time.
 // This lower bound is only an age-limit calculation, never publishedAt.
 if(validDay(e.publishedDate))try{return Date.parse(wallTimeToInstant(e.publishedDate,'00:00',e.timeZone||'Asia/Seoul'));}catch{}
 return NaN;
}
export function eligiblePublication(e,watch){
 if(!instant(watch.created_at)||!instant(e.collectedAt)||Date.parse(e.collectedAt)<=Date.parse(watch.created_at))return false;
 if(instant(e.publishedAt))return Date.parse(e.publishedAt)>=Date.parse(watch.created_at);
 try{
  const start=new Intl.DateTimeFormat('en-CA',{timeZone:e.timeZone||'Asia/Seoul'}).format(new Date(watch.created_at));
  return validDay(e.publishedDate)&&e.publishedDate>=start&&(!e.sourcePostedAt||!!instant(e.sourcePostedAt)&&Date.parse(e.sourcePostedAt)>=Date.parse(watch.created_at));
 }catch{return false;}
}
// Preserve the in-site baseline policy. Same-day DATE_ONLY sources cannot
// prove post-registration publication, even when a later repost is exact.
export function eligiblePushPublication(e,watch){
 // Re-enabling this category must not push older backlog. An unrelated or
 // unchanged setting must not suppress a pending notification. Legacy rows
 // use their last known preference boundary, never an inferred source time.
 const activatedAt=(e.kind==='report'?watch.reports_enabled_at:watch.filings_enabled_at)||watch.settings_updated_at;
 if(instant(activatedAt)&&Date.parse(activatedAt)>Date.parse(watch.created_at))watch={...watch,created_at:activatedAt};
 if(!eligiblePublication(e,watch))return false;
 if(instant(e.publishedAt))return true;
 try{return e.publishedDate>new Intl.DateTimeFormat('en-CA',{timeZone:e.timeZone||'Asia/Seoul'}).format(new Date(watch.created_at));}catch{return false;}
}
export function pushFresh(e,now=Date.now(),hours=24){const published=publicationStart(e),collected=Date.parse(e.collectedAt);return Number.isFinite(published)&&published<=now&&now-published<=hours*3600000&&Number.isFinite(collected)&&collected<=now&&now-collected<=hours*3600000;}
export function settingsAllow(settings,e){return e.kind==='report'?settings.reports!==0:settings.filings==='all'||settings.filings==='major'&&e.major;}
export const pushAge=env=>Math.min(48,Math.max(1,Number(env.NOTIFICATION_PUSH_MAX_AGE_HOURS)||24));

export async function sourceEvents(env,source){
 return (await collectSourceEvents(env,source)).map(e=>({...e,publishedAt:instant(e.publishedAt),publishedDate:validDay(e.publishedDate)?e.publishedDate:null,timePrecision:instant(e.publishedAt)?'EXACT':validDay(e.publishedDate)?'DATE_ONLY':'UNKNOWN'}));
}
async function collectSourceEvents(env,source){
 const db=env.DB,collectedAt=instant(source.collected_at);if(!collectedAt)return [];
 if(source.source==='earnings')return []; // Automated earnings assessments were removed.
 if(source.source==='report'){
  const r=(await rows(db,"SELECT r.*,COALESCE(c.kind,r.kind) AS effective_kind FROM telegram_reports r LEFT JOIN telegram_report_categories c ON c.report_id=r.id WHERE r.id=? AND r.deleted=0",[source.source_id]))[0];
  if(!r||r.effective_kind!=='company')return [];
  r.parsed=JSON.parse(r.payload);const key=verifiedReportKey(r);if(!key)return [];
  const issuer=(await rows(db,'SELECT * FROM issuer_links WHERE market=? AND ticker=?',[r.market,r.ticker]))[0];
  if(!reportIssuerMatches(r,issuer))return [];
  const f=r.parsed.fields||{},publication=reportPublication(r.parsed,r.filename),target=reportTargetInfo(Object.fromEntries(Object.entries(f).filter(([,v])=>v?.status==='extracted')),r.raw_text);
  // Only extracted fields / explicit target sentences qualify as supplementary facts.
  const extras=[];if(f.rating?.status==='extracted')extras.push('투자의견 '+f.rating.value);
  if(target.value)extras.push('목표주가 '+target.value+(target.revision==='up'?' · 상향':target.revision==='down'?' · 하향':''));
  return [{source:'report',kind:'report',key,name:issuer.name,title:f.title?.status==='extracted'?f.title.value:r.title||r.filename,sourceId:r.id,sourceUrl:r.source_url,sourceLabel:publication.broker||r.channel_username,href:'/reports?report='+encodeURIComponent(r.id),publishedAt:publication.date?null:instant(r.posted_at),publishedDate:publication.date,sourcePostedAt:instant(r.posted_at),publicationLabel:publication.date?'발행일':'원본 게시 시각 (발행일 미확인)',timeZone:'Asia/Seoul',collectedAt,supplement:extras.join(' · '),major:false,aliases:['telegram:'+r.id,...reportIdentity(r)],sources:[{id:r.id,name:r.channel_username,url:r.source_url}]}];
 }
 if(source.source==='sec'){
  const f=(await rows(db,'SELECT * FROM sec_filings WHERE accession=?',[source.source_id]))[0];if(!f||f.topic==='manager')return [];
  const targets=await rows(db,"SELECT t.ticker,t.name FROM sec_filing_issuers i JOIN sec_targets t ON t.cik=i.cik WHERE i.accession=? AND (i.relation IN ('company','third_party') OR i.relation='pending' AND (i.evidence LIKE 'SEC submissions%' OR (i.evidence='Finviz Latest Filings ticker export' AND EXISTS(SELECT 1 FROM sec_filing_sources fs WHERE fs.accession=i.accession AND fs.ticker=t.ticker AND fs.provider='Finviz Elite'))))",[f.accession]);
  return targets.map(t=>({source:'sec',kind:'filing',key:'US:'+t.ticker,name:t.name||t.ticker,title:f.title_ko||f.form,sourceId:f.accession,sourceUrl:f.source_url,sourceLabel:'SEC · '+f.form,form:f.form,href:'/stock/US/'+encodeURIComponent(t.ticker)+'?tab=filings&accession='+f.accession,publishedAt:instant(f.accepted_at),publishedDate:f.filed_date,timeZone:'America/New_York',collectedAt,major:/^(?:8-K|6-K|10-K|10-Q|20-F|40-F)(?:\/A)?$/.test(f.form),aliases:['sec:'+f.accession],sources:[{id:f.accession,name:'SEC',url:f.source_url}]}));
 }
 const f=(await rows(db,'SELECT * FROM dart_filings WHERE receipt=?',[source.source_id]))[0];if(!f||!/^\d{6}$/.test(f.ticker)||!/^\d{8}$/.test(f.corp_code))return [];
 return [{source:'dart',kind:'filing',key:'KR:'+f.ticker,name:f.corp_name,title:f.title,sourceId:f.receipt,sourceUrl:dartUrl(f.receipt),sourceLabel:'DART · '+(dartTypes[f.filing_type]||'유형 확인 중'),href:'/stock/KR/'+f.ticker+'?tab=filings&receipt='+f.receipt,publishedAt:null,publishedDate:f.received_date,timeZone:'Asia/Seoul',collectedAt,major:['major','regular'].includes(filingGroup(f)),aliases:['dart:'+f.receipt],sources:[{id:f.receipt,name:'DART',url:dartUrl(f.receipt)}]}];
}

// Build a source-sized transaction before executing any publication writes.
// The same owner and source-version fence guards every statement, including
// alias merges and processed_version, so stale workers cannot publish partially.
async function planEvent(db,e,now,writes){
 const aliases=await Promise.all(e.aliases.map(a=>eventHash(e.key+'|'+e.kind+'|'+a)));
 const existing=await rows(db,`SELECT DISTINCT event_id FROM notification_aliases WHERE alias IN (${aliases.map(()=>'?')})`,aliases);
 const id=existing.map(r=>r.event_id).sort()[0]||aliases[0];
 const previous=(await rows(db,'SELECT payload FROM notification_events WHERE id=?',[id]))[0];
 if(previous){const p=JSON.parse(previous.payload);e={...e,collectedAt:p.collectedAt,sources:[...new Map([...(p.sources||[]),...e.sources].map(s=>[s.id,s])).values()]};}
 writes.push(f=>db.prepare(`INSERT INTO notification_events(id,kind,security_key,payload,created_at) SELECT ?,?,?,?,? WHERE ${f.sql} ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).bind(id,e.kind,e.key,JSON.stringify(e),now,...f.params));
 for(const other of existing.filter(r=>r.event_id!==id)){
  writes.push(
   f=>db.prepare(`UPDATE user_notifications SET read_at=COALESCE(read_at,(SELECT read_at FROM user_notifications d WHERE d.user_id=user_notifications.user_id AND d.event_id=?)) WHERE event_id=? AND ${f.sql}`).bind(other.event_id,id,...f.params),
   f=>db.prepare(`DELETE FROM notification_push_jobs WHERE notification_id IN (SELECT d.id FROM user_notifications d WHERE d.event_id=? AND EXISTS(SELECT 1 FROM user_notifications a WHERE a.user_id=d.user_id AND a.event_id=?)) AND ${f.sql}`).bind(other.event_id,id,...f.params),
   f=>db.prepare(`DELETE FROM user_notifications WHERE event_id=? AND user_id IN (SELECT user_id FROM user_notifications WHERE event_id=?) AND ${f.sql}`).bind(other.event_id,id,...f.params),
   f=>db.prepare(`UPDATE user_notifications SET event_id=? WHERE event_id=? AND ${f.sql}`).bind(id,other.event_id,...f.params),
   f=>db.prepare(`UPDATE notification_aliases SET event_id=? WHERE event_id=? AND ${f.sql}`).bind(id,other.event_id,...f.params),
   f=>db.prepare(`UPDATE notification_events SET merged_into=? WHERE id=? AND ${f.sql}`).bind(id,other.event_id,...f.params)
  );
 }
 for(const alias of aliases)writes.push(f=>db.prepare(`INSERT INTO notification_aliases(alias,event_id) SELECT ?,? WHERE ${f.sql} ON CONFLICT(alias) DO UPDATE SET event_id=excluded.event_id`).bind(alias,id,...f.params));
 return {id,event:e};
}

export async function processNotifications(env,{now,limit=100,leaseToken=null,clock=Date.now}={}){
 const db=env.DB;if(!db)return {processed:0,created:0};
 now=now||new Date(clock()).toISOString();
 // Direct internal invocations use the same lease as the scheduled worker.
 const acquired=leaseToken?null:await acquireNotificationLease(db,{now:clock()});
 const token=leaseToken||acquired?.token;if(!token)return {processed:0,created:0};
 let created=0,failed=0,processed=0;
 try{
  let f=notificationLeaseFence(token,clock());
  await db.prepare(`UPDATE notification_watches SET sec_baseline_at=(SELECT synced_at FROM sec_targets WHERE ticker=substr(security_key,4)) WHERE security_key LIKE 'US:%' AND sec_baseline_at IS NULL AND (SELECT synced_at FROM sec_targets WHERE ticker=substr(security_key,4))>=created_at AND ${f.sql}`).bind(...f.params).run();
  const allowed=['report','sec','dart'].filter(source=>sourceAllowed(env,source));
  const pending=await rows(db,`SELECT * FROM notification_sources WHERE version>processed_version AND source IN (${allowed.map(()=>'?')}) ORDER BY collected_at DESC LIMIT ?`,[...allowed,limit]);
  for(const source of pending){
   try{
    if(!sourceAllowed(env,source.source))continue;
    const writes=[],notificationIndexes=[];
    for(const input of await sourceEvents(env,source)){
     const {id,event:e}=await planEvent(db,{...input,sourceVersion:source.version},now,writes);
     const watchers=await rows(db,'SELECT w.*,s.reports,s.filings,s.updated_at AS settings_updated_at,s.reports_enabled_at,s.filings_enabled_at FROM notification_watches w JOIN notification_settings s ON s.user_id=w.user_id WHERE security_key=?',[e.key]);
     for(const w of watchers){
      if(!eligiblePublication(e,w)||!settingsAllow(w,e))continue;
      if(e.source==='sec'&&(!w.sec_baseline_at||Date.parse(e.collectedAt)<=Date.parse(w.sec_baseline_at)))continue;
      if(e.source==='dart'){
       const baseline=(await rows(db,'SELECT baseline_at FROM dart_subscriptions WHERE reader_hash=? AND ticker=?',[w.user_id,e.key.slice(3)]))[0]?.baseline_at;
       if(!baseline||Date.parse(e.collectedAt)<=Date.parse(baseline))continue;
      }
      const alertId=await eventHash(w.user_id+'|'+(e.kind==='filing'?e.source+':'+e.sourceId:id));
      // Recheck mutable watch/preferences in the commit, including remove/re-add.
      const stillWatching=`EXISTS(SELECT 1 FROM notification_watches w JOIN notification_settings s ON s.user_id=w.user_id WHERE w.user_id=? AND w.security_key=? AND w.created_at=? AND ${e.kind==='report'?'s.reports=1':e.major?"s.filings IN ('all','major')":"s.filings='all'"})`;
      notificationIndexes.push(writes.length);
      writes.push(f=>db.prepare(`INSERT OR IGNORE INTO user_notifications(id,user_id,event_id,security_key,kind,title,source_id,source_url,published_at,published_date,collected_at,created_at,href,payload) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${stillWatching} AND ${f.sql}`).bind(alertId,w.user_id,id,e.key,e.kind,e.title,e.sourceId,e.sourceUrl,e.publishedAt,e.publishedDate,e.collectedAt,now,e.href,JSON.stringify(e),w.user_id,e.key,w.created_at,...f.params));
      if(eligiblePushPublication(e,w)&&pushFresh(e,Date.parse(now),pushAge(env))){
       // changes() refers to the immediately preceding notification insert.
       // A retry must not recreate a deleted/cancelled outbox for an old alert.
       writes.push(f=>db.prepare(`INSERT OR IGNORE INTO notification_push_jobs(notification_id,subscription_id) SELECT ?,id FROM notification_push_subscriptions WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) AND changes()=1 AND ${f.sql}`).bind(alertId,w.user_id,Date.parse(now),...f.params));
      }
     }
    }
    writes.push(f=>db.prepare(`UPDATE notification_sources SET processed_version=? WHERE source=? AND source_id=? AND ${f.sql}`).bind(source.version,source.source,source.source_id,...f.params));
    const lease=notificationLeaseFence(token,clock());
    f={sql:`(${lease.sql}) AND EXISTS(SELECT 1 FROM notification_sources ns WHERE ns.source=? AND ns.source_id=? AND ns.version=?)`,params:[...lease.params,source.source,source.source_id,source.version]};
    const outcomes=await db.batch(writes.map(write=>write(f)));
    if(outcomes.at(-1).meta.changes){processed++;created+=notificationIndexes.reduce((n,i)=>n+outcomes[i].meta.changes,0);}
   }catch{failed++;}
  }
  f=notificationLeaseFence(token,clock());
  await db.batch([
   db.prepare(`INSERT INTO notification_runtime(key,value) SELECT 'last_error',? WHERE ${f.sql} ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(failed?'SOURCE_PROCESSING_FAILED':'',...f.params),
   db.prepare(`INSERT INTO notification_runtime(key,value) SELECT 'heartbeat',? WHERE ${f.sql} ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(now,...f.params)
  ]);
  return {processed,created};
 }finally{if(acquired)await releaseNotificationLease(db,token);}
}
