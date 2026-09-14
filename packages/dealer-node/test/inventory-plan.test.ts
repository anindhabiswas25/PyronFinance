// The inventory planner, against the exact shapes the live runs produced.

import { describe, expect, it } from 'vitest';
import { planInventory } from '../src/inventory-plan.js';

const c = (ref: string, value: bigint) => ({ ref, value });

describe('planInventory', () => {
  it('splits when the live M3 run #2 shape starves concurrent quotes (two coins, target four)', () => {
    // After both 41,316 bids booked a coin each, the node had nothing to quote with.
    const plan = planInventory({ coins: [c('a', 83_040n), c('b', 999_834_000n)], rungAmount: 41_316n, targetCoins: 4, consolidateAbove: 8 });
    expect(plan.action).toBe('split');
    if (plan.action !== 'split') return;
    expect(plan.source).toBe('b');
    expect(plan.pieces).toHaveLength(2);
    expect(plan.pieces.every((p) => p >= 41_316n)).toBe(true);
    expect(plan.pieces[0]).toBe(61_974n); // ceil(41,316 × 1.5)
  });

  it('merges dust first: two coins smaller than a rung would be swept into a half (S5 attempt 2 shape)', () => {
    const plan = planInventory({ coins: [c('a', 749n), c('b', 500n), c('big', 4_999_998_589n)], rungAmount: 1_000n, targetCoins: 2, consolidateAbove: 8 });
    expect(plan).toMatchObject({ action: 'merge', refs: ['b', 'a', 'big'] });
  });

  it('merges when there are too many coins even if none is dust', () => {
    const coins = Array.from({ length: 10 }, (_, i) => c(`k${i}`, 50_000n + BigInt(i)));
    const plan = planInventory({ coins, rungAmount: 41_316n, targetCoins: 4, consolidateAbove: 8 });
    expect(plan).toMatchObject({ action: 'merge', refs: ['k0', 'k1', 'k2'], total: 150_003n });
  });

  it('never merges more than three coins at once', () => {
    const coins = Array.from({ length: 12 }, (_, i) => c(`k${i}`, 10n));
    const plan = planInventory({ coins, rungAmount: 1_000n, targetCoins: 1, consolidateAbove: 4 });
    expect(plan.action === 'merge' && plan.refs.length).toBe(3);
  });

  it('does nothing when the ladder is already in shape', () => {
    const plan = planInventory({ coins: [c('a', 60_000n), c('b', 60_000n), c('c', 60_000n), c('d', 900_000n)], rungAmount: 41_316n, targetCoins: 4, consolidateAbove: 8 });
    expect(plan.action).toBe('none');
  });

  it('does nothing — and says why — when the largest coin cannot spare a rung-sized piece', () => {
    const plan = planInventory({ coins: [c('a', 50_000n)], rungAmount: 41_316n, targetCoins: 3, consolidateAbove: 8 });
    expect(plan).toMatchObject({ action: 'none', reason: expect.stringMatching(/cannot fund/) });
  });

  it('never plans a split that smallest-first selection would fund from existing small coins (live churn, run #3)', () => {
    // Live: coins {1500, 1500, large}, rung 1000, target 4 — a one-piece split of 1500 made the wallet spend an
    // existing 1500 coin to create another, every tick. The split total must exceed the smaller coins' sum.
    const plan = planInventory({ coins: [c('s1', 1_500n), c('s2', 1_500n), c('big', 4_999_998_164n)], rungAmount: 1_000n, targetCoins: 4, consolidateAbove: 8 });
    expect(plan.action).toBe('split');
    if (plan.action !== 'split') return;
    const total = plan.pieces.reduce((a, p) => a + p, 0n);
    expect(total).toBeGreaterThan(3_000n);
    expect(plan.pieces).toEqual([1_500n, 1_500n, 1_500n]);
  });

  it('keeps the split source able to back a rung itself', () => {
    const plan = planInventory({ coins: [c('big', 200_000n)], rungAmount: 41_316n, targetCoins: 6, consolidateAbove: 8 });
    expect(plan.action).toBe('split');
    if (plan.action !== 'split') return;
    const used = plan.pieces.reduce((a, p) => a + p, 0n);
    expect(200_000n - used).toBeGreaterThanOrEqual(41_316n);
  });

  it('is only ever given unbooked coins — the caller excludes coins live offers hold', () => {
    // Documented contract: with the two booked coins excluded, there is nothing to work with.
    const plan = planInventory({ coins: [], rungAmount: 41_316n, targetCoins: 4, consolidateAbove: 8 });
    expect(plan).toMatchObject({ action: 'none', reason: 'no coins to split' });
  });
});
