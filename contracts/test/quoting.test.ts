// commitQuote — the sealed-commitment half of Pillar 2 (docs/ARCHITECTURE.md).
//
// The validity-window cap is the load-bearing rule here: MAX_QUOTE_VALIDITY exists so a dealer
// cannot sit on a free option indefinitely, and so BOND_WITHDRAW_DELAY can be finite
// (docs/CONTRACTS.md §6).

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, bytes32, T0,
  MAX_QUOTE_VALIDITY, DEALER_SK, QUOTE_PK,
} from './harness.js';
import { deriveQuoteId } from '../../packages/sdk/src/domain.js';

describe('commitQuote — validity window', () => {
  it('accepts a spec-compliant window (600s, under MAX_QUOTE_VALIDITY)', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    const validUntil = BigInt(T0 + 600);

    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), validUntil);

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
      bytes32(1), bytes32(2), BigInt(T0 + MAX_QUOTE_VALIDITY),
    );
    expect(sim.ledger.quotes.size()).toBe(1n);
  });

  it('rejects a window longer than MAX_QUOTE_VALIDITY (1200s)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 1200),
    );
    expect(msg).toMatch(/Validity window too long/);
  });

  it('rejects a validUntil already in the past', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 - 10),
    );
    expect(msg).toMatch(/validUntil already past/);
  });
});

describe('commitQuote — dealer preconditions', () => {
  it('rejects a non-dealer', () => {
    const sim = new OTCSim();
    const msg = sim.expectRevert(
      dealer(bytes32(0xff)), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600),
    );
    expect(msg).toMatch(/Not a dealer/);
  });

  it('rejects a dealer who has requested withdrawal (active === false)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600),
    );
    expect(msg).toMatch(/Dealer not active/);
  });

  it('rejects a duplicate quote (same dealer, rfqId and commitment)', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600));

    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'commitQuote',
      bytes32(1), bytes32(2), BigInt(T0 + 600),
    );
    expect(msg).toMatch(/Duplicate quote/);
  });

  it('allows several distinct quotes and counts them all as live', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600));
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(3), bytes32(4), BigInt(T0 + 600));
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(5), bytes32(6), BigInt(T0 + 600));

    expect(sim.ledger.quotes.size()).toBe(3n);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(3n);
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

    sim.call(dealer(DEALER_SK), 'commitQuote', rfqId, commitment, BigInt(T0 + 600));

    const expected = deriveQuoteId(cmt, rfqId, commitment);
    expect(sim.ledger.quotes.member(expected)).toBe(true);

    const stored = sim.ledger.quotes.lookup(expected);
    expect(Buffer.from(stored.dealerCmt)).toEqual(Buffer.from(cmt));
    expect(Buffer.from(stored.commitment)).toEqual(Buffer.from(commitment));
    expect(stored.resolved).toBe(false);
  });
});
