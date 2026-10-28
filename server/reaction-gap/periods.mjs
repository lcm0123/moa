// Pure session-window resolution. Callers supply every clock, calendar and
// completion assertion; no weekday inference or provider-completion inference.
const DEFAULT_POLICY = Object.freeze({ eventSessions: 5, fixedIntervals: 20, preSessions: 20 });
const MODES = new Set(['EVENT', 'DATE_REFERENCE', 'FIXED_WINDOW']);
const KOREAN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
}

export function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDate(match[1])) return null;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return null;
  if (match[6] !== 'Z') {
    const offsetHours = Number(match[6].slice(1, 3));
    const offsetMinutes = Number(match[6].slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
    // RFC 3339 -00:00 declares an unknown local offset, not a verified timezone.
    if (match[6] === '-00:00') return null;
  }
  const valueMs = Date.parse(value);
  return Number.isFinite(valueMs) ? valueMs : null;
}

function koreanDate(valueMs) {
  const parts = KOREAN_DATE.formatToParts(new Date(valueMs));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

function calendarData(calendar) {
  if (!isObject(calendar) || calendar.verified !== true) return { reason: 'CALENDAR_UNVERIFIED' };
  if (!validDate(calendar.coverageStart) || !validDate(calendar.coverageEnd)) return { reason: 'CALENDAR_UNVERIFIED' };
  if (!hasText(calendar.version) || calendar.timeZone !== 'Asia/Seoul'
    || calendar.coverageStart > calendar.coverageEnd || !Array.isArray(calendar.sessions)) {
    return { reason: 'INVALID_CALENDAR' };
  }
  const sessions = [];
  for (const session of calendar.sessions) {
    if (!isObject(session) || !validDate(session.date)
      || session.date < calendar.coverageStart || session.date > calendar.coverageEnd) return { reason: 'INVALID_CALENDAR' };
    const openMs = parseTimestamp(session.open), closeMs = parseTimestamp(session.close);
    if (openMs === null || closeMs === null || openMs >= closeMs
      || koreanDate(openMs) !== session.date || koreanDate(closeMs) !== session.date) return { reason: 'INVALID_CALENDAR' };
    sessions.push({ date: session.date, openMs, closeMs });
  }
  sessions.sort((left, right) => left.date.localeCompare(right.date));
  if (sessions.some((session, index) => index > 0 &&
    (session.date === sessions[index - 1].date || session.openMs <= sessions[index - 1].closeMs))) {
    return { reason: 'INVALID_CALENDAR' };
  }
  return { sessions };
}

function blankResult(mode, calendar, policy) {
  const unavailable = () => ({ complete: false, reasonCodes: [] });
  const requestedTarget = mode === 'FIXED_WINDOW' ? policy.fixedIntervals : policy.eventSessions;
  return {
    mode: MODES.has(mode) ? mode : null, state: 'HOLD', reasonCodes: [],
    t0: null, baseDate: null, endDate: null, observedSessions: 0,
    targetSessions: Number.isSafeInteger(requestedTarget) && requestedTarget > 0 ? requestedTarget : null,
    calendarVersion: hasText(calendar?.version) ? calendar.version : null,
    eventTimestamp: null, priceDates: [], prePriceDates: [], preTurnoverDates: [], postTurnoverDates: [],
    ranges: { price: unavailable(), prePrice: unavailable(), preTurnover: unavailable(), postTurnover: unavailable() },
  };
}

function hold(result, ...reasons) {
  result.state = 'HOLD';
  result.reasonCodes = [...new Set([...result.reasonCodes, ...reasons])];
  for (const range of Object.values(result.ranges)) {
    range.complete = false;
    range.reasonCodes = [...result.reasonCodes];
  }
  return result;
}

function setRange(result, name, sessions, start, end) {
  const complete = start >= 0 && end >= start && end < sessions.length;
  result[`${name}Dates`] = end < start ? [] : sessions.slice(Math.max(0, start), Math.max(0, end + 1)).map(session => session.date);
  result.ranges[name] = { complete, reasonCodes: complete ? [] : ['CALENDAR_RANGE_INCOMPLETE'] };
}

/**
 * Resolve an event or explicit fixed window from verified, caller-owned inputs.
 * DISPLAY/REFERENCE describe temporal eligibility; each range independently
 * reports whether its required calendar prefix is available. Missing historical
 * coverage never shifts a start date or replaces a 20-session range with fewer.
 */
export function resolveWindow(input = {}, policy = DEFAULT_POLICY) {
  const supplied = isObject(input) ? input : {};
  const { asOf, calendar, completion } = supplied;
  const window = isObject(supplied.window) ? supplied.window : {};
  const settings = isObject(policy) ? { ...DEFAULT_POLICY, ...policy } : DEFAULT_POLICY;
  const result = blankResult(window.mode, calendar, settings);
  if (!isObject(input) || !isObject(policy) || !MODES.has(window.mode)
    || ['eventSessions', 'fixedIntervals', 'preSessions'].some(key => !Number.isSafeInteger(settings[key]) || settings[key] < 1)) return hold(result, 'INVALID_WINDOW');
  const asOfMs = parseTimestamp(asOf);
  if (asOfMs === null) return hold(result, 'INVALID_TIMESTAMP');
  const validated = calendarData(calendar);
  if (validated.reason) return hold(result, validated.reason);
  const { sessions } = validated;
  const withinCoverage = date => date >= calendar.coverageStart && date <= calendar.coverageEnd;
  if (!isObject(completion) || completion.verified !== true || !hasText(completion.policyVersion)
    || !validDate(completion.through) || !withinCoverage(completion.through)) return hold(result, 'COMPLETION_UNVERIFIED');
  const confirmedMs = parseTimestamp(completion.confirmedAt);
  if (confirmedMs === null || confirmedMs > asOfMs || completion.through > koreanDate(confirmedMs)) return hold(result, 'COMPLETION_UNVERIFIED');
  const throughIndex = sessions.findLastIndex(session => session.date <= completion.through);
  // A verified through-date cannot assert completion of a session still open at
  // its own confirmation timestamp. Do not silently move that assertion back.
  if (throughIndex >= 0 && sessions[throughIndex].closeMs > confirmedMs) return hold(result, 'COMPLETION_UNVERIFIED');
  const completedIndex = sessions.findLastIndex((session, index) => index <= throughIndex && session.closeMs <= asOfMs);

  if (window.mode === 'FIXED_WINDOW') {
    if (!validDate(window.endDate)) return hold(result, 'INVALID_WINDOW');
    if (!withinCoverage(window.endDate)) return hold(result, 'CALENDAR_UNVERIFIED');
    const end = sessions.findIndex(session => session.date === window.endDate);
    if (end < 0) return hold(result, 'INVALID_WINDOW', 'END_DATE_NOT_SESSION');
    if (end > completedIndex) return hold(result, 'END_DATE_NOT_COMPLETED');
    const base = end - settings.fixedIntervals;
    result.state = 'DISPLAY';
    result.baseDate = sessions[base]?.date ?? null;
    result.endDate = sessions[end].date;
    // Fixed-window observations describe close-to-close intervals. A missing
    // baseline cannot turn ten known closes into ten known return intervals.
    result.observedSessions = Math.min(settings.fixedIntervals, end);
    setRange(result, 'price', sessions, base, end);
    setRange(result, 'prePrice', sessions, base - settings.preSessions, base);
    setRange(result, 'preTurnover', sessions, base - settings.preSessions + 1, base);
    setRange(result, 'postTurnover', sessions, base + 1, end);
    return result;
  }

  const event = window.event;
  if (!isObject(event) || !['timestamp', 'date'].includes(event.precision)) return hold(result, 'INVALID_WINDOW');
  let eventMs = parseTimestamp(event.publishedAt), eventDate;
  if (window.mode === 'DATE_REFERENCE' || event.precision === 'date' || eventMs === null) {
    if (!validDate(event.publishedDate)) {
      return hold(result, event.precision === 'timestamp' && eventMs === null ? 'INVALID_TIMESTAMP' : 'INVALID_WINDOW');
    }
    result.mode = 'DATE_REFERENCE';
    result.state = 'REFERENCE';
    result.reasonCodes.push('DATE_REFERENCE');
    if (window.mode === 'EVENT' && event.precision === 'timestamp') result.reasonCodes.push('EVENT_TIME_UNVERIFIED');
    eventDate = event.publishedDate;
    eventMs = null;
  } else {
    if (event.publishedDate !== undefined && event.publishedDate !== null && !validDate(event.publishedDate)) return hold(result, 'INVALID_WINDOW');
    result.state = 'DISPLAY';
    result.eventTimestamp = event.publishedAt;
    eventDate = koreanDate(eventMs);
    // A separate date may retain the source offset's civil date or be normalized
    // to KST. Any other date contradicts the precise timestamp and is not safe
    // to silently ignore or use as a fallback.
    if (event.publishedDate !== undefined && event.publishedDate !== null && event.publishedDate !== event.publishedAt.slice(0, 10)
      && event.publishedDate !== eventDate) return hold(result, 'EVENT_DATE_MISMATCH');
  }
  if ((eventMs !== null && eventMs > asOfMs) || (eventMs === null && eventDate > koreanDate(asOfMs))) return hold(result, 'EVENT_AFTER_AS_OF');
  if (!withinCoverage(eventDate)) return hold(result, 'CALENDAR_UNVERIFIED');
  const start = sessions.findIndex(session => session.date >= eventDate &&
    (session.date !== eventDate || eventMs === null || eventMs < session.closeMs));
  if (start < 0) return hold(result, 'CALENDAR_UNVERIFIED');
  result.t0 = sessions[start].date;
  result.baseDate = sessions[start - 1]?.date ?? null;
  if (eventMs !== null && sessions[start].date === eventDate && eventMs >= sessions[start].openMs) {
    result.state = 'REFERENCE';
    result.reasonCodes.push('INTRADAY_REFERENCE');
  }
  const end = Math.min(start + settings.eventSessions - 1, completedIndex);
  if (end < start) return hold(result, 'NO_COMPLETED_SESSION');
  result.endDate = sessions[end].date;
  result.observedSessions = end - start + 1;
  if (result.observedSessions < settings.eventSessions) {
    result.state = 'REFERENCE';
    result.reasonCodes.push('OBSERVATION_INCOMPLETE');
  }
  setRange(result, 'price', sessions, start - 1, end);
  setRange(result, 'prePrice', sessions, start - settings.preSessions - 1, start - 1);
  setRange(result, 'preTurnover', sessions, start - settings.preSessions, start - 1);
  setRange(result, 'postTurnover', sessions, start, end);
  return result;
}
