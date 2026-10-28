import { kstDate, validDay } from '../dist/js/calendar-model.js';

const selectColumns = 'id,title,country,importance,featured,starts_at,date_kst,version,updated_at';
function eventFromRow(row) {
 return { id: row.id, title: row.title, country: row.country, importance: row.importance, featured: Boolean(row.featured), startsAt: row.starts_at === null ? null : new Date(row.starts_at).toISOString(), dateKst: row.date_kst, version: row.version, updatedAt: new Date(row.updated_at).toISOString(), source: '관리자 등록' };
}
export function validateEvent(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('일정 내용을 확인해 주세요.');
 const title = typeof input.title === 'string' ? input.title.trim() : '';
 if (!title || title.length > 160) throw new Error('일정명은 1~160자로 입력해 주세요.');
 if (!['KR', 'US'].includes(input.country)) throw new Error('국가를 선택해 주세요.');
 if (!['high', 'medium', 'low'].includes(input.importance) || typeof input.featured !== 'boolean') throw new Error('중요도와 주요 일정 설정을 확인해 주세요.');
 let startsAt = null, dateKst;
 if (input.startsAt !== null) {
  if (typeof input.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(input.startsAt) || !validDay(input.startsAt.slice(0, 10)) || !Number.isFinite(Date.parse(input.startsAt))) throw new Error('시간대가 포함된 확정 시각이 필요합니다.');
  startsAt = Date.parse(input.startsAt); dateKst = kstDate(startsAt);
 } else {
  if (!validDay(input.dateKst)) throw new Error('시간 미정 일정의 한국시간 날짜가 필요합니다.');
  dateKst = input.dateKst;
 }
 return { title, country: input.country, importance: input.importance, featured: input.featured, startsAt, dateKst };
}
export async function listCalendar(db, date, dateTo=date) {
 const result = await db.prepare(`SELECT ${selectColumns} FROM calendar_events WHERE date_kst>=? AND date_kst<=? ORDER BY date_kst,starts_at IS NULL,starts_at,id`).bind(date,dateTo).all();
 return result.results.map(eventFromRow);
}
export async function saveCalendarEvent(db, input, id = null, now = Date.now()) {
 const event = validateEvent(input);
 if (id) {
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('수정할 일정 버전이 필요합니다.');
  const result = await db.prepare('UPDATE calendar_events SET title=?,country=?,importance=?,featured=?,starts_at=?,date_kst=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(event.title,event.country,event.importance,Number(event.featured),event.startsAt,event.dateKst,now,id,input.version).run();
  if (!result.meta.changes) return null;
 } else {
  id = crypto.randomUUID();
  await db.prepare('INSERT INTO calendar_events (id,title,country,importance,featured,starts_at,date_kst,version,updated_at) VALUES (?,?,?,?,?,?,?,1,?)').bind(id,event.title,event.country,event.importance,Number(event.featured),event.startsAt,event.dateKst,now).run();
 }
 const result = await db.prepare(`SELECT ${selectColumns} FROM calendar_events WHERE id=?`).bind(id).all();
 return eventFromRow(result.results[0]);
}
