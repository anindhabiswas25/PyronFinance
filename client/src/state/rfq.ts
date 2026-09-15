// The /trade state machine. One route, no reloads:
//
//   idle → requesting → sealed → revealed → settling → settled
//                                      ↘ failed{ inputs-spent | wallet-shape | expired | rejected }
//   (any non-terminal) → cancelled
//
// The reducer is pure and fully tested. The store persists every transition to sessionStorage, so a
// reload in Sealed or Compare restores the screen with reveals intact. The per-RFQ X25519 secret key
// lives only there and is wiped at a terminal state.

import { create } from 'zustand';
import type { RfqBody, RevealMessage } from '@otc/sdk/browser';
import type { OfferCheck } from '../lib/compare';
import type { Side } from '../lib/side';
import type { SyncStore } from '../data/ports';

export type RfqPhase = 'idle' | 'requesting' | 'sealed' | 'revealed' | 'settling' | 'settled' | 'failed' | 'cancelled';
export type TradeView = 'request' | 'sealed' | 'compare' | 'settle';
export type FailureReason = 'inputs-spent' | 'wallet-shape' | 'expired' | 'rejected';

export type Verification = 'announced' | 'checking' | 'on-chain' | 'rejected' | 'unverifiable';
export type RevealStatus = 'waiting' | 'decrypting' | 'revealed' | 'reveal-invalid' | 'seal-mismatch' | 'offer-mismatch';

export interface RequestForm {
  side: Side;
  /** Decimal string as typed. */
  size: string;
  pair: string;
  windowSecs: number;
  /** Base units as a decimal string, or undefined for any bond. */
  minBond?: string;
}

export interface QuoteRecord {
  quoteId: string;
  dealerCmt: string;
  relays: string[];
  firstSeen: number;
  verification: Verification;
  reason?: string;
  // From the chain, once verified.
  bond?: bigint;
  settled?: bigint;
  slashed?: bigint;
  validUntil?: number;
  notional?: bigint;
  txHash?: string;
  dealerEndpoint?: string;
  dealerEncPk?: string;
  // The reveal.
  reveal: RevealStatus;
  revealReason?: string;
  /** Kept for evidence and fraud proofs; it is ciphertext plus a signature. */
  message?: RevealMessage;
  terms?: { pair: string; side: Side; price: string; size: string };
  nonce?: string;
  offerFile?: string;
  offerExpiresAt?: number;
  /** Counter-asset base units (counterAmountFor). */
  amount?: bigint;
  offer?: OfferCheck;
  /** Hex-encoded signature over the terms (for fraud proofs). */
  signature?: string;
}

export interface LogLine {
  at: number;
  text: string;
  tone?: 'ok' | 'seal' | 'bad' | 'neutral';
}

export type SettleStageId = 'inputs' | 'balance' | 'check' | 'submit' | 'confirm';

export interface SettlementState {
  quoteId: string;
  trayId?: string;
  startedAt: number;
  stages: Record<SettleStageId, { status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'; detail?: string; ms?: number }>;
  identifier?: string;
  txHash?: string;
  blockHeight?: number;
  mergedSize?: number;
  computePs?: bigint;
  allowancePs?: bigint;
}

export interface Failure {
  reason: FailureReason;
  quoteId: string;
  code?: number;
  detail: string;
  spentBy?: string;
  at: number;
}

export interface RfqState {
  phase: RfqPhase;
  view: TradeView;
  form: RequestForm;
  rfq?: RfqBody;
  takerEncSk?: string;
  publishedAt?: number;
  quotes: Record<string, QuoteRecord>;
  /** Display order: first seen. Never re-sorted by the reducer. */
  order: string[];
  log: LogLine[];
  selected?: string;
  pinned?: string;
  settlement?: SettlementState;
  failure?: Failure;
  error?: string;
  /** Set while the chain can't be read: quotes are paused, not rejected. */
  chainError?: string;
  source?: string;
}

export const initialForm = (pair: string): RequestForm => ({ side: 'sell', size: '', pair, windowSecs: 120 });

export const initialRfqState = (pair = 'tNIGHT/TESTUSD'): RfqState => ({ phase: 'idle', view: 'request', form: initialForm(pair), quotes: {}, order: [], log: [] });

export type RfqAction =
  | { type: 'form'; patch: Partial<RequestForm> }
  | { type: 'request'; at: number }
  | { type: 'request-failed'; error: string }
  | { type: 'published'; rfq: RfqBody; takerEncSk: string; at: number; relays: number }
  | { type: 'announced'; quoteId: string; dealerCmt: string; relays: string[]; at: number }
  | { type: 'checking'; quoteId: string }
  | {
      type: 'verified';
      quoteId: string;
      at: number;
      chain: Required<Pick<QuoteRecord, 'bond' | 'settled' | 'slashed' | 'validUntil' | 'notional' | 'dealerEndpoint' | 'dealerEncPk'>> & { txHash?: string };
      relays: string[];
    }
  | { type: 'rejected'; quoteId: string; reason: string; at: number }
  | { type: 'unverifiable'; quoteId: string; reason: string; at: number }
  | { type: 'decrypting'; quoteId: string; message: RevealMessage }
  | {
      type: 'revealed';
      quoteId: string;
      at: number;
      terms: NonNullable<QuoteRecord['terms']>;
      nonce: string;
      offerFile: string;
      offerExpiresAt: number;
      amount: bigint;
      signature: string;
      offer?: OfferCheck;
    }
  | { type: 'reveal-failed'; quoteId: string; status: 'reveal-invalid' | 'seal-mismatch' | 'offer-mismatch'; reason: string; at: number; terms?: QuoteRecord['terms']; nonce?: string; signature?: string; offerFile?: string }
  | { type: 'offer-checked'; quoteId: string; offer: OfferCheck }
  | { type: 'to-compare'; at: number }
  | { type: 'view'; view: TradeView }
  | { type: 'select'; quoteId: string }
  | { type: 'pin'; quoteId?: string }
  | { type: 'settle-start'; quoteId: string; at: number; trayId?: string }
  | { type: 'settle-stage'; stage: SettleStageId; status: SettlementState['stages'][SettleStageId]['status']; detail?: string; ms?: number }
  | { type: 'settle-info'; patch: Partial<Pick<SettlementState, 'identifier' | 'txHash' | 'blockHeight' | 'mergedSize' | 'computePs' | 'allowancePs' | 'trayId'>> }
  | { type: 'settled'; at: number; txHash: string; blockHeight?: number }
  | { type: 'failed'; failure: Omit<Failure, 'at'>; at: number }
  | { type: 'retry-with'; quoteId: string; at: number }
  | { type: 'cancel'; at: number }
  | { type: 'chain-error'; message?: string; at: number }
  | { type: 'log'; line: LogLine }
  | { type: 'reset'; pair: string };

const TERMINAL: ReadonlySet<RfqPhase> = new Set(['settled', 'failed', 'cancelled']);

export function isTerminal(phase: RfqPhase): boolean {
  return TERMINAL.has(phase);
}

const STAGES: SettleStageId[] = ['inputs', 'balance', 'check', 'submit', 'confirm'];

function withLog(s: RfqState, text: string, at: number, tone?: LogLine['tone']): RfqState {
  return { ...s, log: [...s.log, { at, text, tone }].slice(-200) };
}

function patchQuote(s: RfqState, quoteId: string, patch: Partial<QuoteRecord>): RfqState {
  const current = s.quotes[quoteId];
  if (!current) return s;
  return { ...s, quotes: { ...s.quotes, [quoteId]: { ...current, ...patch } } };
}

const short = (hex: string) => `${hex.slice(0, 4)}…${hex.slice(-2)}`;

export function rfqReducer(s: RfqState, a: RfqAction): RfqState {
  switch (a.type) {
    case 'form':
      if (s.phase !== 'idle') return s;
      return { ...s, form: { ...s.form, ...a.patch }, error: undefined };

    case 'request':
      if (s.phase !== 'idle') return s;
      return { ...s, phase: 'requesting', error: undefined };

    case 'request-failed':
      if (s.phase !== 'requesting') return s;
      return { ...s, phase: 'idle', error: a.error };

    case 'published':
      if (s.phase !== 'requesting') return s;
      return withLog({ ...s, phase: 'sealed', view: 'sealed', rfq: a.rfq, takerEncSk: a.takerEncSk, publishedAt: a.at, quotes: {}, order: [], selected: undefined, pinned: undefined }, `Request sent to ${a.relays} relays`, a.at);

    case 'announced': {
      if (isTerminal(s.phase) || s.phase === 'idle' || s.phase === 'requesting') return s;
      const existing = s.quotes[a.quoteId];
      if (existing) {
        const relays = [...new Set([...existing.relays, ...a.relays])];
        return relays.length === existing.relays.length ? s : patchQuote(s, a.quoteId, { relays });
      }
      const record: QuoteRecord = { quoteId: a.quoteId, dealerCmt: a.dealerCmt, relays: a.relays, firstSeen: a.at, verification: 'announced', reveal: 'waiting' };
      return withLog({ ...s, quotes: { ...s.quotes, [a.quoteId]: record }, order: [...s.order, a.quoteId] }, `${short(a.dealerCmt)} announced · checking chain`, a.at, 'neutral');
    }

    case 'checking':
      return s.quotes[a.quoteId]?.verification === 'on-chain' ? s : patchQuote(s, a.quoteId, { verification: 'checking' });

    case 'verified': {
      const q = s.quotes[a.quoteId];
      if (!q) return s;
      const already = q.verification === 'on-chain';
      const next = patchQuote(s, a.quoteId, { verification: 'on-chain', reason: undefined, ...a.chain, relays: [...new Set([...q.relays, ...a.relays])] });
      return already ? next : withLog(next, `${short(q.dealerCmt)} seal confirmed on-chain`, a.at, 'seal');
    }

    case 'rejected': {
      const q = s.quotes[a.quoteId];
      if (!q || q.verification === 'on-chain') return s;
      const changed = q.verification !== 'rejected' || q.reason !== a.reason;
      const next = patchQuote(s, a.quoteId, { verification: 'rejected', reason: a.reason });
      return changed ? withLog(next, `${short(q.dealerCmt)} dropped: ${a.reason}`, a.at, 'bad') : next;
    }

    case 'unverifiable': {
      const q = s.quotes[a.quoteId];
      if (!q || q.verification === 'on-chain') return s;
      const changed = q.verification !== 'unverifiable';
      const next = patchQuote(s, a.quoteId, { verification: 'unverifiable', reason: a.reason });
      return changed ? withLog(next, `${short(q.dealerCmt)} couldn’t be checked: ${a.reason}`, a.at, 'bad') : next;
    }

    case 'decrypting': {
      const q = s.quotes[a.quoteId];
      if (!q || q.reveal !== 'waiting') return s;
      return patchQuote(s, a.quoteId, { reveal: 'decrypting', message: a.message });
    }

    case 'revealed': {
      const q = s.quotes[a.quoteId];
      if (!q || q.reveal === 'revealed') return s;
      const next = patchQuote(s, a.quoteId, {
        reveal: 'revealed',
        revealReason: undefined,
        terms: a.terms,
        nonce: a.nonce,
        offerFile: a.offerFile,
        offerExpiresAt: a.offerExpiresAt,
        amount: a.amount,
        signature: a.signature,
        offer: a.offer,
      });
      return withLog(next, `${short(q.dealerCmt)} price received, encrypted to you`, a.at, 'ok');
    }

    case 'reveal-failed': {
      const q = s.quotes[a.quoteId];
      if (!q || q.reveal === 'revealed' || q.reveal === a.status) return s;
      const next = patchQuote(s, a.quoteId, { reveal: a.status, revealReason: a.reason, terms: a.terms ?? q.terms, nonce: a.nonce ?? q.nonce, signature: a.signature ?? q.signature, offerFile: a.offerFile ?? q.offerFile });
      const text = a.status === 'seal-mismatch' ? `${short(q.dealerCmt)} sent a price that doesn’t open its seal` : `${short(q.dealerCmt)} reveal rejected: ${a.reason}`;
      return withLog(next, text, a.at, 'bad');
    }

    case 'offer-checked':
      return patchQuote(s, a.quoteId, { offer: a.offer });

    case 'to-compare':
      if (s.phase !== 'sealed' && s.phase !== 'revealed') return s;
      return { ...s, phase: 'revealed', view: 'compare' };

    case 'view': {
      // Back steps back without losing data; forward only to screens the phase has reached.
      const reached: Record<RfqPhase, TradeView[]> = {
        idle: ['request'],
        requesting: ['request'],
        sealed: ['sealed'],
        revealed: ['sealed', 'compare'],
        settling: ['sealed', 'compare', 'settle'],
        settled: ['sealed', 'compare', 'settle'],
        failed: ['sealed', 'compare', 'settle'],
        cancelled: ['request'],
      };
      return reached[s.phase].includes(a.view) ? { ...s, view: a.view } : s;
    }

    case 'select':
      if (s.phase !== 'revealed' && s.phase !== 'sealed') return s;
      return s.quotes[a.quoteId]?.reveal === 'revealed' ? { ...s, selected: a.quoteId, pinned: s.pinned === a.quoteId ? undefined : s.pinned } : s;

    case 'pin':
      return { ...s, pinned: a.quoteId && a.quoteId !== s.selected ? a.quoteId : undefined };

    case 'settle-start': {
      if (s.phase !== 'revealed' && s.phase !== 'sealed') return s;
      if (s.quotes[a.quoteId]?.reveal !== 'revealed') return s;
      const stages = Object.fromEntries(STAGES.map((id) => [id, { status: 'pending' as const }])) as SettlementState['stages'];
      return withLog(
        { ...s, phase: 'settling', view: 'settle', selected: a.quoteId, failure: undefined, settlement: { quoteId: a.quoteId, startedAt: a.at, stages, trayId: a.trayId } },
        `Settling with ${short(s.quotes[a.quoteId].dealerCmt)}`,
        a.at,
        'seal',
      );
    }

    case 'settle-stage': {
      if (s.phase !== 'settling' || !s.settlement) return s;
      return { ...s, settlement: { ...s.settlement, stages: { ...s.settlement.stages, [a.stage]: { status: a.status, detail: a.detail, ms: a.ms } } } };
    }

    case 'settle-info':
      if (!s.settlement) return s;
      return { ...s, settlement: { ...s.settlement, ...a.patch } };

    case 'settled':
      if (s.phase !== 'settling' || !s.settlement) return s;
      return withLog({ ...s, phase: 'settled', takerEncSk: undefined, settlement: { ...s.settlement, txHash: a.txHash, blockHeight: a.blockHeight } }, `Settled in tx ${short(a.txHash)}`, a.at, 'ok');

    case 'failed':
      if (s.phase !== 'settling') return s;
      return withLog({ ...s, phase: 'failed', takerEncSk: undefined, failure: { ...a.failure, at: a.at } }, `Settlement failed: ${a.failure.detail}`, a.at, 'bad');

    case 'retry-with': {
      // "Take the next best": back to Compare with that quote selected. Reveals are already decrypted.
      if (s.phase !== 'failed') return s;
      if (s.quotes[a.quoteId]?.reveal !== 'revealed') return s;
      return withLog({ ...s, phase: 'revealed', view: 'compare', selected: a.quoteId, settlement: undefined }, `Switched to ${short(s.quotes[a.quoteId].dealerCmt)}`, a.at);
    }

    case 'cancel':
      if (isTerminal(s.phase) || s.phase === 'idle') return s;
      return withLog({ ...s, phase: 'cancelled', view: 'request', takerEncSk: undefined }, 'Request cancelled', a.at);

    case 'chain-error':
      if (s.chainError === a.message) return s;
      return a.message ? withLog({ ...s, chainError: a.message }, `Can’t reach the chain — quotes paused (${a.message})`, a.at, 'bad') : withLog({ ...s, chainError: undefined }, 'Chain reachable again', a.at);

    case 'log':
      return { ...s, log: [...s.log, a.line].slice(-200) };

    case 'reset':
      return initialRfqState(a.pair);
  }
}

// ---------------------------------------------------------------------------------------------
// Store with sessionStorage persistence
// ---------------------------------------------------------------------------------------------

const KEY = 'trade';

interface RfqStore {
  state: RfqState;
  store?: SyncStore;
  /** Binds the store to a storage namespace (data source + network) and restores what is there. */
  attach(store: SyncStore, pair: string): void;
  dispatch(action: RfqAction): void;
}

export const useRfq = create<RfqStore>((set, get) => ({
  state: initialRfqState(),
  attach(store, pair) {
    const saved = store.get<RfqState>(KEY);
    set({ store, state: saved && saved.form ? saved : initialRfqState(pair) });
  },
  dispatch(action) {
    const { state, store } = get();
    const next = rfqReducer(state, action);
    if (next === state) return;
    set({ state: next });
    store?.set(KEY, next);
  },
}));
