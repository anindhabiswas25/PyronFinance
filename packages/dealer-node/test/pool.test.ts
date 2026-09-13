// B3 (task 3.2): the warm pool, against a fake builder, mid source and inventory. Every rule in
// pool.ts's header has a test here, and each negative case is a way a dealer loses money or a taker
// gets a quote that cannot settle.

import { describe, expect, it } from 'vitest';
import { WarmPool, quotePrice, midMovedTooFar, toFixed, fromFixed, type Mid, type PoolEvent } from '../src/pool.js';
import type { QuotePolicy } from '../src/config.js';
import type { ProvedOffer, SwapLeg } from '../../sdk/src/offers.js';

const NIGHT = '00'.repeat(32);
const USD = '53'.repeat(32);
const T = 1_800_000_000;

function policy(over: Partial<QuotePolicy> = {}): QuotePolicy {
  return {
    pair: 'tNIGHT/TESTUSD',
    enabled: true,
    midSource: 'manual',
    midPrice: '41.44',
    spreadBps: 30,
    minSize: 1000n,
    maxSize: 2000n,
    inventoryFloor: 0n,
    validitySecs: 300,
    refreshSecs: 1800,
    expiryMarginSecs: 900,
    settlementMarginSecs: 300,
    ladderSizes: [1000n, 2000n],
    ...over,
  };
}

function harness(opts: {
  policy?: Partial<QuotePolicy>;
  mid?: () => Mid;
  balances?: Record<string, bigint>;
  reserve?: Record<string, bigint>;
  failBuild?: (req: { give: SwapLeg }) => boolean;
  lifetime?: number;
} = {}) {
  let now = T;
  const released: string[] = [];
  const events: PoolEvent[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let n = 0;
  const builds: Array<{ give: SwapLeg; want: SwapLeg }> = [];
  const pool = new WarmPool({
    policy: policy(opts.policy),
    tokens: { base: { kind: 'unshielded', token: NIGHT }, counter: { kind: 'unshielded', token: USD } },
    inventory: { balance: async (t) => opts.balances?.[t] ?? 10_000_000n },
    reserve: opts.reserve ?? {},
    mid: async () => (opts.mid ? opts.mid() : { price: '41.44', ts: now }),
    now: () => now,
    onEvent: (e) => events.push(e),
    builder: {
      async build(req) {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 2));
        concurrent--;
        if (opts.failBuild?.(req)) throw new Error('offer half already fails the time-to-dismiss rule');
        builds.push({ give: req.give, want: req.want });
        const id = `offer-${++n}`;
        const offer: ProvedOffer = {
          offerFileBase64: id,
          provedAt: now,
          expiresAt: now + (opts.lifetime ?? 3600),
          balanceVector: {},
          inputs: [`${id}:0`],
          release: async () => {
            released.push(id);
          },
        };
        return offer;
      },
    },
  });
  return {
    pool,
    released,
    events,
    builds,
    advance: (s: number) => (now += s),
    get now() {
      return now;
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
  };
}

describe('pricing', () => {
  it('bids below and asks above the mid, rounding against the dealer', () => {
    const mid = toFixed('41.44'); // 41_440_000
    expect(quotePrice(mid, 'buy', 30)).toBe(41_315_680n); // floor(41.44 * 0.997)
    expect(quotePrice(mid, 'sell', 30)).toBe(41_564_320n); // ceil(41.44 * 1.003)
    expect(quotePrice(1_000_001n, 'buy', 30)).toBe(997_000n); // 997000.997 -> down
    expect(quotePrice(1_000_001n, 'sell', 30)).toBe(1_003_002n); // 1003001.003 -> up
  });

  it('round-trips fixed-point prices without floats', () => {
    expect(fromFixed(toFixed('41.315680'))).toBe('41.315680');
    expect(fromFixed(1000n)).toBe('0.001000');
  });

  it('treats a move of exactly spread/2 as tolerable and anything beyond as stale', () => {
    const built = 10_000_000n; // 10.0, spread 30 bps -> half-spread = 0.15% = 15_000
    expect(midMovedTooFar(built, built + 15_000n, 30)).toBe(false);
    expect(midMovedTooFar(built, built + 15_001n, 30)).toBe(true);
    expect(midMovedTooFar(built, built - 15_001n, 30)).toBe(true);
  });
});

describe('WarmPool', () => {
  it('fills the whole ladder on both sides, with legs matching the terms', async () => {
    const h = harness();
    await h.pool.tick();
    expect(h.pool.size).toBe(4);
    const sell = h.pool.list().find((e) => e.side === 'sell' && e.size === 1000n)!;
    expect(sell.give).toEqual({ kind: 'unshielded', token: NIGHT, amount: 1000n });
    // ask 41.564320 x 0.001 = 41.56432 -> floor 41564 base units of counter (dealer receives)
    expect(h.builds.find((b) => b.give.token === NIGHT && b.give.amount === 1000n)!.want.amount).toBe(41564n);
    const buy = h.pool.list().find((e) => e.side === 'buy' && e.size === 1000n)!;
    // bid 41.315680 x 0.001 = 41.31568 -> ceil 41316 (dealer pays; taker gets at least the quote)
    expect(buy.give).toEqual({ kind: 'unshielded', token: USD, amount: 41316n });
  });

  it('builds strictly one at a time — the proof server does not parallelise', async () => {
    const h = harness();
    await Promise.all([h.pool.tick(), h.pool.tick()]);
    expect(h.maxConcurrent).toBe(1);
  });

  it('discards offers inside the expiry margin and releases their coins', async () => {
    const h = harness();
    await h.pool.tick();
    h.advance(3600 - 900); // every offer now exactly at the margin
    await h.pool.tick();
    expect(h.released).toHaveLength(4);
    expect(h.pool.size).toBe(4); // re-proved in the same tick
    expect(h.events.filter((e) => e.kind === 'discarded').every((e) => /expiry margin/.test(e.detail!))).toBe(true);
  });

  it('re-proves when the mid moves beyond spread/2, not for a smaller move', async () => {
    let price = '41.44';
    const h = harness({ mid: () => ({ price, ts: h.now }) });
    await h.pool.tick();
    price = '41.47'; // +0.072%, inside the 0.15% half-spread
    await h.pool.tick();
    expect(h.released).toHaveLength(0);
    price = '41.60'; // +0.386%
    await h.pool.tick();
    expect(h.released).toHaveLength(4);
    expect(h.pool.list().every((e) => e.midAtBuild === toFixed('41.60'))).toBe(true);
  });

  it('HARD-STOPS on a stale mid: empties the pool and hands nothing out', async () => {
    let ts = T;
    const h = harness({ mid: () => ({ price: '41.44', ts }) });
    await h.pool.tick();
    h.advance(901); // refresh_secs / 2 = 900
    await h.pool.tick();
    expect(h.pool.size).toBe(0);
    expect(h.pool.take('sell', 1000n)).toBeUndefined();
    ts = h.now;
    await h.pool.tick();
    expect(h.pool.size).toBe(4);
  });

  it('treats a failing mid source as stale', async () => {
    const h = harness({ mid: () => { throw new Error('endpoint down'); } });
    await h.pool.tick();
    expect(h.pool.size).toBe(0);
    expect(h.events.some((e) => e.kind === 'stale-mid')).toBe(true);
  });

  it('never commits value below the reserve', async () => {
    // 2500 tNIGHT balance, 1000 reserved: only one 1000-sell rung fits (the 2000 rung and a second rung do not).
    const h = harness({ balances: { [NIGHT]: 2500n }, reserve: { [NIGHT]: 1000n } });
    await h.pool.tick();
    const sells = h.pool.list().filter((e) => e.side === 'sell');
    expect(sells.map((e) => e.size)).toEqual([1000n]);
    expect(h.events.some((e) => e.kind === 'reserve-blocked' && e.key.includes('sell|2000'))).toBe(true);
  });

  it('keeps counting a taken offer against the reserve until it is retired', async () => {
    const h = harness({ balances: { [NIGHT]: 2000n }, policy: { ladderSizes: [1000n] } });
    await h.pool.tick();
    const taken = h.pool.take('sell', 1000n)!;
    await h.pool.tick(); // rung empty again; 1000 still outstanding, 1000 free -> rebuild fits
    expect(h.pool.list().filter((e) => e.side === 'sell')).toHaveLength(1);
    h.pool.take('sell', 1000n);
    await h.pool.tick(); // 2000 outstanding: no headroom
    expect(h.pool.list().filter((e) => e.side === 'sell')).toHaveLength(0);
    await h.pool.retire(taken, { release: false });
    await h.pool.tick();
    expect(h.pool.list().filter((e) => e.side === 'sell')).toHaveLength(1);
  });

  it('respects the inventory floor on the side that gives the base asset', async () => {
    const h = harness({ balances: { [NIGHT]: 1500n }, policy: { inventoryFloor: 1000n, ladderSizes: [1000n] } });
    await h.pool.tick();
    expect(h.pool.list().filter((e) => e.side === 'sell')).toHaveLength(0);
    expect(h.pool.list().filter((e) => e.side === 'buy')).toHaveLength(1);
  });

  it('refuses to hand out an offer that cannot outlive the quote window', async () => {
    const h = harness();
    await h.pool.tick();
    h.advance(3600 - 600); // 600 s left < validity 300 + margin 300 strictly
    expect(h.pool.take('sell', 1000n)).toBeUndefined();
    expect(h.released.length).toBeGreaterThan(0);
  });

  it('hands out a healthy offer exactly once', async () => {
    const h = harness();
    await h.pool.tick();
    expect(h.pool.take('buy', 2000n)).toBeDefined();
    expect(h.pool.take('buy', 2000n)).toBeUndefined();
  });

  it('skips a rung whose half fails time-to-dismiss, and keeps building the rest', async () => {
    const h = harness({ failBuild: (req) => req.give.amount === 2000n });
    await h.pool.tick();
    expect(h.pool.size).toBe(3);
    expect(h.events.some((e) => e.kind === 'build-failed' && /time-to-dismiss/.test(e.detail!))).toBe(true);
  });

  it('halt releases everything and stops all quoting', async () => {
    const h = harness();
    await h.pool.tick();
    await h.pool.halt('slashed');
    expect(h.released).toHaveLength(4);
    await h.pool.tick();
    expect(h.pool.size).toBe(0);
    expect(h.pool.take('sell', 1000n)).toBeUndefined();
  });

  it('a disabled pair keeps nothing warm', async () => {
    const h = harness({ policy: { enabled: false } });
    await h.pool.tick();
    expect(h.pool.size).toBe(0);
  });
});
