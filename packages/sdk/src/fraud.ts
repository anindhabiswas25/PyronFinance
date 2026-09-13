// Fraud-proof construction and quote-resolution calls — docs/CONTRACTS.md §5.2–5.3. No caller
// authentication anywhere. Security comes from the asserts, not from who submits.
//
// Class B (openSettlementChallenge / submitFraudProofTimeout) was REMOVED on 2026-09-14 — see
// docs/ROADMAP.md "Research: what Class B is still for". Class A below is the only slashing path.

import type { QuoteReveal } from './quotes.js';
import type { DeployedOTCContract } from './types.js';

/** CLASS A — commitment mismatch. Submits a dealer-signed reveal that does not open the
 *  on-chain commitment. Anyone holding such a reveal can call this; the contract verifies the
 *  signature and the commitment mismatch itself (docs/CONTRACTS.md §5.3). */
export async function submitFraudProofMismatch(
  contract: DeployedOTCContract,
  quoteId: Uint8Array,
  reveal: QuoteReveal,
  beneficiary: Uint8Array,
) {
  return contract.callTx.submitFraudProofMismatch(
    quoteId,
    reveal.encodedTerms,
    reveal.nonce,
    reveal.signature,
    beneficiary,
  );
}

/** Records a settled trade: resolves the quote, bumps the dealer's settled counter and frees the
 *  live-quote slot. Dealer-attested — the contract cannot see the Zswap settlement (§5.2). */
export async function recordSettlement(contract: DeployedOTCContract, quoteId: Uint8Array) {
  return contract.callTx.recordSettlement(quoteId);
}

/** Releases a quote that expired unsettled, freeing the dealer's live-quote slot.
 *
 *  Permissionless, and only callable once the fraud-proof grace period after `validUntil` has
 *  elapsed. Without this, an expired unsettled quote pins liveQuotes > 0 forever and the dealer
 *  can never withdraw their bond. */
export async function releaseExpiredQuote(contract: DeployedOTCContract, quoteId: Uint8Array) {
  return contract.callTx.releaseExpiredQuote(quoteId);
}
