// Pure views over the ledger and protocol events for the public pages. WASM-free, fully testable.
// Nothing here ever sees a price: the chain has none.

import type { BondView, LedgerView, ProtocolEvent } from './ports';
import { NOTIONAL_CAP_K } from '../lib/bond';

// ---------------------------------------------------------------------------------------------
// Protocol totals
// ---------------------------------------------------------------------------------------------

export interface ProtocolTotals {
  resolvedQuotes: bigint;
  liveQuotes: bigint;
  /** Dealers whose bond is active and non-zero. */
  bondedDealers: number;
  /** Sum of every bond still held by the contract (active and withdrawing). */
  totalBonded: bigint;
  bondsSlashed: bigint;
  burned: bigint;
}

export function protocolTotals(view: LedgerView): ProtocolTotals {
  let resolvedQuotes = 0n;
  let liveQuotes = 0n;
  for (const q of view.quotes.values()) {
    if (q.resolved) resolvedQuotes += 1n;
    else liveQuotes += 1n;
  }
  let bondedDealers = 0;
  let totalBonded = 0n;
  for (const b of view.bonds.values()) {
    totalBonded += b.amount;
    if (b.active && b.amount > 0n) bondedDealers += 1;
  }
  let bondsSlashed = 0n;
  for (const n of view.slashed.values()) bondsSlashed += n;
  return { resolvedQuotes, liveQuotes, bondedDealers, totalBonded, bondsSlashed, burned: view.burnedTotal };
}

// ---------------------------------------------------------------------------------------------
// Dealers
// ---------------------------------------------------------------------------------------------

export type DealerStatus = 'active' | 'withdrawing' | 'withdrawn' | 'slashed' | 'inactive';

export function dealerStatus(bond: BondView | undefined, slashed: bigint): DealerStatus {
  if (!bond) return 'withdrawn';
  if (slashed > 0n && bond.amount === 0n && !bond.active) return 'slashed';
  if (bond.withdrawRequested > 0n) return 'withdrawing';
  return bond.active ? 'active' : 'inactive';
}

export interface DealerRow {
  dealerCmt: string;
  status: DealerStatus;
  bond: bigint;
  /** bond × 20 while the dealer can quote; undefined otherwise. */
  largestQuote?: bigint;
  settled: bigint;
  slashed: bigint;
  liveQuotes: bigint;
  /** Published failure evidence has no source yet (open decision): always undefined. */
  failures?: bigint;
  lastQuoteAt?: number;
  bondedAt?: number;
  bondedHeight?: number;
  withdrawableAt?: bigint;
}

export function dealerRows(view: LedgerView, events: readonly ProtocolEvent[]): DealerRow[] {
  const keys = new Set<string>([...view.bonds.keys(), ...view.settled.keys(), ...view.slashed.keys()]);
  const lastQuote = new Map<string, number>();
  const bonded = new Map<string, { at: number; height: number }>();
  for (const e of events) {
    if (e.kind === 'quote-sealed') lastQuote.set(e.dealerCmt, Math.max(lastQuote.get(e.dealerCmt) ?? 0, e.timestamp));
    if (e.kind === 'bond-posted' && !bonded.has(e.dealerCmt)) bonded.set(e.dealerCmt, { at: e.timestamp, height: e.height });
    if ('dealerCmt' in e && e.dealerCmt) keys.add(e.dealerCmt);
  }
  return [...keys].map((dealerCmt) => {
    const bond = view.bonds.get(dealerCmt);
    const slashed = view.slashed.get(dealerCmt) ?? 0n;
    const status = dealerStatus(bond, slashed);
    return {
      dealerCmt,
      status,
      bond: bond?.amount ?? 0n,
      largestQuote: status === 'active' && bond ? bond.amount * NOTIONAL_CAP_K : undefined,
      settled: view.settled.get(dealerCmt) ?? 0n,
      slashed,
      liveQuotes: bond?.liveQuotes ?? 0n,
      lastQuoteAt: lastQuote.get(dealerCmt),
      bondedAt: bonded.get(dealerCmt)?.at,
      bondedHeight: bonded.get(dealerCmt)?.height,
      withdrawableAt: bond && bond.withdrawRequested > 0n ? bond.withdrawRequested + 86_400n : undefined,
    };
  });
}

export type DealerTab = 'all' | 'active' | 'withdrawing' | 'slashed';
export type DealerSort = 'bond' | 'settled' | 'slashed' | 'failures' | 'lastQuote';

export function inTab(row: DealerRow, tab: DealerTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'active') return row.status === 'active';
  if (tab === 'withdrawing') return row.status === 'withdrawing' || row.status === 'withdrawn';
  return row.status === 'slashed';
}

export function matchesKey(row: DealerRow, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^0x/, '');
  return q === '' || row.dealerCmt.startsWith(q);
}

const big = (a: bigint | undefined, b: bigint | undefined) => {
  const x = a ?? -1n;
  const y = b ?? -1n;
  return x === y ? 0 : x > y ? -1 : 1;
};

/** Descending by the chosen column, ties broken by dealer key, so the order is stable and total. */
export function sortDealers(rows: readonly DealerRow[], sort: DealerSort): DealerRow[] {
  const cmp = (a: DealerRow, b: DealerRow): number => {
    switch (sort) {
      case 'bond':
        return big(a.bond, b.bond);
      case 'settled':
        return big(a.settled, b.settled);
      case 'slashed':
        return big(a.slashed, b.slashed);
      case 'failures':
        return big(a.failures, b.failures);
      case 'lastQuote':
        return (b.lastQuoteAt ?? -1) - (a.lastQuoteAt ?? -1);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || (a.dealerCmt < b.dealerCmt ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// One dealer
// ---------------------------------------------------------------------------------------------

export interface BondPoint {
  t: number;
  amount: bigint;
  kind: 'posted' | 'topped-up' | 'withdrawal-requested' | 'withdrawn' | 'slashed';
}

export function bondHistory(events: readonly ProtocolEvent[], dealerCmt: string): BondPoint[] {
  const out: BondPoint[] = [];
  let amount = 0n;
  for (const e of events) {
    if (!('dealerCmt' in e) || e.dealerCmt !== dealerCmt) continue;
    if (e.kind === 'bond-posted') amount = e.amount;
    else if (e.kind === 'bond-topped-up') amount = e.amount;
    else if (e.kind === 'bond-withdrawn' || e.kind === 'bond-slashed') amount = 0n;
    else if (e.kind !== 'withdrawal-requested') continue;
    const kind =
      e.kind === 'bond-posted' ? 'posted' : e.kind === 'bond-topped-up' ? 'topped-up' : e.kind === 'bond-withdrawn' ? 'withdrawn' : e.kind === 'bond-slashed' ? 'slashed' : 'withdrawal-requested';
    out.push({ t: e.timestamp, amount, kind });
  }
  return out;
}

export type QuoteOutcome = 'settled' | 'released' | 'slashed' | 'live' | 'expired';

export interface DealerQuote {
  quoteId: string;
  notional: bigint;
  validUntil: bigint;
  sealedAt: number;
  outcome: QuoteOutcome;
  resolvedAt?: number;
  txHash: string;
}

/** Newest first. `expired` = unresolved past validUntil (releasable after the 1 h grace period). */
export function dealerQuotes(view: LedgerView, events: readonly ProtocolEvent[], dealerCmt: string, now: number): DealerQuote[] {
  const byId = new Map<string, DealerQuote>();
  for (const e of events) {
    if (e.kind === 'quote-sealed' && e.dealerCmt === dealerCmt) {
      byId.set(e.quoteId, { quoteId: e.quoteId, notional: e.notional, validUntil: e.validUntil, sealedAt: e.timestamp, outcome: 'live', txHash: e.txHash });
    } else if ((e.kind === 'quote-settled' || e.kind === 'quote-released') && byId.has(e.quoteId)) {
      const q = byId.get(e.quoteId)!;
      q.outcome = e.kind === 'quote-settled' ? 'settled' : 'released';
      q.resolvedAt = e.timestamp;
    } else if (e.kind === 'bond-slashed' && e.quoteId && byId.has(e.quoteId)) {
      const q = byId.get(e.quoteId)!;
      q.outcome = 'slashed';
      q.resolvedAt = e.timestamp;
    }
  }
  for (const q of byId.values()) {
    if (q.outcome !== 'live') continue;
    const onChain = view.quotes.get(q.quoteId);
    if (onChain?.resolved) q.outcome = 'released';
    else if (q.validUntil <= BigInt(now)) q.outcome = 'expired';
  }
  return [...byId.values()].sort((a, b) => b.sealedAt - a.sealedAt);
}

// ---------------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------------

export type ActivityFilter = 'all' | 'trades' | 'slashes' | 'releases' | 'bonds';

export function activityMatches(e: ProtocolEvent, filter: ActivityFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'trades':
      return e.kind === 'quote-settled' || e.kind === 'quote-sealed' || e.kind === 'note-attached';
    case 'slashes':
      return e.kind === 'bond-slashed';
    case 'releases':
      return e.kind === 'quote-released';
    case 'bonds':
      return e.kind === 'bond-posted' || e.kind === 'bond-topped-up' || e.kind === 'withdrawal-requested' || e.kind === 'bond-withdrawn';
  }
}

export function dealerOf(e: ProtocolEvent): string | undefined {
  return 'dealerCmt' in e ? e.dealerCmt : undefined;
}
