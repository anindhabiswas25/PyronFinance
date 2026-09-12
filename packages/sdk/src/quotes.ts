// Sealed commit-reveal quote flow — docs/ARCHITECTURE.md Pillar 2, docs/CONTRACTS.md §5.2.
//
// CRITICAL: commitments use persistentCommit with a fresh 32-byte nonce, never persistentHash.
// See commit-reveal-schemes SKILL.md — a bare hash of [pair, side, price, size] is brute-forcible
// in under a second because pair/side/size are already public from the RFQ.

import { persistentCommit, CompactTypeField, CompactTypeVector } from '@midnight-ntwrk/compact-runtime';
import { deriveQuoteId } from './domain.js';
import { encodeTerms, notionalOf, type QuoteTerms } from './terms.js';
import { schnorrSign, schnorrVerify, freshNonce, type SchnorrSignature } from './schnorr.js';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import type { DeployedOTCContract } from './types.js';

const FieldVector4 = new CompactTypeVector(4, CompactTypeField);

export interface SealedQuote {
  terms: QuoteTerms;
  encodedTerms: bigint[];
  nonce: Uint8Array;
  commitment: Uint8Array;
  rfqId: Uint8Array;
  validUntil: bigint;
  /** Bond-asset base units, disclosed to `commitQuote` for the per-quote bond cap
   *  (docs/CONTRACTS.md §7). Derived from `terms`, never supplied separately, so an honest dealer
   *  cannot commit a notional that disagrees with the size they will reveal. */
  notional: bigint;
}

/** Builds a fresh sealed commitment for a quote. Persist `nonce` to disk BEFORE submitting the
 *  commit transaction — a lost nonce means the dealer can't open their own commitment and gets
 *  slashed. See commit-reveal-schemes SKILL.md §2. */
export function sealQuote(terms: QuoteTerms, rfqId: Uint8Array, validUntil: bigint): SealedQuote {
  const encodedTerms = encodeTerms(terms);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const commitment = persistentCommit(FieldVector4, encodedTerms, nonce);
  return { terms, encodedTerms, nonce, commitment, rfqId, validUntil, notional: notionalOf(terms) };
}

export async function commitQuote(contract: DeployedOTCContract, sealed: SealedQuote) {
  return contract.callTx.commitQuote(sealed.rfqId, sealed.commitment, sealed.validUntil, sealed.notional);
}

/** Recomputes the deterministic on-chain quoteId — publicly recomputable, no lookup service
 *  needed (docs/RELAY.md §3.2). */
export function quoteIdFor(dealerCmt: Uint8Array, sealed: SealedQuote): Uint8Array {
  return deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment);
}

export interface QuoteReveal {
  terms: QuoteTerms;
  encodedTerms: bigint[];
  nonce: Uint8Array;
  signature: SchnorrSignature;
  /** Base64-encoded Zswap Offer File — see offers.ts. */
  offerFile: string;
  expiresAt: number;
}

/** Builds the point-to-point reveal payload a dealer sends to the taker, per docs/RELAY.md §4.
 *  Signs over the plaintext terms with the dealer's quote-signing key — this signature is what
 *  makes a mismatching reveal non-repudiable evidence for submitFraudProofMismatch. See
 *  commit-reveal-schemes SKILL.md §4. */
export function buildReveal(sealed: SealedQuote, dealerSk: bigint, offerFile: string, expiresAt: number): QuoteReveal {
  const signature = schnorrSign(sealed.encodedTerms, dealerSk, freshNonce());
  return {
    terms: sealed.terms,
    encodedTerms: sealed.encodedTerms,
    nonce: sealed.nonce,
    signature,
    offerFile,
    expiresAt,
  };
}

/** Verifies a reveal against the on-chain commitment BEFORE trusting it, per docs/ARCHITECTURE.md's
 *  "COMPARE (in the taker's client only)" step. Checks: signature validity, commitment opens
 *  correctly, and (optionally) the quote hasn't expired. Does NOT touch the chain. */
export function verifyReveal(
  reveal: QuoteReveal,
  onChainCommitment: Uint8Array,
  dealerQuotePk: JubjubPoint,
  /** The `notional` stored on-chain by `commitQuote`. Pass it whenever it is known: the contract
   *  cannot open the hiding commitment, so it cannot check that the declared notional matches the
   *  sealed size. A dealer who under-declares notional slips past the bond cap, and THIS is the
   *  only place that is caught (docs/CONTRACTS.md §7). */
  onChainNotional?: bigint,
): { valid: boolean; reason?: string } {
  if (!schnorrVerify(reveal.encodedTerms, reveal.signature, dealerQuotePk)) {
    return { valid: false, reason: 'signature invalid under dealer quote key' };
  }
  const recomputed = persistentCommit(FieldVector4, reveal.encodedTerms, reveal.nonce);
  if (Buffer.compare(Buffer.from(recomputed), Buffer.from(onChainCommitment)) !== 0) {
    return { valid: false, reason: 'reveal does not open the on-chain commitment' };
  }
  if (onChainNotional !== undefined && reveal.encodedTerms[3] !== onChainNotional) {
    return {
      valid: false,
      reason:
        `revealed size ${reveal.encodedTerms[3]} does not match the notional ${onChainNotional} ` +
        'declared on-chain — the bond cap was checked against the wrong size',
    };
  }
  if (reveal.expiresAt * 1000 < Date.now()) {
    return { valid: false, reason: 'reveal has expired' };
  }
  return { valid: true };
}
