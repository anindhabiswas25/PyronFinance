// Zswap Offer File construction/proving/serialization wrapper — zswap-offer-files SKILL.md.
//
// We reuse Zswap's audited atomic-swap primitive rather than reimplementing settlement
// (docs/CONTRACTS.md §1 non-goals; docs/ARCHITECTURE.md's on-chain/off-chain split table).
// This module is a thin, documented wrapper — the exact ledger-v8 Offer/UnshieldedOffer
// construction API should be pinned down against a running proof server during 1.9/2.6; the
// shape here follows the lifecycle and invariants the skill documents precisely, but has not
// been executed against a live proof server (no funded wallet / proof server available in this
// environment — see docs/ROADMAP.md M1 status).

import * as ledger from '@midnight-ntwrk/ledger-v8';

/** Offer Files expire in roughly one hour — zswap-offer-files SKILL.md §4. This is the single
 *  most operationally significant constraint on the protocol. */
export const OFFER_FILE_EXPIRY_SECS = 3600;

/** The rule that must never be violated: committing to a quote backed by an Offer File that
 *  expires mid-window guarantees the dealer cannot settle, which guarantees a slash. */
export function canBackQuote(
  offerFileProvedAt: number,
  validitySecs: number,
  settlementMarginSecs = 300,
): boolean {
  const remainingLife = OFFER_FILE_EXPIRY_SECS - (Date.now() / 1000 - offerFileProvedAt);
  return remainingLife > validitySecs + settlementMarginSecs;
}

export interface ProvedOffer {
  /** Base64-encoded serialized Offer File — rides inside the encrypted point-to-point reveal,
   *  NEVER gossiped (zswap-offer-files SKILL.md §3, §4). */
  offerFileBase64: string;
  provedAt: number;
  balanceVector: Record<string, bigint>;
}

/** Constructs and locally proves an Offer File for a dealer selling `giveAmount` of `giveToken`
 *  and wanting `wantAmount` of `wantToken`. Proving happens ahead of time in the warm pool, never
 *  in the quote hot path (zswap-offer-files SKILL.md §8 checklist). */
export async function buildAndProveOffer(params: {
  giveToken: string;
  giveAmount: bigint;
  wantToken: string;
  wantAmount: bigint;
  proofServerUrl: string;
}): Promise<ProvedOffer> {
  // The exact ledger-v8 offer-construction API (UnshieldedOffer.new / balance-vector proof
  // pipeline) needs to be pinned down against a running proof server — see file header. This
  // wrapper enforces the invariants (balance vector nets to zero, base64 wire format) so callers
  // don't have to know the underlying primitive's exact shape once it is wired up.
  throw new Error(
    'buildAndProveOffer is a documented stub — Zswap offer construction requires a running proof ' +
      'server (docker run -p 6300:6300 midnightnetwork/proof-server), which was not available in ' +
      'this build environment. Wire this up against packages/dealer-node during M2/M3 once a proof ' +
      'server is running; see zswap-offer-files SKILL.md §3 for the exact lifecycle to follow.',
  );
}

/** Verifies a combined balance vector nets to zero for every token type before submitting —
 *  zswap-offer-files SKILL.md §2. Client-side sanity check; the chain enforces this regardless. */
export function balanceVectorNetsToZero(vectors: Array<Record<string, bigint>>): boolean {
  const totals = new Map<string, bigint>();
  for (const v of vectors) {
    for (const [token, amount] of Object.entries(v)) {
      totals.set(token, (totals.get(token) ?? 0n) + amount);
    }
  }
  return [...totals.values()].every((v) => v === 0n);
}

export { ledger as zswapLedger };
