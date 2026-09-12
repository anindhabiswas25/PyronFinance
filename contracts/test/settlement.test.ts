// Settlement recording, the Class-B challenge path, and quote lifecycle accounting.
// docs/CONTRACTS.md §5.2, docs/ARCHITECTURE.md "Fraud path B".

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, taker, bytes32, T0,
  CHALLENGE_WINDOW, PROOF_GRACE_PERIOD, BOND_WITHDRAW_DELAY,
  DEALER_SK, TAKER_ADDR, QUOTE_PK, NOTIONAL
} from './harness.js';
import { deriveQuoteId, deriveChallengeId } from '../../packages/sdk/src/domain.js';

const RFQ = bytes32(1);
const COMMITMENT = bytes32(2);
const RECIPIENT = bytes32(0xab);

/** Bond a dealer and commit one quote valid for `windowSecs`. */
function bondedWithQuote(windowSecs = 600) {
  const sim = new OTCSim();
  const cmt = bondDealer(sim);
  const validUntil = BigInt(T0 + windowSecs);
  sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, COMMITMENT, validUntil, NOTIONAL);
  return { sim, cmt, quoteId: deriveQuoteId(cmt, RFQ, COMMITMENT), validUntil };
}

describe('recordSettlement — no challenge', () => {
  it('resolves the quote, bumps settled, and releases the live-quote slot', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();

    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, RECIPIENT);

    expect(sim.ledger.quotes.lookup(quoteId).resolved).toBe(true);
    expect(sim.ledger.settled.lookup(cmt).read()).toBe(1n);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
  });

  it("rejects settling another dealer's quote", () => {
    const { sim, quoteId } = bondedWithQuote();
    const other = bytes32(0xbb);
    sim.call(dealer(other), 'postBond', 1000n, QUOTE_PK);
    const msg = sim.expectRevert(
      dealer(other), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, RECIPIENT,
    );
    expect(msg).toMatch(/Not your quote/);
  });

  it('rejects double settlement', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, RECIPIENT);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, RECIPIENT,
    );
    expect(msg).toMatch(/Already resolved/);
  });
});

describe('openSettlementChallenge — Class B', () => {
  it('records a challenge and increments the dealer openChallenges counter', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();

    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0));

    const cid = deriveChallengeId(quoteId, TAKER_ADDR);
    const ch = sim.ledger.challenges.lookup(cid);
    expect(ch.bondAmount).toBe(250n);
    expect(ch.respondBy).toBe(BigInt(T0 + CHALLENGE_WINDOW));
    expect(ch.resolved).toBe(false);
    expect(sim.ledger.bonds.lookup(cmt).openChallenges).toBe(1n);
  });

  it('rejects a challenge against an expired quote — nothing left to honor', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.advanceTo(T0 + 601);
    const msg = sim.expectRevert(
      taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0 + 601),
    );
    expect(msg).toMatch(/Quote expired/);
  });

  it('rejects a challenge bond below 2% of notional (NOTIONAL 1000 needs 20)', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 19n, BigInt(T0));
    expect(msg).toMatch(/below 2% of notional/);
    expect(sim.ledger.bonds.lookup(cmt).openChallenges).toBe(0n);
  });

  it('accepts a challenge bond of exactly 2% of notional', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 20n, BigInt(T0));
    expect(sim.ledger.challenges.lookup(deriveChallengeId(quoteId, TAKER_ADDR)).bondAmount).toBe(20n);
  });

  it('rounds the 2% requirement UP, never in the challenger\'s favour', () => {
    // 2% of 1001 is 20.02: a bond of 20 is short of it and must be refused.
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, COMMITMENT, BigInt(T0 + 600), 1001n);
    const quoteId = deriveQuoteId(cmt, RFQ, COMMITMENT);
    sim.expectRevert(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 20n, BigInt(T0));
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 21n, BigInt(T0));
  });

  it('scales with notional — a flat bond that griefs a small quote is too small for a large one', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, 1000n);
    sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, COMMITMENT, BigInt(T0 + 600), 20_000n);
    const quoteId = deriveQuoteId(cmt, RFQ, COMMITMENT);
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0));
    expect(msg).toMatch(/below 2% of notional/);
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 400n, BigInt(T0));
  });

  it('rejects a zero challenge bond at the floor', () => {
    const { sim, quoteId } = bondedWithQuote();
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 0n, BigInt(T0));
    expect(msg).toMatch(/below floor/);
  });

  it('rejects a duplicate challenge from the same taker', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0));
    const msg = sim.expectRevert(
      taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0),
    );
    expect(msg).toMatch(/Challenge already open/);
  });
});

describe('recordSettlement answering a challenge — this is what prices griefing', () => {
  it('resolves the challenge and clears both counters', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0));
    const cid = deriveChallengeId(quoteId, TAKER_ADDR);

    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: true, value: cid }, RECIPIENT);

    expect(sim.ledger.challenges.lookup(cid).resolved).toBe(true);
    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.openChallenges).toBe(0n);
    expect(bond.liveQuotes).toBe(0n);
    expect(sim.ledger.settled.lookup(cmt).read()).toBe(1n);
  });
});

// ── D3: the bond-lock defect ──────────────────────────────────────────────
describe('expired quotes must not permanently lock the bond', () => {
  it('an expired unsettled quote can be released so the dealer can withdraw', () => {
    // The normal case: a dealer quotes, no taker trades, the quote expires. Without a release
    // path, liveQuotes stays > 0 forever and withdrawBond's `liveQuotes == 0` assertion means an
    // honest dealer can NEVER recover their bond.
    const { sim, cmt, quoteId } = bondedWithQuote();
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(1n);

    // Past expiry AND past the fraud-proof grace period.
    sim.advanceTo(T0 + 600 + PROOF_GRACE_PERIOD);
    sim.call(dealer(DEALER_SK), 'releaseExpiredQuote', quoteId);

    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
    expect(sim.ledger.quotes.lookup(quoteId).resolved).toBe(true);

    // ...and the dealer can now actually exit.
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(sim.time));
    sim.advance(BOND_WITHDRAW_DELAY);
    sim.call(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(sim.ledger.bonds.member(cmt)).toBe(false);
  });

  it('release is permissionless — anyone can clear a stale quote', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();
    sim.advanceTo(T0 + 600 + PROOF_GRACE_PERIOD);
    sim.call(taker(TAKER_ADDR), 'releaseExpiredQuote', quoteId);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
  });

  it('rejects release while the quote is still live', () => {
    const { sim, quoteId } = bondedWithQuote();
    const msg = sim.expectRevert(dealer(DEALER_SK), 'releaseExpiredQuote', quoteId);
    expect(msg).toMatch(/grace period still open|still live/i);
  });

  it('rejects release during the fraud-proof grace period — no self-immunising', () => {
    // A dealer must not be able to release their own expired quote the moment it expires and
    // thereby dodge a Class-A fraud proof (submitFraudProofMismatch asserts !q.resolved).
    const { sim, quoteId } = bondedWithQuote();
    sim.advanceTo(T0 + 600 + PROOF_GRACE_PERIOD - 1);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'releaseExpiredQuote', quoteId);
    expect(msg).toMatch(/grace period still open/i);
  });

  it('rejects releasing an already-resolved quote', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, RECIPIENT);
    sim.advanceTo(T0 + 600 + PROOF_GRACE_PERIOD);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'releaseExpiredQuote', quoteId);
    expect(msg).toMatch(/resolved/i);
  });
});
