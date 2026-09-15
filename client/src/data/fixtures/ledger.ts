// Folding protocol events into a ledger — the inverse of derive-events.ts, used to build fixture
// state so every counter and total follows from the events by construction.

import type { BondView, LedgerView, NoteView, ProtocolEvent, QuoteView } from '../ports';

export interface MutableLedger extends LedgerView {
  bonds: Map<string, BondView>;
  settled: Map<string, bigint>;
  slashed: Map<string, bigint>;
  quotes: Map<string, QuoteView>;
  notes: Map<string, NoteView>;
  burnedTotal: bigint;
}

/** Fixture dealers outside a trade scenario have no real quote key; nothing public verifies one. */
export const NO_QUOTE_KEY = Object.freeze({ x: 0n, y: 0n }) as unknown as BondView['quotePk'];

export function emptyLedger(): MutableLedger {
  return { bonds: new Map(), settled: new Map(), slashed: new Map(), quotes: new Map(), notes: new Map(), burnedTotal: 0n };
}

export function cloneLedger(l: LedgerView): MutableLedger {
  return {
    bonds: new Map([...l.bonds].map(([k, v]) => [k, { ...v }])),
    settled: new Map(l.settled),
    slashed: new Map(l.slashed),
    quotes: new Map([...l.quotes].map(([k, v]) => [k, { ...v }])),
    notes: new Map([...l.notes].map(([k, v]) => [k, { ...v }])),
    burnedTotal: l.burnedTotal,
  };
}

function bondOf(l: MutableLedger, cmt: string): BondView {
  const b = l.bonds.get(cmt);
  if (!b) throw new Error(`fixture event references dealer ${cmt.slice(0, 8)} with no bond`);
  return b;
}

function resolveQuote(l: MutableLedger, quoteId: string): QuoteView {
  const q = l.quotes.get(quoteId);
  if (!q || q.resolved) throw new Error(`fixture event resolves quote ${quoteId.slice(0, 8)} that is not live`);
  q.resolved = true;
  const b = l.bonds.get(q.dealerCmt);
  if (b && b.liveQuotes > 0n) b.liveQuotes -= 1n;
  return q;
}

export function applyEvent(l: MutableLedger, e: ProtocolEvent): void {
  switch (e.kind) {
    case 'bond-posted':
      l.bonds.set(e.dealerCmt, { dealerCmt: e.dealerCmt, amount: e.amount, quotePk: NO_QUOTE_KEY, withdrawRequested: 0n, liveQuotes: 0n, active: true });
      l.settled.set(e.dealerCmt, l.settled.get(e.dealerCmt) ?? 0n);
      l.slashed.set(e.dealerCmt, l.slashed.get(e.dealerCmt) ?? 0n);
      return;
    case 'bond-topped-up':
      bondOf(l, e.dealerCmt).amount += e.delta;
      return;
    case 'withdrawal-requested': {
      const b = bondOf(l, e.dealerCmt);
      b.withdrawRequested = e.requestedAt;
      b.active = false;
      return;
    }
    case 'bond-withdrawn':
      l.bonds.delete(e.dealerCmt);
      return;
    case 'quote-sealed': {
      const b = bondOf(l, e.dealerCmt);
      if (!b.active) throw new Error('fixture quote sealed by an inactive dealer');
      if (e.notional > b.amount * 20n) throw new Error('fixture quote exceeds the bond cap');
      l.quotes.set(e.quoteId, { quoteId: e.quoteId, dealerCmt: e.dealerCmt, commitment: e.commitment, validUntil: e.validUntil, rfqId: e.rfqId, notional: e.notional, resolved: false });
      b.liveQuotes += 1n;
      return;
    }
    case 'quote-settled':
      resolveQuote(l, e.quoteId);
      l.settled.set(e.dealerCmt, (l.settled.get(e.dealerCmt) ?? 0n) + 1n);
      return;
    case 'quote-released':
      resolveQuote(l, e.quoteId);
      return;
    case 'bond-slashed': {
      const b = bondOf(l, e.dealerCmt);
      if (e.quoteId) resolveQuote(l, e.quoteId);
      b.amount = 0n;
      b.active = false;
      l.slashed.set(e.dealerCmt, (l.slashed.get(e.dealerCmt) ?? 0n) + 1n);
      l.burnedTotal += e.burned;
      return;
    }
    case 'note-attached':
      l.notes.set(e.tradeId, { tradeId: e.tradeId, ciphertextHash: `${e.tradeId.slice(0, 32)}${'0'.repeat(32)}`, policyTag: e.policyTag, recipientHint: '0'.repeat(64) });
      return;
    case 'unrecognized':
      return;
  }
}

export const ENTRY_POINT_OF: Record<ProtocolEvent['kind'], string> = {
  'bond-posted': 'postBond',
  'bond-topped-up': 'topUpBond',
  'withdrawal-requested': 'requestBondWithdrawal',
  'bond-withdrawn': 'withdrawBond',
  'quote-sealed': 'commitQuote',
  'quote-settled': 'recordSettlement',
  'quote-released': 'releaseExpiredQuote',
  'bond-slashed': 'submitFraudProofMismatch',
  'note-attached': 'attachDisclosureNote',
  unrecognized: 'unknown',
};
