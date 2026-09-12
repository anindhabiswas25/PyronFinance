// Schnorr signature verification — the primitive Class-A fraud proofs depend on entirely.
//
// docs/ROADMAP.md claims the SDK signer was cross-verified against a compiled `verifyTest`
// circuit, but no such circuit exists in the tree and no artifact was committed. This file
// re-establishes that verification REPRODUCIBLY, exercising the real compiled schnorr.compact
// through submitFraudProofMismatch — the only production circuit that calls schnorrVerify.
//
// Background on why the two-limb reduction exists at all: a transientHash challenge lives in
// Compact's ~255-bit Field, but ecMul scalars must be valid Jubjub-subgroup scalars (EmbeddedFr,
// ~252 bits). A challenge exceeds that range ~87.5% of the time, so a naive polyfill compiles but
// is broken for almost every input. See compact-contracts SKILL.md §9.

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, prover, bytes32, T0,
  DEALER_SK, TAKER_ADDR, PROVER_ADDR, QUOTE_SK, QUOTE_PK, NOTIONAL
} from './harness.js';
import { deriveQuoteId } from '../../packages/sdk/src/domain.js';
import { sealQuote } from '../../packages/sdk/src/quotes.js';
import { encodeTerms, type QuoteTerms } from '../../packages/sdk/src/terms.js';
import {
  JUBJUB_R, reduceChallengeToScalar, schnorrSign, schnorrVerify,
  schnorrChallenge, freshNonce,
} from '../../packages/sdk/src/schnorr.js';

const REAL: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '1000.0' };
const FRAUD: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0999', size: '1000.0' };

/**
 * Drives the REAL compiled schnorr.compact through submitFraudProofMismatch.
 * Returns true if the in-circuit verification accepted the signature.
 *
 * The terms always mismatch the commitment, so the only way the circuit can revert is on
 * signature verification — which is exactly what we want to probe.
 */
function circuitAcceptsSignature(sk: bigint, tamper?: (s: { announcement: unknown; response: bigint }) => unknown): boolean {
  const sim = new OTCSim();
  const cmt = bondDealer(sim);
  const sealed = sealQuote(REAL, bytes32(1), BigInt(T0 + 600));
  sim.call(dealer(DEALER_SK), 'commitQuote', sealed.rfqId, sealed.commitment, sealed.validUntil, NOTIONAL);
  const quoteId = deriveQuoteId(cmt, sealed.rfqId, sealed.commitment);

  const terms = encodeTerms(FRAUD);
  let sig: unknown = schnorrSign(terms, sk, freshNonce());
  if (tamper) sig = tamper(sig as { announcement: unknown; response: bigint });

  try {
    sim.call(prover(PROVER_ADDR), 'submitFraudProofMismatch',
      quoteId, terms, sealed.nonce, sig as never, TAKER_ADDR);
    return true;
  } catch (e) {
    const msg = String((e as Error).message);
    // A "no fraud" revert would mean verification passed and the mismatch check failed.
    if (/no fraud/i.test(msg)) return true;
    return false;
  }
}

describe('in-circuit Schnorr verification (real compiled schnorr.compact)', () => {
  it('accepts a validly signed message', () => {
    expect(circuitAcceptsSignature(QUOTE_SK)).toBe(true);
  });

  it('rejects a signature from the wrong key', () => {
    expect(circuitAcceptsSignature(0xdeadbeefn)).toBe(false);
  });

  it('rejects a tampered response scalar', () => {
    expect(
      circuitAcceptsSignature(QUOTE_SK, (s) => ({ ...s, response: s.response + 1n })),
    ).toBe(false);
  });
});

describe('challenge reduction — the two-limb range check', () => {
  it('reduces correctly at the R-1 / R / R+1 limb boundary', () => {
    for (const c of [JUBJUB_R - 1n, JUBJUB_R, JUBJUB_R + 1n]) {
      const { quotient, remHi, remLo } = reduceChallengeToScalar(c);
      const remainder = remHi * (1n << 248n) + remLo;
      expect(quotient * JUBJUB_R + remainder).toBe(c);
      // Canonicity: the remainder must be a genuine mod-R residue.
      expect(remainder).toBeLessThan(JUBJUB_R);
      expect(remainder).toBeGreaterThanOrEqual(0n);
    }
  });

  it('always produces a canonical residue below R', () => {
    for (const c of [0n, 1n, 12345n, JUBJUB_R * 3n + 7n, (1n << 254n) - 1n]) {
      const { quotient, remHi, remLo } = reduceChallengeToScalar(c);
      const remainder = remHi * (1n << 248n) + remLo;
      expect(quotient * JUBJUB_R + remainder).toBe(c);
      expect(remainder).toBeLessThan(JUBJUB_R);
    }
  });

  it('keeps remHi within the 4-bit limb the circuit range-checks', () => {
    for (const c of [JUBJUB_R - 1n, JUBJUB_R * 7n + 11n, (1n << 254n) - 1n]) {
      const { quotient, remHi, remLo } = reduceChallengeToScalar(c);
      expect(remHi).toBeLessThanOrEqual(15n);
      expect(remLo).toBeLessThan(1n << 248n);
      expect(quotient).toBeLessThanOrEqual(9n);
    }
  });
});

describe('SDK signer/verifier self-consistency', () => {
  it('verifies its own signatures', () => {
    const msg = encodeTerms(REAL);
    const sig = schnorrSign(msg, QUOTE_SK, freshNonce());
    expect(schnorrVerify(msg, sig, QUOTE_PK)).toBe(true);
  });

  it('rejects a signature over different terms', () => {
    const sig = schnorrSign(encodeTerms(REAL), QUOTE_SK, freshNonce());
    expect(schnorrVerify(encodeTerms(FRAUD), sig, QUOTE_PK)).toBe(false);
  });

  it('produces a response scalar strictly below R', () => {
    // s = (k + c*sk) mod R must be true Euclidean mod-R arithmetic, not native Field
    // arithmetic mod the (different) field modulus p.
    for (let i = 0; i < 20; i++) {
      const sig = schnorrSign(encodeTerms(REAL), QUOTE_SK, freshNonce());
      expect(sig.response).toBeLessThan(JUBJUB_R);
    }
  });

  it('binds the challenge to the announcement and pubkey, not just the message', () => {
    const msg = encodeTerms(REAL);
    const a = schnorrSign(msg, QUOTE_SK, freshNonce());
    const b = schnorrSign(msg, QUOTE_SK, freshNonce());
    // Different nonces => different announcements => different challenges.
    expect(schnorrChallenge(a.announcement, QUOTE_PK, msg))
      .not.toBe(schnorrChallenge(b.announcement, QUOTE_PK, msg));
  });
});
