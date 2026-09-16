// Protocol events derived from contract actions: each action's entry point plus the difference
// between the contract state before and after it. The contract emits no events of its own; this is
// the only way to reconstruct history, and it uses nothing but public state.
//
// Pure and WASM-free: the live adapter decodes state into LedgerView first.

import type { BondView, LedgerView, ProtocolEvent, ProtocolEventBody, QuoteView } from './ports';
import { splitSlash } from '../lib/slash';
import { BOND_WITHDRAW_DELAY_SECS, NOTIONAL_CAP_K } from '../lib/bond';

/** The compiled contract's circuits. test/unit/derive-events.test.ts checks this against
 *  contracts/managed/otc-protocol/compiler/contract-info.json. */
export const ENTRY_POINTS = [
  'postBond',
  'topUpBond',
  'requestBondWithdrawal',
  'withdrawBond',
  'commitQuote',
  'recordSettlement',
  'releaseExpiredQuote',
  'submitFraudProofMismatch',
  'attachDisclosureNote',
] as const;

export type EntryPoint = (typeof ENTRY_POINTS)[number];

export interface ActionMeta {
  /** GraphQL __typename: ContractDeploy | ContractCall | ContractUpdate. */
  typename: string;
  entryPoint?: string;
  txHash: string;
  height: number;
  /** Unix seconds. */
  timestamp: number;
}

function newlyResolved(prev: LedgerView, next: LedgerView): QuoteView[] {
  const out: QuoteView[] = [];
  for (const q of next.quotes.values()) {
    if (q.resolved && prev.quotes.get(q.quoteId)?.resolved === false) out.push(q);
  }
  return out;
}

export function deriveEvents(prev: LedgerView | undefined, next: LedgerView, meta: ActionMeta): ProtocolEvent[] {
  if (meta.typename === 'ContractDeploy') return [];
  const out: ProtocolEvent[] = [];
  const push = (body: ProtocolEventBody) =>
    out.push({
      id: `${meta.txHash}:${out.length}`,
      txHash: meta.txHash,
      height: meta.height,
      timestamp: meta.timestamp,
      entryPoint: meta.entryPoint ?? meta.typename,
      ...body,
    });

  if (!prev) {
    push({ kind: 'unrecognized', detail: 'no earlier contract state to compare this action against' });
    return out;
  }

  const bondsBefore = prev.bonds;
  switch (meta.entryPoint) {
    case 'postBond':
      for (const b of next.bonds.values()) {
        if (!bondsBefore.has(b.dealerCmt)) push({ kind: 'bond-posted', dealerCmt: b.dealerCmt, amount: b.amount, maxQuote: b.amount * NOTIONAL_CAP_K });
      }
      break;
    case 'topUpBond':
      for (const b of next.bonds.values()) {
        const p = bondsBefore.get(b.dealerCmt);
        if (p && b.amount > p.amount) push({ kind: 'bond-topped-up', dealerCmt: b.dealerCmt, delta: b.amount - p.amount, amount: b.amount });
      }
      break;
    case 'requestBondWithdrawal':
      for (const b of next.bonds.values()) {
        const p = bondsBefore.get(b.dealerCmt);
        if (b.withdrawRequested > 0n && (!p || p.withdrawRequested === 0n)) {
          push({
            kind: 'withdrawal-requested',
            dealerCmt: b.dealerCmt,
            requestedAt: b.withdrawRequested,
            withdrawableAt: b.withdrawRequested + BigInt(BOND_WITHDRAW_DELAY_SECS),
          });
        }
      }
      break;
    case 'withdrawBond':
      for (const p of bondsBefore.values()) {
        if (!next.bonds.has(p.dealerCmt)) push({ kind: 'bond-withdrawn', dealerCmt: p.dealerCmt, amount: p.amount });
      }
      break;
    case 'commitQuote':
      for (const q of next.quotes.values()) {
        if (!prev.quotes.has(q.quoteId)) {
          push({ kind: 'quote-sealed', dealerCmt: q.dealerCmt, quoteId: q.quoteId, rfqId: q.rfqId, commitment: q.commitment, notional: q.notional, validUntil: q.validUntil });
        }
      }
      break;
    case 'recordSettlement':
      for (const q of newlyResolved(prev, next)) push({ kind: 'quote-settled', dealerCmt: q.dealerCmt, quoteId: q.quoteId, notional: q.notional });
      break;
    case 'releaseExpiredQuote':
      for (const q of newlyResolved(prev, next)) push({ kind: 'quote-released', dealerCmt: q.dealerCmt, quoteId: q.quoteId, notional: q.notional });
      break;
    case 'submitFraudProofMismatch': {
      const resolved = newlyResolved(prev, next);
      const burnedDelta = next.burnedTotal - prev.burnedTotal;
      for (const b of next.bonds.values()) {
        const p: BondView | undefined = bondsBefore.get(b.dealerCmt);
        if (!p || p.amount === 0n || b.amount !== 0n || b.active) continue;
        const split = splitSlash(p.amount);
        push({
          kind: 'bond-slashed',
          dealerCmt: b.dealerCmt,
          quoteId: resolved.find((q) => q.dealerCmt === b.dealerCmt)?.quoteId,
          amount: p.amount,
          taker: split.taker,
          prover: split.prover,
          // The chain's own burned delta is authoritative; the computed split is the fallback.
          burned: burnedDelta >= 0n ? burnedDelta : split.burned,
        });
      }
      break;
    }
    case 'attachDisclosureNote':
      for (const n of next.notes.values()) {
        if (!prev.notes.has(n.tradeId)) {
          push({ kind: 'note-attached', tradeId: n.tradeId, dealerCmt: next.quotes.get(n.tradeId)?.dealerCmt, policyTag: n.policyTag });
        }
      }
      break;
    default:
      push({ kind: 'unrecognized', detail: `unknown entry point ${meta.entryPoint ?? meta.typename}` });
      return out;
  }

  if (out.length === 0) push({ kind: 'unrecognized', detail: `${meta.entryPoint} changed nothing this client recognises` });
  return out;
}

/** Counters and totals implied by a list of events — used to cross-check fixtures against the
 *  ledger view they fold into. */
export function tallyEvents(events: readonly ProtocolEvent[]) {
  const settled = new Map<string, bigint>();
  const slashed = new Map<string, bigint>();
  let burned = 0n;
  const bump = (m: Map<string, bigint>, k: string) => m.set(k, (m.get(k) ?? 0n) + 1n);
  for (const e of events) {
    if (e.kind === 'quote-settled') bump(settled, e.dealerCmt);
    if (e.kind === 'bond-slashed') {
      bump(slashed, e.dealerCmt);
      burned += e.burned;
    }
  }
  return { settled, slashed, burned };
}
