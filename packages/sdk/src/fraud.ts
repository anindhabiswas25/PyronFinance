// Fraud-proof construction — docs/CONTRACTS.md §5.3. Both circuits are callable by anyone; no
// caller authentication anywhere. Security comes from the asserts, not from who submits.

import { deriveChallengeId } from './domain.js';
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

export function challengeIdFor(quoteId: Uint8Array, takerAddr: Uint8Array): Uint8Array {
  return deriveChallengeId(quoteId, takerAddr);
}

export async function openSettlementChallenge(
  contract: DeployedOTCContract,
  quoteId: Uint8Array,
  bondAmount: bigint,
  now: bigint = BigInt(Math.floor(Date.now() / 1000)),
) {
  return contract.callTx.openSettlementChallenge(quoteId, bondAmount, now);
}

/** CLASS B — failure to honor a live quote, proven by an unanswered settlement challenge.
 *  Callable by anyone once the challenge's response window has closed. */
export async function submitFraudProofTimeout(contract: DeployedOTCContract, challengeId: Uint8Array) {
  return contract.callTx.submitFraudProofTimeout(challengeId);
}

/** Records a settled trade, optionally answering an open challenge.
 *
 *  `recipient` is the dealer's unshielded wallet address, used to refund the taker's challenge
 *  bond when `challengeId` is supplied. It must be a real address: the dealer commitment is an
 *  identity hash, not an address, and refunding to it would burn the bond.
 */
export async function recordSettlement(
  contract: DeployedOTCContract,
  quoteId: Uint8Array,
  recipient: Uint8Array,
  challengeId?: Uint8Array,
) {
  const challengeIdParam = challengeId
    ? { is_some: true, value: challengeId }
    : { is_some: false, value: new Uint8Array(32) };
  return contract.callTx.recordSettlement(quoteId, challengeIdParam, recipient);
}

/** Releases a quote that expired unsettled, freeing the dealer's live-quote slot.
 *
 *  Permissionless, and only callable once the fraud-proof grace period after `validUntil` has
 *  elapsed. Without this, an expired unsettled quote pins liveQuotes > 0 forever and the dealer
 *  can never withdraw their bond. */
export async function releaseExpiredQuote(contract: DeployedOTCContract, quoteId: Uint8Array) {
  return contract.callTx.releaseExpiredQuote(quoteId);
}
