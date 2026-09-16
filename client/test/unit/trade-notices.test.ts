// The notification-centre rules: every trade state that needs the user, or reports what happened,
// derived from the state alone; and the store that reconciles them in place.

import { describe, expect, it } from 'vitest';
import { NETWORKS } from '../../src/config/networks';
import { initialRfqState, rfqReducer, type RfqAction, type RfqState } from '../../src/state/rfq';
import { tradeNotices, TRADE_NOTICE_PREFIX, type NoticeContext } from '../../src/features/trade/notify';
import { useNotifications, needsYou, type NoticeDraft } from '../../src/state/notifications';
import { splitSlash } from '../../src/lib/slash';
import { fmtBase } from '../../src/features/shared/protocol';

const pair = NETWORKS.preprod.pairs[0];
const T0 = 1_800_000_000;
const rfq = { rfqId: 'ab'.repeat(32), pair: pair.code, side: 'sell' as const, size: '1000', expiry: T0 + 120, takerEncPk: 'cd'.repeat(32), replyTo: ['ws://a', 'ws://b'] };
const qid = (n: number) => String(n).padStart(64, '0');
const dcmt = (n: number) => String(n).repeat(64);

const run = (...groups: RfqAction[][]): RfqState => groups.flat().reduce(rfqReducer, initialRfqState(pair.code));
const published: RfqAction[] = [
  { type: 'request', at: T0 },
  { type: 'published', rfq, takerEncSk: 'ee', at: T0, relays: 2 },
];
const sealed = (n: number, bond = 1_000_000n): RfqAction[] => [
  { type: 'announced', quoteId: qid(n), dealerCmt: dcmt(n), relays: ['ws://a'], at: T0 + 1 },
  { type: 'verified', quoteId: qid(n), at: T0 + 2, relays: ['ws://a'], chain: { bond, settled: 0n, slashed: 0n, validUntil: T0 + 300, notional: 1_000_000_000n, dealerEndpoint: 'ws://a', dealerEncPk: 'ff' } },
];
const revealed = (n: number, amount: bigint): RfqAction[] => [
  ...sealed(n),
  { type: 'revealed', quoteId: qid(n), at: T0 + 3, terms: { pair: pair.code, side: 'buy', price: '41.5', size: '1000' }, nonce: '00', offerFile: 'x', offerExpiresAt: T0 + 3600, amount, signature: 'sig' },
];
const mismatch = (n: number, bond: bigint): RfqAction[] => [
  ...sealed(n, bond),
  { type: 'reveal-failed', quoteId: qid(n), status: 'seal-mismatch', reason: 'does not open the on-chain commitment', at: T0 + 3 },
];
const settleStart = (n: number): RfqAction[] => [{ type: 'settle-start', quoteId: qid(n), at: T0 + 20 }];

const ctx = (patch: Partial<NoticeContext> = {}): NoticeContext => ({ now: T0 + 10, onTrade: false, pair, relaysConnected: 2, walletLost: false, provenQuotes: new Set(), ...patch });
const named = (s: RfqState, name: string, c = ctx()) => tradeNotices(s, c).find((n) => n.key.split(':').slice(2).join(':').startsWith(name));

describe('trade notices', () => {
  it('reports nothing without a published request', () => {
    expect(tradeNotices(initialRfqState(pair.code), ctx())).toEqual([]);
    expect(tradeNotices(run(published, [{ type: 'cancel', at: T0 + 5 }]), ctx())).toEqual([]);
  });

  it('keys every entry by the request, so a new request never updates an old one', () => {
    for (const n of tradeNotices(run(published, revealed(1, 41_520_000n)), ctx())) expect(n.key.startsWith(`${TRADE_NOTICE_PREFIX}${rfq.rfqId}:`)).toBe(true);
  });

  it('sealed: one merged update for bound dealers, and nothing that needs the user', () => {
    const s = run(published, sealed(1), sealed(2));
    expect(named(s, 'sent')?.title).toBe('Request sent');
    expect(named(s, 'sent')?.body).not.toMatch(/\d+\.\d+ TESTUSD/);
    expect(named(s, 'seals')).toMatchObject({ kind: 'update', title: '2 dealers bound to a price' });
    expect(needsYou(tradeNotices(s, ctx()) as never)).toHaveLength(0);
  });

  it('prices ready: review, never settle, and hidden while Compare is on screen', () => {
    const s = run(published, revealed(1, 41_440_000n), revealed(2, 41_520_000n));
    const ready = named(s, 'ready')!;
    expect(ready).toMatchObject({ kind: 'action', title: '2 prices ready to compare', toast: true });
    expect(ready.body).toContain('41.52 TESTUSD received');
    expect(ready.actions).toEqual([{ label: 'Review quotes', action: { type: 'open-trade', view: 'compare' }, primary: true }]);

    const onCompare = rfqReducer(s, { type: 'to-compare', at: T0 + 11 });
    expect(named(onCompare, 'ready', ctx({ onTrade: true }))).toBeUndefined();
    expect(named(onCompare, 'ready', ctx({ onTrade: false }))).toBeDefined();
  });

  it('no entry ever offers to settle directly', () => {
    const states = [run(published, revealed(1, 1n)), rfqReducer(run(published, revealed(1, 1n), revealed(2, 2n)), { type: 'to-compare', at: T0 + 11 })];
    for (const s of states)
      for (const n of tradeNotices(s, ctx({ now: T0 + 290 }))) for (const a of n.actions) expect(a.label).not.toMatch(/^Settle/);
  });

  it('seal mismatch: a fraud-proof action with the payout, gone once the proof landed', () => {
    const bond = 5_000_000n;
    const s = run(published, mismatch(3, bond));
    const fraud = named(s, 'fraud')!;
    expect(fraud.kind).toBe('action');
    expect(fraud.actions[0]).toMatchObject({ label: `Submit proof · receive ${fmtBase(splitSlash(bond).selfProving)} tNIGHT`, action: { type: 'fraud-proof', quoteId: qid(3) } });
    expect(named(s, 'fraud', ctx({ provenQuotes: new Set([qid(3)]) }))).toBeUndefined();
  });

  it('window closing: only for a user off /trade', () => {
    const s = run(published, revealed(1, 1n));
    expect(named(s, 'closing', ctx({ now: rfq.expiry - 10 }))?.title).toBe('Quote window closing');
    expect(named(s, 'closing', ctx({ now: rfq.expiry - 10, onTrade: true }))).toBeUndefined();
    expect(named(s, 'closing', ctx({ now: rfq.expiry - 60 }))).toBeUndefined();
  });

  it('no dealer answered: ask again or become a dealer', () => {
    const n = named(run(published), 'none', ctx({ now: rfq.expiry + 1 }))!;
    expect(n.actions.map((a) => a.action.type)).toEqual(['ask-again', 'become-dealer']);
  });

  it('every quote expired', () => {
    const s = rfqReducer(run(published, revealed(1, 1n)), { type: 'to-compare', at: T0 + 11 });
    expect(named(s, 'all-expired', ctx({ now: T0 + 400 }))?.actions[0].action).toEqual({ type: 'ask-again' });
  });

  it('expiring pick: review and settle with that quote selected', () => {
    const s = run(published, revealed(1, 41_440_000n), revealed(2, 41_520_000n), [{ type: 'to-compare', at: T0 + 11 }, { type: 'select', quoteId: qid(1) }]);
    const n = named(s, 'expiring', ctx({ now: T0 + 280 }))!;
    expect(n.title).toBe('Your pick expires in under 30 s');
    expect(n.actions[0]).toMatchObject({ label: 'Review & settle', action: { type: 'open-trade', view: 'compare', quoteId: qid(1) } });
    expect(named(s, 'expiring', ctx({ now: T0 + 280, onTrade: true }))).toBeUndefined();
    expect(named(s, 'expiring', ctx({ now: T0 + 200 }))).toBeUndefined();
  });

  it('settling: approve in the wallet while the wallet balances, then it resolves', () => {
    const s = run(published, revealed(1, 41_520_000n), settleStart(1), [{ type: 'settle-stage', stage: 'balance', status: 'active' }]);
    expect(named(s, 'approve')?.title).toBe('Approve the settlement in your wallet');
    expect(named(rfqReducer(s, { type: 'settle-stage', stage: 'balance', status: 'done' }), 'approve')).toBeUndefined();
  });

  it('settled: receipt and disclosure note', () => {
    const s = run(published, revealed(1, 41_520_000n), settleStart(1), [{ type: 'settled', at: T0 + 40, txHash: 'aa'.repeat(32), blockHeight: 7 }]);
    const n = named(s, 'settled')!;
    expect(n.kind).toBe('update');
    expect(n.body).toContain('received 41.52 TESTUSD');
    expect(n.body).toContain('block 7');
    expect(n.actions.map((a) => a.action.type)).toEqual(['open-receipt', 'attach-note']);
  });

  it.each([
    ['inputs-spent', ['save-evidence', 'retry-quote']],
    ['wallet-shape', ['retry-quote']],
    ['rejected', ['retry-quote']],
    ['expired', ['retry-quote']],
  ] as const)('failed (%s): what to do next', (reason, types) => {
    const s = run(published, revealed(1, 41_520_000n), revealed(2, 41_440_000n), settleStart(1), [
      { type: 'failed', at: T0 + 30, failure: { reason, quoteId: qid(1), detail: 'detail', code: reason === 'rejected' ? 138 : undefined } },
    ]);
    const n = named(s, 'failed')!;
    expect(n.kind).toBe('action');
    expect(n.actions.map((a) => a.action.type)).toEqual(types);
    if (reason === 'rejected') expect(n.title).toContain('(code 138)');
    if (reason === 'wallet-shape') expect(n.actions[0].action).toEqual({ type: 'retry-quote', quoteId: qid(1) });
    if (reason === 'inputs-spent') expect(n.actions[1].action).toEqual({ type: 'retry-quote', quoteId: qid(2) });
  });

  it('chain outage, too few relays after the grace period, and a lost wallet', () => {
    const s = rfqReducer(run(published, sealed(1)), { type: 'chain-error', message: 'indexer timeout', at: T0 + 8 });
    expect(named(s, 'chain')?.body).toContain('indexer timeout');
    expect(named(s, 'relays', ctx({ now: T0 + 2, relaysConnected: 1 }))).toBeUndefined();
    expect(named(s, 'relays', ctx({ relaysConnected: 1 }))?.actions[0].action).toEqual({ type: 'manage-relays' });
    expect(named(s, 'wallet', ctx({ walletLost: true }))?.actions[0].action).toEqual({ type: 'connect-wallet' });
  });
});

describe('notification store', () => {
  const draft = (key: string, patch: Partial<NoticeDraft> = {}): NoticeDraft => ({ key, kind: 'action', tone: 'warn', title: key, actions: [], ...patch });
  const store = () => useNotifications.getState();
  const entry = (key: string) => store().entries.find((e) => e.key === key);

  it('creates once, and leaves identical drafts alone', () => {
    expect(store().sync('t:', [draft('t:a')], 1).map((n) => n.key)).toEqual(['t:a']);
    const before = store().entries;
    expect(store().sync('t:', [draft('t:a')], 2)).toEqual([]);
    expect(store().entries).toBe(before);
  });

  it('updates in place and marks it unread, without announcing it again', () => {
    store().sync('t:', [draft('t:a', { title: '1 dealer' })], 1);
    store().markAllRead();
    expect(store().sync('t:', [draft('t:a', { title: '2 dealers' })], 5)).toEqual([]);
    expect(entry('t:a')).toMatchObject({ title: '2 dealers', read: false, createdAt: 1, updatedAt: 5 });
  });

  it('resolves a needs-you entry when its state goes away, keeps updates, and announces a return', () => {
    store().sync('t:', [draft('t:a'), draft('t:u', { kind: 'update' })], 1);
    store().sync('t:', [], 2);
    expect(entry('t:a')?.resolved).toBe(true);
    expect(entry('t:u')?.resolved).toBe(false);
    expect(store().sync('t:', [draft('t:a')], 3).map((n) => n.key)).toEqual(['t:a']);
  });

  it('a dismissed needs-you entry stays hidden until its state goes away', () => {
    store().sync('t:', [draft('t:a')], 1);
    store().dismiss('t:a');
    expect(store().sync('t:', [draft('t:a', { title: 'changed' })], 2)).toEqual([]);
    expect(entry('t:a')).toBeUndefined();
    store().sync('t:', [], 3);
    expect(store().sync('t:', [draft('t:a')], 4)).toHaveLength(1);
  });

  it('never touches another prefix, and survives a reload', () => {
    store().sync('other:', [draft('other:x')], 1);
    store().sync('t:', [], 2);
    expect(entry('other:x')?.resolved).toBe(false);
    useNotifications.setState({ entries: [], dismissed: [] });
    store().hydrate();
    expect(entry('other:x')).toBeDefined();
  });
});
