// The SDK's off-chain derivations must be byte-identical to the in-circuit ones.
//
// This is not a style concern. quoteId is deterministic and publicly recomputable specifically
// so a taker can locate a dealer's on-chain commitment from a gossiped reference with no lookup
// service (docs/RELAY.md §3.2). If the two implementations ever diverge, every taker silently
// fails to find every quote, and the relay design breaks with no error message anywhere.
//
// contracts/test/quoting.test.ts proves the contract agrees with these functions by round-tripping
// through a real circuit. This file pins the functions themselves.

import { describe, expect, it } from 'vitest';
import { dealerCommitment, deriveQuoteId, deriveChallengeId } from '../src/domain.js';
import { encodeTerms, PAIR_CODES, PRICE_DECIMALS, type QuoteTerms } from '../src/terms.js';

const A = new Uint8Array(32).fill(1);
const B = new Uint8Array(32).fill(2);
const C = new Uint8Array(32).fill(3);

describe('domain separation', () => {
  it('produces 32-byte outputs', () => {
    expect(dealerCommitment(A)).toHaveLength(32);
    expect(deriveQuoteId(A, B, C)).toHaveLength(32);
    expect(deriveChallengeId(A, B)).toHaveLength(32);
  });

  it('is deterministic', () => {
    expect(Buffer.from(dealerCommitment(A))).toEqual(Buffer.from(dealerCommitment(A)));
    expect(Buffer.from(deriveQuoteId(A, B, C))).toEqual(Buffer.from(deriveQuoteId(A, B, C)));
  });

  it('separates domains — the same inputs never collide across derivations', () => {
    // Distinct pad(32, "otc:...:v1") prefixes are what stop a value valid in one context from
    // being replayed in another.
    const asCommitment = dealerCommitment(A);
    const asChallenge = deriveChallengeId(A, A);
    expect(Buffer.from(asCommitment)).not.toEqual(Buffer.from(asChallenge));
  });

  it('is sensitive to every input position', () => {
    const base = deriveQuoteId(A, B, C);
    expect(Buffer.from(deriveQuoteId(B, B, C))).not.toEqual(Buffer.from(base));
    expect(Buffer.from(deriveQuoteId(A, C, C))).not.toEqual(Buffer.from(base));
    expect(Buffer.from(deriveQuoteId(A, B, A))).not.toEqual(Buffer.from(base));
  });

  it('does not confuse argument order', () => {
    expect(Buffer.from(deriveChallengeId(A, B))).not.toEqual(Buffer.from(deriveChallengeId(B, A)));
  });
});

describe('terms encoding', () => {
  const base: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '1000.0' };

  it('encodes to exactly four Field values', () => {
    expect(encodeTerms(base)).toHaveLength(4);
  });

  it('encodes price as fixed-point, not float', () => {
    // 0.0412 at 6dp => 41200. Float arithmetic would give 41199.999... and settlement would
    // fail with a balance vector that does not quite net to zero.
    expect(encodeTerms(base)[2]).toBe(41200n);
  });

  it('distinguishes buy from sell', () => {
    expect(encodeTerms({ ...base, side: 'buy' })[1]).toBe(0n);
    expect(encodeTerms({ ...base, side: 'sell' })[1]).toBe(1n);
  });

  it('uses the registered pair code', () => {
    expect(encodeTerms(base)[0]).toBe(PAIR_CODES['tNIGHT/USDM']);
  });

  it('rejects an unknown pair rather than silently encoding zero', () => {
    expect(() => encodeTerms({ ...base, pair: 'FAKE/PAIR' })).toThrow(/unknown pair/i);
  });

  it('rejects more precision than the encoding can represent', () => {
    // Silently truncating here would make the dealer's commitment and the taker's recomputation
    // disagree, which reads on-chain as dealer fraud.
    const tooPrecise = '0.' + '0'.repeat(PRICE_DECIMALS) + '1';
    expect(() => encodeTerms({ ...base, price: tooPrecise })).toThrow(/decimal places/i);
  });

  it('rejects negative values', () => {
    expect(() => encodeTerms({ ...base, price: '-0.5' })).toThrow(/non-negative/i);
  });

  it('treats trailing zeros as equal values', () => {
    expect(encodeTerms({ ...base, size: '1000.0' })[3])
      .toBe(encodeTerms({ ...base, size: '1000.000' })[3]);
  });

  it('distinguishes terms that differ only in size', () => {
    expect(encodeTerms(base)).not.toEqual(encodeTerms({ ...base, size: '1000.000001' }));
  });
});
