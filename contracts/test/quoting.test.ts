// commitQuote — the sealed-commitment half of Pillar 2 (docs/ARCHITECTURE.md).
//
// The validity-window cap is the load-bearing rule here: MAX_QUOTE_VALIDITY exists so a dealer
// cannot sit on a free option indefinitely, and so BOND_WITHDRAW_DELAY can be finite
// (docs/CONTRACTS.md §6).

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, prover, bytes32, T0,
  MAX_QUOTE_VALIDITY, NOTIONAL_CAP_K, NOTIONAL, DEALER_SK, QUOTE_SK, TAKER_ADDR, PROVER_ADDR,
} from './harness.js';
import { deriveQuoteId } from '../../packages/sdk/src/domain.js';
import { sealQuote } from '../../packages/sdk/src/quotes.js';
import { encodeTerms } from '../../packages/sdk/src/terms.js';
import { schnorrSign, freshNonce } from '../../packages/sdk/src/schnorr.js';

describe('commitQuote — validity window', () => {
  it('accepts a spec-compliant window (600s, under MAX_QUOTE_VALIDITY)', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    const validUntil = BigInt(T0 + 600);

    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), validUntil, NOTIONAL);

    const qid = deriveQuoteId(cmt, bytes32(1), bytes32(2));
    expect(sim.ledger.quotes.member(qid)).toBe(true);
    expect(sim.ledger.quotes.lookup(qid).validUntil).toBe(validUntil);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(1n);
  });

  it('accepts a window exactly at MAX_QUOTE_VALIDITY (900s boundary)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + MAX_QUOTE_VALIDITY), NOTIONAL,
    );
    expect(sim.ledger.quotes.size()).toBe(1n);
  });

  it('rejects a window longer than MAX_QUOTE_VALIDITY (1200s)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 1200), NOTIONAL,
    );
    expect(msg).toMatch(/Validity window too long/);
  });

  it('rejects a validUntil already in the past', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 - 10), NOTIONAL,
    );
    expect(msg).toMatch(/validUntil already past/);
  });
});

describe('commitQuote — dealer preconditions', () => {
  it('rejects a non-dealer', () => {
    const sim = new OTCSim();
    const msg = sim.expectRevert(
      dealer(bytes32(0xff)), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL,
    );
    expect(msg).toMatch(/Not a dealer/);
  });

  it('rejects a dealer who has requested withdrawal (active === false)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL,
    );
    expect(msg).toMatch(/Dealer not active/);
  });

  it('rejects a duplicate quote (same dealer, rfqId and commitment)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL);

    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL,
    );
    expect(msg).toMatch(/Duplicate quote/);
  });

  it('allows several distinct quotes and counts them all as live', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(3), bytes32(4), BigInt(T0 + 600), NOTIONAL);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(5), bytes32(6), BigInt(T0 + 600), NOTIONAL);

    expect(sim.ledger.quotes.size()).toBe(3n);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(3n);
  });
});

// ── M2 task 2.9: per-quote notional cap, docs/CONTRACTS.md §7 ─────────────
describe('commitQuote — notional cap (bond must be >= 5% of notional)', () => {
  const BOND = 1000n;

  it('accepts a notional exactly at bond * k', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, BOND);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), BOND * NOTIONAL_CAP_K);
    const qid = deriveQuoteId(cmt, bytes32(1), bytes32(2));
    expect(sim.ledger.quotes.lookup(qid).notional).toBe(BOND * NOTIONAL_CAP_K);
  });

  it('rejects a notional one base unit over bond * k', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, BOND);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600), BOND * NOTIONAL_CAP_K + 1n,
    );
    expect(msg).toMatch(/Notional exceeds bond cap/);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
  });

  it('rejects a zero notional — a quote for nothing is not a quote', () => {
    const sim = new OTCSim();
    bondDealer(sim, BOND);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), 0n);
    expect(msg).toMatch(/Notional must be positive/);
  });

  it('the cap is per quote, not cumulative — k is a sizing rule, not a risk limit', () => {
    // CONTRACTS.md §7 caps each quote's notional against the whole bond. Aggregate exposure across
    // live quotes is the Dealer Node's risk cap (`max_total_notional`, DEALER-NODE.md), not the
    // contract's. This test pins that reading so a change to it is a deliberate one.
    const sim = new OTCSim();
    const cmt = bondDealer(sim, BOND);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), BOND * NOTIONAL_CAP_K);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(3), bytes32(4), BigInt(T0 + 600), BOND * NOTIONAL_CAP_K);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(2n);
  });

  it('topUpBond raises the cap', () => {
    const sim = new OTCSim();
    bondDealer(sim, BOND);
    const over = BOND * NOTIONAL_CAP_K + 1n;
    sim.expectRevert(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), over);
    sim.call(dealer(DEALER_SK), 'topUpBond', 1n);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), over);
    expect(sim.ledger.quotes.size()).toBe(1n);
  });

  it('a slashed dealer can back no notional at all', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, BOND);
    const sealed = sealQuote({ pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '0.001' }, bytes32(9), BigInt(T0 + 600));
    sim.call(dealer(DEALER_SK), 'commitQuote', sealed.rfqId, sealed.commitment, sealed.validUntil, NOTIONAL);
    const fraudTerms = encodeTerms({ pair: 'tNIGHT/USDM', side: 'sell', price: '0.0999', size: '0.001' });
    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      deriveQuoteId(cmt, sealed.rfqId, sealed.commitment), fraudTerms, sealed.nonce,
      schnorrSign(fraudTerms, QUOTE_SK, freshNonce()), TAKER_ADDR);

    const msg = sim.expectRevert(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), 1n);
    // Deactivation is checked first; either refusal is correct, but it must refuse.
    expect(msg).toMatch(/Dealer not active|Notional exceeds bond cap/);
  });
});

describe('quoteId determinism — RELAY.md §3.2', () => {
  it('the SDK derives the same quoteId the contract stores', () => {
    // If these ever diverge, a taker cannot locate a dealer's on-chain commitment from a
    // gossiped reference and the relay design silently breaks.
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    const rfqId = bytes32(11);
    const commitment = bytes32(12);

    sim.call(dealer(DEALER_SK), 'commitQuote', rfqId, commitment, BigInt(T0 + 600), NOTIONAL);

    const expected = deriveQuoteId(cmt, rfqId, commitment);
    expect(sim.ledger.quotes.member(expected)).toBe(true);

    const stored = sim.ledger.quotes.lookup(expected);
    expect(Buffer.from(stored.dealerCmt)).toEqual(Buffer.from(cmt));
    expect(Buffer.from(stored.commitment)).toEqual(Buffer.from(commitment));
    expect(stored.notional).toBe(NOTIONAL);
    expect(stored.resolved).toBe(false);
  });
});
