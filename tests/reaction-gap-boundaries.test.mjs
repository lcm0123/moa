// TEST_ONLY. Adversarial expectations are literal policy assertions, never
// regenerated from calculateReactionGap output or a production data response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReactionGap } from '../server/reaction-gap/index.mjs';
import {publicationTimeReasons} from '../server/reaction-gap/input.mjs';
import { fixture, rowAt, clone, fixedFixture } from './fixtures/reaction-gap.mjs';

const metrics = (result, index = 0) => result.companies[index].metrics;
const expectValue = (metric, decimal, display) => {
  assert.notEqual(metric.value, null);
  assert.equal(metric.value.decimal, decimal);
  if (display !== undefined) assert.equal(metric.value.display, display);
};
const expectHold = (metric, reason) => {
  assert.equal(metric.value, null);
  assert.equal(metric.state, 'HOLD');
  if (reason) assert.ok(metric.reasonCodes.includes(reason), `${reason}: ${metric.reasonCodes.join(', ')}`);
};
const changeRows = (input, kind, first, last, edit, candidate = 0) => {
  for (let index = first; index <= last; index++) edit(rowAt(input, kind, index, candidate), index);
};

for(const informationMode of ['AS_KNOWN','RETROSPECTIVE'])test(`FIXED_WINDOW accepts demonstrably earlier date-only business evidence in ${informationMode} without an invented timestamp`,()=>{
 const input=fixedFixture();input.informationMode=informationMode;
 for(const c of input.candidates){c.relationship.publishedAt=null;c.relationship.publishedDate='2029-12-01';}
 const result=calculateReactionGap(input);
 for(const c of result.companies){expectValue(c.metrics.priceReturn,'20','20.0');assert.equal(c.relationship.publishedAt,null);assert.equal(c.relationship.publishedDate,'2029-12-01');}
 expectValue(result.comparisons[0],'0','0.0');assert.equal(result.period.eventTimestamp,null);
 assert.equal(result.period.baseDate,input.calendar.sessions[39].date);assert.equal(result.period.endDate,input.calendar.sessions[59].date);
});

test('date-only publication cannot move the AS_KNOWN knowledge cutoff to retrospective asOf',()=>{
 const input=fixedFixture();input.candidates[0].relationship.publishedAt=null;
 input.candidates[0].relationship.publishedDate=input.calendar.sessions[50].date;
 expectHold(metrics(calculateReactionGap(input)).priceReturn,'EVIDENCE_AFTER_CUTOFF');
 input.informationMode='RETROSPECTIVE';expectValue(metrics(calculateReactionGap(input)).priceReturn,'20');
});

test('same-cutoff-day or timezone-ambiguous date-only publication remains held',()=>{
 for(const publishedDate of ['2030-03-25','2030-03-24']){
  const input=fixedFixture();input.informationMode='RETROSPECTIVE';input.asOf='2030-03-25T00:00:00+09:00';
  input.completion.confirmedAt=input.asOf;input.cohort.frozenAt=input.cohort.knowledgeCutoff='2030-03-01T00:00:00Z';
  input.candidates[0].relationship.publishedAt=null;input.candidates[0].relationship.publishedDate=publishedDate;
  assert(calculateReactionGap(input).companies[0].reasonCodes.includes('EVIDENCE_TIME_UNVERIFIED'));
 }
});

test('date-only evidence does not waive observed-at cutoff or malformed explicit timestamp checks',()=>{
 const input=fixedFixture();input.candidates[0].relationship.publishedAt=null;input.candidates[0].relationship.publishedDate='2029-12-01';
 input.candidates[0].relationship.firstObservedAt='2031-01-01T00:00:00Z';
 expectHold(metrics(calculateReactionGap(input)).priceReturn,'EVIDENCE_AFTER_CUTOFF');
 input.candidates[0].relationship.firstObservedAt=input.cohort.knowledgeCutoff;
 input.candidates[0].relationship.publishedAt='2029-12-01T08:00:00';
 expectHold(metrics(calculateReactionGap(input)).priceReturn,'EVIDENCE_TIME_UNVERIFIED');
});

test('date-only eligibility bounds retain precision and reject missing or impossible civil dates',()=>{
 const publication={publishedAt:null,publishedDate:'2030-03-01'};
 assert.deepEqual(publicationTimeReasons(publication,'2030-03-02T14:00:00Z'),[]);
 assert.deepEqual(publicationTimeReasons(publication,'2030-03-02T13:59:59.999Z'),['EVIDENCE_TIME_UNVERIFIED']);
 assert.deepEqual(publicationTimeReasons(publication,'2030-02-28T09:59:59Z'),['EVIDENCE_AFTER_CUTOFF']);
 for(const invalid of [null,{}, {publishedAt:null,publishedDate:'2030-02-30'}])assert.deepEqual(publicationTimeReasons(invalid,'2030-03-10T00:00:00Z'),['EVIDENCE_TIME_UNVERIFIED']);
 assert.deepEqual(publication,{publishedAt:null,publishedDate:'2030-03-01'});
});

test('invalid envelope is an explicit result with no companies or numeric comparisons', () => {
  for (const input of [null, undefined, [], 'invalid', 42, {}]) {
    const result = calculateReactionGap(input);
    assert.equal(result.execution, 'INVALID_INPUT');
    assert.deepEqual(result.companies, []);
    assert.deepEqual(result.comparisons, []);
    assert.equal(result.publication.allowed, false);
  }
});

for (const [label, edit, reason] of [
  ['wrong schema', input => { input.schemaVersion = 'future-schema'; }, 'INPUT_VERSION_MISMATCH'],
  ['missing snapshot', input => { delete input.snapshotId; }, 'SNAPSHOT_REQUIRED'],
  ['missing knowledge mode', input => { delete input.informationMode; }, 'INFORMATION_MODE_REQUIRED'],
  ['duplicate candidates', input => { input.candidates.push(clone(input.candidates[0])); }, 'DUPLICATE_OR_INVALID_ID'],
  ['duplicate benchmarks', input => { input.benchmarks.push(clone(input.benchmarks[0])); }, 'DUPLICATE_OR_INVALID_ID'],
  ['duplicate frozen IDs', input => { input.cohort.orderedAssetIds.push('TEST:A'); }, 'INVALID_COHORT'],
  ['cohort after snapshot', input => { input.cohort.frozenAt = '2031-01-01T08:00:00+09:00'; }, 'COHORT_AFTER_ASOF'],
]) {
  test(`envelope rejects ${label}`, () => {
    const input = fixture(); edit(input);
    const result = calculateReactionGap(input);
    assert.equal(result.execution, 'INVALID_INPUT');
    assert.ok(result.reasonCodes.includes(reason));
  });
}

for (const [label, suffix] of [
  ['24-hour rollover', 'T24:00:00+09:00'],
  ['unknown UTC offset', 'T08:00:00-00:00'],
  ['out-of-range offset', 'T08:00:00+15:00'],
  ['timezone absent', 'T08:00:00'],
]) {
  test(`timestamps reject ${label} in envelope, evidence and source observations`, () => {
    let input = fixture();
    input.asOf = input.calendar.sessions[49].date + suffix;
    assert.equal(calculateReactionGap(input).execution, 'INVALID_INPUT');

    input = fixture();
    input.candidates[0].relationship.firstObservedAt = input.calendar.sessions[40].date + suffix;
    let result = calculateReactionGap(input);
    expectHold(metrics(result).priceReturn, 'EVIDENCE_TIME_UNVERIFIED');
    expectValue(metrics(result, 1).priceReturn, '18');

    input = fixture();
    rowAt(input, 'price', 44).observedAt = input.calendar.sessions[44].date + suffix;
    result = calculateReactionGap(input);
    expectHold(metrics(result).priceReturn, 'OBSERVATION_TIME_UNVERIFIED');
    expectValue(metrics(result, 1).priceReturn, '18');
  });
}

test('T04 date-only mode keeps timestamp null and comparison at reference status', () => {
  const input = fixture({ mode: 'DATE_REFERENCE' });
  input.window.event.publishedAt = null;
  const result = calculateReactionGap(input);
  assert.equal(result.period.mode, 'DATE_REFERENCE');
  assert.equal(result.period.eventTimestamp, null);
  assert.equal(result.period.t0, input.calendar.sessions[45].date);
  expectValue(metrics(result).priceReturn, '2');
  assert.equal(metrics(result).priceReturn.state, 'REFERENCE');
  assert.ok(metrics(result).priceReturn.reasonCodes.includes('DATE_REFERENCE'));
  assert.equal(result.comparisons[0].state, 'REFERENCE');
});

test('T01 intraday event remains daily reference and preserves previous-close baseline', () => {
  const input = fixture();
  input.window.event.publishedAt = `${input.calendar.sessions[45].date}T12:00:00+09:00`;
  const result = calculateReactionGap(input);
  assert.equal(result.period.baseDate, input.calendar.sessions[44].date);
  expectValue(metrics(result).priceReturn, '2');
  assert.ok(metrics(result).priceReturn.reasonCodes.includes('INTRADAY_REFERENCE'));
  assert.equal(result.comparisons[0].state, 'REFERENCE');
});

test('T05 three completed sessions use three post amounts, not a five-day denominator', () => {
  const input = fixture({ observed: 3 });
  const result = calculateReactionGap(input);
  assert.equal(result.period.observedSessions, 3);
  assert.equal(result.period.targetSessions, 5);
  assert.equal(result.period.endDate, input.calendar.sessions[47].date);
  expectValue(metrics(result).turnover.postMean, '10000000000');
  expectValue(metrics(result).turnover.multiple, '1', '1.00');
  assert.equal(metrics(result).turnover.postMean.observations, 3);
  assert.ok(metrics(result).priceReturn.reasonCodes.includes('OBSERVATION_INCOMPLETE'));
});

test('T06 missing B common endpoint holds B only and never moves shared end date', () => {
  const input = fixture();
  const endDate = input.calendar.sessions[49].date;
  input.candidates[1].price.rows = input.candidates[1].price.rows.filter(row => row.date !== endDate);
  const result = calculateReactionGap(input);
  assert.equal(result.period.endDate, endDate);
  expectValue(metrics(result).priceReturn, '2');
  expectHold(metrics(result, 1).priceReturn, 'ENDPOINT_MISSING');
  expectValue(metrics(result, 1).turnover.multiple, '1.1');
  assert.equal(metrics(result, 1).priceReturn.endDate, endDate);
  assert.equal(result.comparisons[0].value, null);
  assert.equal(result.execution, 'PARTIAL');
});

test('T07 evidence first discovered after knowledge cutoff is excluded from as-known comparison', () => {
  const input = fixture();
  input.candidates[0].relationship.firstObservedAt = `${input.calendar.sessions[46].date}T08:00:00+09:00`;
  let result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'EVIDENCE_AFTER_CUTOFF');
  expectValue(metrics(result, 1).priceReturn, '18');
  assert.equal(result.companies[0].comparisonEligible, false);

  input.informationMode = 'RETROSPECTIVE';
  input.cohort.version = '2-current-retrospective';
  result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  assert.equal(metrics(result).priceReturn.state, 'REFERENCE');
  assert.ok(metrics(result).priceReturn.reasonCodes.includes('RETROSPECTIVE_COMPARISON'));
  assert.equal(result.informationMode, 'RETROSPECTIVE');
});

test('unverified completion holds values instead of inferring completion from wall time', () => {
  const input = fixture(); input.completion.verified = false;
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'COMPLETION_UNVERIFIED');
  expectHold(metrics(result).turnover.multiple, 'COMPLETION_UNVERIFIED');
  assert.equal(result.execution, 'HELD');
});

test('D02 venue transition holds incompatible ratio while valid price survives', () => {
  const input = fixture();
  changeRows(input, 'turnover', 45, 49, row => { row.contract = { venueScope: 'KRX_PLUS_NXT' }; });
  const result = calculateReactionGap(input);
  expectHold(metrics(result).turnover.multiple, 'SCOPE_MISMATCH');
  expectValue(metrics(result).priceReturn, '2');
});

test('D02 integrated plus component duplicate is never summed into actual turnover', () => {
  const input = fixture();
  const integrated = clone(rowAt(input, 'turnover', 49));
  integrated.contract = { venueScope: 'KRX_PLUS_NXT' };
  integrated.value = '15000000000';
  integrated.sourceId = 'TEST_ONLY-integrated';
  integrated.rawSnapshotId = 'TEST_ONLY-integrated-49';
  input.candidates[0].turnover.rows.push(integrated);
  const result = calculateReactionGap(input);
  expectHold(metrics(result).turnover.multiple, 'CONFLICTING_OBSERVATIONS');
  expectValue(metrics(result).priceReturn, '2');
});

test('D03 after-hours-inclusive turnover is not combined with regular closing prices', () => {
  const input = fixture();
  input.candidates[0].turnover.contract.sessionScope = 'REGULAR_AND_AFTER_HOURS';
  const result = calculateReactionGap(input);
  expectHold(metrics(result).turnover.multiple, 'SESSION_MISMATCH');
  expectValue(metrics(result).priceReturn, '2');
});

test('D04 one missing pre-day holds 20-session denominator and preserves post mean', () => {
  const input = fixture();
  const missing = input.calendar.sessions[25].date;
  input.candidates[0].turnover.rows = input.candidates[0].turnover.rows.filter(row => row.date !== missing);
  const result = calculateReactionGap(input);
  expectHold(metrics(result).turnover.preMean, 'INCOMPLETE_PRE_WINDOW');
  expectHold(metrics(result).turnover.multiple, 'INCOMPLETE_PRE_WINDOW');
  expectValue(metrics(result).turnover.postMean, '11000000000');
  expectValue(metrics(result).priceReturn, '2');
});

test('D04 twenty actual zero values are zero mean with null ratio, not missing', () => {
  const input = fixture();
  changeRows(input, 'turnover', 25, 44, row => { row.value = '0'; });
  const result = calculateReactionGap(input);
  expectValue(metrics(result).turnover.preMean, '0', '0.00');
  expectHold(metrics(result).turnover.multiple, 'ZERO_BASE_TURNOVER');
  assert.ok(!metrics(result).turnover.preMean.reasonCodes.includes('MISSING_ACTUAL_TURNOVER'));
  expectValue(metrics(result).priceReturn, '2');
});

for (const invalid of ['-1', 'NaN', 'Infinity', '1e10', 123]) {
  test(`D04 invalid turnover ${String(invalid)} is held without erasing valid price`, () => {
    const input = fixture(); rowAt(input, 'turnover', 25).value = invalid;
    const result = calculateReactionGap(input);
    expectHold(metrics(result).turnover.multiple, 'INVALID_INPUT');
    expectValue(metrics(result).priceReturn, '2');
  });
}

test('D05 explicit thousand/million units normalize before exact means and ratio', () => {
  const input = fixture();
  changeRows(input, 'turnover', 25, 44, row => { row.value = '10000000'; row.contract = { unit: 'THOUSAND_KRW' }; });
  changeRows(input, 'turnover', 45, 49, row => { row.value = '11000'; row.contract = { unit: 'MILLION_KRW' }; });
  const result = calculateReactionGap(input);
  expectValue(metrics(result).turnover.preMean, '10000000000');
  expectValue(metrics(result).turnover.postMean, '11000000000');
  expectValue(metrics(result).turnover.multiple, '1.1');
  assert.equal(metrics(result).turnover.preMean.provenance[0].lineage[0].originalUnit, 'THOUSAND_KRW');
  assert.equal(metrics(result).turnover.postMean.provenance[0].lineage[0].originalUnit, 'MILLION_KRW');
});

test('D05 integer amounts above Number safe range preserve every source digit', () => {
  const input = fixture();
  changeRows(input, 'turnover', 25, 44, row => { row.value = '9007199254740993'; });
  changeRows(input, 'turnover', 45, 49, row => { row.value = '27021597764222979'; });
  const result = calculateReactionGap(input);
  expectValue(metrics(result).turnover.preMean, '9007199254740993');
  expectValue(metrics(result).turnover.postMean, '27021597764222979');
  expectValue(metrics(result).turnover.multiple, '3', '3.00');
});

test('D05 unknown unit and wrong currency are held explicitly', () => {
  for (const edit of [contract => { contract.unit = 'UNKNOWN_SCALE'; }, contract => { contract.currency = 'USD'; }]) {
    const input = fixture(); edit(input.candidates[0].turnover.contract);
    const result = calculateReactionGap(input);
    expectHold(metrics(result).turnover.multiple, 'UNIT_MISMATCH');
    expectValue(metrics(result).priceReturn, '2');
  }
});

test('D06 identical repeated date preserves source lineage with one observation', () => {
  const input = fixture();
  const repeated = clone(rowAt(input, 'price', 49));
  repeated.sourceId = 'TEST_ONLY-second-transport';
  repeated.rawSnapshotId = 'TEST_ONLY-repeat-49';
  input.candidates[0].price.rows.push(repeated);
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  assert.equal(metrics(result).priceReturn.observations, 6);
  assert.equal(metrics(result).priceReturn.provenance.at(-1).lineage.length, 2);
  assert.ok(metrics(result).priceReturn.rawSnapshotIds.includes('TEST_ONLY-repeat-49'));
  input.candidates[0].price.rows.reverse();
  const reversed = calculateReactionGap(input);
  assert.deepEqual(metrics(reversed).priceReturn, metrics(result).priceReturn);
});

test('D06 conflicting observations without verified correction lineage are held', () => {
  const input = fixture();
  const correction = { ...clone(rowAt(input, 'price', 49)), value: '10300', revision: 'r2', supersedes: ['r1'], revisionVerified: false };
  input.candidates[0].price.rows.push(correction);
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'CONFLICTING_OBSERVATIONS');
  expectHold(metrics(result).benchmarkDifference, 'CONFLICTING_OBSERVATIONS');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('D06 verified correction replaces exact value and retains superseded raw lineage', () => {
  const input = fixture();
  const correction = { ...clone(rowAt(input, 'price', 49)), value: '10300', revision: 'r2', supersedes: ['r1'], revisionVerified: true, rawSnapshotId: 'TEST_ONLY-corrected-49' };
  input.candidates[0].price.rows.push(correction);
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '3');
  expectValue(metrics(result).benchmarkDifference, '-1');
  const last = metrics(result).priceReturn.provenance.at(-1);
  assert.equal(last.lineage[0].revision, 'r2');
  assert.equal(last.lineage[0].originalValue, '10300');
  assert.equal(last.supersededLineage[0].revision, 'r1');
  assert.equal(last.supersededLineage[0].originalValue, '10200');
});

test('D06 future correction cannot alter historical snapshot even with supersession proof', () => {
  const input = fixture();
  const correction = { ...clone(rowAt(input, 'price', 49)), value: '10300', revision: 'r2', supersedes: ['r1'], revisionVerified: true, observedAt: `${input.calendar.sessions[50].date}T16:00:00+09:00`, rawSnapshotId: 'TEST_ONLY-future-correction' };
  input.candidates[0].price.rows.push(correction);
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  assert.ok(!metrics(result).priceReturn.rawSnapshotIds.includes('TEST_ONLY-future-correction'));
});

test('D06 ambiguous cyclic corrections never pick an arbitrary latest row', () => {
  const input = fixture();
  const first = rowAt(input, 'price', 49);
  first.revisionVerified = true; first.supersedes = ['r2'];
  input.candidates[0].price.rows.push({ ...clone(first), value: '10300', revision: 'r2', supersedes: ['r1'] });
  expectHold(metrics(calculateReactionGap(input)).priceReturn, 'CONFLICTING_OBSERVATIONS');
});

test('D07 raw price and dividend total-return bases cannot be mixed within a window', () => {
  const input = fixture();
  rowAt(input, 'price', 49).contract = { returnBasis: 'TOTAL_RETURN', adjustmentMethod: 'DIVIDEND_ADJUSTED_TOTAL_RETURN' };
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'PRICE_BASIS_MISMATCH');
  expectHold(metrics(result).benchmarkDifference, 'PRICE_BASIS_MISMATCH');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('D07 real zero price return is displayed, while halt/no-trade retain separate reference reasons', () => {
  for (const status of ['FINAL', 'HALTED', 'NO_TRADES']) {
    const input = fixture();
    changeRows(input, 'price', 45, 49, row => { row.value = '10000'; row.status = status; });
    const result = calculateReactionGap(input);
    expectValue(metrics(result).priceReturn, '0', '0.0');
    if (status === 'FINAL') {
      assert.equal(metrics(result).priceReturn.state, 'DISPLAY');
      assert.equal(result.comparisons[0].value.decimal, '-18');
    } else {
      assert.equal(metrics(result).priceReturn.state, 'REFERENCE');
      assert.ok(metrics(result).priceReturn.reasonCodes.includes(status));
      assert.equal(result.comparisons[0].value, null);
      assert.ok(result.comparisons[0].reasonCodes.includes('TRADING_STATUS_INELIGIBLE'));
    }
  }
});

test('D07 fetch failure is a held value, never a real-zero observation', () => {
  const input = fixture();
  rowAt(input, 'price', 49).status = 'FETCH_FAILED';
  rowAt(input, 'price', 49).value = null;
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'UPSTREAM_ERROR');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('invalid price denominator does not erase independent turnover amount metrics', () => {
  const input = fixture(); rowAt(input, 'price', 44).value = '0';
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'INVALID_INPUT');
  expectHold(metrics(result).benchmarkDifference, 'INVALID_INPUT');
  expectValue(metrics(result).turnover.preMean, '10000000000');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('row limit and snapshot mismatch hold only affected metric series', () => {
  let input = fixture();
  input.candidates[0].price.rows = Array.from({ length: 10001 }, () => clone(rowAt(input, 'price', 49)));
  let result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'ROW_LIMIT');
  expectValue(metrics(result).turnover.multiple, '1.1');

  input = fixture();
  rowAt(input, 'turnover', 49).contract = { snapshotId: 'TEST_ONLY-old-snapshot' };
  result = calculateReactionGap(input);
  expectHold(metrics(result).turnover.multiple, 'SNAPSHOT_MISMATCH');
  expectValue(metrics(result).priceReturn, '2');
});

for (const [label, edit, reason] of [
  ['parent substituted for subsidiary', candidate => { candidate.relationship.subjectIssuerId = 'TEST-UNRELATED-PARENT'; }, 'EVIDENCE_UNVERIFIED'],
  ['preferred share', candidate => { candidate.securityType = 'PREFERRED_STOCK'; }, 'SECURITY_TYPE_INELIGIBLE'],
  ['unverified identity', candidate => { candidate.identityVerified = false; }, 'IDENTITY_INVALID'],
  ['missing identifier validity', candidate => { delete candidate.validFrom; }, 'IDENTITY_OUT_OF_RANGE'],
  ['revoked relationship', candidate => { candidate.relationship.revoked = true; }, 'EVIDENCE_REVOKED'],
  ['unverified relationship', candidate => { candidate.relationship.verified = false; }, 'EVIDENCE_UNVERIFIED'],
]) {
  test(`C01/C02 ${label} is excluded with reason while peer survives`, () => {
    const input = fixture(); edit(input.candidates[0]);
    const result = calculateReactionGap(input);
    expectHold(metrics(result).priceReturn, reason);
    assert.equal(result.companies[0].comparisonEligible, false);
    assert.ok(result.exclusions.find(item => item.id === 'TEST:A').reasonCodes.includes(reason));
    expectValue(metrics(result, 1).priceReturn, '18');
  });
}

test('C01 wrong security price join cannot borrow another share class series', () => {
  const input = fixture(); input.candidates[0].price.securityId = 'TEST-PREFERRED-SECURITY';
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn, 'SERIES_IDENTITY_MISMATCH');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('C01 prehistory beyond identifier validity holds pre-return independently', () => {
  const input = fixture();
  input.candidates[0].validFrom = input.calendar.sessions[44].date;
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  expectHold(metrics(result).preReturn, 'IDENTITY_OUT_OF_RANGE');
  expectHold(metrics(result).turnover.preMean, 'IDENTITY_OUT_OF_RANGE');
  expectValue(metrics(result).turnover.postMean, '11000000000');
});

test('C02 product seller and confirmed project delivery remain distinct comparison groups', () => {
  const input = fixture(); input.candidates[1].relationship.stage = 'CONFIRMED_DELIVERY';
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  expectValue(metrics(result, 1).priceReturn, '18');
  assert.equal(result.cohort.strictGroups.length, 2);
  assert.equal(result.comparisons[0].value, null);
  assert.ok(result.comparisons[0].reasonCodes.includes('STRICT_COHORT_MISMATCH'));
});

test('C03 single frozen candidate has individual metrics and no company gap', () => {
  const input = fixture(); input.cohort.orderedAssetIds = ['TEST:A'];
  const result = calculateReactionGap(input);
  assert.equal(result.companies.length, 1);
  expectValue(metrics(result).priceReturn, '2');
  assert.deepEqual(result.comparisons, []);
  assert.deepEqual(result.exclusions, [{ id: 'TEST:B', reasonCodes: ['NOT_IN_FROZEN_COHORT'] }]);
});

test('C03 declared price-dependent selection is excluded from company comparisons', () => {
  const input = fixture(); input.cohort.selectedBeforePrices = false;
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  assert.equal(result.comparisons[0].value, null);
  assert.ok(result.comparisons[0].reasonCodes.includes('PRICE_DEPENDENT_SELECTION'));
  assert.ok(result.companies.every(company => company.comparisonEligible === false));
  assert.equal(result.cohort.priceRanked, false);
});

test('C04 sector benchmark is not silently replaced by market benchmark', () => {
  const input = fixture(); input.candidates[1].benchmarkId = 'SECTOR-TEST';
  const result = calculateReactionGap(input);
  expectValue(metrics(result, 1).priceReturn, '18');
  expectHold(metrics(result, 1).benchmarkDifference, 'BENCHMARK_MISMATCH');
  assert.equal(result.comparisons[0].value, null);
  assert.ok(result.comparisons[0].reasonCodes.includes('BENCHMARK_MISMATCH'));
});

test('missing benchmark endpoint holds excess only and preserves individual return', () => {
  const input = fixture();
  input.benchmarks[0].rows = input.benchmarks[0].rows.filter(row => row.date !== input.calendar.sessions[49].date);
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '2');
  expectHold(metrics(result).benchmarkDifference, 'ENDPOINT_MISSING');
  expectValue(metrics(result).turnover.multiple, '1.1');
});

test('stale and unknown freshness remain visible references with their original dates', () => {
  for (const [freshness, reason] of [['STALE', 'STALE'], ['UNKNOWN', 'FRESHNESS_UNKNOWN']]) {
    const input = fixture(); input.candidates[0].price.contract.freshness = freshness;
    const result = calculateReactionGap(input);
    expectValue(metrics(result).priceReturn, '2');
    assert.equal(metrics(result).priceReturn.state, 'REFERENCE');
    assert.ok(metrics(result).priceReturn.reasonCodes.includes(reason));
    assert.equal(metrics(result).priceReturn.endDate, input.calendar.sessions[49].date);
  }
});

test('C01 unknown listing market cannot qualify as a verified domestic identity', () => {
  const input = fixture(); input.candidates[0].listingMarket = 'UNKNOWN';
  const result = calculateReactionGap(input);
  expectHold(metrics(result).priceReturn);
  assert.equal(result.companies[0].comparisonEligible, false);
  assert.ok(result.companies[0].reasonCodes.length > 0);
  expectValue(metrics(result, 1).priceReturn, '18');
});

test('C02 null or invalid business source IDs cannot count as verified evidence', () => {
  for (const sourceIds of [[null], [''], [17], ['UNKNOWN'], []]) {
    const input = fixture(); input.candidates[0].relationship.sourceIds = sourceIds;
    const result = calculateReactionGap(input);
    expectHold(metrics(result).priceReturn, 'EVIDENCE_UNVERIFIED');
    assert.equal(result.companies[0].comparisonEligible, false);
    expectValue(metrics(result, 1).priceReturn, '18');
  }
});

test('C03 aliases for one issuer/security cannot become two independent companies', () => {
  const input = fixture();
  const [a, b] = input.candidates;
  b.issuerId = a.issuerId; b.securityId = a.securityId;
  b.relationship.subjectIssuerId = a.issuerId;
  for (const kind of ['price', 'turnover']) {
    b[kind].issuerId = a.issuerId; b[kind].securityId = a.securityId;
  }
  const result = calculateReactionGap(input);
  assert.ok(result.comparisons.every(comparison => comparison.value === null));
  const reasons = [
    ...result.reasonCodes,
    ...(result.exclusions || []).flatMap(item => item.reasonCodes),
    ...result.companies.flatMap(company => company.reasonCodes),
    ...result.comparisons.flatMap(comparison => comparison.reasonCodes),
  ];
  assert.ok(reasons.length > 0, 'Duplicate issuer/security aliases require an explicit exclusion or invalid-input reason');
});

for (const [field, value] of [
  ['definitionVersion', 'TEST_ONLY-price-definition-2'],
  ['adjustmentVersion', 'TEST_ONLY-adjustment-2'],
  ['aggregationScope', 'DIFFERENT_CLOSE_AGGREGATION'],
]) {
  test(`company comparison rejects incompatible price ${field}`, () => {
    const input = fixture(); input.candidates[1].price.contract[field] = value;
    const result = calculateReactionGap(input);
    expectValue(metrics(result).priceReturn, '2');
    expectValue(metrics(result, 1).priceReturn, '18');
    assert.equal(result.comparisons[0].value, null);
    assert.equal(result.comparisons[0].state, 'HOLD');
    assert.ok(result.comparisons[0].reasonCodes.length > 0);
  });
}

test('D06 identical copies of a verified correction remain one corrected observation', () => {
  const input = fixture();
  const correction = { ...clone(rowAt(input, 'price', 49)), value: '10300', revision: 'r2', supersedes: ['r1'], revisionVerified: true, rawSnapshotId: 'TEST_ONLY-corrected-copy-1' };
  input.candidates[0].price.rows.push(correction, { ...clone(correction), rawSnapshotId: 'TEST_ONLY-corrected-copy-2' });
  const result = calculateReactionGap(input);
  expectValue(metrics(result).priceReturn, '3');
  assert.equal(metrics(result).priceReturn.observations, 6);
  const last = metrics(result).priceReturn.provenance.at(-1);
  assert.equal(last.lineage.length, 2);
  assert.ok(last.lineage.every(source => source.revision === 'r2' && source.originalValue === '10300'));
  assert.ok(last.supersededLineage.some(source => source.revision === 'r1' && source.originalValue === '10200'));
  input.candidates[0].price.rows.reverse();
  assert.deepEqual(metrics(calculateReactionGap(input)).priceReturn, metrics(result).priceReturn);
});
