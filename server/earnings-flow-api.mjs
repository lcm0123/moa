import config from '../config/earnings-inflection.json' with {type:'json'};
import {calculateEarningsInflection} from './earnings-inflection.mjs';
import {financialApi} from './financial-api.mjs';
import {rows} from './dart-filings.mjs';
import {securityKey} from './security-identity.mjs';
import {finvizPolicy} from './providers/finviz-client.mjs';
let busy=false;
const response=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function earningsFlowApi(request,env){
 const u=new URL(request.url),key=securityKey(u.searchParams.get('market'),u.searchParams.get('ticker'));
 if(request.method!=='GET'||!key)return new Response('Invalid request',{status:400});
 if(!env.DB)return response({status:'unavailable',message:'재무 저장소 연결 필요'});
 if(key.startsWith('US:')&&!finvizPolicy(env,'STOCKS').display)return response({status:'restricted',flow:null,collectionMode:'stored_only',refreshing:false,message:'Finviz 자료 표시 권한 확인 필요'});
 // A page read must not register a collection target, invalidate a refresh
 // schedule or start a financial job. Explicit worker entry points remain.
 const saved=(await rows(env.DB,'SELECT * FROM earnings_flow_targets WHERE security_key=?',[key]))[0];
 if(!saved)return response({status:'unavailable',flow:null,collectionMode:'stored_only',refreshing:false,message:'저장된 분기 실적 흐름 자료가 없습니다.'});
 const old=saved.payload?JSON.parse(saved.payload):null,outdated=old&&old.version!==config.version;
 const flow=outdated?null:old;
 return response({status:flow?'ready':'unavailable',flow:saved.error&&flow?{...flow,score:null,label:'자료 확인 필요',summary:'재무 갱신 지연 · 마지막 저장 자료',stale:true}:flow,message:saved.error||(outdated?'이전 계산 버전의 자료입니다. 현재 기준으로 저장된 분기 실적 흐름이 필요합니다.':!flow?'저장된 분기 실적 흐름 자료가 없습니다.':null),dataAsOf:saved.updated_at,collectionMode:'stored_only',refreshing:saved.lease_until>Date.now()});
}
export async function filingEvidence(db,key){
 const [market,ticker]=key.split(':');
 if(market==='KR')return rows(db,"SELECT receipt id,title,received_date publishedDate,first_seen_at collectedAt FROM dart_filings WHERE ticker=? AND filing_type='A' ORDER BY received_date DESC LIMIT 100",[ticker]);
 return rows(db,"SELECT DISTINCT f.accession id,f.form title,f.filed_date publishedDate,f.collected_at collectedAt FROM sec_filings f JOIN sec_filing_issuers i ON i.accession=f.accession JOIN sec_targets t ON t.cik=i.cik WHERE t.ticker=? AND i.relation='company' AND (f.form LIKE '10-K%' OR f.form LIKE '10-Q%') ORDER BY f.filed_date DESC LIMIT 100",[ticker]);
}
// A stored baseline is mandatory. A recalculation/version change and a historical
// first backfill can never create an earnings alert, even if its numbers change.
export async function saveEarningsFlow(env,key,data,filings,{now=new Date().toISOString()}={}){
 const db=env.DB,prior=(await rows(db,'SELECT * FROM earnings_flow_targets WHERE security_key=?',[key]))[0];
 const flow=calculateEarningsInflection(data,{now:Date.parse(now),filings}),previous=prior?.payload?JSON.parse(prior.payload):null;
 if(data.stale){
  // Keep the last fresh state for transition detection; a stale display is not
  // a new accounting decision and must not consume a filing/version identity.
  if(!previous||previous.version!==flow.version)await db.prepare('UPDATE earnings_flow_targets SET payload=?,updated_at=?,lease_until=0 WHERE security_key=?').bind(JSON.stringify({...flow,monitoringSince:previous?.monitoringSince||now}),now,key).run();
  return flow;
 }
 const principal=Object.values(flow.points.at(-1)?.metrics||{}).map(m=>m.source).filter(Boolean).sort((a,b)=>String(b.filedAt||'').localeCompare(String(a.filedAt||''))||b.accession.localeCompare(a.accession))[0],accession=principal?.accession||null,filing=filings.find(f=>f.id===accession),version=flow.version;
 // Preserve financial snapshots, but do not create automated assessment alerts.
 flow.monitoringSince=previous?.monitoringSince||prior?.updated_at||now;
 const statements=[];
 if(accession)statements.push(db.prepare('INSERT OR IGNORE INTO earnings_flow_evaluations(security_key,accession,version,payload,created_at) VALUES(?,?,?,?,?)').bind(key,accession,version,JSON.stringify(flow),now));
 statements.push(db.prepare('UPDATE earnings_flow_targets SET payload=?,last_accession=?,last_version=?,updated_at=?,next_refresh=?,lease_until=0,error=NULL WHERE security_key=?').bind(JSON.stringify(flow),accession,version,now,Date.parse(now)+21600000,key));
 await db.batch(statements);return flow;
}
export async function runEarningsJob(env,requestedKey=null,{load=financialApi}={}){
 if(busy||!env.DB)return;busy=true;
 try{
 const db=env.DB,now=Date.now();
 const target=(await rows(db,'SELECT * FROM earnings_flow_targets WHERE next_refresh<=? AND lease_until<=?'+(requestedKey?' AND security_key=?':'')+' ORDER BY next_refresh LIMIT 1',requestedKey?[now,now,requestedKey]:[now,now]))[0];if(!target)return;
 const lock=await db.prepare('UPDATE earnings_flow_targets SET lease_until=? WHERE security_key=? AND lease_until<=?').bind(now+600000,target.security_key,now).run();if(!lock.meta.changes)return;
 try{
  const [market,ticker]=target.security_key.split(':'),r=await load(new Request('http://localhost/api/financials?'+new URLSearchParams({market,ticker,interval:'quarter'})),env),data=await r.json();
  if(data.status!=='ready')throw Error('FINANCIAL_UNAVAILABLE');
  await saveEarningsFlow(env,target.security_key,data,await filingEvidence(db,target.security_key));
  if(data.stale)await db.prepare('UPDATE earnings_flow_targets SET lease_until=0,next_refresh=?,error=? WHERE security_key=?').bind(Date.now()+300000,'재무 갱신 지연 · 마지막 저장 자료',target.security_key).run();
 }catch{await db.prepare('UPDATE earnings_flow_targets SET lease_until=0,next_refresh=?,error=? WHERE security_key=?').bind(Date.now()+300000,'재무 수집 실패 · 마지막 저장 자료',target.security_key).run();}
 }finally{busy=false;}
}
// The earnings assessment card and its automatic jobs were removed at the user's request.
export function startEarningsWorker(){return ()=>{};}
