// Settlement recording and quote lifecycle accounting. docs/CONTRACTS.md §5.2.
//
// Class B (settlement challenges, timeout proofs, challenge bonds) was REMOVED on 2026-09-14 — see
// docs/ROADMAP.md "Research: what Class B is still for". The last describe block pins that removal,
// so a challenge path cannot quietly come back.

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, taker, bytes32, T0,
  PROOF_GRACE_PERIOD, BOND_WITHDRAW_DELAY,
  DEALER_SK, TAKER_ADDR, QUOTE_PK, NOTIONAL
} from './harness.js';
import { deriveQuoteId } from '../../packages/sdk/src/domain.js';
import { Contract } from '../managed/otc-protocol/contract/index.js';
import { otcWitnesses } from '../../packages/sdk/src/witnesses.js';

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

describe('recordSettlement', () => {
  it('resolves the quote, bumps settled, and releases the live-quote slot', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();

    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId);

    expect(sim.ledger.quotes.lookup(quoteId).resolved).toBe(true);
    expect(sim.ledger.settled.lookup(cmt).read()).toBe(1n);
    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
  });

  it("rejects settling another dealer's quote", () => {
    const { sim, quoteId } = bondedWithQuote();
    const other = bytes32(0xbb);
    sim.call(dealer(other), 'postBond', 1000n, QUOTE_PK);
    const msg = sim.expectRevert(dealer(other), 'recordSettlement', quoteId);
    expect(msg).toMatch(/Not your quote/);
  });

  it('rejects double settlement', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'recordSettlement', quoteId);
    expect(msg).toMatch(/Already resolved/);
  });

  it('rejects an unknown quote', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'recordSettlement', bytes32(0x99));
    expect(msg).toMatch(/Unknown quote/);
  });

  it('leaves the bond untouched', () => {
    const { sim, cmt, quoteId } = bondedWithQuote();
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId);
    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.amount).toBe(1000n);
    expect(bond.active).toBe(true);
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
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId);
    sim.advanceTo(T0 + 600 + PROOF_GRACE_PERIOD);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'releaseExpiredQuote', quoteId);
    expect(msg).toMatch(/resolved/i);
  });

  it('a withdrawal cannot outrun a live quote', () => {
    const { sim, quoteId } = bondedWithQuote();
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(sim.time));
    sim.advance(BOND_WITHDRAW_DELAY);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(msg).toMatch(/Live quote commitments outstanding/);
    sim.call(taker(TAKER_ADDR), 'releaseExpiredQuote', quoteId);
    sim.call(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
  });
});

describe('Class B is removed (owner decision 2026-09-14)', () => {
  it('the contract exposes no challenge or timeout circuit', () => {
    const circuits = Object.keys(new Contract(otcWitnesses).impureCircuits);
    expect(circuits).not.toContain('openSettlementChallenge');
    expect(circuits).not.toContain('submitFraudProofTimeout');
    expect(circuits.filter((c) => /challenge|timeout/i.test(c))).toEqual([]);
  });

  it('the ledger carries no challenge state', () => {
    const { sim, cmt } = bondedWithQuote();
    expect('challenges' in sim.ledger).toBe(false);
    expect('openChallenges' in sim.ledger.bonds.lookup(cmt)).toBe(false);
  });
});
