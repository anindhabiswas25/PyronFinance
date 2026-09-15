// Browser-safe SDK entry point (Phase 0 task 0.1,
// docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §3). `client/` MUST import from here, never
// from individual `src/*.ts` files directly — that is what keeps a future Node-only addition
// elsewhere in the package from silently breaking the Vite build.
//
// Deliberately excluded, and why:
//   - wallet.ts, providers.ts   — build a Node headless wallet (wallet-sdk-facade + a seed).
//                                  The browser talks to a wallet through the DApp Connector API
//                                  instead (docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §4).
//   - contract.ts               — resolves ZK assets from the filesystem via node:path. The
//                                  browser needs a fetch-based zk-config provider instead (task 0.3).
//   - relay-client-node.ts      — the Node `ws`-backed socket factory. client/ passes the
//                                  browser's native `WebSocket` global as `socketFactory` instead.
//   - wallet-state.ts           — Node wallet snapshot persistence (fs).
//   - inventory.ts              — Dealer Node's UTXO consolidation keeper; not a taker concern.
//   - test-token.ts, test-shielded-token.ts — deploy/mint scripts for Preprod test scaffolding.
//
// offers.ts is intentionally NOT re-exported wholesale: `buildAndProveOffer`/`settleFromOffer`
// still take an `OfferWallet` built from the Node headless wallet (wallet.ts). The pure,
// browser-needed surface — including `serializeOffer`/`deserializeOffer`, now Uint8Array/base64
// based rather than `Buffer`-based — is re-exported individually below.

import { nativeToken } from '@midnight-ntwrk/ledger-v8';

/** The native token's `RawTokenType` — the base leg of every tNIGHT pair, as `offerMatchesTerms`
 *  expects it. ledger-v8 itself is not re-exported. */
export function nativeTokenRaw(): string {
  return nativeToken().raw;
}

export type { RfqBody, QuoteRefBody, Envelope } from '../../relay-node/src/schema.js';
// Wire helpers a browser dealer (and the client's sample data) needs to sign and address gossip.
export { computeId, canonicalJSON, signBody, verifyBodySignature, encodeSignature, decodeSignature, WIRE_VERSION } from '../../relay-node/src/schema.js';
export * from './domain.js';
export * from './terms.js';
export * from './schnorr.js';
export * from './quotes.js';
export * from './bonding.js';
export * from './fraud.js';
export * from './indexer.js';
export * from './reveal-channel.js';
export * from './disclosure.js';
export * from './aead.js';
export * from './ledger-view.js';
export * from './sample-offer.js';
export * from './types.js';
export {
  offerMatchesTerms,
  checkTimeToDismiss,
  dismissReport,
  inputsOf,
  nodeErrorCode,
  balanceVectorNetsToZero,
  balanceVectorOf,
  balanceKey,
  tradeableBalance,
  canBackQuote,
  showVector,
  serializeOffer,
  deserializeOffer,
  describeIntents,
  OfferError,
  OFFER_FILE_EXPIRY_SECS,
  DEFAULT_SETTLEMENT_MARGIN_SECS,
  type BalanceVector,
  type SwapLeg,
  type SettlementResult,
  type DismissReport,
} from './offers.js';
export {
  RelayAggregator,
  InsufficientRelaysError,
  MIN_RELAYS,
  verifyQuoteRef,
  indexerChainReader,
  type ChainReader,
  type ChainQuote,
  type ChainBond,
  type ChainDealer,
  type VerifiedQuote,
  type QuoteRefVerdict,
  type VerifiedAggregate,
  type RejectedRef,
  type AggregationResult,
  type RelayAggregatorOptions,
  type RelayStatus,
  type WebSocketLike,
  type SocketFactory,
} from './relay-client.js';
