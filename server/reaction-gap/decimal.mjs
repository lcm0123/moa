// Exact, dependency-free arithmetic. Values are reduced BigInt fractions;
// formatting is the only operation that rounds. No provider or clock access.
import policy from '../../config/reaction-gap.json' with { type: 'json' };
const MAX_INTEGER_DIGITS = 128;
const MAX_FRACTION_DIGITS = 64;
const REPEATING_DECIMAL_PLACES = policy.repeatingDecimalPlaces;
if (policy.rounding !== 'HALF_AWAY_FROM_ZERO' || !Number.isInteger(REPEATING_DECIMAL_PLACES)
  || REPEATING_DECIMAL_PLACES < 1 || REPEATING_DECIMAL_PLACES > 64) {
  throw new TypeError('Unsupported exact-decimal serialization policy');
}

const abs = value => value < 0n ? -value : value;

function gcd(a, b) {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(n, d) {
  if (typeof n !== 'bigint' || typeof d !== 'bigint') {
    throw new TypeError('Rational numerator and denominator must be BigInt');
  }
  if (d === 0n) throw new RangeError('Rational denominator must not be zero');
  if (n === 0n) return Object.freeze({ n: 0n, d: 1n });
  if (d < 0n) { n = -n; d = -d; }
  const factor = gcd(n, d);
  return Object.freeze({ n: n / factor, d: d / factor });
}

function value(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('Expected an exact rational value');
  }
  return rational(input.n, input.d);
}

/** Parse plain decimal strings only, retaining every source digit. */
export function decimal(input) {
  if (typeof input !== 'string') throw new TypeError('Decimal input must be a string');
  // Check total length before scanning or allocating a BigInt from user input.
  if (input.length > MAX_INTEGER_DIGITS + MAX_FRACTION_DIGITS + 2) {
    throw new RangeError('Decimal input exceeds digit limits');
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match) throw new TypeError('Expected a plain decimal string');
  const [, sign, integer, fraction = ''] = match;
  if (integer.length > MAX_INTEGER_DIGITS || fraction.length > MAX_FRACTION_DIGITS) {
    throw new RangeError('Decimal input exceeds digit limits');
  }
  const n = BigInt(integer + fraction) * (sign === '-' ? -1n : 1n);
  return rational(n, 10n ** BigInt(fraction.length));
}

export function add(a, b) {
  a = value(a); b = value(b);
  const common = gcd(a.d, b.d);
  return rational(a.n * (b.d / common) + b.n * (a.d / common), (a.d / common) * b.d);
}

export function sub(a, b) {
  b = value(b);
  return add(a, rational(-b.n, b.d));
}

export function mul(a, b) {
  a = value(a); b = value(b);
  const left = gcd(a.n, b.d);
  const right = gcd(b.n, a.d);
  return rational((a.n / left) * (b.n / right), (a.d / right) * (b.d / left));
}

export function div(a, b) {
  a = value(a); b = value(b);
  if (b.n === 0n) throw new RangeError('Cannot divide by zero');
  return mul(a, rational(b.d, b.n));
}

export function compare(a, b) {
  a = value(a); b = value(b);
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function mean(values) {
  if (!Array.isArray(values)) throw new TypeError('Mean input must be an array');
  if (values.length === 0) throw new RangeError('Mean requires at least one value');
  // Iteration validates every slot, including sparse array holes.
  let sum = rational(0n, 1n);
  for (const item of values) sum = add(sum, item);
  return div(sum, rational(BigInt(values.length), 1n));
}

export function percentChange(base, end) {
  base = value(base); end = value(end);
  if (base.n <= 0n || end.n <= 0n) {
    throw new RangeError('Percent change requires positive base and end values');
  }
  return mul(sub(div(end, base), rational(1n, 1n)), rational(100n, 1n));
}

function formatScaled(integer, places, trimFraction = false) {
  const negative = integer < 0n;
  const digits = abs(integer).toString().padStart(places + 1, '0');
  let result = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  if (trimFraction && places > 0) result = result.replace(/0+$/, '').replace(/\.$/, '');
  return negative ? `-${result}` : result;
}

function rounded(value, places) {
  const scaled = abs(value.n) * (10n ** BigInt(places));
  let quotient = scaled / value.d;
  // Exactly half is rounded away from zero for both signs.
  if ((scaled % value.d) * 2n >= value.d) quotient += 1n;
  return formatScaled(value.n < 0n ? -quotient : quotient, places);
}

function exactDecimal(value) {
  let denominator = value.d;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) { denominator /= 2n; twos += 1; }
  while (denominator % 5n === 0n) { denominator /= 5n; fives += 1; }
  if (denominator !== 1n) return null;
  const places = Math.max(twos, fives);
  const integer = value.n * (2n ** BigInt(places - twos)) * (5n ** BigInt(places - fives));
  return formatScaled(integer, places, true);
}

/** JSON-safe exact fraction, canonical decimal, and separately rounded display. */
export function serialize(input, { places = 1 } = {}) {
  if (!Number.isInteger(places) || places < 0 || places > MAX_FRACTION_DIGITS) {
    throw new RangeError('Display places must be an integer from 0 to 64');
  }
  const parsed = value(input);
  const exact = exactDecimal(parsed);
  return {
    numerator: parsed.n.toString(),
    denominator: parsed.d.toString(),
    decimal: exact ?? rounded(parsed, REPEATING_DECIMAL_PLACES),
    decimalIsExact: exact !== null,
    display: rounded(parsed, places),
  };
}
