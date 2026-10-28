import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decimal, rational, add, sub, mul, div, compare, mean, percentChange, serialize,
} from '../server/reaction-gap/decimal.mjs';

test('decimal parses source strings exactly beyond Number precision and 21 digits', () => {
  assert.deepEqual(decimal('9007199254740993'), { n: 9007199254740993n, d: 1n });
  assert.deepEqual(decimal('999999999999999999999'), { n: 999999999999999999999n, d: 1n });
  assert.deepEqual(decimal('9007199254740993.125'), { n: 72057594037927945n, d: 8n });
  assert.deepEqual(decimal('-0012.5000'), { n: -25n, d: 2n });
  assert.deepEqual(decimal('+0.000'), { n: 0n, d: 1n });
  assert.deepEqual(decimal('-0'), { n: 0n, d: 1n });
});

test('decimal rejects Number, coercion, whitespace, exponents and non-decimal input', () => {
  for (const input of [1, 9007199254740992, NaN, Infinity, 1n, null, undefined, {}, [],
    '', ' ', '1 ', ' 1', '1\n', 'NaN', 'Infinity', '1e3', '1E-3', '0x10', '1,000', '.5', '1.', '--1']) {
    assert.throws(() => decimal(input), { name: 'TypeError' }, String(input));
  }
});

test('decimal bounds source integer and fraction digits before BigInt parsing', () => {
  assert.deepEqual(decimal('1' + '0'.repeat(127)), { n: 10n ** 127n, d: 1n });
  assert.deepEqual(decimal('0.' + '0'.repeat(63) + '1'), { n: 1n, d: 10n ** 64n });
  assert.throws(() => decimal('1'.repeat(129)), RangeError);
  assert.throws(() => decimal('0'.repeat(129)), RangeError);
  assert.throws(() => decimal('0.' + '1'.repeat(65)), RangeError);
  assert.throws(() => decimal('1'.repeat(100000)), RangeError);
});

test('rational reduces values, normalizes denominator sign and rejects zero denominators', () => {
  assert.deepEqual(rational(12n, -18n), { n: -2n, d: 3n });
  assert.deepEqual(rational(-12n, -18n), { n: 2n, d: 3n });
  assert.deepEqual(rational(0n, -18n), { n: 0n, d: 1n });
  assert.throws(() => rational(1n, 0n), RangeError);
  assert.throws(() => rational(0n, 0n), RangeError);
  assert.throws(() => rational(1, 2n), TypeError);
  assert.throws(() => rational(1n, '2'), TypeError);
  assert.throws(() => add({ n: 1n, d: 0n }, decimal('1')), RangeError);
});

test('arithmetic preserves exact fractions and supports negative intermediate values', () => {
  assert.deepEqual(add(rational(1n, 3n), rational(1n, 6n)), { n: 1n, d: 2n });
  assert.deepEqual(sub(decimal('2'), decimal('4')), { n: -2n, d: 1n });
  assert.deepEqual(mul(rational(-3n, 14n), rational(7n, 6n)), { n: -1n, d: 4n });
  assert.deepEqual(div(rational(-2n, 3n), rational(-4n, 9n)), { n: 3n, d: 2n });
  assert.deepEqual(add(decimal('0.1'), decimal('0.2')), { n: 3n, d: 10n });
  assert.deepEqual(sub(decimal('9007199254740993'), decimal('9007199254740992')), { n: 1n, d: 1n });
  assert.throws(() => div(decimal('1'), decimal('0')), RangeError);
});

test('mean preserves true sample count and rejects empty, sparse or malformed inputs', () => {
  assert.deepEqual(mean(['0.1', '0.2', '0.3'].map(decimal)), { n: 1n, d: 5n });
  assert.deepEqual(mean([decimal('1'), decimal('0'), decimal('0')]), { n: 1n, d: 3n });
  assert.deepEqual(mean([decimal('-2'), decimal('2')]), { n: 0n, d: 1n });
  assert.throws(() => mean([]), RangeError);
  assert.throws(() => mean(new Array(2)), TypeError);
  assert.throws(() => mean([decimal('1'), '2']), TypeError);
  assert.throws(() => mean(null), TypeError);
});

test('comparisons use exact rational values without converting to Number', () => {
  assert.equal(compare(decimal('9007199254740993'), decimal('9007199254740992')), 1);
  assert.equal(compare(decimal('-0.01'), decimal('0')), -1);
  assert.equal(compare(rational(2n, 6n), rational(1n, 3n)), 0);
  assert.equal(compare(decimal('-100'), decimal('-99.99')), -1);
});

test('percent change requires positive endpoints and retains an exact return', () => {
  assert.deepEqual(percentChange(decimal('10000'), decimal('10200')), { n: 2n, d: 1n });
  assert.deepEqual(percentChange(decimal('2000'), decimal('2080')), { n: 4n, d: 1n });
  assert.deepEqual(percentChange(decimal('8000'), decimal('10000')), { n: 25n, d: 1n });
  assert.deepEqual(percentChange(decimal('3'), decimal('4')), { n: 100n, d: 3n });
  assert.deepEqual(percentChange(decimal('5000'), decimal('5000')), { n: 0n, d: 1n });
  assert.deepEqual(percentChange(decimal('10000'), decimal('5000')), { n: -50n, d: 1n });
  for (const [base, end] of [['0', '1'], ['-1', '1'], ['1', '0'], ['1', '-1']]) {
    assert.throws(() => percentChange(decimal(base), decimal(end)), RangeError);
  }
});

test('explicit decimal unit multiplication preserves every original amount digit', () => {
  const won = decimal('9007199254740993');
  const thousands = mul(decimal('9007199254740.993'), decimal('1000'));
  const millions = mul(decimal('9007199254.740993'), decimal('1000000'));
  assert.deepEqual(thousands, { n: 9007199254740993n, d: 1n });
  assert.deepEqual(millions, won);
  assert.deepEqual(div(thousands, won), { n: 1n, d: 1n });
});

test('terminating serialization includes complete exact decimal and independent display', () => {
  assert.deepEqual(serialize(decimal('9007199254740993.125')), {
    numerator: '72057594037927945', denominator: '8', decimal: '9007199254740993.125',
    decimalIsExact: true, display: '9007199254740993.1',
  });
  assert.deepEqual(serialize(rational(1n, 40n), { places: 2 }), {
    numerator: '1', denominator: '40', decimal: '0.025', decimalIsExact: true, display: '0.03',
  });
  assert.equal(serialize(rational(1n, 10n ** 24n)).decimal, '0.000000000000000000000001');
  assert.equal(serialize(decimal('001.2000')).decimal, '1.2');
});

test('repeating serialization rounds at 18 places but preserves exact rational fields', () => {
  assert.deepEqual(serialize(rational(1n, 3n)), {
    numerator: '1', denominator: '3', decimal: '0.333333333333333333',
    decimalIsExact: false, display: '0.3',
  });
  assert.deepEqual(serialize(rational(-2n, 3n), { places: 2 }), {
    numerator: '-2', denominator: '3', decimal: '-0.666666666666666667',
    decimalIsExact: false, display: '-0.67',
  });
  assert.equal(serialize(rational(9999999999999999999n, 9999999999999999998n)).decimal, '1.000000000000000000');
});

test('display uses HALF_AWAY_FROM_ZERO with carry and never produces negative zero', () => {
  for (const [input, places, expected] of [
    ['1.25', 1, '1.3'], ['-1.25', 1, '-1.3'], ['-1.24', 1, '-1.2'],
    ['9.995', 2, '10.00'], ['-9.995', 2, '-10.00'], ['0.5', 0, '1'],
    ['-0.5', 0, '-1'], ['-0.04', 1, '0.0'], ['-0', 2, '0.00'],
  ]) assert.equal(serialize(decimal(input), { places }).display, expected);
  assert.equal(serialize(rational(-1n, 300000000000000000000n)).decimal, '0.000000000000000000');
  assert.equal(serialize(decimal('1'), { places: 64 }).display, '1.' + '0'.repeat(64));
  for (const places of [-1, 65, 0.5, NaN, Infinity, '2', null]) {
    assert.throws(() => serialize(decimal('1'), { places }), RangeError);
  }
});

test('serialized fractions survive JSON roundtrip without using approximate decimals', () => {
  const exact = rational(999999999999999999999n, 7n);
  const wire = JSON.parse(JSON.stringify(serialize(exact, { places: 2 })));
  assert.deepEqual(wire, {
    numerator: '999999999999999999999', denominator: '7',
    decimal: '142857142857142857142.714285714285714286',
    decimalIsExact: false, display: '142857142857142857142.71',
  });
  assert.deepEqual(rational(BigInt(wire.numerator), BigInt(wire.denominator)), exact);
});

test('intermediate values do not round and arithmetic does not mutate operands', () => {
  const third = rational(1n, 3n);
  const before = { ...third };
  assert.deepEqual(mul(third, decimal('3')), { n: 1n, d: 1n });
  assert.deepEqual(add(add(third, third), third), { n: 1n, d: 1n });
  assert.deepEqual(third, before);
  assert.deepEqual(percentChange(mul(decimal('3'), decimal('1000')), mul(decimal('4'), decimal('1000'))),
    { n: 100n, d: 3n });
});
