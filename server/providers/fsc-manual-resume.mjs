// Explicit internal/development command only. No reader route calls this module.
// A recovered account/IP may perform one scoped read without changing its key.
// This does not clear an authentication lock or restart automatic collectors.
import {randomUUID} from 'node:crypto';
import {requestFscPage,createFscRequestBudget,fscFailureCode,fscCredentialVersion} from './data-go-kr.mjs';
import {fscHash} from './fsc-exact.mjs';

const cooldownMs=15*60000;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&stamp(value)&&new Date(value).toISOString().slice(0,10)===value;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);

export function validateManualFscRead(request,authorization,{now,synthetic=false}={}){
 if(!request||!/^[a-zA-Z0-9_-]{8,80}$/.test(request.attemptId||'')||request.operation!=='stocks'||!/^\d{6}$/.test(request.stockId||'')||!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(request.isin||'')||!day(request.baseDate))fail('MANUAL_READ_SCOPE_INVALID');
 const p=authorization;
 if(!p||p.schemaVersion!=='fsc-manual-read-authorization-1'||p.environment!=='development'||p.readApproved!==true||p.maxRequests!==1||p.maxRows!==1||p.accessRestoredConfirmed!==true||typeof p.reviewedBy!=='string'||!p.reviewedBy.trim()||!stamp(p.reviewedAt)||!stamp(p.expiresAt)||Date.parse(p.reviewedAt)>now||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)-Date.parse(p.reviewedAt)>86400000)fail('MANUAL_READ_PERMISSION_REQUIRED');
 if(p.testOnly===true&&!synthetic)fail('TEST_ONLY_PERMISSION');
 if(!Array.isArray(p.evidence)||!p.evidence.length||p.evidence.some(e=>!/^https:\/\//.test(e.url||'')||!/^([0-9a-f]{64})$/.test(e.documentHash||'')||typeof e.locator!=='string'||!e.locator.trim()))fail('MANUAL_READ_PERMISSION_EVIDENCE_REQUIRED');
 if(['operation','stockId','isin','baseDate'].some(k=>p.scope?.[k]!==request[k]))fail('MANUAL_READ_PERMISSION_SCOPE_MISMATCH');
 return {operation:request.operation,stockId:request.stockId,isin:request.isin,baseDate:request.baseDate};
}

/** The authorization is a trusted operator file, never an HTTP request body.
 * No schema, business contract, calendar, public-display permission, or auth
 * failure row is changed. The caller may inspect the single returned raw row.
 */
export async function resumeFscReadOnce(env,request,{authorization,fetcher=fetch,now=Date.now(),synthetic=false}={}){
 if(env.LOCAL_PREVIEW!==true||env.FSC_MANUAL_RESUME_ENABLED!=='true'||!env.DB)fail('MANUAL_READ_DISABLED');
 if(synthetic&&fetcher===fetch)fail('SYNTHETIC_PROVIDER_REQUIRED');
 const scope=validateManualFscRead(request,authorization,{now,synthetic});
 if(!env.DATA_GO_KR_SERVICE_KEY?.trim())fail('MISSING_KEY');
 const db=env.DB,token=randomUUID(),key='fsc-manual-read:'+request.attemptId,control='fsc-manual-read-control';
 const credential=await fscCredentialVersion(env),requestHash=await fscHash(JSON.stringify({scope,credential})),permissionHash=await fscHash(canonical(authorization)),permissionKey='fsc-manual-read-permission:'+permissionHash;
 const record={attemptId:request.attemptId,scope,requestHash,permissionHash,token,state:'RUNNING',at:new Date(now).toISOString(),until:now+cooldownMs};
 const results=await db.batch([
  db.prepare("INSERT INTO catalyst_runtime(key,value,updated_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM catalyst_runtime WHERE key IN (?,?)) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(catalyst_runtime.value,'$.until')<=? AND NOT EXISTS(SELECT 1 FROM catalyst_runtime WHERE key IN (?,?))").bind(control,JSON.stringify(record),record.at,key,permissionKey,now,key,permissionKey),
  db.prepare("INSERT OR IGNORE INTO catalyst_runtime(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalyst_runtime WHERE key=? AND json_extract(value,'$.token')=?)").bind(key,JSON.stringify(record),record.at,control,token),
  db.prepare("INSERT OR IGNORE INTO catalyst_runtime(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalyst_runtime WHERE key=? AND json_extract(value,'$.token')=?)").bind(permissionKey,JSON.stringify({attemptId:request.attemptId,permissionHash,consumedAt:record.at}),record.at,control,token)
 ]);
 if(!results[1].meta.changes){
  const old=parse((await db.prepare('SELECT value FROM catalyst_runtime WHERE key=?').bind(key).all()).results[0]?.value);
  const used=(await db.prepare('SELECT 1 used FROM catalyst_runtime WHERE key=?').bind(permissionKey).all()).results.length>0;
  return {status:old?'ALREADY_ATTEMPTED':used?'PERMISSION_CONSUMED':'COOLDOWN',attemptId:request.attemptId,requests:0,automaticLockPreserved:true};
 }
 const budget=createFscRequestBudget({maxRequests:1,deadlineMs:12000,timeoutMs:12000});
 let data=null,errorCode=null;
 try{
  data=await requestFscPage(env,scope.operation,{isinCd:scope.isin,basDt:scope.baseDate.replaceAll('-',''),numOfRows:'1',pageNo:'1'},{fetcher,budget});
  if(data.page!==1||data.total>1||data.items.length>1||data.items.length!==data.total)fail('INCOMPLETE_PAGE');
  if(!data.total)fail('NO_DATA');
  const row=data.items[0];
  if(row.isinCd!==scope.isin||row.srtnCd!==scope.stockId||row.basDt!==scope.baseDate.replaceAll('-',''))fail('INVALID_HISTORY_IDENTITY');
 }catch(error){errorCode=fscFailureCode(error);data=null;}
 const summary={status:errorCode?'FAILED':'READY',attemptId:request.attemptId,requests:budget.requests,resultCount:data?.items.length||0,errorCode,automaticLockPreserved:true,responseHash:data?.responseHash||null};
 await db.prepare("UPDATE catalyst_runtime SET value=? WHERE key=? AND json_extract(value,'$.token')=?").bind(JSON.stringify({...record,token:null,state:summary.status,summary}),key,token).run();
 return {...summary,data};
}
