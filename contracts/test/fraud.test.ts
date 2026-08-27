// Fraud proofs — the mechanism the whole protocol exists for (docs/CONTRACTS.md §5.3).
//
// This file contains the M1 definition-of-done in simulation:
//   bond -> commit -> deliberately mismatched reveal -> fraud proof -> slash.
//
// The negative cases matter more than the happy path. A fraud circuit that slashes when it
// should is only half correct; one that slashes when it should NOT lets anyone destroy an
// honest dealer's bond.

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, taker, prover, bytes32, T0,
  CHALLENGE_WINDOW, DEALER_SK, TAKER_ADDR, PROVER_ADDR, QUOTE_SK, QUOTE_PK,
  SLASH_TAKER_BPS, SLASH_PROVER_BPS,
} from './harness.js';
import { deriveQuoteId, deriveChallengeId } from '../../packages/sdk/src/domain.js';
import { sealQuote } from '../../packages/sdk/src/quotes.js';
import { encodeTerms, type QuoteTerms } from '../../packages/sdk/src/terms.js';
import { schnorrSign, schnorrPublicKey, freshNonce } from '../../packages/sdk/src/schnorr.js';

const REAL_TERMS: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '1000.0' };
const FRAUD_TERMS: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0999', size: '1000.0' };

const RFQ = bytes32(1);
const BOND = 1000n;

/** Bond a dealer, seal a quote over REAL_TERMS, and commit it on-chain. */
function committed(bond = BOND) {
  const sim = new OTCSim();
  const cmt = bondDealer(sim, bond);
  const sealed = sealQuote(REAL_TERMS, RFQ, BigInt(T0 + 600));
  sim.call(dealer(DEALER_SK), 'commitQuote', sealed.rfqId, sealed.commitment, sealed.validUntil);
  return { sim, cmt, sealed, quoteId: deriveQuoteId(cmt, sealed.rfqId, sealed.commitment) };
}

describe('submitFraudProofMismatch — Class A (M1 definition of done)', () => {
  it('slashes a dealer whose signed reveal does not open their commitment', () => {
    const { sim, cmt, sealed, quoteId } = committed();

    // The fraud: sign terms different from what was committed, reusing the committed nonce.
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());

    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);

    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.amount).toBe(0n);
    expect(bond.active).toBe(false);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(1n);
    expect(sim.ledger.quotes.lookup(quoteId).resolved).toBe(true);
  });

  it('burns exactly the remainder — no value created or destroyed', () => {
    const { sim, sealed, quoteId } = committed();
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());

    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);

    const takerCut = (BOND * SLASH_TAKER_BPS) / 10000n;
    const proverCut = (BOND * SLASH_PROVER_BPS) / 10000n;
    expect(sim.ledger.burnedTotal).toBe(BOND - takerCut - proverCut);
    // 60/10/30 on 1000 => 600 taker, 100 prover, 300 burned.
    expect(sim.ledger.burnedTotal).toBe(300n);
  });

  it('REJECTS a reveal that correctly opens the commitment — this is not fraud', () => {
    const { sim, cmt, sealed, quoteId } = committed();
    const honestTerms = sealed.encodedTerms;
    const sig = schnorrSign(honestTerms, QUOTE_SK, freshNonce());

    const msg = sim.expectRevert(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, honestTerms, sealed.nonce, sig, TAKER_ADDR);

    expect(msg).toMatch(/no fraud/i);
    expect(sim.ledger.bonds.lookup(cmt).amount).toBe(BOND);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(0n);
  });

  it('REJECTS a reveal signed by the wrong key — cannot frame an honest dealer', () => {
    // Without in-circuit signature verification, anyone could fabricate a mismatching reveal
    // and slash any dealer they liked. This test is the guard on that.
    const { sim, cmt, sealed, quoteId } = committed();
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const attackerSk = 0xbadbadbadn;
    const sig = schnorrSign(fraudTerms, attackerSk, freshNonce());

    expect(() =>
      sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
        quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR),
    ).toThrow();

    expect(sim.ledger.bonds.lookup(cmt).amount).toBe(BOND);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(0n);
  });

  it('REJECTS a tampered signature response', () => {
    const { sim, cmt, sealed, quoteId } = committed();
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());
    const tampered = { ...sig, response: sig.response + 1n };

    expect(() =>
      sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
        quoteId, fraudTerms, sealed.nonce, tampered, TAKER_ADDR),
    ).toThrow();

    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(0n);
  });

  it('rejects a second fraud proof against the same quote', () => {
    const { sim, sealed, quoteId } = committed();
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());

    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);
    const msg = sim.expectRevert(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);

    expect(msg).toMatch(/already resolved/i);
  });

  it('releases the live-quote slot when it slashes', () => {
    const { sim, cmt, sealed, quoteId } = committed();
    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());

    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);

    expect(sim.ledger.bonds.lookup(cmt).liveQuotes).toBe(0n);
  });
});

describe('submitFraudProofTimeout — Class B', () => {
  function challenged() {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, BOND);
    const commitment = bytes32(2);
    sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, commitment, BigInt(T0 + 600));
    const quoteId = deriveQuoteId(cmt, RFQ, commitment);
    sim.call(taker(TAKER_ADDR), 'openSettlementChallenge', quoteId, 250n, BigInt(T0));
    return { sim, cmt, quoteId, challengeId: deriveChallengeId(quoteId, TAKER_ADDR) };
  }

  it('rejects the proof while the dealer still has time to respond', () => {
    const { sim, challengeId } = challenged();
    sim.advanceTo(T0 + CHALLENGE_WINDOW - 1);
    const msg = sim.expectRevert(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);
    expect(msg).toMatch(/Response window still open/);
  });

  it('slashes once the response window closes unanswered', () => {
    const { sim, cmt, quoteId, challengeId } = challenged();
    sim.advanceTo(T0 + CHALLENGE_WINDOW);

    sim.call(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);

    expect(sim.ledger.bonds.lookup(cmt).amount).toBe(0n);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(1n);
    expect(sim.ledger.challenges.lookup(challengeId).resolved).toBe(true);
    expect(sim.ledger.quotes.lookup(quoteId).resolved).toBe(true);
  });

  it('clears both obligation counters when it slashes', () => {
    const { sim, cmt, challengeId } = challenged();
    sim.advanceTo(T0 + CHALLENGE_WINDOW);
    sim.call(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);

    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.openChallenges).toBe(0n);
    expect(bond.liveQuotes).toBe(0n);
  });

  it('rejects a repeat proof on an already-resolved challenge', () => {
    const { sim, challengeId } = challenged();
    sim.advanceTo(T0 + CHALLENGE_WINDOW);
    sim.call(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);
    const msg = sim.expectRevert(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);
    expect(msg).toMatch(/already resolved/i);
  });

  it('a dealer who settles in time cannot then be slashed', () => {
    const { sim, cmt, quoteId, challengeId } = challenged();
    sim.advanceTo(T0 + 100);
    sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: true, value: challengeId }, bytes32(0xab));

    sim.advanceTo(T0 + CHALLENGE_WINDOW + 1);
    const msg = sim.expectRevert(prover(PROVER_ADDR), 'submitFraudProofTimeout', challengeId);

    expect(msg).toMatch(/already resolved/i);
    expect(sim.ledger.bonds.lookup(cmt).amount).toBe(BOND);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(0n);
  });
});

describe('slash arithmetic', () => {
  it('handles a bond that does not divide evenly — burn absorbs the remainder', () => {
    const odd = 1007n;
    const { sim, sealed, quoteId } = committed(odd);

    const fraudTerms = encodeTerms(FRAUD_TERMS);
    const sig = schnorrSign(fraudTerms, QUOTE_SK, freshNonce());

    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, fraudTerms, sealed.nonce, sig, TAKER_ADDR);

    const takerCut = (odd * SLASH_TAKER_BPS) / 10000n;   // 604
    const proverCut = (odd * SLASH_PROVER_BPS) / 10000n; // 100
    expect(sim.ledger.burnedTotal).toBe(odd - takerCut - proverCut); // 303
  });
});

describe('schnorr key derivation', () => {
  it('the SDK public key matches what the contract verifies against', () => {
    expect(schnorrPublicKey(QUOTE_SK)).toEqual(QUOTE_PK);
  });
});
