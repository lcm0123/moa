import { finvizCalendar } from './providers/finviz-calendar.mjs';
import { finvizEarnings } from './providers/finviz-earnings.mjs';
import { kstDate, validDay, shiftDay } from '../dist/js/calendar-model.js';
import { listCalendar, saveCalendarEvent, validateEvent } from './calendar-store.mjs';
import {storedCalendar} from './calendar-stored.mjs';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function calendarApi(request, env) {
 const url = new URL(request.url);
 // Editable only in the loopback development server. No public admin bypass.
 const canManage = env.LOCAL_CALENDAR_ADMIN === true && url.hostname === '127.0.0.1';
 if(request.method==='GET'&&url.pathname==='/api/calendar/earnings'){
  const date=url.searchParams.get('date')||kstDate(),dateTo=url.searchParams.get('dateTo')||(validDay(date)?shiftDay(date,6):'');
  if(!validDay(date)||!validDay(dateTo)||dateTo<date||Date.parse(dateTo)-Date.parse(date)>30*86400000)return json({error:'31일 이내의 날짜 범위를 선택해 주세요.'},400);
  if(url.searchParams.get('stored')==='1'){try{return json({date,dateTo,timeZone:'Asia/Seoul',...await storedCalendar(env,date,dateTo,'earnings'),fetchedAt:new Date().toISOString()});}catch{return json({error:'저장된 실적 일정을 불러오지 못했습니다.'},503);}}
  try{const result=await finvizEarnings(env,date,dateTo);return json({date,dateTo,timeZone:'Asia/Seoul',...result,providerUpdatedAt:result.receivedAt,fetchedAt:new Date().toISOString()});}
  catch(error){return json({status:['disconnected','restricted'].includes(error.status)?error.status:'error',error:error.status==='disconnected'?'실적 데이터 연결 필요':error.status==='restricted'?'실적 데이터 이용 권한 확인 필요':'실적 발표를 불러오지 못했습니다'},503);}
 }
 if (request.method === 'GET' && url.pathname === '/api/calendar') {
  const date = url.searchParams.get('date') || kstDate(),dateTo=url.searchParams.get('dateTo')||date;
  if (!validDay(date)||!validDay(dateTo)||dateTo<date||Date.parse(dateTo)-Date.parse(date)>30*86400000) return json({ error: '31일 이내의 한국시간 날짜를 선택해 주세요.' }, 400);
  if (!env.DB) return json({ error: '일정을 불러오지 못했습니다' }, 503);
  if(url.searchParams.get('stored')==='1'){try{return json({date,dateTo,timeZone:'Asia/Seoul',...await storedCalendar(env,date,dateTo),fetchedAt:new Date().toISOString()});}catch{return json({error:'저장된 경제 일정을 불러오지 못했습니다.'},503);}}
  try {
   const local=await listCalendar(env.DB,date,dateTo),remote=env.FINVIZ_API_KEY?await finvizCalendar(env,date,dateTo):{items:[],receivedAt:null};
   return json({date,dateTo,timeZone:'Asia/Seoul',items:[...local,...remote.items],canManage,source:remote.receivedAt?'Finviz · 관리자 등록':'관리자 등록',providerUpdatedAt:remote.receivedAt,fetchedAt:new Date().toISOString()});
  }
  catch { return json({ error: '일정을 불러오지 못했습니다' }, 503); }
 }
 const preference=url.pathname.match(/^\/api\/calendar\/preferences\/(finviz-[a-f0-9]{64})$/)?.[1];
 if(preference&&request.method==='PATCH'){
  if(!canManage||request.headers.get('Origin')!==url.origin)return json({error:'로컬 관리자만 일정을 수정할 수 있습니다.'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
  try{
   const body=await request.text();if(body.length>1024)return json({error:'요청이 너무 큽니다.'},413);
   const input=JSON.parse(body);if(typeof input.featured!=='boolean'||!validDay(input.date))return json({error:'주요 일정 설정을 확인해 주세요.'},400);
   const remote=await finvizCalendar(env,input.date);if(!remote.items.some(e=>e.id===preference))return json({error:'최신 일정에서 다시 확인해 주세요.'},409);
   await env.DB.prepare('INSERT INTO calendar_preferences(id,featured,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET featured=excluded.featured,updated_at=excluded.updated_at').bind(preference,Number(input.featured),Date.now()).run();
   return json({saved:true});
  }catch{return json({error:'주요 일정 설정을 저장하지 못했습니다.'},503);}
 }
 const id = url.pathname.match(/^\/api\/calendar\/([a-f0-9-]{36})$/i)?.[1];
 if (!((request.method === 'POST' && url.pathname === '/api/calendar') || (request.method === 'PATCH' && id))) return json({ error: 'Method not allowed' }, 405);
 if (!canManage || request.headers.get('Origin') !== url.origin) return json({ error: '로컬 관리자만 일정을 수정할 수 있습니다.' }, 403);
 if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON 요청이 필요합니다.' }, 415);
 if (!env.DB) return json({ error: '일정을 저장하지 못했습니다. 다시 시도해 주세요.' }, 503);
 let input;
 try {
  const text = await request.text(); if (text.length > 2048) return json({ error: '일정 내용이 너무 깁니다.' }, 413);
  input = JSON.parse(text); validateEvent(input);
  if (id && (!Number.isInteger(input.version) || input.version < 1)) throw new Error('수정할 일정 버전이 필요합니다.');
 } catch (error) { return json({ error: error instanceof SyntaxError ? '일정 내용을 확인해 주세요.' : error.message }, 400); }
 try {
  const item = await saveCalendarEvent(env.DB, input, id);
  if (!item) return json({ error: '다른 화면에서 일정이 변경되었습니다. 최신 일정을 다시 열어 수정해 주세요.' }, 409);
  return json({ item }, id ? 200 : 201);
 } catch { return json({ error: '일정을 저장하지 못했습니다. 입력 내용은 유지됩니다.' }, 503); }
}
