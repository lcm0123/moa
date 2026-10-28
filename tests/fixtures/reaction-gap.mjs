// TEST_ONLY: deterministic synthetic calendar and companies; no live data.
import references from './reaction-gap-reference-v2.json' with { type: 'json' };

export const reference = id => references.cases.find(item => item.id === id);
export const clone = value => structuredClone(value);

export function fixture({ observed = 5, elapsed = null, mode = 'EVENT' } = {}) {
  const sessions = [];
  // Weekday generation is strictly a synthetic test fixture, never a fallback
  // for the production resolver's explicitly supplied verified calendar.
  for (let day = 0; sessions.length < 100; day++) {
    const date = new Date(Date.UTC(2030, 0, 1 + day));
    if ([0, 6].includes(date.getUTCDay())) continue;
    const iso = date.toISOString().slice(0, 10);
    sessions.push({ date: iso, open: `${iso}T09:00:00+09:00`, close: `${iso}T15:30:00+09:00` });
  }
  const t0 = 45;
  const last = elapsed ?? t0 + observed - 1;
  const asOf = `${sessions[last].date}T18:00:00+09:00`;
  const snapshotId = 'TEST_ONLY-snapshot-1';
  const evidenceAt = `${sessions[40].date}T08:00:00+09:00`;
  const frozenAt = `${sessions[t0].date}T08:00:00+09:00`;
  const contract = kind => ({
    verification: 'VERIFIED', definitionVersion: `TEST_ONLY-${kind}-1`, snapshotId,
    currency: 'KRW', unit: kind === 'benchmark' ? 'INDEX_POINT' : 'KRW',
    venueScope: 'KRX', sessionScope: 'REGULAR',
    aggregationScope: kind === 'turnover' ? 'EXCHANGE_DAILY_TOTAL' : 'OFFICIAL_CLOSE',
    measure: kind === 'turnover' ? 'ACTUAL_TRADED_VALUE' : kind === 'benchmark' ? 'PRICE_INDEX' : 'CLOSE',
    freshness: 'CURRENT', upstreamStatus: 'OK',
    ...(kind !== 'turnover' ? { corporateActionsVerified: true, adjustmentVersion: 'TEST_ONLY-1', adjustmentMethod: 'RAW_NO_ACTIONS_VERIFIED', returnBasis: 'PRICE_RETURN' } : {}),
    ...(kind === 'benchmark' ? { indexKind: 'MARKET_PRICE' } : {}),
  });
  const rows = (prefix, value) => sessions.map((s, i) => ({
    date: s.date, value: value(i), status: 'FINAL', observedAt: `${s.date}T16:00:00+09:00`,
    sourceId: `TEST_ONLY-${prefix}`, rawSnapshotId: `TEST_ONLY-${prefix}-${s.date}`, revision: 'r1',
  }));
  const turnoverReference = reference('TURNOVER_FULL_ARRAYS').input;
  const priorReference = reference('TWENTY_INTERVALS_REQUIRE_21_CLOSES').input.closes;
  const candidates = ['A', 'B'].map(suffix => {
    const identity = { id: `TEST:${suffix}`, issuerId: `TEST-ISSUER-${suffix}`, securityId: `TEST-SECURITY-${suffix}` };
    return {
      ...identity, market: 'KR', listingMarket: 'KOSPI', securityType: 'COMMON_STOCK',
      identityVerified: true, validFrom: '2020-01-01', validTo: null, benchmarkId: 'KOSPI',
      relationship: { eventId: 'TEST-event', eventVersion: '1', role: 'equipment', product: 'TEST concrete product',
        stage: 'PRODUCT_SELLER', verified: true, subjectIssuerId: identity.issuerId,
        sourceIds: [`TEST_ONLY-business-${suffix}`], publishedAt: evidenceAt, firstObservedAt: evidenceAt, revoked: false },
      price: { assetId: identity.id, issuerId: identity.issuerId, securityId: identity.securityId,
        contract: contract('price'), rows: rows(`price-${suffix}`, i => i >= 24 && i <= 44 ? priorReference[i - 24] : i >= 45 ? suffix === 'A' ? '10200' : '11800' : '8000') },
      turnover: { assetId: identity.id, issuerId: identity.issuerId, securityId: identity.securityId,
        contract: contract('turnover'), rows: rows(`turnover-${suffix}`, i => i >= 25 && i <= 44 ? turnoverReference.pre_20[i - 25] : i >= 45 && i <= 49 ? turnoverReference.post_5[i - 45] : '10000000000') },
    };
  });
  const input = {
    schemaVersion: 'reaction-gap-input-1', asOf, snapshotId, informationMode: 'AS_KNOWN',
    window: mode === 'FIXED_WINDOW' ? { mode, endDate: sessions[last].date } : {
      mode, event: { id: 'TEST-event', version: '1', publishedAt: frozenAt, publishedDate: sessions[t0].date, precision: mode === 'DATE_REFERENCE' ? 'date' : 'timestamp' },
    },
    calendar: { verified: true, version: 'TEST_ONLY-calendar-1', timeZone: 'Asia/Seoul', coverageStart: sessions[0].date, coverageEnd: sessions.at(-1).date, sessions },
    completion: { verified: true, through: sessions[last].date, confirmedAt: asOf, policyVersion: 'TEST_ONLY-completion-1' },
    cohort: { id: 'TEST-cohort', version: '1', selectionPolicyVersion: 'TEST_ONLY-evidence-order-1', selectedBeforePrices: true, frozenAt, knowledgeCutoff: frozenAt, orderedAssetIds: ['TEST:A', 'TEST:B'] },
    rights: { verified: false, internalCalculation: false, redisplay: false },
    candidates,
    benchmarks: [{ id: 'KOSPI', listingMarket: 'KOSPI', contract: contract('benchmark'), rows: rows('benchmark', i => i >= t0 ? '2080' : '2000') }],
  };
  if (observed === 0) input.cohort.frozenAt = input.cohort.knowledgeCutoff = evidenceAt;
  return input;
}

export const rowAt = (input, kind, index, candidate = 0) => input.candidates[candidate][kind].rows.find(row => row.date === input.calendar.sessions[index].date);
export const values = result => result.companies.map(company => ({ id: company.id, price: company.metrics.priceReturn.value, benchmark: company.metrics.benchmarkDifference.value, prior: company.metrics.preReturn.value, pre: company.metrics.turnover.preMean.value, post: company.metrics.turnover.postMean.value, ratio: company.metrics.turnover.multiple.value }));

export function fixedFixture() {
  const input = fixture({ mode: 'FIXED_WINDOW', elapsed: 59 });
  for (let c = 0; c < input.candidates.length; c++) {
    for (const row of input.candidates[c].price.rows) row.value = '15000';
    rowAt(input, 'price', 19, c).value = '10000';
    rowAt(input, 'price', 59, c).value = '18000';
    for (let i = 20; i <= 59; i++) rowAt(input, 'turnover', i, c).value = String(BigInt(i - 10) * 1000000n);
  }
  return input;
}
