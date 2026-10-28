import {readerSession,eventHash} from './research-events.mjs';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
export const reportDocumentVersion=async attachment=>/^[a-f0-9]{64}\.pdf$/.test(attachment?.key||'')?eventHash('report-document-version:'+attachment.key):null;
// Both report lists project the current PDF version. A corrected file must not
// inherit the earlier document's read mark, even if its report event is read.
// This helper only reads saved rows; listing/prefetching never opens a document.
export async function readReportDocumentStates(db,ids,owner){
 const unique=[...new Set(ids)],result=new Map();if(!unique.length)return result;
 const placeholders=unique.map(()=>'?').join(',');
 const reports=(await db.prepare('SELECT id,payload FROM telegram_reports WHERE deleted=0 AND id IN ('+placeholders+')').bind(...unique).all()).results;
 const saved=owner?(await db.prepare('SELECT report_id,document_version,opened_at FROM document_reading_state WHERE reader_hash=? AND report_id IN ('+placeholders+')').bind(owner,...unique).all()).results:[];
 for(const report of reports){let attachment;try{attachment=JSON.parse(report.payload).attachment;}catch{continue;}
  if(attachment?.kind!=='pdf'||attachment.status!=='ready')continue;
  const version=await reportDocumentVersion(attachment);if(!version)continue;
  const state=saved.find(r=>r.report_id===report.id&&r.document_version===version);
  result.set(report.id,{version,openedAt:state?.opened_at||null,unread:!state});
 }
 return result;
}
export function cleanDocumentState(value){
 if(!value||typeof value!=='object')throw Error('INVALID_STATE');
 const point=v=>{if(!v||!Number.isInteger(v.page)||v.page<1||v.page>10000||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>100000||Math.abs(v.y)>100000)throw Error('INVALID_POINT');return {page:v.page,x:v.x,y:v.y};};
 if(!Array.isArray(value.bookmarks)||value.bookmarks.length>30)throw Error('INVALID_BOOKMARKS');
 const seen=new Set(),bookmarks=value.bookmarks.map(b=>{const p=point(b);if(seen.has(p.page))throw Error('DUPLICATE_PAGE');seen.add(p.page);return p;});
 return {anchor:point(value.anchor),bookmarks};
}
export async function documentStateApi(request,env,id){
 const url=new URL(request.url);
 if(!['GET','PUT'].includes(request.method))return json({message:'Method not allowed'},405);
 if(env.LOCAL_PREVIEW!==true&&(env.TELEGRAM_REPORTS_PUBLIC_DISPLAY!=='true'||env.TELEGRAM_REPORTS_PUBLIC_PDF_DISPLAY!=='true'))return json({message:'PDF 표시 권한이 없습니다.'},403);
 if(!/^-?\d+:\d+$/.test(id))return json({message:'잘못된 문서 ID입니다.'},400);
 if(!env.DB)return json({message:'읽던 위치 저장소 연결 필요'},503);
 if(request.method==='PUT'&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return json({message:'잘못된 저장 요청입니다.'},403);
 try{
  const row=(await env.DB.prepare('SELECT payload FROM telegram_reports WHERE id=? AND deleted=0').bind(id).all()).results[0];
  if(!row)return json({message:'문서가 없습니다.'},404);
  const attachment=JSON.parse(row.payload).attachment,version=await reportDocumentVersion(attachment);
  if(!version||attachment?.status!=='ready')return json({message:'확인된 PDF 버전이 없습니다.'},404);
  const reader=await readerSession(request),args=[reader.hash,id,version];
  const saved=(await env.DB.prepare('SELECT revision,state_json,opened_at,updated_at FROM document_reading_state WHERE reader_hash=? AND report_id=? AND document_version=?').bind(...args).all()).results[0];
  if(request.method==='GET'){
   const older=(await env.DB.prepare('SELECT COUNT(*) n FROM document_reading_state WHERE reader_hash=? AND report_id=? AND document_version<>?').bind(...args).all()).results[0].n;
   return json({version,revision:saved?.revision||0,state:saved?JSON.parse(saved.state_json):null,openedAt:saved?.opened_at||null,updatedAt:saved?.updated_at||null,previousVersionAvailable:older>0},200,reader.headers);
  }
  const text=await request.text();if(text.length>4096)return json({message:'저장 범위가 큽니다.'},413);
  let input,state;try{input=JSON.parse(text);state=cleanDocumentState(input.state);if(!Number.isInteger(input.revision)||input.revision<0)throw Error();}catch{return json({message:'읽던 위치와 북마크를 확인해 주세요.'},400);}
  if(input.version!==version)return json({message:'원문이 변경되었습니다. 다시 열면 새 버전으로 표시합니다.',code:'DOCUMENT_VERSION_CHANGED'},409);
  if(input.revision!==(saved?.revision||0))return json({message:'다른 화면에서 읽던 위치가 변경되었습니다. 최신 상태를 다시 불러와 주세요.',code:'STATE_CONFLICT'},409);
  const now=new Date().toISOString(),payload=JSON.stringify(state);
  const operation=saved?env.DB.prepare('UPDATE document_reading_state SET state_json=?,revision=revision+1,updated_at=? WHERE reader_hash=? AND report_id=? AND document_version=? AND revision=?').bind(payload,now,...args,input.revision):env.DB.prepare('INSERT OR IGNORE INTO document_reading_state(reader_hash,report_id,document_version,revision,state_json,opened_at,updated_at) VALUES(?,?,?,1,?,?,?)').bind(...args,payload,now,now);
  const result=await operation.run();if((result.meta?.changes??result.changes)!==1)return json({message:'다른 화면에서 상태가 변경되었습니다.',code:'STATE_CONFLICT'},409);
  return json({saved:true,version,revision:input.revision+1,updatedAt:now},200,reader.headers);
 }catch{return json({message:'읽던 위치를 저장·조회하지 못했습니다. PDF는 계속 볼 수 있습니다.'},503);}
}
