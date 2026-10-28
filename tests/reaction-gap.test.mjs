import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReactionGap } from '../server/reaction-gap/index.mjs';
import { fixture, fixedFixture, rowAt, clone, reference, values } from './fixtures/reaction-gap.mjs';

const first = input => calculateReactionGap(input).companies[0].metrics;
const amount = metric => metric.value?.decimal ?? null;
const hold = (metric, reason) => { assert.equal(metric.state, 'HOLD'); assert.equal(metric.value, null); assert.ok(metric.reasonCodes.includes(reason), metric.reasonCodes.join(', ')); };

test('G01/G02 PRICE_AND_BENCHMARK: exact return and percentage-point difference', () => {
  const input = fixture(), expected = reference('PRICE_AND_BENCHMARK').expected;
  const result = calculateReactionGap(input), m = result.companies[0].metrics;
  assert.equal(result.execution, 'COMPLETE');
  assert.equal(amount(m.priceReturn), expected.return_pct);
  assert.equal(amount(m.benchmarkReturn), expected.benchmark_return_pct);
  assert.equal(amount(m.benchmarkDifference), expected.difference_pp);
  assert.equal(m.benchmarkDifference.unit, 'PERCENTAGE_POINT');
  assert.equal(m.priceReturn.baseDate, m.benchmarkReturn.baseDate);
  assert.equal(m.priceReturn.endDate, m.benchmarkReturn.endDate);
  assert.equal(result.publication.allowed, false);
  assert.ok(result.publication.reasonCodes.includes('RIGHTS_UNCONFIRMED'));
});

test('G03/G04 TURNOVER_FULL_ARRAYS: 20 pre sessions, 5 post sessions', () => {
  const m = first(fixture()), expected = reference('TURNOVER_FULL_ARRAYS').expected;
  assert.equal(amount(m.turnover.preMean), expected.pre_mean);
  assert.equal(amount(m.turnover.postMean), expected.post_mean);
  assert.equal(amount(m.turnover.multiple), expected.ratio);
  assert.equal(m.turnover.preMean.observations, 20);
  assert.equal(m.turnover.postMean.observations, 5);
});

test('G05 TWENTY_INTERVALS_REQUIRE_21_CLOSES: inclusive prices, exclusive intervals', () => {
  const m = first(fixture()), expected = reference('TWENTY_INTERVALS_REQUIRE_21_CLOSES').expected;
  assert.equal(amount(m.preReturn), expected.pre_return_pct);
  assert.equal(m.preReturn.observations, expected.observations);
  assert.equal(m.preReturn.observedSessions, expected.intervals);
});

test('G06 DO_NOT_ESTIMATE_TURNOVER_FROM_CLOSE: actual field only, no close-times-volume fallback', () => {
  const input = fixture(), original = reference('DO_NOT_ESTIMATE_TURNOVER_FROM_CLOSE');
  for (const row of input.candidates[0].turnover.rows) row.value = original.expected.actual_turnover;
  assert.equal(amount(first(input).turnover.postMean), '300000');
  input.candidates[0].turnover.contract.measure = 'CLOSE_TIMES_VOLUME';
  for (const row of input.candidates[0].turnover.rows) row.value = original.expected.close_times_volume;
  hold(first(input).turnover.multiple, 'MISSING_ACTUAL_TURNOVER');
  delete input.candidates[0].turnover;
  for (const row of input.candidates[0].price.rows) row.volume = original.input.total_volume;
  hold(first(input).turnover.postMean, 'MISSING_ACTUAL_TURNOVER');
  assert.equal(amount(first(input).priceReturn), '2');
});

test('G07 SPLIT_ONLY_NO_ECONOMIC_PRICE_MOVE: verified adjusted prices, untouched turnover', () => {
  const input = fixture(), s = input.candidates[0].price;
  rowAt(input, 'price', 44).value = '5000';
  for (let i = 45; i <= 49; i++) rowAt(input, 'price', i).value = '5000';
  s.contract.adjustmentMethod = 'SPLIT_ADJUSTED_PRICE';
  assert.equal(amount(first(input).priceReturn), reference('SPLIT_ONLY_NO_ECONOMIC_PRICE_MOVE').expected.comparable_price_return_pct);
  assert.equal(amount(first(input).turnover.multiple), '1.1');
  rowAt(input, 'price', 44).value = '10000';
  s.contract.corporateActionsVerified = false;
  hold(first(input).priceReturn, 'ADJUSTMENT_UNVERIFIED');
  assert.equal(amount(first(input).turnover.postMean), '11000000000');
});

test('G08 COMMON_BENCHMARK_NOT_SECOND_GAP_SIGNAL: one gap and no duplicate score', () => {
  const input = fixture(), expected = reference('COMMON_BENCHMARK_NOT_SECOND_GAP_SIGNAL').expected;
  for (let i = 45; i <= 49; i++) { rowAt(input, 'price', i).value = '11800'; rowAt(input, 'price', i, 1).value = '10200'; }
  const result = calculateReactionGap(input);
  assert.equal(amount(result.companies[0].metrics.benchmarkDifference), expected.excess_a_pp);
  assert.equal(amount(result.companies[1].metrics.benchmarkDifference), expected.excess_b_pp);
  assert.equal(amount(result.comparisons[0]), expected.raw_gap_pp);
  assert.equal(result.comparisons[0].independentSignalCount, 1);
  assert.equal(result.comparisons.length, 1);
  assert.equal('score' in result, false);
});

test('TURNOVER_ABSENT_PRICE_STILL_USABLE: independent metric states', () => {
  const input = fixture(); input.candidates[0].turnover = null;
  const m = first(input), expected = reference('TURNOVER_ABSENT_PRICE_STILL_USABLE').expected;
  assert.equal(amount(m.priceReturn), expected.return_pct);
  hold(m.turnover.multiple, expected.turnover_reason);
  assert.equal(amount(m.benchmarkDifference), '-2');
  assert.equal(amount(m.preReturn), '25');
  assert.equal(calculateReactionGap(input).execution, 'PARTIAL');
});

test('LOW_BASE_RATIO_IS_NOT_ABSOLUTE_ACTIVITY: preserve amounts and evidence order', () => {
  const input = fixture(), item = reference('LOW_BASE_RATIO_IS_NOT_ABSOLUTE_ACTIVITY');
  for (const [c, prefix] of input.candidates.map((c, i) => [c, i === 0 ? 'a' : 'b'])) {
    for (const row of c.turnover.rows) row.value = row.date < input.calendar.sessions[45].date ? item.input[`${prefix}_pre_mean`] : item.input[`${prefix}_post_mean`];
  }
  const result = calculateReactionGap(input), [a, b] = result.companies.map(c => c.metrics.turnover);
  assert.equal(amount(a.multiple), item.expected.a_ratio);
  assert.equal(amount(b.multiple), item.expected.b_ratio);
  assert.equal(amount(a.postMean), '1000000000');
  assert.equal(amount(b.postMean), '20000000000');
  assert.equal(a.interpretation, 'RELATIVE_ACTIVITY_NOT_ABSOLUTE_SCALE');
  assert.deepEqual(result.companies.map(c => c.id), ['TEST:A', 'TEST:B']);
  assert.equal(result.cohort.priceRanked, false);
});

test('EVENT 0/5 is held, 1/5 and 3/5 are reference only, 5/5 is display', () => {
  for (const observed of [0, 1, 3, 5]) {
    const result = calculateReactionGap(fixture({ observed }));
    assert.equal(result.period.observedSessions, observed);
    assert.equal(result.period.targetSessions, 5);
    assert.equal(result.companies[0].metrics.priceReturn.state, observed === 0 ? 'HOLD' : observed < 5 ? 'REFERENCE' : 'DISPLAY');
    if (observed === 3) assert.equal(amount(result.companies[0].metrics.turnover.postMean), '10000000000');
    if (observed === 1) assert.equal(amount(result.companies[0].metrics.turnover.postMean), '9000000000');
  }
});

test('EVENT after 8 and 30 calendar days retains t0..t4 despite later price/turnover changes', () => {
  const original = fixture(), expected = calculateReactionGap(original);
  for (const days of [8, 30]) {
    const input = clone(original);
    input.asOf = new Date(Date.parse(input.window.event.publishedAt) + days * 86400000 + 10 * 3600000).toISOString();
    input.completion.through = input.asOf.slice(0, 10); input.completion.confirmedAt = input.asOf;
    for (const c of input.candidates) for (const kind of ['price', 'turnover']) for (const row of c[kind].rows) if (row.date > input.calendar.sessions[49].date) row.value = '999999999999';
    const result = calculateReactionGap(input);
    assert.deepEqual(values(result), values(expected));
    assert.deepEqual(result.period, expected.period);
    assert.equal(result.period.endDate, input.calendar.sessions[49].date);
  }
});

test('FIXED_WINDOW independent oracle: E-40/E-20/E prices and disjoint pre/post turnover', () => {
  const input = fixedFixture();
  // Literal oracle: 10000 -> 15000 -> 18000; daily turnover i*1,000,000
  // for i=10..49 produces means 19,500,000 and 39,500,000, ratio 79/39.
  const result = calculateReactionGap(input), m = result.companies[0].metrics;
  assert.equal(result.period.priceDates.length, 21);
  assert.deepEqual([result.period.priceDates[0], result.period.priceDates.at(-1)], [input.calendar.sessions[39].date, input.calendar.sessions[59].date]);
  assert.deepEqual([result.period.prePriceDates[0], result.period.prePriceDates.at(-1)], [input.calendar.sessions[19].date, input.calendar.sessions[39].date]);
  assert.deepEqual([result.period.preTurnoverDates[0], result.period.preTurnoverDates.at(-1)], [input.calendar.sessions[20].date, input.calendar.sessions[39].date]);
  assert.deepEqual([result.period.postTurnoverDates[0], result.period.postTurnoverDates.at(-1)], [input.calendar.sessions[40].date, input.calendar.sessions[59].date]);
  assert.equal(amount(m.priceReturn), '20'); assert.equal(amount(m.preReturn), '50');
  assert.equal(amount(m.turnover.preMean), '19500000'); assert.equal(amount(m.turnover.postMean), '39500000');
  assert.equal(m.turnover.multiple.value.numerator, '79'); assert.equal(m.turnover.multiple.value.denominator, '39');
  assert.equal(m.turnover.multiple.value.display, '2.03'); assert.equal(m.turnover.multiple.value.decimalIsExact, false);
});

test('EVENT in calendar but missing historical prefix only holds pre metrics', () => {
  const input = fixture(); input.calendar.sessions = input.calendar.sessions.slice(30); input.calendar.coverageStart = input.calendar.sessions[0].date;
  const m = first(input);
  assert.equal(amount(m.priceReturn), '2'); assert.equal(amount(m.turnover.postMean), '11000000000');
  hold(m.preReturn, 'CALENDAR_RANGE_INCOMPLETE'); hold(m.turnover.preMean, 'CALENDAR_RANGE_INCOMPLETE'); hold(m.turnover.multiple, 'CALENDAR_RANGE_INCOMPLETE');
});

test('scope mismatch holds turnover while preserving independent returns', () => {
  const input = fixture(); rowAt(input, 'turnover', 45).contract = { venueScope: 'KRX_PLUS_NXT' };
  const m = first(input); hold(m.turnover.multiple, 'SCOPE_MISMATCH'); assert.equal(amount(m.priceReturn), '2');
});

test('source precision beyond Number range survives normalization, arithmetic and JSON serialization', () => {
  const input = fixture();
  for (const row of input.candidates[0].price.rows) row.value = '9007199254740993';
  rowAt(input, 'price', 49).value = '9007199254740994';
  for (const row of input.candidates[0].turnover.rows) row.value = '9007199254740993.123456789123456789';
  const m = JSON.parse(JSON.stringify(first(input)));
  assert.equal(m.priceReturn.value.numerator, '100'); assert.equal(m.priceReturn.value.denominator, '9007199254740993');
  assert.equal(amount(m.turnover.preMean), '9007199254740993.123456789123456789');
  assert.equal(m.turnover.preMean.value.numerator, '9007199254740993123456789123456789');
  assert.equal(m.turnover.preMean.value.denominator, '1000000000000000000');
  assert.equal(m.turnover.preMean.provenance[0].lineage[0].originalValue, '9007199254740993.123456789123456789');
});

test('negative returns and repeating values have exact fractions and half-away display rounding', () => {
  const input = fixture(); for (const row of input.candidates[0].price.rows) row.value = '3'; rowAt(input, 'price', 49).value = '2';
  const v = first(input).priceReturn.value;
  assert.equal(v.numerator, '-100'); assert.equal(v.denominator, '3');
  assert.equal(v.decimal, '-33.333333333333333333'); assert.equal(v.display, '-33.3'); assert.equal(v.decimalIsExact, false);
  for (const row of input.candidates[0].price.rows) row.value = '2000'; rowAt(input, 'price', 49).value = '1999';
  assert.equal(first(input).priceReturn.value.display, '-0.1');
});

test('metamorphic: row, candidate and calendar permutations preserve complete output', () => {
  const input = fixture(), expected = calculateReactionGap(input), reordered = clone(input);
  reordered.calendar.sessions.reverse(); reordered.candidates.reverse(); reordered.benchmarks.reverse();
  for (const c of reordered.candidates) { c.price.rows.reverse(); c.turnover.rows.reverse(); }
  for (const b of reordered.benchmarks) b.rows.reverse();
  assert.deepEqual(calculateReactionGap(reordered), expected);
});

test('metamorphic: common price multiplier preserves returns and gaps', () => {
  const input = fixture(), expected = values(calculateReactionGap(input));
  for (const c of input.candidates) for (const row of c.price.rows) row.value = String(BigInt(row.value) * 7n);
  for (const b of input.benchmarks) for (const row of b.rows) row.value = String(BigInt(row.value) * 7n);
  assert.deepEqual(values(calculateReactionGap(input)), expected);
});

test('metamorphic: turnover multiplier preserves ratio and changes absolute means', () => {
  const input = fixture(), expected = first(input);
  for (const c of input.candidates) for (const row of c.turnover.rows) row.value = String(BigInt(row.value) * 7n);
  const m = first(input);
  assert.deepEqual(m.turnover.multiple.value, expected.turnover.multiple.value);
  assert.equal(amount(m.turnover.preMean), '70000000000'); assert.equal(amount(m.turnover.postMean), '77000000000');
  assert.deepEqual(m.priceReturn.value, expected.priceReturn.value);
});

test('pure/replayable: frozen input unchanged, deterministic output, no live publication', () => {
  const input = fixture(), before = clone(input);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); } }; freeze(input);
  const firstResult = calculateReactionGap(input); assert.deepEqual(calculateReactionGap(input), firstResult); assert.deepEqual(input, before);
  const withRights = clone(input); withRights.rights = { verified: true, redisplay: true, internalCalculation: true };
  assert.equal(calculateReactionGap(withRights).publication.allowed, false);
  assert.equal(calculateReactionGap(withRights).liveIntegration, false);
});

test('unconfirmed provider contracts and source state never default to verified display', () => {
  const input = fixture(); delete input.candidates[0].price.contract.verification;
  hold(first(input).priceReturn, 'CONTRACT_UNVERIFIED');
  assert.equal(amount(first(input).turnover.postMean), '11000000000');
  const unknown = fixture(); delete unknown.candidates[0].price.contract.upstreamStatus;
  assert.equal(first(unknown).priceReturn.state, 'REFERENCE');
  assert.ok(first(unknown).priceReturn.reasonCodes.includes('UPSTREAM_STATE_UNVERIFIED'));
});

test('event ID/version is required, and benchmark currency cannot be guessed', () => {
  for (const field of ['id', 'version']) {
    const input = fixture(); delete input.window.event[field];
    const result = calculateReactionGap(input); assert.equal(result.execution, 'INVALID_INPUT'); assert.ok(result.reasonCodes.includes('EVENT_ID_REQUIRED'));
  }
  const input = fixture(); input.benchmarks[0].contract.currency = 'USD';
  hold(first(input).benchmarkDifference, 'BENCHMARK_DEFINITION_MISMATCH'); assert.equal(amount(first(input).priceReturn), '2');
});

test('calculation never reads current clock or calls global fetch', () => {
  const input = fixture(), expected = values(calculateReactionGap(input));
  const originalDateNow = Date.now, originalFetch = globalThis.fetch;
  try {
    Date.now = () => { throw new Error('Current clock access prohibited'); };
    globalThis.fetch = () => { throw new Error('Network access prohibited'); };
    assert.deepEqual(values(calculateReactionGap(input)), expected);
  } finally { Date.now = originalDateNow; globalThis.fetch = originalFetch; }
});

test('late snapshot cannot replace an earlier caller-owned input or alter repeated request results', () => {
  const earlier = fixture(), expected = calculateReactionGap(earlier), later = clone(earlier);
  later.snapshotId = 'TEST_ONLY-snapshot-2'; later.asOf = `${later.calendar.sessions[50].date}T18:00:00+09:00`;
  for (const c of later.candidates) for (const kind of ['price', 'turnover']) c[kind].contract.snapshotId = later.snapshotId;
  for (const b of later.benchmarks) b.contract.snapshotId = later.snapshotId;
  const corrected = clone(rowAt(later, 'price', 49));
  corrected.value = '10500'; corrected.revision = 'r2'; corrected.revisionVerified = true; corrected.supersedes = ['r1']; corrected.observedAt = later.asOf;
  later.candidates[0].price.rows.push(corrected);
  assert.equal(amount(first(later).priceReturn), '5');
  assert.deepEqual(calculateReactionGap(earlier), expected);
  // Pure replay isolation only; this is NOT a queue late-completion/fencing test.
});

test('a later correction cannot legitimize a cyclic or self-referential revision history', () => {
  const input = fixture(), original = rowAt(input, 'price', 49);
  Object.assign(original, { revisionVerified: true, supersedes: ['r2'] });
  input.candidates[0].price.rows.push({ ...clone(original), value: '10300', revision: 'r2', supersedes: ['r1'] });
  input.candidates[0].price.rows.push({ ...clone(original), value: '10400', revision: 'r3', supersedes: ['r2'] });
  hold(first(input).priceReturn, 'REVISION_LINEAGE_INVALID');
  const self = fixture(); Object.assign(rowAt(self, 'price', 49), { revisionVerified: true, supersedes: ['r1'] });
  hold(first(self).priceReturn, 'REVISION_LINEAGE_INVALID');
});

test('post scope failure preserves valid pre mean, and pre scope failure preserves valid post mean', () => {
  const postFailure = fixture(); rowAt(postFailure, 'turnover', 45).contract = { venueScope: 'KRX_PLUS_NXT' };
  assert.equal(amount(first(postFailure).turnover.preMean), '10000000000');
  hold(first(postFailure).turnover.multiple, 'SCOPE_MISMATCH');
  const preFailure = fixture(); rowAt(preFailure, 'turnover', 25).contract = { venueScope: 'KRX_PLUS_NXT' };
  assert.equal(amount(first(preFailure).turnover.postMean), '11000000000');
  hold(first(preFailure).turnover.multiple, 'SCOPE_MISMATCH');
});
