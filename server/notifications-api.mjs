import {readerSession,eventHash} from './research-events.mjs';
import {parseSecurities} from './security-identity.mjs';
import {rows,dartDay} from './dart-filings.mjs';
import {sourceAllowed} from './notification-events.mjs';
export function validPushSubscription(s){
 try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.href.length<=2048&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||h==='web.push.apple.com'&&u.hostname.endsWith('.push.apple.com'))&&/^[\w-]{87}=?$/.test(s.keys?.p256dh||'')&&/^[\w-]{22}={0,2}$/.test(s.keys?.auth||'')&&(!s.expirationTime||Number.isFinite(s.expirationTime));}catch{return false;}
}
const json=(d,status=200,h={})=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...h}});
export async function notificationApi(request,env){
 const url=new URL(request.url),route=url.pathname.slice('/api/notifications'.length),db=env.DB;
 if(!db)return json({message:'알림 저장소 연결 필요'},503);
 if(!['GET','POST','DELETE'].includes(request.method))return json({message:'Method not allowed'},405);
 if(request.method!=='GET'&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return json({message:'잘못된 요청 출처'},403);
 const reader=await readerSession(request),user=reader.hash,now=new Date().toISOString();
 try{
  let body={};if(request.method!=='GET'){const raw=await request.text();if(raw.length>4096)return json({message:'요청 범위 초과'},413);body=JSON.parse(raw||'{}');}
  await db.prepare('INSERT OR IGNORE INTO notification_settings(user_id,updated_at,reports_enabled_at,filings_enabled_at) VALUES(?,?,?,?)').bind(user,now,now,now).run();
  if(route==='/watchlist'&&request.method==='POST'){
   if(!Array.isArray(body.keys)||body.keys.length>100||body.keys.some(k=>typeof k!=='string'))return json({message:'관심종목 식별자 오류'},400);
   const keys=parseSecurities(body.keys.join(',')).map(s=>s.key);if(keys.some(k=>k.startsWith('KR:')&&!/^KR:\d{6}$/.test(k)))return json({message:'국내 공시는 6자리 종목코드를 사용합니다.'},400);
   const removed=keys.length?` AND security_key NOT IN (${keys.map(()=>'?')})`:'';
   const writes=[
    db.prepare('DELETE FROM notification_watches WHERE user_id=?'+removed).bind(user,...keys),
    db.prepare("UPDATE notification_push_jobs SET state='cancelled',error='unwatched' WHERE state IN ('queued','retry') AND notification_id IN (SELECT id FROM user_notifications WHERE user_id=?"+removed+')').bind(user,...keys)
   ];
   for(const key of keys){
    writes.push(db.prepare('INSERT OR IGNORE INTO notification_watches(user_id,security_key,created_at) VALUES(?,?,?)').bind(user,key,now));
    if(key.startsWith('KR:')){
     const ticker=key.slice(3);writes.push(db.prepare('INSERT OR IGNORE INTO dart_subscriptions(reader_hash,ticker,created_at,start_date) VALUES(?,?,?,?)').bind(user,ticker,now,dartDay()));
    }
    // A watch preference is not a request to register or wake a source collector.
   }
   const tickers=keys.filter(k=>k.startsWith('KR:')).map(k=>k.slice(3));
   writes.push(db.prepare('DELETE FROM dart_subscriptions WHERE reader_hash=?'+(tickers.length?` AND ticker NOT IN (${tickers.map(()=>'?')})`:'')).bind(user,...tickers));
   await db.batch(writes);
   return json({saved:true,count:keys.length},200,reader.headers);
  }
  if(route==='/settings'&&request.method==='POST'){
   if(typeof body.reports!=='boolean'||!['all','major','none'].includes(body.filings))return json({message:'알림 설정 오류'},400);
   await db.batch([
    db.prepare("UPDATE notification_settings SET reports_enabled_at=CASE WHEN reports=0 AND ?=1 THEN ? ELSE COALESCE(reports_enabled_at,updated_at) END,filings_enabled_at=CASE WHEN filings='none' AND ?<>'none' THEN ? ELSE COALESCE(filings_enabled_at,updated_at) END,reports=?,filings=?,updated_at=? WHERE user_id=?").bind(body.reports?1:0,now,body.filings,now,body.reports?1:0,body.filings,now,user),
    db.prepare("UPDATE notification_push_jobs SET state='cancelled',error='settings_changed' WHERE state IN ('queued','retry') AND notification_id IN (SELECT id FROM user_notifications WHERE user_id=? AND ((kind='report' AND ?=0) OR (kind='filing' AND (?='none' OR (?='major' AND COALESCE(json_extract(payload,'$.major'),0)<>1)))))").bind(user,body.reports?1:0,body.filings,body.filings)
   ]);return json({saved:true},200,reader.headers);
  }
  if(route==='/read'&&request.method==='POST'){
   if(body.all===true)await db.prepare('UPDATE user_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=?').bind(now,user).run();
   else{if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>100||body.ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))return json({message:'알림 식별자 오류'},400);await db.batch(body.ids.map(id=>db.prepare('UPDATE user_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?').bind(now,user,id)));}
   return json({saved:true},200,reader.headers);
  }
  if(route==='/push'&&request.method==='POST'){
   if(!env.NOTIFICATION_PUSH_READY)return json({message:'HTTPS·VAPID 서버 설정 필요'},503);
   if(!validPushSubscription(body))return json({message:'지원하는 브라우저의 유효한 푸시 구독이 필요합니다.'},400);
   const endpoint=body.endpoint,prior=(await rows(db,'SELECT user_id FROM notification_push_subscriptions WHERE endpoint=?',[endpoint]))[0];
   if(prior&&prior.user_id!==user)return json({message:'다른 브라우저 사용자에게 연결된 구독입니다. 브라우저 구독을 해제한 뒤 다시 등록해 주세요.'},409);
   const count=(await rows(db,'SELECT COUNT(*) n FROM notification_push_subscriptions WHERE user_id=?',[user]))[0].n;if(!prior&&count>=10)return json({message:'브라우저 구독 수 제한'},400);
   await db.batch([
    db.prepare("UPDATE notification_push_jobs SET state='cancelled',error='subscription_changed' WHERE state IN ('queued','retry') AND subscription_id IN (SELECT id FROM notification_push_subscriptions WHERE user_id=? AND endpoint=? AND (p256dh<>? OR auth<>? OR COALESCE(expires_at,0)<>?))").bind(user,endpoint,body.keys.p256dh,body.keys.auth,body.expirationTime||0),
    db.prepare('INSERT INTO notification_push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at,expires_at=excluded.expires_at WHERE notification_push_subscriptions.user_id=excluded.user_id').bind(await eventHash(endpoint),user,endpoint,body.keys.p256dh,body.keys.auth,now,now,body.expirationTime||null)
   ]);
   return json({saved:true},200,reader.headers);
  }
  if(route==='/push'&&request.method==='DELETE'){
   if(body.endpoint&&typeof body.endpoint!=='string')return json({message:'구독 오류'},400);
   const subs=await rows(db,'SELECT id FROM notification_push_subscriptions WHERE user_id=?'+(body.endpoint?' AND endpoint=?':''),body.endpoint?[user,body.endpoint]:[user]);
   for(const s of subs)await db.batch([db.prepare('DELETE FROM notification_push_jobs WHERE subscription_id=?').bind(s.id),db.prepare('DELETE FROM notification_push_subscriptions WHERE id=? AND user_id=?').bind(s.id,user)]);
   return json({saved:true},200,reader.headers);
  }
  if(route!==''||request.method!=='GET')return json({message:'Not found'},404);
  const type=url.searchParams.get('type')||'all',offset=Number(url.searchParams.get('offset')||0);if(!['all','report','filing'].includes(type)||!Number.isInteger(offset)||offset<0||offset>100000)return json({message:'알림 조회 조건 오류'},400);
  const allowed=['report','sec','dart','earnings'].filter(s=>sourceAllowed(env,s)),params=[user,...allowed],where=`user_id=? AND json_extract(payload,'$.source') IN (${allowed.map(()=>'?')})`+(type!=='all'?' AND kind=?':'');if(type!=='all')params.push(type);
  const records=await rows(db,'SELECT * FROM user_notifications WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?',[...params,offset]);
  const recent=await rows(db,`SELECT id,created_at,payload,read_at FROM user_notifications WHERE user_id=? AND json_extract(payload,'$.source') IN (${allowed.map(()=>'?')}) ORDER BY created_at DESC,id DESC LIMIT 10`,[user,...allowed]);
  const unread=(await rows(db,`SELECT COUNT(*) n FROM user_notifications WHERE user_id=? AND read_at IS NULL AND json_extract(payload,'$.source') IN (${allowed.map(()=>'?')})`,[user,...allowed]))[0].n;
  const settings=(await rows(db,'SELECT reports,filings FROM notification_settings WHERE user_id=?',[user]))[0];
  const processingDelayed=!!(await rows(db,"SELECT value FROM notification_runtime WHERE key='last_error'"))[0]?.value;
  const heartbeat=(await rows(db,"SELECT value FROM notification_runtime WHERE key='heartbeat'"))[0]?.value;
  const errors=await rows(db,"SELECT w.security_key,t.error AS sec_error,d.error AS dart_error FROM notification_watches w LEFT JOIN sec_targets t ON w.security_key='US:'||t.ticker LEFT JOIN dart_targets d ON w.security_key='KR:'||d.ticker WHERE w.user_id=?",[user]);
  return json({recent:recent.map(r=>({...JSON.parse(r.payload),id:r.id,createdAt:r.created_at,unread:!r.read_at})),items:records.slice(0,30).map(r=>({...JSON.parse(r.payload),id:r.id,key:r.security_key,href:r.href,createdAt:r.created_at,collectedAt:r.collected_at,readAt:r.read_at,unread:!r.read_at})),unread,nextOffset:records.length>30?offset+30:null,settings:{reports:!!settings.reports,filings:settings.filings},scope:'이 브라우저의 관심종목',processingDelayed,workerActive:!!heartbeat&&Date.now()-Date.parse(heartbeat)<120000,heartbeat:heartbeat||null,delayed:errors.filter(e=>e.sec_error||e.dart_error).map(e=>e.security_key),push:{ready:!!env.NOTIFICATION_PUSH_READY,publicKey:env.NOTIFICATION_PUSH_READY?env.WEB_PUSH_PUBLIC_KEY:null,subscriptions:(await rows(db,'SELECT COUNT(*) n FROM notification_push_subscriptions WHERE user_id=?',[user]))[0].n}},200,reader.headers);
 }catch{return json({message:'알림 요청을 처리하지 못했습니다.'},400,reader.headers);}
}
