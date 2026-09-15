import { describe, expect, it } from 'vitest';
import {
  bestQuote,
  bondPercentTenths,
  bondTone,
  cautionsFor,
  formatRate,
  medianAmount,
  pairwiseSentence,
  roundDiv,
  sortForTable,
  spreadOf,
  summarize,
  validityPermille,
  vsBest,
  type CompareQuote,
} from '../../src/lib/compare';
import { counterLabel, expectedDealerSide, isValidDealerSide, takerReceivesCounter } from '../../src/lib/side';
import { formatUnits } from '../../src/lib/format';

const NOW = 1_000_000;
const U = 1_000_000n;

function q(id: string, amount: bigint, over: Partial<CompareQuote> = {}): CompareQuote {
  return {
    quoteId: id,
    dealerCmt: `${id}${'0'.repeat(62)}`.slice(0, 64),
    amount,
    price: '41.440000',
    bond: 12_400n * U,
    notional: 50_000n * U,
    settled: 10n,
    slashed: 0n,
    validUntil: NOW + 300,
    firstSeen: NOW - 60,
    state: 'valid',
    ...over,
  };
}

describe('sides', () => {
  it('maps the taker side to the dealer side and the counter role', () => {
    expect(expectedDealerSide('sell')).toBe('buy');
    expect(isValidDealerSide('sell', 'sell')).toBe(false);
    expect(takerReceivesCounter('sell')).toBe(true);
    expect(counterLabel('buy')).toBe('You pay');
  });
});

describe('roundDiv', () => {
  it('rounds halves away from zero', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(roundDiv(-4n, 3n)).toBe(-1n);
  });
});

describe('best by side', () => {
  const quotes = [q('a', 2_072n * U), q('b', 2_095n * U), q('c', 2_060n * U)];
  it('selling: most received', () => expect(bestQuote(quotes, 'sell', NOW)?.quoteId).toBe('b'));
  it('buying: least paid', () => expect(bestQuote(quotes, 'buy', NOW)?.quoteId).toBe('c'));
  it('ignores expired, mismatched and offer-mismatched quotes', () => {
    const mixed = [q('a', 2_072n * U), q('b', 3_000n * U, { validUntil: NOW }), q('c', 4_000n * U, { state: 'seal-mismatch' }), q('d', 5_000n * U, { state: 'offer-mismatch' })];
    expect(bestQuote(mixed, 'sell', NOW)?.quoteId).toBe('a');
  });
  it('breaks ties by first seen, then quote id', () => {
    expect(bestQuote([q('z', 10n, { firstSeen: NOW - 5 }), q('a', 10n, { firstSeen: NOW - 1 })], 'sell', NOW)?.quoteId).toBe('z');
    expect(bestQuote([q('z', 10n), q('a', 10n)], 'sell', NOW)?.quoteId).toBe('a');
  });
});

describe('vs best', () => {
  it('signs from the taker side and rounds bps', () => {
    // Design example: 2,072.00 vs best 2,095.00 → −23.00 and −110 bps (−109.78 rounds to −110).
    expect(vsBest(2_072n * U, 2_095n * U, 'sell')).toEqual({ diff: -23n * U, bps: -110n });
    // Paying more than the best is also negative.
    expect(vsBest(2_095n * U, 2_072n * U, 'buy')).toEqual({ diff: -23n * U, bps: -111n });
    expect(vsBest(2_095n * U, 2_095n * U, 'sell')).toEqual({ diff: 0n, bps: 0n });
    // Exactly half a basis point rounds away from zero: −0.5 bps → −1.
    expect(vsBest(19_999n, 20_000n, 'sell').bps).toBe(-1n);
    // Less than half rounds to zero: −0.05 bps → 0.
    expect(vsBest(199_999n, 200_000n, 'sell').bps).toBe(0n);
  });
});

describe('median', () => {
  it('odd count takes the middle', () => {
    expect(medianAmount([3n, 1n, 2n], 'sell')).toBe(2n);
  });
  it('even count rounds toward the taker’s worse side', () => {
    expect(medianAmount([1n, 2n], 'sell')).toBe(1n); // receiving: down
    expect(medianAmount([1n, 2n], 'buy')).toBe(2n); // paying: up
    expect(medianAmount([2n, 4n], 'buy')).toBe(3n);
  });
  it('is undefined with no quotes', () => {
    expect(medianAmount([], 'sell')).toBeUndefined();
  });
});

describe('spread', () => {
  it('measures best to worst in bps of the best', () => {
    expect(spreadOf([2_072n * U, 2_095n * U, 2_060n * U], 'sell')).toEqual({ abs: 35n * U, bps: 167n, best: 2_095n * U, worst: 2_060n * U });
    expect(spreadOf([2_072n * U, 2_095n * U, 2_060n * U], 'buy')).toMatchObject({ best: 2_060n * U, worst: 2_095n * U, bps: 170n });
  });
  it('is zero for one quote', () => {
    expect(spreadOf([5n], 'sell')).toMatchObject({ abs: 0n, bps: 0n });
  });
});

describe('bond % of trade', () => {
  it('computes tenths with half-up rounding, and tones', () => {
    expect(bondPercentTenths(5_200n * U, 50_000n * U)).toBe(104n);
    expect(bondPercentTenths(45_000n * U, 50_000n * U)).toBe(900n);
    expect(bondPercentTenths(1n, 3n)).toBe(333n);
    expect(bondPercentTenths(1n, 0n)).toBeUndefined();
    expect([bondTone(500n), bondTone(499n), bondTone(200n), bondTone(199n)]).toEqual(['ok', 'neutral', 'neutral', 'warn']);
  });
});

describe('rate and validity', () => {
  it('formats rates with five decimals', () => {
    expect(formatRate('0.041440')).toBe('0.04144');
    expect(formatRate('41.44')).toBe('41.44000');
    expect(formatRate('0.0419')).toBe('0.04190');
  });
  it('reports remaining validity as permille of the observed window', () => {
    expect(validityPermille({ validUntil: NOW + 100, firstSeen: NOW - 100 }, NOW)).toBe(500);
    expect(validityPermille({ validUntil: NOW, firstSeen: NOW - 100 }, NOW)).toBe(0);
    expect(validityPermille({ validUntil: NOW + 100, firstSeen: NOW + 100 }, NOW)).toBe(0);
  });
});

describe('summary', () => {
  it('excludes mismatches from every statistic', () => {
    const quotes = [q('a', 2_072n * U, { validUntil: NOW + 292 }), q('b', 2_095n * U), q('c', 2_060n * U), q('x', 9_999n * U, { state: 'seal-mismatch' })];
    const s = summarize(quotes, 'sell', NOW);
    expect(s).toMatchObject({ opened: 4, valid: 3, mismatches: 1, median: 2_072n * U });
    expect(s.best?.quoteId).toBe('b');
    expect(s.spread?.bps).toBe(167n);
    expect(s.firstToExpire?.quoteId).toBe('a');
  });
  it('handles a single quote', () => {
    const s = summarize([q('a', 10n * U)], 'buy', NOW);
    expect(s).toMatchObject({ valid: 1, median: 10n * U });
    expect(s.spread?.abs).toBe(0n);
  });
  it('handles all expired', () => {
    const s = summarize([q('a', 10n, { validUntil: NOW - 1 }), q('b', 20n, { state: 'expired', validUntil: NOW - 5 })], 'sell', NOW);
    expect(s).toMatchObject({ valid: 0, expired: 2, best: undefined, median: undefined, spread: undefined, firstToExpire: undefined });
  });
});

describe('table order and cautions', () => {
  const quotes = [q('a', 2_072n * U, { bond: 45_000n * U, validUntil: NOW + 292 }), q('b', 2_095n * U, { bond: 5_200n * U, slashed: 2n, settled: 14n }), q('c', 2_060n * U, { validUntil: NOW + 550 }), q('d', 2_081n * U, { validUntil: NOW - 1 }), q('x', 1n, { state: 'seal-mismatch' })];

  it('sorts valid rows by the chosen order, then expired, never mismatches', () => {
    expect(sortForTable(quotes, 'amount', 'sell', NOW).map((r) => r.quoteId)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortForTable(quotes, 'amount', 'buy', NOW).map((r) => r.quoteId)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortForTable(quotes, 'bond', 'sell', NOW).map((r) => r.quoteId)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortForTable(quotes, 'validity', 'sell', NOW).map((r) => r.quoteId)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('flags slashes, small bonds and the best price from the weakest record', () => {
    const c = cautionsFor(quotes[1], quotes, 'sell', NOW);
    expect(c).toEqual({ slashes: 2n, smallBond: false, bestButWeakest: true });
    expect(cautionsFor(q('s', 1n, { bond: 4_999n * U }), [q('s', 1n, { bond: 4_999n * U })], 'sell', NOW)).toEqual({ slashes: undefined, smallBond: true, bestButWeakest: false });
  });

  it('writes the pairwise sentence from the numbers only', () => {
    const fmt = { amount: (v: bigint) => formatUnits(v, 6, { minFraction: 2 }), symbol: 'USDM', dealer: (cmt: string) => `${cmt.slice(0, 1)}…` };
    expect(pairwiseSentence(quotes[0], quotes[1], 'sell', fmt)).toBe('Choosing a… gives up 23.00 USDM (1.10%) for a dealer with 8.7× the bond, no slashes and 4 fewer recorded trades.');
    expect(pairwiseSentence(quotes[1], quotes[0], 'sell', fmt)).toBe('Choosing b… gains 23.00 USDM (1.11%) for a dealer with 8.7× less bond, 2 more slashes and 4 more recorded trades.');
    expect(pairwiseSentence(q('p', 5n * U), q('r', 5n * U), 'buy', fmt)).toBe('Choosing p… gets the same price as r… for a dealer with the same bond.');
  });
});
