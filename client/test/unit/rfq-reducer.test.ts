import { describe, expect, it } from 'vitest';
import { initialRfqState, isTerminal, rfqReducer, useRfq, type RfqAction, type RfqState } from '../../src/state/rfq';
import { createStorage } from '../../src/data/storage';

const Q = 'a'.repeat(64);
const Q2 = 'b'.repeat(64);
const D = 'd'.repeat(64);
const rfq = { rfqId: 'f'.repeat(64), pair: 'tNIGHT/TESTUSD', side: 'sell' as const, size: '1000', expiry: 2000, takerEncPk: 'e'.repeat(64), replyTo: ['ws://a/gossip', 'ws://b/gossip'] };
const chain = { bond: 1n, settled: 2n, slashed: 0n, validUntil: 3000, notional: 1_000_000_000n, dealerEndpoint: 'http://a', dealerEncPk: 'c'.repeat(64) };
const terms = { pair: 'tNIGHT/TESTUSD', side: 'buy' as const, price: '41.44', size: '1000' };

const run = (actions: RfqAction[], from: RfqState = initialRfqState()) => actions.reduce(rfqReducer, from);

const toSealed: RfqAction[] = [{ type: 'form', patch: { size: '1000' } }, { type: 'request', at: 1 }, { type: 'published', rfq, takerEncSk: '11'.repeat(32), at: 2, relays: 2 }];
const withQuote: RfqAction[] = [
  ...toSealed,
  { type: 'announced', quoteId: Q, dealerCmt: D, relays: ['ws://a/gossip'], at: 3 },
  { type: 'checking', quoteId: Q },
  { type: 'verified', quoteId: Q, at: 4, chain, relays: ['ws://b/gossip'] },
  { type: 'revealed', quoteId: Q, at: 5, terms, nonce: '00'.repeat(32), offerFile: 'b2Zm', offerExpiresAt: 4000, amount: 41_440_000_000n, signature: '0'.repeat(192) },
];

describe('rfq reducer', () => {
  it('walks request → sealed → revealed → settling → settled and wipes the key', () => {
    const sealed = run(toSealed);
    expect(sealed).toMatchObject({ phase: 'sealed', view: 'sealed', takerEncSk: '11'.repeat(32) });
    const revealed = run([{ type: 'to-compare', at: 6 }], run(withQuote));
    expect(revealed).toMatchObject({ phase: 'revealed', view: 'compare' });
    expect(revealed.quotes[Q]).toMatchObject({ verification: 'on-chain', reveal: 'revealed', relays: ['ws://a/gossip', 'ws://b/gossip'], amount: 41_440_000_000n });
    const settling = run([{ type: 'settle-start', quoteId: Q, at: 7 }, { type: 'settle-stage', stage: 'balance', status: 'done', ms: 1200 }], revealed);
    expect(settling).toMatchObject({ phase: 'settling', view: 'settle', selected: Q });
    expect(settling.settlement?.stages.balance).toEqual({ status: 'done', detail: undefined, ms: 1200 });
    const settled = run([{ type: 'settled', at: 30, txHash: '9'.repeat(64), blockHeight: 10 }], settling);
    expect(settled).toMatchObject({ phase: 'settled', takerEncSk: undefined });
    expect(settled.settlement?.txHash).toBe('9'.repeat(64));
    expect(isTerminal(settled.phase)).toBe(true);
  });

  it('refuses out-of-order transitions', () => {
    const idle = initialRfqState();
    expect(rfqReducer(idle, { type: 'published', rfq, takerEncSk: 'x', at: 1, relays: 2 })).toBe(idle);
    expect(rfqReducer(idle, { type: 'settle-start', quoteId: Q, at: 1 })).toBe(idle);
    const sealed = run(toSealed);
    expect(rfqReducer(sealed, { type: 'form', patch: { size: '5' } })).toBe(sealed);
    // A quote without a reveal can't be selected or settled.
    const announced = run([{ type: 'announced', quoteId: Q, dealerCmt: D, relays: [], at: 3 }], sealed);
    expect(rfqReducer(announced, { type: 'select', quoteId: Q })).toBe(announced);
    expect(rfqReducer(announced, { type: 'settle-start', quoteId: Q, at: 4 })).toBe(announced);
  });

  it('keeps "couldn’t verify" distinct from "rejected", and never downgrades a verified quote', () => {
    const s = run([...toSealed, { type: 'announced', quoteId: Q, dealerCmt: D, relays: [], at: 3 }, { type: 'unverifiable', quoteId: Q, reason: 'indexer down', at: 4 }]);
    expect(s.quotes[Q]).toMatchObject({ verification: 'unverifiable', reason: 'indexer down' });
    const r = run([{ type: 'rejected', quoteId: Q, reason: 'quoteId not found', at: 5 }], s);
    expect(r.quotes[Q].verification).toBe('rejected');
    const v = run([{ type: 'verified', quoteId: Q, at: 6, chain, relays: [] }, { type: 'rejected', quoteId: Q, reason: 'late', at: 7 }], r);
    expect(v.quotes[Q].verification).toBe('on-chain');
  });

  it('records seal mismatches with the evidence fields', () => {
    const s = run([...toSealed, { type: 'announced', quoteId: Q, dealerCmt: D, relays: [], at: 3 }, { type: 'reveal-failed', quoteId: Q, status: 'seal-mismatch', reason: 'does not open', at: 4, terms, nonce: '00', signature: 'ab' }]);
    expect(s.quotes[Q]).toMatchObject({ reveal: 'seal-mismatch', terms, signature: 'ab' });
    expect(s.log.at(-1)?.tone).toBe('bad');
  });

  it('fails into a named outcome and can take the next best quote', () => {
    const revealed = run([
      ...withQuote,
      { type: 'announced', quoteId: Q2, dealerCmt: D, relays: [], at: 3 },
      { type: 'verified', quoteId: Q2, at: 4, chain, relays: [] },
      { type: 'revealed', quoteId: Q2, at: 5, terms, nonce: '00', offerFile: 'b2Zm', offerExpiresAt: 4000, amount: 1n, signature: '0'.repeat(192) },
      { type: 'to-compare', at: 6 },
      { type: 'settle-start', quoteId: Q, at: 7 },
    ]);
    const failed = run([{ type: 'failed', at: 8, failure: { reason: 'inputs-spent', quoteId: Q, detail: 'coins spent', spentBy: '7'.repeat(64) } }], revealed);
    expect(failed).toMatchObject({ phase: 'failed', takerEncSk: undefined, failure: { reason: 'inputs-spent', spentBy: '7'.repeat(64) } });
    const retry = run([{ type: 'retry-with', quoteId: Q2, at: 9 }], failed);
    expect(retry).toMatchObject({ phase: 'revealed', view: 'compare', selected: Q2, settlement: undefined });
  });

  it('cancels from every non-terminal phase, and never from a terminal one', () => {
    for (const prefix of [toSealed.slice(0, 2), toSealed, [...withQuote, { type: 'to-compare', at: 6 } as RfqAction], [...withQuote, { type: 'settle-start', quoteId: Q, at: 7 } as RfqAction]]) {
      const s = run([...prefix, { type: 'cancel', at: 99 }]);
      expect(s).toMatchObject({ phase: 'cancelled', takerEncSk: undefined, view: 'request' });
    }
    const settled = run([...withQuote, { type: 'settle-start', quoteId: Q, at: 7 }, { type: 'settled', at: 8, txHash: 'aa' }]);
    expect(rfqReducer(settled, { type: 'cancel', at: 9 })).toBe(settled);
  });

  it('steps back without losing data, and forward only to reached screens', () => {
    const revealed = run([...withQuote, { type: 'to-compare', at: 6 }]);
    const back = rfqReducer(revealed, { type: 'view', view: 'sealed' });
    expect(back.view).toBe('sealed');
    expect(back.quotes[Q].amount).toBe(41_440_000_000n);
    expect(rfqReducer(back, { type: 'view', view: 'settle' })).toBe(back);
    expect(rfqReducer(back, { type: 'view', view: 'compare' }).view).toBe('compare');
  });

  it('survives a reload through session storage, bigints and reveals intact', () => {
    const store = createStorage('rfq-test');
    useRfq.getState().attach(store.session, 'tNIGHT/TESTUSD');
    for (const a of [...withQuote, { type: 'to-compare', at: 6 } as RfqAction]) useRfq.getState().dispatch(a);
    // Reload: a fresh attach reads it back.
    useRfq.setState({ state: initialRfqState() });
    useRfq.getState().attach(store.session, 'tNIGHT/TESTUSD');
    const restored = useRfq.getState().state;
    expect(restored).toMatchObject({ phase: 'revealed', view: 'compare', takerEncSk: '11'.repeat(32) });
    expect(restored.quotes[Q].amount).toBe(41_440_000_000n);
    expect(restored.quotes[Q].bond).toBe(1n);
  });
});
