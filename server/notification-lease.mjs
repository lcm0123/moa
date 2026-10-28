// Same token/expiry compare-and-swap pattern as reaction-gap's shared lease.
// Keep the existing runtime key; accept its legacy numeric expiry on acquisition.
const key='lease';
const duration=ttl=>Math.max(1,Math.min(180000,Number(ttl)||180000));
export function notificationLeaseFence(token,now){
 return token?{sql:"EXISTS(SELECT 1 FROM notification_runtime WHERE key='lease' AND json_valid(value) AND json_extract(value,'$.token')=? AND CAST(json_extract(value,'$.until') AS INTEGER)>?)",params:[token,now]}:{sql:'1',params:[]};
}
export async function acquireNotificationLease(db,{now=Date.now(),ttlMs=180000,token=crypto.randomUUID()}={}){
 await db.prepare("INSERT OR IGNORE INTO notification_runtime(key,value) VALUES('lease','0')").run();
 const until=now+duration(ttlMs);
 const result=await db.prepare("UPDATE notification_runtime SET value=? WHERE key=? AND CASE WHEN json_valid(value) AND json_type(value)='object' THEN COALESCE(CAST(json_extract(value,'$.until') AS INTEGER),0) ELSE CAST(value AS INTEGER) END<=?").bind(JSON.stringify({token,until}),key,now).run();
 return result.meta.changes?{token,until}:null;
}
export async function renewNotificationLease(db,token,{now=Date.now(),ttlMs=180000}={}){
 if(!token)return false;
 const fence=notificationLeaseFence(token,now);
 const result=await db.prepare(`UPDATE notification_runtime SET value=json_set(value,'$.until',?) WHERE key=? AND ${fence.sql}`).bind(now+duration(ttlMs),key,...fence.params).run();
 return result.meta.changes>0;
}
export async function releaseNotificationLease(db,token){
 if(!token)return false;
 const result=await db.prepare("UPDATE notification_runtime SET value='{\"until\":0}' WHERE key=? AND json_valid(value) AND json_extract(value,'$.token')=?").bind(key,token).run();
 return result.meta.changes>0;
}
export async function ownsNotificationLease(db,token,{now=Date.now()}={}){
 if(!token)return false;
 const fence=notificationLeaseFence(token,now);
 return !!(await db.prepare(`SELECT 1 AS valid WHERE ${fence.sql}`).bind(...fence.params).all()).results.length;
}
