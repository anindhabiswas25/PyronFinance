import { describe, expect, it } from 'vitest';
import { formatBpsAsPercent, formatRatioPercent, formatUnits, isAmountInput, parseUnits, truncateHash } from '../../src/lib/format';
import { parse, stringify } from '../../src/lib/bigint-json';
import { formatClock, formatDuration, formatDurationWords } from '../../src/lib/time';

describe('formatUnits', () => {
  it('formats exact base units with grouping', () => {
    expect(formatUnits(1234567890n, 6)).toBe('1,234.56789');
    expect(formatUnits(41_440_000_000n, 6, { minFraction: 2 })).toBe('41,440.00');
    expect(formatUnits(0n, 6)).toBe('0');
    expect(formatUnits(1n, 6)).toBe('0.000001');
  });
  it('rounds toward zero by default and up or half-up on request', () => {
    expect(formatUnits(1_999_999n, 6, { maxFraction: 2 })).toBe('1.99');
    expect(formatUnits(1_999_999n, 6, { maxFraction: 2, round: 'up' })).toBe('2');
    expect(formatUnits(1_005_000n, 6, { maxFraction: 2, round: 'half-up' })).toBe('1.01');
    expect(formatUnits(1_004_999n, 6, { maxFraction: 2, round: 'half-up' })).toBe('1');
  });
  it('signs negatives with a real minus and handles huge values without precision loss', () => {
    expect(formatUnits(-2_500_000n, 6)).toBe('−2.5');
    expect(formatUnits(123456789012345678901234567890n, 6, { group: false })).toBe('123456789012345678901234.56789');
  });
});

describe('parseUnits', () => {
  it('parses decimal strings exactly', () => {
    expect(parseUnits('0.001', 6)).toBe(1000n);
    expect(parseUnits('1,000.5', 6)).toBe(1_000_500_000n);
    expect(parseUnits('.5', 6)).toBe(500_000n);
  });
  it('refuses too many decimals and non-numbers', () => {
    expect(() => parseUnits('0.0000001', 6)).toThrow();
    expect(() => parseUnits('1e3', 6)).toThrow();
    expect(() => parseUnits('', 6)).toThrow();
  });
  it('accepts only valid partial input while typing', () => {
    expect(isAmountInput('12.', 6)).toBe(true);
    expect(isAmountInput('12.1234567', 6)).toBe(false);
    expect(isAmountInput('1a', 6)).toBe(false);
  });
});

describe('identifiers and percentages', () => {
  it('truncates hashes as abcd…ef', () => {
    expect(truncateHash('0f7a1234567891')).toBe('0f7a…91');
    expect(truncateHash('abc')).toBe('abc');
  });
  it('formats basis points and ratios', () => {
    expect(formatBpsAsPercent(-110n)).toBe('−1.10%');
    expect(formatBpsAsPercent(5n, { signed: true })).toBe('+0.05%');
    expect(formatRatioPercent(1n, 3n)).toBe('33.3%');
    expect(formatRatioPercent(2n, 3n)).toBe('66.7%');
    expect(formatRatioPercent(1n, 0n)).toBe('—');
  });
});

describe('bigint JSON', () => {
  it('round-trips bigint and Uint8Array inside nested values', () => {
    const value = { a: 123456789012345678901234567890n, b: [-1n, 0n], c: new Uint8Array([0, 255, 16]), d: 'x', e: { $bigint: 5 } };
    const back = parse<typeof value>(stringify(value));
    expect(back.a).toBe(value.a);
    expect(back.b).toEqual([-1n, 0n]);
    expect(Array.from(back.c)).toEqual([0, 255, 16]);
    expect(back.d).toBe('x');
    expect(back.e).toEqual({ $bigint: 5 });
  });
});

describe('time', () => {
  it('formats clocks and durations', () => {
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatDuration(3840)).toBe('1 h 4 min');
    expect(formatDurationWords(61)).toBe('1 minute 1 second');
  });
});
