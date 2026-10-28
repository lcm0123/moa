import {securityKey} from './security-identity.mjs';
import {present} from '../dist/js/calendar-presentation.js';
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;
const instant=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export async function eventHash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])])):value;
export function normalizeResearchEvent(e,now=new Date().toISOString()){
 const [market,ticker]=String(e.key||'').split(':');if(!securityKey(market,ticker)||!day(e.date)||!['report','manager','earnings','calendar','price','filing'].includes(e.kind))return null;
 const actual=e.kind==='earnings'?[e.epsActual,e.revenueActual].some(Number.isFinite):present(e.actual);
 const future=e.at?Date.parse(e.at)>Date.parse(now):e.date>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(now));
 const state=['earnings','calendar'].includes(e.kind)?actual?'released':future?'scheduled':'awaiting_result':e.kind==='price'?'observed':'published';
 const publishedAt=instant(e.publishedAt)||(e.kind==='manager'?instant(e.date):null);
 const publishedDate=day(e.publishedDate)||(['report','manager'].includes(e.kind)?day(e.originalDate):null);
 return {...e,schemaVersion:1,state,semantics:e.kind==='price'?'observed_price_change':e.kind==='calendar'?'market_context':'source_fact',causalClaim:false,
  publishedAt,publishedDate,scheduledAt:['earnings','calendar'].includes(e.kind)?instant(e.at):null,
  sourcePostedAt:instant(e.sourcePostedAt)||(e.precision==='posted'?instant(e.at):null),
  dataDate:day(e.dataDate)||day(e.period)||(e.kind==='price'?e.date:null),dataPeriod:e.dataPeriod||e.period||null,
  collectedAt:instant(e.collectedAt)||(e.collectionConfirmed?null:instant(e.updatedAt)),sourceModifiedAt:instant(e.sourceModifiedAt),
  marketDate:day(e.originalDate)||((instant(e.sourcePostedAt)||instant(e.at))?new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Seoul'}).format(new Date(instant(e.sourcePostedAt)||instant(e.at))):e.date),displayTimeZone:e.at?'Asia/Seoul':e.timeZone||'원본 날짜',
  sourceKeys:e.sourceKeys?.length?[...new Set(e.sourceKeys)]:[e.kind+':'+e.id],sources:e.sources||[]};
}
export function eventContent(e){
 // Polling times, PDF readiness and source copies are observations, not new market events.
 const {id,collectionConfirmed,collectedAt,updatedAt,sourceKeys,sources,sourcePostedAt,sourceModifiedAt,reportId,href,firstSeenAt,lastSeenAt,eventId,eventRevision,unread,contentHash,revisionHistory,attachment,...facts}=e;
 return JSON.stringify(stable(facts));
}
async function rows(db,sql,args=[]){return (await db.prepare(sql).bind(...args).all()).results;}
async function batch(db,statements){for(let i=0;i<statements.length;i+=60)await db.batch(statements.slice(i,i+60));}
export async function persistResearchEvents(env,input,{now=new Date().toISOString(),identities=[]}={}){
 if(!env.DB)return [];const db=env.DB,events=input.map(e=>normalizeResearchEvent(e,now)).filter(Boolean);if(!events.length)return [];
 const keys=[...new Set(events.map(e=>e.key))],securities=new Map();
 for(let i=0;i<keys.length;i+=80)for(const r of await rows(db,`SELECT * FROM research_securities WHERE security_key IN (${keys.slice(i,i+80).map(()=>'?')})`,keys.slice(i,i+80)))securities.set(r.security_key,r);
 const invalid=new Set(),securityWrites=[];
 for(const key of keys){const [market,ticker]=key.split(':'),old=securities.get(key),evidence=identities.find(i=>i.key===key)||{},cusips=[...new Set(events.filter(e=>e.key===key&&e.cusip).map(e=>e.cusip))];
  const issuer=evidence.issuerId||null,isin=evidence.isin||null,cusip=cusips.length===1?cusips[0]:null;
  if(cusips.length>1||old&&((issuer&&old.issuer_id&&issuer!==old.issuer_id)||(isin&&old.isin&&isin!==old.isin)||(cusip&&old.cusip&&cusip!==old.cusip))){invalid.add(key);continue;}
  const id=old?.security_id||'security-'+crypto.randomUUID();securities.set(key,{...old,security_id:id});
  securityWrites.push(db.prepare('INSERT INTO research_securities(security_key,security_id,market,ticker,issuer_id,isin,cusip,evidence,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(security_key) DO UPDATE SET issuer_id=COALESCE(excluded.issuer_id,issuer_id),isin=COALESCE(excluded.isin,isin),cusip=COALESCE(excluded.cusip,cusip),evidence=excluded.evidence,updated_at=excluded.updated_at').bind(key,id,market,ticker,issuer,isin,cusip,JSON.stringify({source:evidence.source||'검증된 공급사 종목 코드',issuerVerified:!!issuer,shareClassVerified:!!(isin||cusip)}),now));
 }await batch(db,securityWrites);
 // Read the winning UUID if another request created the same security concurrently.
 for(let i=0;i<keys.length;i+=80)for(const r of await rows(db,`SELECT * FROM research_securities WHERE security_key IN (${keys.slice(i,i+80).map(()=>'?')})`,keys.slice(i,i+80)))securities.set(r.security_key,r);
 const valid=events.filter(e=>!invalid.has(e.key));const aliases=new Map(),aliasesByEvent=new Map();
 for(const e of valid)aliasesByEvent.set(e,await Promise.all(e.sourceKeys.map(k=>eventHash(e.key+'|'+e.kind+'|'+k))));
 const allAliases=[...new Set([...aliasesByEvent.values()].flat())];
 for(let i=0;i<allAliases.length;i+=80)for(const r of await rows(db,`SELECT source_key,event_id FROM research_event_sources WHERE source_key IN (${allAliases.slice(i,i+80).map(()=>'?')})`,allAliases.slice(i,i+80)))aliases.set(r.source_key,r.event_id);
 const writes=[],ids=new Set();
 for(const e of valid){const sourceKeys=aliasesByEvent.get(e),matches=[...new Set(sourceKeys.map(k=>aliases.get(k)).filter(Boolean))].sort(),id=matches[0]||await eventHash(e.key+'|'+e.kind+'|'+e.sourceKeys[0]);
  const normalized={...e,securityId:securities.get(e.key).security_id};delete normalized.sourceKeys;
  const hash=await eventHash(eventContent(normalized));ids.add(id);
  writes.push(db.prepare('INSERT INTO research_events(id,security_key,security_id,kind,event_date,published_at,published_date,data_date,collected_at,first_seen_at,last_seen_at,content_hash,revision,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET event_date=excluded.event_date,published_at=excluded.published_at,published_date=excluded.published_date,data_date=excluded.data_date,collected_at=COALESCE(excluded.collected_at,collected_at),last_seen_at=excluded.last_seen_at,revision=revision+CASE WHEN content_hash<>excluded.content_hash THEN 1 ELSE 0 END,content_hash=excluded.content_hash,payload=excluded.payload').bind(id,e.key,normalized.securityId,e.kind,e.date,e.publishedAt,e.publishedDate,e.dataDate,e.collectedAt,now,now,hash,JSON.stringify(normalized)));
  for(const alias of sourceKeys){aliases.set(alias,id);writes.push(db.prepare('INSERT INTO research_event_sources(source_key,event_id) VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET event_id=excluded.event_id').bind(alias,id));}
  for(const duplicate of matches.slice(1))writes.push(db.prepare('UPDATE research_events SET merged_into=? WHERE id=?').bind(id,duplicate));
 }await batch(db,writes);
 const result=[],allIds=[...ids];for(let i=0;i<allIds.length;i+=80){const part=allIds.slice(i,i+80);for(const r of await rows(db,`SELECT * FROM research_events WHERE id IN (${part.map(()=>'?')}) AND merged_into IS NULL`,part))result.push({...JSON.parse(r.payload),eventId:r.id,eventRevision:r.revision,firstSeenAt:r.first_seen_at,lastSeenAt:r.last_seen_at});}result.excludedKeys=[...invalid];return result;
}
export async function savedPriceEvents(db,keys,from,kinds=['price']){const result=[];if(!kinds.length)return result;for(let i=0;i<keys.length;i+=70){const part=keys.slice(i,i+70);const saved=await rows(db,`SELECT * FROM research_events WHERE security_key IN (${part.map(()=>'?')}) AND kind IN (${kinds.map(()=>'?')}) AND event_date>=? AND merged_into IS NULL`,[...part,...kinds,from]);result.push(...saved.map(r=>({...JSON.parse(r.payload),eventId:r.id,eventRevision:r.revision,firstSeenAt:r.first_seen_at,lastSeenAt:r.last_seen_at})));}return result;}
export async function readerSession(request){const url=new URL(request.url);let token=request.headers.get('Cookie')?.match(/(?:^|;\s*)moa_research_reader=([a-f0-9]{64})(?:;|$)/)?.[1];const fresh=!token;if(!token)token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');return {hash:await eventHash(token),headers:fresh?{'Set-Cookie':`moa_research_reader=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${url.protocol==='https:'?'; Secure':''}`}:{}};}
export async function applyReadState(db,events,reader){const saved=new Map((await rows(db,'SELECT event_id,revision FROM research_reads WHERE reader_hash=?',[reader])).map(r=>[r.event_id,r.revision]));return events.map(e=>({...e,unread:(saved.get(e.eventId)||0)<e.eventRevision}));}
export async function markEventsRead(db,reader,items,now=new Date().toISOString()){
 if(!Array.isArray(items)||!items.length||items.length>20||items.some(i=>!/^[a-f0-9]{64}$/.test(i.id)||!Number.isInteger(i.revision)||i.revision<1))throw new Error('INVALID_READ');
 await db.batch(items.map(i=>db.prepare('INSERT INTO research_reads(id,reader_hash,event_id,revision,read_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM research_events WHERE id=? AND revision>=?) ON CONFLICT(reader_hash,event_id) DO UPDATE SET revision=MAX(research_reads.revision,excluded.revision),read_at=excluded.read_at').bind(reader+':'+i.id,reader,i.id,i.revision,now,i.id,i.revision)));
}
