// Contract state hex -> LedgerView. Decoding needs compact-runtime (WASM), so the SDK is imported
// lazily here: a public page renders first and fetches the decoder only when live data is asked for.

import type { OtcLedger } from '@otc/sdk/browser';
import type { BondView, LedgerView, NoteView, QuoteView } from '../ports';

export type Decoder = (stateHex: string, knownDealers?: Iterable<string>) => LedgerView;

let loading: Promise<Decoder> | undefined;

export function loadDecoder(): Promise<Decoder> {
  loading ??= import('@otc/sdk/browser')
    .then((sdk) => (stateHex: string, knownDealers: Iterable<string> = []) => toLedgerView(sdk.decodeOtcLedger(stateHex), knownDealers, sdk.bytesToHex, sdk.hexToBytes))
    .catch((err) => {
      loading = undefined; // never cache a failed load
      throw err;
    });
  return loading;
}

export function toLedgerView(
  l: OtcLedger,
  knownDealers: Iterable<string>,
  hex: (b: Uint8Array) => string,
  unhex: (s: string) => Uint8Array,
): LedgerView {
  const bonds = new Map<string, BondView>();
  for (const [k, b] of l.bonds) {
    const dealerCmt = hex(k);
    bonds.set(dealerCmt, { dealerCmt, amount: b.amount, quotePk: b.quotePk, withdrawRequested: b.withdrawRequested, liveQuotes: b.liveQuotes, active: b.active });
  }
  const quotes = new Map<string, QuoteView>();
  for (const [k, q] of l.quotes) {
    const quoteId = hex(k);
    quotes.set(quoteId, {
      quoteId,
      dealerCmt: hex(q.dealerCmt),
      commitment: hex(q.commitment),
      validUntil: q.validUntil,
      rfqId: hex(q.rfqId),
      notional: q.notional,
      resolved: q.resolved,
    });
  }
  const notes = new Map<string, NoteView>();
  for (const [k, n] of l.notes) {
    const tradeId = hex(k);
    notes.set(tradeId, { tradeId, ciphertextHash: hex(n.ciphertextHash), policyTag: Number(n.policyTag), recipientHint: hex(n.recipientHint) });
  }
  // The counter maps are not iterable: read them for every key we know about.
  const dealerKeys = new Set<string>([...bonds.keys(), ...[...quotes.values()].map((q) => q.dealerCmt), ...knownDealers]);
  const settled = new Map<string, bigint>();
  const slashed = new Map<string, bigint>();
  for (const k of dealerKeys) {
    const kb = unhex(k);
    if (l.settled.member(kb)) settled.set(k, l.settled.lookup(kb).read());
    if (l.slashed.member(kb)) slashed.set(k, l.slashed.lookup(kb).read());
  }
  return { bonds, settled, slashed, quotes, notes, burnedTotal: l.burnedTotal };
}
