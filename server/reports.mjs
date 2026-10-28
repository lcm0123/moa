import {uniqueReports} from './report-dedup.mjs';
import {reportTargetInfo} from './report-target.mjs';
import {reportDocumentVersion,readReportDocumentStates} from './document-state-api.mjs';
import {readerSession} from './research-events.mjs';
import channels from '../config/telegram-channels.json' with {type:'json'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...headers}});
export async function reportsApi(request,env){
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(env.LOCAL_PREVIEW!==true&&env.TELEGRAM_REPORTS_PUBLIC_DISPLAY!=='true')return json({status:'restricted',items:[],message:'리포트 공개 표시 설정 필요'});
 if(!env.DB)return json({status:'error',items:[],message:'리포트 저장소 연결 필요'});
 const url=new URL(request.url),kind=url.searchParams.get('kind')||'market',market=url.searchParams.get('market'),ticker=url.searchParams.get('ticker'),q=(url.searchParams.get('q')||'').trim().slice(0,100),offset=Number(url.searchParams.get('offset')||0);
 if(!['market','company','unclassified'].includes(kind)||!Number.isInteger(offset)||offset<0||offset>100000||(market&&!['KR','US'].includes(market))||(ticker&&(!market||!/^[A-Z0-9.^/-]{1,24}$/.test(ticker))))return json({error:'리포트 조회 조건을 확인해 주세요.'},400);
 try{
  const channelRows=(await env.DB.prepare('SELECT username,status,last_error,heartbeat_at,last_sync_at FROM telegram_channels').bind().all()).results;
  const sources=channels.map(c=>{const r=channelRows.find(r=>r.username.toLowerCase()===c.username.toLowerCase());const alive=r&&Number.isFinite(Date.parse(r.heartbeat_at))&&Date.now()-Date.parse(r.heartbeat_at)<=180000;return {...c,status:r?(['connected','connecting','retrying'].includes(r.status)&&!alive?'disconnected':r.status):'setup_required',message:r?.last_error||null,lastSyncAt:r?.last_sync_at||null,heartbeatAt:r?.heartbeat_at||null};});
  const rows=(await env.DB.prepare("SELECT r.id,r.message_id,r.channel_username,COALESCE(c.kind,r.kind) AS effective_kind,c.kind AS manual_kind,r.market,r.ticker,r.title,r.filename,r.posted_at,r.edited_at,r.payload,r.source_url,r.raw_text FROM telegram_reports r LEFT JOIN telegram_report_categories c ON c.report_id=r.id WHERE r.deleted=0 AND json_extract(r.payload,'$.attachment.kind')='pdf'").bind().all()).results;
  const requestedId=url.searchParams.get('report'),unique=uniqueReports(rows),search=q.replace(/\s/g,'').toLowerCase();
  const filtered=unique.filter(r=>(requestedId?r.id===requestedId||r.duplicateSources?.some(s=>s.id===requestedId):r.effective_kind===kind)&&(!market||r.market===market)&&(!ticker||r.ticker===ticker)&&(!search||[r.parsed.fields?.stockName?.value,r.title,r.filename].some(v=>String(v||'').replace(/\s/g,'').toLowerCase().includes(search))));
  const items=await Promise.all(filtered.slice(offset,offset+30).map(async row=>{const {sourceMediaId,attachment,...payload}=row.parsed;return {id:row.id,channel:row.channel_username,postedAt:row.posted_at,editedAt:row.edited_at,...payload,targetPriceInfo:row.effective_kind==='company'?reportTargetInfo(payload.fields,row.raw_text):null,kind:row.effective_kind,classificationMode:row.manual_kind?'manual':'auto',attachment:{kind:'pdf',filename:attachment.filename,size:attachment.size,status:attachment.status,version:await reportDocumentVersion(attachment),url:attachment.status==='ready'?'/api/reports/'+encodeURIComponent(row.id)+'/pdf':null},sourceUrl:row.source_url};}));
  const canManage=env.LOCAL_PREVIEW===true&&url.hostname==='127.0.0.1';
  const reader=await readerSession(request);
  const reading=await readReportDocumentStates(env.DB,items.map(r=>r.id),reader.hash);
  for(const item of items){const state=reading.get(item.id);item.reading={openedAt:state?.openedAt||null,unread:state?.unread??true};}
  const counts={};for(const row of unique)counts[row.effective_kind]=(counts[row.effective_kind]||0)+1;
  return json({status:items.length?'ready':'empty',items,sources,nextOffset:filtered.length>offset+30?offset+30:null,kind,canManage,counts},200,reader.headers);
 }catch{return json({status:'error',items:[],message:'리포트를 불러오지 못했습니다.'});}
}

export async function reportPdfApi(request,env,id){
 if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
 if(env.LOCAL_PREVIEW!==true&&(env.TELEGRAM_REPORTS_PUBLIC_DISPLAY!=='true'||env.TELEGRAM_REPORTS_PUBLIC_PDF_DISPLAY!=='true'))return json({error:'PDF 공개 표시 설정 필요'},403);
 if(!/^-?\d+:\d+$/.test(id))return json({error:'잘못된 리포트 주소입니다.'},400);
 if(!env.DB||!env.REPORT_PDF_STORAGE)return json({error:'PDF 저장소 연결 필요'},503);
 try{
  const row=(await env.DB.prepare('SELECT filename,payload FROM telegram_reports WHERE id=? AND deleted=0').bind(id).all()).results[0];
  if(!row)return json({error:'PDF를 찾을 수 없습니다.'},404);
  const a=JSON.parse(row.payload).attachment;
  if(a?.kind!=='pdf'||a.status!=='ready'||!/^[a-f0-9]{64}\.pdf$/.test(a.key||''))return json({error:'PDF 파일 준비 중입니다.'},404);
  const bytes=await env.REPORT_PDF_STORAGE.read(a.key);
  if(!bytes)return json({error:'PDF 파일을 찾을 수 없습니다.'},404);
  const size=bytes.byteLength,headers={'Content-Type':'application/pdf','Content-Disposition':`inline; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(a.filename||row.filename||'report.pdf').replace(/'/g,'%27')}`,'Content-Length':String(size),'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
  const range=request.headers.get('Range');
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;
   if(match&&(match[1]||match[2])){start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));end=match[1]?(match[2]?Math.min(size-1,Number(match[2])):size-1):size-1;}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
   headers['Content-Range']=`bytes ${start}-${end}/${size}`;headers['Content-Length']=String(end-start+1);
   return new Response(request.method==='HEAD'?null:bytes.slice(start,end+1),{status:206,headers});
  }
  return new Response(request.method==='HEAD'?null:bytes,{headers});
 }catch{return json({error:'PDF를 불러오지 못했습니다.'},500);}
}

export async function reportCategoryApi(request,env,id){
 const url=new URL(request.url);
 if(request.method!=='PATCH')return json({error:'Method not allowed'},405);
 if(env.LOCAL_PREVIEW!==true||url.hostname!=='127.0.0.1'||request.headers.get('Origin')!==url.origin)return json({error:'로컬 관리자만 분류를 변경할 수 있습니다.'},403);
 if(!/^-?\d+:\d+$/.test(id))return json({error:'잘못된 리포트 주소입니다.'},400);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
 if(!env.DB)return json({error:'저장소 연결 필요'},503);
 try{
  const text=await request.text();if(text.length>512)return json({error:'요청이 너무 큽니다.'},413);
  const {kind}=JSON.parse(text);if(!['market','company','unclassified','auto'].includes(kind))return json({error:'분류를 확인해 주세요.'},400);
  const row=(await env.DB.prepare("SELECT id FROM telegram_reports WHERE id=? AND deleted=0 AND json_extract(payload,'$.attachment.kind')='pdf'").bind(id).all()).results[0];if(!row)return json({error:'리포트를 찾을 수 없습니다.'},404);
  if(kind==='auto')await env.DB.prepare('DELETE FROM telegram_report_categories WHERE report_id=?').bind(id).run();
  else await env.DB.prepare('INSERT INTO telegram_report_categories(report_id,kind,updated_at) VALUES(?,?,?) ON CONFLICT(report_id) DO UPDATE SET kind=excluded.kind,updated_at=excluded.updated_at').bind(id,kind,new Date().toISOString()).run();
  return json({saved:true});
 }catch{return json({error:'분류를 저장하지 못했습니다.'},500);}
}
