import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, parseTimestamp } from '../server/reaction-gap/periods.mjs';
import actualPolicy from '../config/reaction-gap.json' with { type: 'json' };

// Explicit SYNTHETIC sessions: March 9 is deliberately closed and January 2
// opens at 10:00. This is not a production calendar or an exchange assertion.
const DATES = (`
2026-01-02 2026-01-05 2026-01-06 2026-01-07 2026-01-08 2026-01-09
2026-01-12 2026-01-13 2026-01-14 2026-01-15 2026-01-16
2026-01-19 2026-01-20 2026-01-21 2026-01-22 2026-01-23
2026-01-26 2026-01-27 2026-01-28 2026-01-29 2026-01-30
2026-02-02 2026-02-03 2026-02-04 2026-02-05 2026-02-06
2026-02-09 2026-02-10 2026-02-11 2026-02-12 2026-02-13
2026-02-16 2026-02-17 2026-02-18 2026-02-19 2026-02-20
2026-02-23 2026-02-24 2026-02-25 2026-02-26 2026-02-27
2026-03-02 2026-03-03 2026-03-04 2026-03-05 2026-03-06
2026-03-10 2026-03-11 2026-03-12 2026-03-13
2026-03-16 2026-03-17 2026-03-18 2026-03-19 2026-03-20
2026-03-23 2026-03-24 2026-03-25 2026-03-26 2026-03-27
2026-03-30 2026-03-31 2026-04-01 2026-04-02 2026-04-03
2026-04-06 2026-04-07 2026-04-08 2026-04-09 2026-04-10
`).trim().split(/\s+/);
const at = (date, time = '16:00:00') => `${date}T${time}+09:00`;
const calendar = () => ({
  version: 'synthetic-calendar-v1', verified: true, timeZone: 'Asia/Seoul',
  coverageStart: '2026-01-01', coverageEnd: '2026-04-30',
  sessions: DATES.map(date => ({ date, open: at(date, date === '2026-01-02' ? '10:00:00' : '09:00:00'), close: at(date, '15:30:00') })),
});
function fixture(through = '2026-04-10') {
  return {
    asOf: at(through, '20:00:00'), calendar: calendar(),
    completion: { verified: true, through, confirmedAt: at(through), policyVersion: 'synthetic-completion-v1' },
    window: { mode: 'EVENT', event: { id: 'synthetic-event', version: '1', publishedAt: at('2026-03-03', '08:59:59'), publishedDate: '2026-03-03', precision: 'timestamp' } },
  };
}
function withEvent(timestamp, through) {
  const input = fixture(through);
  input.window.event.publishedAt = timestamp;
  input.window.event.publishedDate = timestamp.slice(0, 10);
  return input;
}
const EXPECTED_POST = ['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-10'];
const EXPECTED_PRE_PRICE = [
  '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06',
  '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-03-02',
];

test('T01 exact open and close boundaries use the supplied regular session', () => {
  const cases = [
    ['08:59:59', '2026-03-03', 'DISPLAY', false],
    ['09:00:00', '2026-03-03', 'REFERENCE', true],
    ['15:29:59', '2026-03-03', 'REFERENCE', true],
    ['15:30:00', '2026-03-04', 'DISPLAY', false],
  ];
  for (const [time, t0, state, intraday] of cases) {
    const result = resolveWindow(withEvent(at('2026-03-03', time)));
    assert.equal(result.t0, t0);
    assert.equal(result.state, state);
    assert.equal(result.reasonCodes.includes('INTRADAY_REFERENCE'), intraday);
  }
});

test('T02 Friday after close, weekend and closed Monday resolve to Tuesday', () => {
  for (const date of ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']) {
    assert.equal(resolveWindow(withEvent(at(date))).t0, '2026-03-10');
  }
});

test('T03 special 10:00 opening treats 09:30 as before the open', () => {
  const result = resolveWindow(withEvent(at('2026-01-02', '09:30:00')));
  assert.equal(result.t0, '2026-01-02');
  assert.equal(result.state, 'DISPLAY');
  assert.ok(!result.reasonCodes.includes('INTRADAY_REFERENCE'));
});

test('T04 date-only trading day and holiday retain a null event timestamp', () => {
  for (const [date, expected] of [['2026-03-03', '2026-03-03'], ['2026-03-09', '2026-03-10']]) {
    const input = fixture();
    input.window = { mode: 'DATE_REFERENCE', event: { id: 'date-only', version: '1', publishedDate: date, precision: 'date' } };
    const result = resolveWindow(input);
    assert.equal(result.mode, 'DATE_REFERENCE');
    assert.equal(result.state, 'REFERENCE');
    assert.equal(result.t0, expected);
    assert.equal(result.eventTimestamp, null);
    assert.ok(result.reasonCodes.includes('DATE_REFERENCE'));
  }
});

test('EVENT date precision and ambiguous timestamp lower to explicit date reference', () => {
  for (const event of [
    { publishedDate: '2026-03-03', precision: 'date' },
    { publishedAt: '2026-03-03T09:00:00', publishedDate: '2026-03-03', precision: 'timestamp' },
    { publishedDate: '2026-03-03', precision: 'timestamp' },
  ]) {
    const input = fixture();
    input.window.event = event;
    const result = resolveWindow(input);
    assert.equal(result.mode, 'DATE_REFERENCE');
    assert.equal(result.eventTimestamp, null);
    assert.equal(result.state, 'REFERENCE');
  }
});

test('T05 zero completed event sessions hold every dependent range', () => {
  const input = fixture('2026-03-02');
  input.asOf = at('2026-03-03', '10:00:00');
  const result = resolveWindow(input);
  assert.equal(result.t0, '2026-03-03');
  assert.equal(result.baseDate, '2026-03-02');
  assert.equal(result.endDate, null);
  assert.equal(result.observedSessions, 0);
  assert.equal(result.state, 'HOLD');
  assert.ok(result.reasonCodes.includes('NO_COMPLETED_SESSION'));
  assert.deepEqual(result.priceDates, []);
  assert.deepEqual(result.postTurnoverDates, []);
  assert.ok(Object.values(result.ranges).every(range => !range.complete));
});

test('T05 1, 3 and 5 completed sessions retain the actual common end and denominator', () => {
  for (const [through, count, state] of [
    ['2026-03-03', 1, 'REFERENCE'], ['2026-03-05', 3, 'REFERENCE'], ['2026-03-10', 5, 'DISPLAY'],
  ]) {
    const result = resolveWindow(fixture(through));
    assert.equal(result.observedSessions, count);
    assert.equal(result.targetSessions, 5);
    assert.equal(result.endDate, through);
    assert.equal(result.state, state);
    assert.equal(result.reasonCodes.includes('OBSERVATION_INCOMPLETE'), count < 5);
    assert.deepEqual(result.postTurnoverDates, EXPECTED_POST.slice(0, count));
    assert.deepEqual(result.priceDates, ['2026-03-02', ...EXPECTED_POST.slice(0, count)]);
  }
});

test('T06 a company missing the common end cannot shrink a calendar-owned window', () => {
  const input = fixture('2026-03-10');
  const complete = resolveWindow({ ...input, companies: [{ id: 'A', priceDates: EXPECTED_POST }] });
  const missingEnd = resolveWindow({ ...input, companies: [{ id: 'A', priceDates: EXPECTED_POST }, { id: 'B', priceDates: EXPECTED_POST.slice(0, 4) }] });
  assert.deepEqual(missingEnd, complete);
  assert.equal(missingEnd.endDate, '2026-03-10');
});

test('five-session event window never expands after 8 or 30 calendar days', () => {
  for (const through of ['2026-03-11', '2026-04-02']) {
    const result = resolveWindow(fixture(through));
    assert.equal(result.endDate, '2026-03-10');
    assert.equal(result.observedSessions, 5);
    assert.deepEqual(result.postTurnoverDates, EXPECTED_POST);
  }
});

test('event pre-price requires 21 closes while pre-turnover requires exactly 20 sessions', () => {
  const result = resolveWindow(fixture());
  assert.deepEqual(result.prePriceDates, EXPECTED_PRE_PRICE);
  assert.deepEqual(result.preTurnoverDates, EXPECTED_PRE_PRICE.slice(1));
  assert.ok(Object.values(result.ranges).every(range => range.complete));
});

test('FIXED_WINDOW uses E-20..E prices and disjoint 20-session turnover windows', () => {
  const input = fixture();
  input.window = { mode: 'FIXED_WINDOW', endDate: '2026-03-27' };
  const result = resolveWindow(input);
  assert.equal(result.state, 'DISPLAY');
  assert.equal(result.t0, null);
  assert.equal(result.eventTimestamp, null);
  assert.equal(result.baseDate, '2026-02-26');
  assert.equal(result.endDate, '2026-03-27');
  assert.equal(result.priceDates.length, 21);
  assert.equal(result.prePriceDates.length, 21);
  assert.equal(result.prePriceDates[0], '2026-01-29');
  assert.equal(result.prePriceDates.at(-1), '2026-02-26');
  assert.equal(result.preTurnoverDates.length, 20);
  assert.equal(result.preTurnoverDates[0], '2026-01-30');
  assert.equal(result.preTurnoverDates.at(-1), '2026-02-26');
  assert.equal(result.postTurnoverDates.length, 20);
  assert.equal(result.postTurnoverDates[0], '2026-02-27');
  assert.equal(result.postTurnoverDates.at(-1), '2026-03-27');
  assert.equal(result.targetSessions, 20);
  assert.equal(result.observedSessions, 20);
  assert.equal(new Set([...result.preTurnoverDates, ...result.postTurnoverDates]).size, 40);
});

test('missing earliest pre-price date holds only that range', () => {
  const input = fixture();
  input.calendar.coverageStart = '2026-02-03';
  input.calendar.sessions = input.calendar.sessions.filter(session => session.date >= '2026-02-03');
  const result = resolveWindow(input);
  assert.equal(result.state, 'DISPLAY');
  assert.equal(result.ranges.price.complete, true);
  assert.equal(result.ranges.prePrice.complete, false);
  assert.deepEqual(result.ranges.prePrice.reasonCodes, ['CALENDAR_RANGE_INCOMPLETE']);
  assert.equal(result.ranges.preTurnover.complete, true);
  assert.equal(result.ranges.postTurnover.complete, true);
  assert.equal(result.prePriceDates.length, 20);
});

test('FIXED_WINDOW lacks E-40 without losing its valid E-20..E price range', () => {
  const input = fixture();
  input.window = { mode: 'FIXED_WINDOW', endDate: '2026-03-27' };
  input.calendar.coverageStart = '2026-01-30';
  input.calendar.sessions = input.calendar.sessions.filter(session => session.date >= '2026-01-30');
  const result = resolveWindow(input);
  assert.equal(result.ranges.price.complete, true);
  assert.equal(result.ranges.prePrice.complete, false);
  assert.equal(result.ranges.preTurnover.complete, true);
  assert.equal(result.prePriceDates.length, 20);
  assert.equal(result.priceDates.length, 21);
});

test('FIXED_WINDOW counts available return intervals when its price prefix is missing', () => {
  const input = fixture();
  input.window = { mode: 'FIXED_WINDOW', endDate: '2026-03-27' };
  input.calendar.coverageStart = '2026-03-16';
  input.calendar.sessions = input.calendar.sessions.filter(session => session.date >= '2026-03-16');
  const result = resolveWindow(input);
  assert.equal(result.priceDates.length, 10);
  assert.equal(result.observedSessions, 9);
  assert.equal(result.targetSessions, 20);
  assert.equal(result.baseDate, null);
  assert.equal(result.ranges.price.complete, false);
  assert.equal(result.postTurnoverDates.length, 10);
  assert.equal(result.ranges.postTurnover.complete, false);
});

test('missing previous close keeps the independently covered post-turnover range', () => {
  const input = fixture();
  input.calendar.coverageStart = '2026-03-03';
  input.calendar.sessions = input.calendar.sessions.filter(session => session.date >= '2026-03-03');
  const result = resolveWindow(input);
  assert.equal(result.baseDate, null);
  assert.equal(result.ranges.price.complete, false);
  assert.equal(result.ranges.prePrice.complete, false);
  assert.equal(result.ranges.preTurnover.complete, false);
  assert.equal(result.ranges.postTurnover.complete, true);
  assert.deepEqual(result.postTurnoverDates, EXPECTED_POST);
});

test('calendar input order is irrelevant and inputs are not mutated', () => {
  const input = fixture();
  input.calendar.sessions.reverse();
  const before = JSON.stringify(input);
  assert.deepEqual(resolveWindow(input), resolveWindow(fixture()));
  assert.equal(JSON.stringify(input), before);
});

test('equivalent offset timestamps produce the same session without rewriting the event timestamp', () => {
  const input = withEvent('2026-03-02T23:59:59Z');
  const result = resolveWindow(input);
  assert.equal(result.t0, '2026-03-03');
  assert.equal(result.eventTimestamp, '2026-03-02T23:59:59Z');
  assert.deepEqual(result.priceDates, resolveWindow(fixture()).priceDates);
});

test('timestamp civil date or KST date is allowed, but a contradictory date holds the window', () => {
  for (const date of ['2026-03-02', '2026-03-03']) {
    const input = withEvent('2026-03-02T23:59:59Z');
    input.window.event.publishedDate = date;
    const result = resolveWindow(input);
    assert.equal(result.state, 'DISPLAY');
    assert.equal(result.t0, '2026-03-03');
  }
  for (const date of ['2025-03-03', '2026-03-04']) {
    const input = fixture();
    input.window.event.publishedDate = date;
    const result = resolveWindow(input);
    assert.equal(result.state, 'HOLD');
    assert.ok(result.reasonCodes.includes('EVENT_DATE_MISMATCH'));
    assert.ok(Object.values(result.ranges).every(range => !range.complete));
  }
});

test('verified calendar may explicitly include a weekend session; no weekday fallback', () => {
  const input = fixture();
  input.calendar.sessions.push({ date: '2026-03-07', open: at('2026-03-07', '09:00:00'), close: at('2026-03-07', '15:30:00') });
  input.window.event = { precision: 'date', publishedDate: '2026-03-07' };
  assert.equal(resolveWindow(input).t0, '2026-03-07');
});

test('calendar and completion verification must be explicitly true', () => {
  for (const value of [undefined, false, 'true', 1]) {
    const input = fixture();
    input.calendar.verified = value;
    assert.ok(resolveWindow(input).reasonCodes.includes('CALENDAR_UNVERIFIED'));
    input.calendar.verified = true;
    input.completion.verified = value;
    assert.ok(resolveWindow(input).reasonCodes.includes('COMPLETION_UNVERIFIED'));
  }
});

test('invalid, duplicate and impossible sessions are rejected without repair', () => {
  const mutations = [
    value => value.sessions.push({ ...value.sessions[0] }),
    value => { value.sessions[0].date = '2026-02-30'; },
    value => { value.sessions[0].open = '2026-01-02T10:00:00'; },
    value => { value.sessions[0].close = at('2026-01-02', '09:00:00'); },
    value => { value.sessions[0].close = at('2026-01-03', '15:30:00'); },
    value => { value.timeZone = 'UTC'; },
    value => { value.version = ''; },
    value => { value.coverageStart = '2026-05-01'; },
    value => { value.sessions[0].date = '2025-12-31'; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input.calendar);
    const result = resolveWindow(input);
    assert.equal(result.state, 'HOLD');
    assert.ok(result.reasonCodes.includes('INVALID_CALENDAR'));
  }
});

test('unknown calendar coverage and events outside coverage do not infer sessions', () => {
  const missing = fixture();
  delete missing.calendar.coverageStart;
  assert.ok(resolveWindow(missing).reasonCodes.includes('CALENDAR_UNVERIFIED'));
  const outside = withEvent(at('2025-12-31'));
  assert.ok(resolveWindow(outside).reasonCodes.includes('CALENDAR_UNVERIFIED'));
  const noNextSession = withEvent(at('2026-04-10'));
  assert.ok(resolveWindow(noNextSession).reasonCodes.includes('CALENDAR_UNVERIFIED'));
});

test('asOf requires a real timestamp with explicit known timezone', () => {
  for (const asOf of [undefined, '2026-04-10', '2026-04-10T20:00:00', '2026-02-30T20:00:00+09:00', '2026-04-10T24:00:00+09:00', '2026-04-10T20:00:00+14:01', '2026-04-10T20:00:00-00:00']) {
    const result = resolveWindow({ ...fixture(), asOf });
    assert.equal(result.state, 'HOLD');
    assert.ok(result.reasonCodes.includes('INVALID_TIMESTAMP'));
  }
});

test('completion cannot use later evidence or confirm a session before it closes', () => {
  const lateEvidence = fixture('2026-03-05');
  lateEvidence.asOf = at('2026-03-05', '15:45:00');
  assert.ok(resolveWindow(lateEvidence).reasonCodes.includes('COMPLETION_UNVERIFIED'));
  const beforeClose = fixture('2026-03-05');
  beforeClose.completion.confirmedAt = at('2026-03-05', '15:00:00');
  assert.ok(resolveWindow(beforeClose).reasonCodes.includes('COMPLETION_UNVERIFIED'));
  const noPolicy = fixture();
  delete noPolicy.completion.policyVersion;
  assert.ok(resolveWindow(noPolicy).reasonCodes.includes('COMPLETION_UNVERIFIED'));
});

test('completion through a verified closed date uses the prior actual session', () => {
  const result = resolveWindow(fixture('2026-03-09'));
  assert.equal(result.endDate, '2026-03-06');
  assert.equal(result.observedSessions, 4);
  assert.equal(result.state, 'REFERENCE');
});

test('FIXED_WINDOW requires an exact confirmed end date and never moves it', () => {
  for (const [endDate, reason] of [
    [undefined, 'INVALID_WINDOW'], ['2026-02-30', 'INVALID_WINDOW'],
    ['2026-03-09', 'END_DATE_NOT_SESSION'], ['2026-03-10', 'END_DATE_NOT_COMPLETED'],
    ['2026-05-01', 'CALENDAR_UNVERIFIED'],
  ]) {
    const input = fixture('2026-03-06');
    input.window = { mode: 'FIXED_WINDOW', endDate };
    const result = resolveWindow(input);
    assert.equal(result.state, 'HOLD');
    assert.equal(result.endDate, null);
    assert.ok(result.reasonCodes.includes(reason));
  }
});

test('future event cannot be used at the snapshot cutoff', () => {
  const input = fixture('2026-03-02');
  assert.ok(resolveWindow(input).reasonCodes.includes('EVENT_AFTER_AS_OF'));
  input.window.event = { precision: 'date', publishedDate: '2026-03-03' };
  assert.ok(resolveWindow(input).reasonCodes.includes('EVENT_AFTER_AS_OF'));
});

test('invalid window shapes and policies return HOLD rather than throw', () => {
  for (const input of [undefined, null, [], 42, {}, { ...fixture(), window: null }, { ...fixture(), window: { mode: 'OTHER' } }]) {
    assert.equal(resolveWindow(input).state, 'HOLD');
  }
  for (const policy of [null, { eventSessions: 0 }, { eventSessions: undefined }, { preSessions: 1.5 }, { fixedIntervals: Number.NaN }]) {
    const result = resolveWindow(fixture(), policy);
    assert.equal(result.state, 'HOLD');
    assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
  }
  const input = fixture();
  input.window.event = { precision: 'timestamp', publishedAt: '2026-03-03T09:00:00' };
  assert.ok(resolveWindow(input).reasonCodes.includes('INVALID_TIMESTAMP'));
});

test('explicit policy controls target length and pre-periods without accessing wall clock', () => {
  const result = resolveWindow(fixture(), { eventSessions: 3, fixedIntervals: 10, preSessions: 2 });
  assert.equal(result.targetSessions, 3);
  assert.equal(result.observedSessions, 3);
  assert.equal(result.endDate, '2026-03-05');
  assert.deepEqual(result.prePriceDates, ['2026-02-26', '2026-02-27', '2026-03-02']);
  assert.deepEqual(result.preTurnoverDates, ['2026-02-27', '2026-03-02']);
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
});

test('full application policy interoperates with the isolated period resolver', () => {
  const expected = resolveWindow(fixture());
  const actual = resolveWindow(fixture(), actualPolicy);
  assert.equal(actual.state, 'DISPLAY');
  assert.deepEqual(actual, expected);
});

test('shared strict timestamp parser rejects invalid civil dates and unknown offsets', () => {
  assert.equal(parseTimestamp('2026-03-03T08:59:59+09:00'), Date.parse('2026-03-02T23:59:59Z'));
  assert.equal(parseTimestamp('2024-02-29T12:00:00.123Z'), Date.parse('2024-02-29T12:00:00.123Z'));
  for (const value of [null, undefined, '', '2026-02-29T12:00:00Z', '2026-02-30T12:00:00Z',
    '2026-03-03T09:00:00', '2026-03-03T24:00:00Z', '2026-03-03T12:00:60Z',
    '2026-03-03T12:00:00-00:00', '2026-03-03T12:00:00+15:00']) {
    assert.equal(parseTimestamp(value), null);
  }
});
