// Guards added during the 2026-09-14 session, tested on their own. Every earlier guard in this project
// that went untested turned out to be a bug (ROADMAP S2, S3): the checks are as untested as the code
// they check.

import { describe, expect, it } from 'vitest';
import { counterAmountFor, type QuoteTerms } from '../src/terms.js';
import { nodeErrorCode } from '../src/offers.js';
import { forbiddenClash } from '../src/inventory.js';
import { requirePrivateStatePassword } from '../src/config.js';

const t = (side: 'buy' | 'sell', price: string, size: string): QuoteTerms => ({ pair: 'tNIGHT/USDM', side, price, size });

describe('counterAmountFor — the one definition dealer and taker both use', () => {
  it('is exact when size x price is a whole number of base units', () => {
    expect(counterAmountFor(t('sell', '41.44', '0.001'))).toBe(41440n);
    expect(counterAmountFor(t('buy', '41.44', '0.001'))).toBe(41440n);
  });

  it('rounds AGAINST the dealer: down when the dealer receives, up when the dealer pays', () => {
    // 0.001 x 41.315681 = 41.315681 base units -> not whole
    expect(counterAmountFor(t('sell', '41.315681', '0.001'))).toBe(41315n); // dealer receives: floor
    expect(counterAmountFor(t('buy', '41.315681', '0.001'))).toBe(41316n); // dealer pays: ceil
  });

  it('never lets a non-zero trade round to a free lunch for the dealer', () => {
    // 0.000001 x 0.000001 = 1e-12 base units: a dealer who PAYS still pays 1; one who receives gets 0.
    expect(counterAmountFor(t('buy', '0.000001', '0.000001'))).toBe(1n);
    expect(counterAmountFor(t('sell', '0.000001', '0.000001'))).toBe(0n);
  });

  it('refuses more than 6 decimal places rather than silently truncating', () => {
    expect(() => counterAmountFor(t('sell', '41.4400001', '0.001'))).toThrow(/decimal places/);
  });
});

describe('nodeErrorCode — the node rejection code the facade buries', () => {
  it('finds the code in a nested Effect-style failure whose message says nothing', () => {
    const err = Object.assign(new Error('Transaction submission error'), {
      cause: { _tag: 'SubmissionError', error: { reason: '1010: Invalid Transaction: Custom error: 168', data: '0x…' } },
    });
    expect(nodeErrorCode(err)).toBe(168);
  });

  it('finds it in a plain message too', () => {
    expect(nodeErrorCode(new Error('1010: Invalid Transaction: Custom error: 192'))).toBe(192);
  });

  it('returns undefined rather than guessing when there is no code', () => {
    expect(nodeErrorCode(new Error('Transaction submission error'))).toBeUndefined();
    expect(nodeErrorCode(undefined)).toBeUndefined();
  });
});

describe('forbiddenClash — the keeper may never spend a live offer\'s coin', () => {
  const live = 'a83d6079458b6fdf1837689903f0a573e0745417eb62780a2f39da41e8c59cde:1';
  it('catches the exact live M3 run #3 self-invalidation (split spent the cycle-1 offer coin)', () => {
    expect(forbiddenClash([live], new Set([live]))).toEqual([live]);
  });
  it('ignores 0x and case differences between journal, wallet and ledger', () => {
    expect(forbiddenClash(['0x' + live.toUpperCase().replace(':1', ':1')], new Set([live]))).toHaveLength(1);
  });
  it('does not confuse sibling outputs of the same transaction', () => {
    expect(forbiddenClash([live.replace(/:1$/, ':0'), live.replace(/:1$/, ':2')], new Set([live]))).toEqual([]);
  });
});

describe('requirePrivateStatePassword — fails before a wallet sync, not after', () => {
  const withPw = (pw: string | undefined, fn: () => void) => {
    const old = process.env.MN_PRIVATE_STATE_PASSWORD;
    if (pw === undefined) delete process.env.MN_PRIVATE_STATE_PASSWORD; else process.env.MN_PRIVATE_STATE_PASSWORD = pw;
    try { fn(); } finally { if (old === undefined) delete process.env.MN_PRIVATE_STATE_PASSWORD; else process.env.MN_PRIVATE_STATE_PASSWORD = old; }
  };
  it('rejects a 32-char hex password (the README timing run: 2 classes)', () => {
    withPw('0123456789abcdef0123456789abcdef', () => expect(() => requirePrivateStatePassword()).toThrow(/at least 3 of/));
  });
  it('rejects a short one', () => {
    withPw('Ab1!', () => expect(() => requirePrivateStatePassword()).toThrow(/16 characters/));
  });
  it('accepts three classes', () => {
    withPw('Op-0123456789abcdef', () => expect(requirePrivateStatePassword()).toBe('Op-0123456789abcdef'));
  });
});
