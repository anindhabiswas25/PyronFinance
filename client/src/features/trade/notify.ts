// What a running trade needs from the user, and what has happened, as notification-centre entries.
// Pure: the whole set is derived from the trade state every time and state/notifications.ts reconciles
// it, so an entry updates in place and a "needs you" entry resolves once the state moves past it.
// No SDK import: this runs in the shell on every page.
//
// Actions never settle. A ready or expiring quote opens Compare with it selected, where its cautions
// (slashes, small bond, weakest record) are on screen before the user presses Settle.

import type { PairConfig } from '../../config/networks';
import type { NoticeButton, NoticeDraft } from '../../state/notifications';
import type { RfqState } from '../../state/rfq';
import { bestQuote, isValidAt } from '../../lib/compare';
import { formatUnits, truncateHash } from '../../lib/format';
import { splitSlash } from '../../lib/slash';
import { takerReceivesCounter } from '../../lib/side';
import { fmtBase } from '../shared/protocol';
import { compareQuotesOf } from './useCompare';

export const TRADE_NOTICE_PREFIX = 'trade:';

/** Seconds before the window closes, or a quote expires, that off-page users are told. */
export const WINDOW_CLOSING_SECS = 15;
export const QUOTE_EXPIRING_SECS = 30;
/** A reloaded page takes a moment to reconnect its relays; don't call that an outage. */
const RELAY_GRACE_SECS = 5;

export interface NoticeContext {
  /** Unix seconds. */
  now: number;
  /** The user is on /trade, where the screen itself shows the trade. */
  onTrade: boolean;
  pair?: PairConfig;
  /** Relay sockets open. */
  relaysConnected: number;
  walletLost: boolean;
  /** Quotes whose fraud proof landed from this tab. */
  provenQuotes: ReadonlySet<string>;
}

export function tradeNotices(s: RfqState, ctx: NoticeContext): NoticeDraft[] {
  const rfq = s.rfq;
  if (!rfq || s.phase === 'idle' || s.phase === 'requesting' || s.phase === 'cancelled') return [];

  const out: NoticeDraft[] = [];
  const key = (name: string) => `${TRADE_NOTICE_PREFIX}${rfq.rfqId}:${name}`;
  const pair = ctx.pair;
  const baseSymbol = pair?.base.symbol ?? '';
  const counter = (v: bigint) => (pair ? `${formatUnits(v, pair.counter.decimals, { minFraction: 2 })} ${pair.counter.symbol}` : v.toString());
  const base = (v: bigint) => (pair ? `${formatUnits(v, pair.base.decimals, { minFraction: 2 })} ${baseSymbol}` : v.toString());
  const dealer = (cmt: string) => (cmt ? `dealer ${truncateHash(cmt)}` : 'a dealer');
  const receives = takerReceivesCounter(rfq.side);

  const live = s.phase === 'sealed' || s.phase === 'revealed';
  const remaining = rfq.expiry - ctx.now;
  const quotes = s.order.map((id) => s.quotes[id]).filter(Boolean);
  const compare = compareQuotesOf(s, ctx.now);
  const valid = compare.filter((q) => isValidAt(q, ctx.now));
  const best = bestQuote(compare, rfq.side, ctx.now);
  const onCompare = ctx.onTrade && s.view === 'compare';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  out.push({
    key: key('sent'),
    kind: 'update',
    tone: 'neutral',
    title: 'Request sent',
    body: `${rfq.side === 'sell' ? 'Sell' : 'Buy'} ${rfq.size} ${baseSymbol}${pair ? ` for ${pair.counter.symbol}` : ''}. No price was sent.`,
    actions: [],
  });

  const bound = quotes.filter((q) => q.verification === 'on-chain');
  if (bound.length) {
    out.push({
      key: key('seals'),
      kind: 'update',
      tone: 'seal',
      title: `${plural(bound.length, 'dealer')} bound to a price`,
      body: 'Each price opens for you once its seal is confirmed on-chain.',
      actions: [],
    });
  }

  const aside = quotes.filter((q) => q.verification === 'rejected' || q.reveal === 'reveal-invalid' || q.reveal === 'offer-mismatch');
  if (aside.length) {
    const last = aside[aside.length - 1];
    out.push({
      key: key('aside'),
      kind: 'update',
      tone: 'neutral',
      title: `${plural(aside.length, 'quote')} set aside`,
      body: `${dealer(last.dealerCmt)}: ${last.revealReason ?? last.reason ?? 'failed verification'}`,
      actions: [],
    });
  }

  if (live && s.chainError) {
    out.push({
      key: key('chain'),
      kind: 'action',
      tone: 'bad',
      title: 'Can’t reach the chain — quotes paused',
      body: `${s.chainError}. Quotes aren’t rejected; they’re checked again once the indexer answers.`,
      actions: [],
      toast: true,
    });
  }

  if (s.phase === 'sealed' && remaining > 0 && ctx.relaysConnected < 2 && ctx.now - (s.publishedAt ?? ctx.now) >= RELAY_GRACE_SECS) {
    out.push({
      key: key('relays'),
      kind: 'action',
      tone: ctx.relaysConnected === 0 ? 'bad' : 'warn',
      title: ctx.relaysConnected === 0 ? 'No relay connected' : 'Only one relay connected',
      body: 'Dealers may not hear your request while the window is open.',
      actions: [{ label: 'Manage relays', action: { type: 'manage-relays' } }],
      toast: true,
    });
  }

  if (ctx.walletLost && (live || s.phase === 'settling')) {
    out.push({
      key: key('wallet'),
      kind: 'action',
      tone: 'warn',
      title: 'Wallet disconnected',
      body: 'Reconnect to settle. Your request and quotes are kept.',
      actions: [{ label: 'Reconnect wallet', action: { type: 'connect-wallet' }, primary: true }],
      toast: true,
    });
  }

  for (const q of quotes) {
    if (q.reveal !== 'seal-mismatch' || ctx.provenQuotes.has(q.quoteId)) continue;
    const payout = q.bond !== undefined ? splitSlash(q.bond).selfProving : undefined;
    out.push({
      key: key(`fraud:${q.quoteId}`),
      kind: 'action',
      tone: 'bad',
      title: `${dealer(q.dealerCmt)} sent a price that doesn’t open its seal`,
      body: 'You hold the signed proof. Proving it slashes their bond.',
      actions: [{ label: payout !== undefined ? `Submit proof · receive ${fmtBase(payout)} ${baseSymbol}` : 'Submit proof', action: { type: 'fraud-proof', quoteId: q.quoteId }, primary: true }],
      toast: true,
    });
  }

  if (live && valid.length && !onCompare) {
    out.push({
      key: key('ready'),
      kind: 'action',
      tone: 'seal',
      title: `${plural(valid.length, 'price')} ready to compare`,
      body: best ? `Best so far: ${counter(best.amount)} ${receives ? 'received' : 'to pay'}, from ${dealer(best.dealerCmt)}.` : undefined,
      actions: [{ label: 'Review quotes', action: { type: 'open-trade', view: 'compare' }, primary: true }],
      toast: true,
    });
  }

  if (s.phase === 'sealed' && !ctx.onTrade && remaining > 0 && remaining <= WINDOW_CLOSING_SECS) {
    out.push({
      key: key('closing'),
      kind: 'action',
      tone: 'warn',
      title: 'Quote window closing',
      body: `${plural(valid.length, 'price')} opened so far. The window doesn’t extend.`,
      actions: [{ label: 'Open trade', action: { type: 'open-trade' } }],
      toast: true,
    });
  }

  if (live && remaining <= 0 && quotes.length === 0) {
    out.push({
      key: key('none'),
      kind: 'action',
      tone: 'neutral',
      title: 'No dealer answered',
      body: 'Early on this is normal: there may be no dealer online for this pair and size.',
      actions: [
        { label: 'Ask again', action: { type: 'ask-again' }, primary: true },
        { label: 'Become a dealer', action: { type: 'become-dealer' } },
      ],
      toast: true,
    });
  }

  if (s.phase === 'revealed' && remaining <= 0 && valid.length === 0 && compare.some((q) => q.state === 'expired')) {
    out.push({
      key: key('all-expired'),
      kind: 'action',
      tone: 'neutral',
      title: 'Every quote has expired',
      body: 'No dealer is bound to a price for this request any more.',
      actions: [{ label: 'Ask again', action: { type: 'ask-again' }, primary: true }],
      toast: true,
    });
  }

  if (s.phase === 'revealed' && !onCompare) {
    const selected = s.selected ? valid.find((q) => q.quoteId === s.selected) : undefined;
    const pick = selected ?? best;
    if (pick && pick.validUntil - ctx.now <= QUOTE_EXPIRING_SECS) {
      out.push({
        key: key(`expiring:${pick.quoteId}`),
        kind: 'action',
        tone: 'warn',
        title: `${selected ? 'Your pick' : 'The best quote'} expires in under ${QUOTE_EXPIRING_SECS} s`,
        body: `${counter(pick.amount)} from ${dealer(pick.dealerCmt)}.`,
        actions: [{ label: 'Review & settle', action: { type: 'open-trade', view: 'compare', quoteId: pick.quoteId }, primary: true }],
        toast: true,
      });
    }
  }

  const settlement = s.settlement;
  if (s.phase === 'settling' && settlement && settlement.stages.balance.status === 'active') {
    out.push({
      key: key(`approve:${settlement.quoteId}:${settlement.startedAt}`),
      kind: 'action',
      tone: 'seal',
      title: 'Approve the settlement in your wallet',
      body: `Swap with ${dealer(s.quotes[settlement.quoteId]?.dealerCmt ?? '')}. Nothing moves until the whole swap lands.`,
      actions: [],
      toast: true,
    });
  }

  if (s.phase === 'settled' && settlement?.txHash) {
    const q = s.quotes[settlement.quoteId];
    const amounts = q?.amount !== undefined && q.notional !== undefined ? (receives ? `Sent ${base(q.notional)}, received ${counter(q.amount)}` : `Paid ${counter(q.amount)}, received ${base(q.notional)}`) : 'The swap landed';
    out.push({
      key: key(`settled:${settlement.quoteId}`),
      kind: 'update',
      tone: 'ok',
      title: `Settled with ${dealer(q?.dealerCmt ?? '')}`,
      body: `${amounts}${settlement.blockHeight !== undefined ? ` · block ${settlement.blockHeight}` : ''}.`,
      actions: [
        { label: 'Open receipt', action: { type: 'open-receipt', quoteId: settlement.quoteId }, primary: true },
        { label: 'Attach disclosure note', action: { type: 'attach-note', quoteId: settlement.quoteId } },
      ],
      toast: true,
    });
  }

  const f = s.failure;
  if (s.phase === 'failed' && f) {
    const q = s.quotes[f.quoteId];
    const next = bestQuote(
      compare.filter((c) => c.quoteId !== f.quoteId),
      rfq.side,
      ctx.now,
    );
    const nextBest: NoticeButton[] = next ? [{ label: `Review next best · ${counter(next.amount)}`, action: { type: 'retry-quote', quoteId: next.quoteId } }] : [];
    const base = { key: key(`failed:${f.quoteId}:${f.at}`), kind: 'action' as const, toast: true };
    if (f.reason === 'inputs-spent') {
      out.push({
        ...base,
        tone: 'bad',
        title: `Couldn’t settle: ${dealer(q?.dealerCmt ?? '')}’s offer coins were already spent`,
        body: 'Nothing moved and you lost nothing. The evidence file can be checked by anyone on Verify.',
        actions: [{ label: 'Save evidence', action: { type: 'save-evidence' }, primary: true }, ...nextBest],
      });
    } else if (f.reason === 'wallet-shape') {
      const stillValid = (q?.validUntil ?? 0) > ctx.now;
      out.push({
        ...base,
        tone: 'warn',
        title: 'Your wallet needs one prep step',
        body: f.detail,
        actions: stillValid ? [{ label: 'Back to this quote', action: { type: 'retry-quote', quoteId: f.quoteId }, primary: true }] : nextBest,
      });
    } else if (f.reason === 'rejected') {
      out.push({ ...base, tone: 'bad', title: `The network rejected the settlement${f.code !== undefined ? ` (code ${f.code})` : ''}`, body: f.detail, actions: nextBest });
    } else {
      out.push({ ...base, tone: 'neutral', title: 'The quote expired before it settled', body: f.detail, actions: nextBest });
    }
  }

  return out;
}
