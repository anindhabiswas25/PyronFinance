// Sealed commit-reveal client logic (docs/ARCHITECTURE.md Pillar 2).
//
// verifyReveal is the taker's entire defence. It runs in the "COMPARE (in the taker's client
// only)" step, before any settlement, and it is what turns a dealer's claimed price into
// something the taker can act on. Every rejection path below is a distinct attack.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { sealQuote, quoteIdFor, buildReveal, verifyReveal } from '../src/quotes.js';
import { encodeTerms, notionalOf, type QuoteTerms } from '../src/terms.js';
import { minBondForNotional, maxNotionalForBond } from '../src/bonding.js';
import { schnorrPublicKey, schnorrSign, freshNonce } from '../src/schnorr.js';
import { deriveQuoteId, dealerCommitment } from '../src/domain.js';
import { computeSlashSharesFor } from './helpers.js';

const TERMS: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '1000.0' };
const OTHER: QuoteTerms = { ...TERMS, price: '0.0999' };
const RFQ = new Uint8Array(32).fill(9);
const SK = 0x5eed_1234_5678_9abcn;
const PK = schnorrPublicKey(SK);
const FUTURE = Math.floor(Date.now() / 1000) + 600;

afterEach(() => vi.useRealTimers());

describe('sealQuote', () => {
  it('produces a fresh nonce every time', () => {
    const a = sealQuote(TERMS, RFQ, 1n);
    const b = sealQuote(TERMS, RFQ, 1n);
    expect(Buffer.from(a.nonce)).not.toEqual(Buffer.from(b.nonce));
  });

  it('produces a different commitment for identical terms — hiding depends on this', () => {
    // A bare hash of [pair, side, price, size] would be identical here, and brute-forcible in
    // under a second because pair/side/size are already public from the RFQ. Two identical
    // quotes must not be linkable on-chain.
    const a = sealQuote(TERMS, RFQ, 1n);
    const b = sealQuote(TERMS, RFQ, 1n);
    expect(Buffer.from(a.commitment)).not.toEqual(Buffer.from(b.commitment));
  });

  it('uses a full 32 bytes of nonce entropy', () => {
    expect(sealQuote(TERMS, RFQ, 1n).nonce).toHaveLength(32);
  });

  it('derives the quoteId consistently with the domain helper', () => {
    const cmt = dealerCommitment(new Uint8Array(32).fill(4));
    const sealed = sealQuote(TERMS, RFQ, 1n);
    expect(Buffer.from(quoteIdFor(cmt, sealed)))
      .toEqual(Buffer.from(deriveQuoteId(cmt, sealed.rfqId, sealed.commitment)));
  });
});

describe('verifyReveal', () => {
  it('accepts an honest reveal', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    expect(verifyReveal(reveal, sealed.commitment, PK)).toEqual({ valid: true });
  });

  it('rejects a reveal whose terms do not open the commitment', () => {
    // This is the Class-A fraud a taker must detect locally before settling.
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    reveal.encodedTerms = encodeTerms(OTHER);
    reveal.signature = schnorrSign(reveal.encodedTerms, SK, freshNonce());

    const res = verifyReveal(reveal, sealed.commitment, PK);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/does not open/i);
  });

  it('rejects a reveal signed by someone other than the dealer', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, 0xdeadbeefn, 'offer-b64', FUTURE);
    const res = verifyReveal(reveal, sealed.commitment, PK);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/signature/i);
  });

  it('rejects a reveal opened with the wrong nonce', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    reveal.nonce = new Uint8Array(32).fill(7);
    const res = verifyReveal(reveal, sealed.commitment, PK);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/does not open/i);
  });

  it('rejects an expired reveal', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const past = Math.floor(Date.now() / 1000) - 1;
    const reveal = buildReveal(sealed, SK, 'offer-b64', past);
    const res = verifyReveal(reveal, sealed.commitment, PK);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/expired/i);
  });

  it('checks the signature before the commitment — a forged reveal is rejected as forged', () => {
    // Ordering matters for the error a taker sees: an unsigned blob that also fails to open the
    // commitment is a forgery, not dealer fraud, and must not be reported as slashable.
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, 0xbadn, 'offer-b64', FUTURE);
    reveal.encodedTerms = encodeTerms(OTHER);
    expect(verifyReveal(reveal, sealed.commitment, PK).reason).toMatch(/signature/i);
  });

  it('rejects a reveal against a different dealer commitment', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    const otherCommitment = sealQuote(TERMS, RFQ, 1n).commitment;
    expect(verifyReveal(reveal, otherCommitment, PK).valid).toBe(false);
  });

  // M2 task 2.9. The contract cannot open the hiding commitment, so it cannot tie the notional a
  // dealer declares to `commitQuote` to the size they seal. This check is the only thing that does.
  it('accepts a reveal whose size matches the on-chain notional', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    expect(verifyReveal(reveal, sealed.commitment, PK, sealed.notional)).toEqual({ valid: true });
  });

  it('REJECTS an honest-looking reveal when the dealer under-declared notional on-chain', () => {
    // Signature valid, commitment opens — and still unsafe: the bond cap was checked against a
    // smaller size than the dealer is actually quoting.
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, SK, 'offer-b64', FUTURE);
    const res = verifyReveal(reveal, sealed.commitment, PK, sealed.notional - 1n);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/notional/);
  });
});

describe('bond sizing — mirrors OTCProtocol.compact (CONTRACTS.md §7, §7a)', () => {
  it('notionalOf is the tNIGHT size in base units', () => {
    expect(notionalOf({ ...TERMS, size: '0.001' })).toBe(1000n);
    expect(sealQuote(TERMS, RFQ, 1n).notional).toBe(1_000_000_000n);
  });

  it('notionalOf refuses a pair whose base leg is not the bond asset — that needs an oracle', () => {
    expect(() => notionalOf({ ...TERMS, pair: 'USDM/tNIGHT' })).toThrow(/oracle/);
  });

  it('minBondForNotional is the exact ceiling of notional / 20', () => {
    expect(minBondForNotional(1000n)).toBe(50n);
    expect(minBondForNotional(1001n)).toBe(51n);
    expect(minBondForNotional(1n)).toBe(1n);
    for (const n of [1n, 19n, 20n, 21n, 999n, 1_000_000_007n]) {
      const bond = minBondForNotional(n);
      expect(maxNotionalForBond(bond)).toBeGreaterThanOrEqual(n);
      expect(maxNotionalForBond(bond - 1n)).toBeLessThan(n);
    }
  });

  it('minBondForNotional rejects a non-positive notional, as commitQuote does', () => {
    expect(() => minBondForNotional(0n)).toThrow();
  });
});

describe('computeSlashShares — must satisfy the in-circuit range check', () => {
  // The circuit asserts cut*10000 <= amount*bps AND (cut+1)*10000 > amount*bps, i.e. the witness
  // must supply the exact floor. A witness that rounds in its own favour is rejected on-chain.
  const cases = [0n, 1n, 9n, 10n, 999n, 1000n, 1007n, 9999n, 10000n, 123456789n];

  it.each(cases.map((n) => [n]))('exact floor division for amount=%s', (amount) => {
    const { takerCut, proverCut } = computeSlashSharesFor(amount as bigint);
    for (const [cut, bps] of [[takerCut, 6000n], [proverCut, 1000n]] as const) {
      expect(cut * 10000n).toBeLessThanOrEqual(amount * bps);
      expect((cut + 1n) * 10000n).toBeGreaterThan(amount * bps);
    }
  });

  it.each(cases.map((n) => [n]))('shares never exceed the bond for amount=%s', (amount) => {
    const { takerCut, proverCut } = computeSlashSharesFor(amount as bigint);
    expect(takerCut + proverCut).toBeLessThanOrEqual(amount as bigint);
  });
});
