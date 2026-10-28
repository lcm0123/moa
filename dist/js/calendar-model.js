export const CALENDAR_TIME_ZONE = 'Asia/Seoul';
export const countryNames = { KR: '한국', US: '미국' };
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function kstDate(value = Date.now()) {
 const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function kstClock(value) { return clockFormatter.format(new Date(value)); }
export function validDay(day) {
 return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
export function shiftDay(day, offset) { return new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10); }
export function calendarMonth(day){
 if(!validDay(day))throw new Error('날짜를 확인해 주세요.');
 const first=day.slice(0,7)+'-01',next=new Date(first+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
 const last=shiftDay(next.toISOString().slice(0,10),-1),offset=new Date(first+'T00:00:00Z').getUTCDay(),count=Number(last.slice(-2));
 return {first,last,cells:Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>i<offset||i>=offset+count?null:shiftDay(first,i-offset))};
}
export function shiftCalendarMonth(day,offset){
 const target=new Date(day.slice(0,7)+'-01T00:00:00Z');target.setUTCMonth(target.getUTCMonth()+offset);
 const first=target.toISOString().slice(0,10),last=calendarMonth(first).last;
 return first.slice(0,8)+String(Math.min(Number(day.slice(-2)),Number(last.slice(-2)))).padStart(2,'0');
}
export function nextKstMidnight(now = Date.now()) { return Date.parse(shiftDay(kstDate(now), 1) + 'T00:00:00+09:00'); }
export function chronological(events) {
 return [...events].sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity) || a.title.localeCompare(b.title, 'ko') || a.id.localeCompare(b.id));
}
export function importantToday(events, now = Date.now()) {
 const day = kstDate(now);
 return chronological(events.filter(e => ['KR', 'US'].includes(e.country) && e.dateConfirmed !== false && isMajorEconomic(e) && (e.startsAt ? kstDate(e.startsAt) : e.dateKst) === day));
}
// Named releases take precedence over provider impact; administrator selections take precedence over both.
export function isMajorEconomic(event) {
 if(event.featured)return true;
 const title=event.title||'';
 if(/\b(FOMC.*(?:rate|decision|statement|press conference|projections)|Fed Interest Rate Decision|CPI|Consumer Price Index|(?:Core )?Inflation Rate (?:MoM|YoY)|PCE|Personal Consumption Expenditure|Non.?Farm Payrolls?|Employment (?:Situation|Report)|Unemployment Rate|GDP|Gross Domestic Product|Retail Sales|ISM (?:Manufacturing|Services|Non.Manufacturing) (?:PMI|Index)|Federal Funds Rate)\b|금리\s*결정|소비자물가|개인소비지출|고용보고서|비농업.*고용|국내총생산|소매판매/i.test(title))return true;
 if(/auction|bill issuance|note issuance|bond issuance|Chicago Fed|Dallas Fed|Richmond Fed|Kansas(?: City)? Fed|Philly Fed|Philadelphia Fed|Empire State|입찰|지역.*지수/i.test(title))return false;
 if(/speech|speaks|발언|연설/i.test(title)&&event.importance!=='high')return false;
 return event.importance==='high';
}
export function homeEconomicEvents(events,now=Date.now(),limit=3){
 const items=importantToday(events,now),future=items.filter(e=>e.startsAt&&Date.parse(e.startsAt)>now),unknown=items.filter(e=>!e.startsAt),past=items.filter(e=>e.startsAt&&Date.parse(e.startsAt)<=now).reverse();
 const priority=list=>[...list.filter(e=>e.featured),...list.filter(e=>!e.featured)];
 return [...priority(future),...priority(unknown),...priority(past)].slice(0,limit);
}
export function chooseHeadline(events, now = Date.now()) {
 const items = importantToday(events, now);
 const future = items.filter(e => e.startsAt && Date.parse(e.startsAt) > now);
 const upcoming = future.find(e => e.featured) || future[0];
 if (upcoming) return { event: upcoming, state: 'upcoming', items };
 const undated = items.filter(e => !e.startsAt);
 if (undated.length) return { event: undated.find(e => e.featured) || undated[0], state: 'undetermined', items };
 const recent = items.filter(e => e.startsAt).at(-1);
 return { event: recent || null, state: recent ? 'ended' : 'empty', items };
}
// Reject ambiguous/missing New York DST times rather than inventing an offset.
export function wallTimeToInstant(day, clock, zone = CALENDAR_TIME_ZONE) {
 if (!validDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock) || !['Asia/Seoul', 'America/New_York'].includes(zone)) throw new Error('날짜와 시간을 확인해 주세요.');
 if (zone === CALENDAR_TIME_ZONE) return new Date(`${day}T${clock}:00+09:00`).toISOString();
 const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
 const nominal = Date.parse(`${day}T${clock}:00Z`), matches = [];
 for (const offset of [-5, -4]) {
  const candidate = nominal - offset * 3600000;
  const p = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(x => [x.type, x.value]));
  if (`${p.year}-${p.month}-${p.day}` === day && `${p.hour}:${p.minute}` === clock) matches.push(candidate);
 }
 if (matches.length !== 1) throw new Error(matches.length ? '미국 서머타임 종료로 중복되는 시각입니다. 한국시간으로 입력해 주세요.' : '미국 서머타임 변경으로 존재하지 않는 시각입니다.');
 return new Date(matches[0]).toISOString();
}
