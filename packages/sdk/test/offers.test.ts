// Offer File lifecycle arithmetic and the settlement condition (zswap-offer-files SKILL.md §2, §4).
//
// buildAndProveOffer/settleFromOffer need a real wallet and proof server and are exercised on-chain
// by `pnpm run e2e-settle`, not here. What IS here is pure and is exactly the part that, when wrong,
// gets an honest dealer slashed for nothing: the expiry accounting and the nets-to-zero check.
//
// `canBackQuote` takes an ABSOLUTE offer expiry now, not `provedAt`. The old form assumed every
// offer lives exactly OFFER_FILE_EXPIRY_SECS from proving; the expiry is really the intent TTL the
// builder chooses and can read back off the transaction (see offers.ts header).

import { describe, expect, it } from 'vitest';
import {
  canBackQuote,
  balanceVectorNetsToZero,
  balanceKey,
  tradeableBalance,
  deserializeOffer,
  buildAndProveOffer,
  settleFromOffer,
  OfferError,
  OFFER_FILE_EXPIRY_SECS,
  DEFAULT_SETTLEMENT_MARGIN_SECS,
  type OfferWallet,
} from '../src/offers.js';

const NOW = 1_800_000_000; // fixed clock — these are pure arithmetic tests, not timing tests

describe('canBackQuote — the rule that prevents self-inflicted slashing', () => {
  it('accepts a freshly proved offer for a short quote', () => {
    expect(canBackQuote(NOW + OFFER_FILE_EXPIRY_SECS, 600, 300, NOW)).toBe(true);
  });

  it('rejects an offer that would expire inside the quote validity window', () => {
    // Committing to a quote backed by an Offer File that dies mid-window guarantees the dealer
    // cannot settle, which guarantees a slash. Entirely preventable at quote time.
    expect(canBackQuote(NOW + 500, 600, 300, NOW)).toBe(false);
  });

  it('rejects an offer that expires AFTER the quote but inside the settlement margin', () => {
    // The subtle case: the offer outlives the quote, so a naive "is it expired at commit time?"
    // check passes — but the taker has no time left to actually submit the settlement.
    expect(canBackQuote(NOW + 700, 600, 300, NOW)).toBe(false);
    expect(canBackQuote(NOW + 901, 600, 300, NOW)).toBe(true);
  });

  it('rejects an already-expired offer', () => {
    expect(canBackQuote(NOW - 1, 60, 30, NOW)).toBe(false);
    expect(canBackQuote(NOW, 0, 0, NOW)).toBe(false);
  });

  it('enforces remainingLife > validity + margin at the boundary', () => {
    // The inequality is strict for a reason: chain time is coarse, and "just barely enough" is not.
    expect(canBackQuote(NOW + 900, 600, 300, NOW)).toBe(false);
    expect(canBackQuote(NOW + 901, 600, 300, NOW)).toBe(true);
  });

  it('accounts for the settlement margin', () => {
    expect(canBackQuote(NOW + 800, 600, 100, NOW)).toBe(true);
    expect(canBackQuote(NOW + 800, 600, 300, NOW)).toBe(false);
  });

  it('defaults the settlement margin rather than treating it as zero', () => {
    expect(canBackQuote(NOW + 600 + DEFAULT_SETTLEMENT_MARGIN_SECS, 600, undefined, NOW)).toBe(false);
    expect(canBackQuote(NOW + 600 + DEFAULT_SETTLEMENT_MARGIN_SECS + 1, 600, undefined, NOW)).toBe(true);
  });
});

describe('balanceVectorNetsToZero — the whole Zswap settlement condition', () => {
  it('accepts complementary offers', () => {
    expect(balanceVectorNetsToZero([
      { tNIGHT: 1000n, USDM: -41440n },
      { tNIGHT: -1000n, USDM: 41440n },
    ])).toBe(true);
  });

  it('rejects a mismatch in any single token', () => {
    expect(balanceVectorNetsToZero([
      { tNIGHT: 1000n, USDM: -41440n },
      { tNIGHT: -1000n, USDM: 41439n },
    ])).toBe(false);
  });

  it('rejects an unmatched token type appearing on only one side', () => {
    expect(balanceVectorNetsToZero([
      { tNIGHT: 1000n },
      { tNIGHT: -1000n, USDM: 5n },
    ])).toBe(false);
  });

  it('rejects an off-by-one-base-unit rounding discrepancy', () => {
    // This is the shape a float/decimal rounding bug takes: a vector that almost nets to zero, with
    // no obvious cause at the point of failure (zswap-offer-files SKILL.md §7).
    expect(balanceVectorNetsToZero([{ tNIGHT: 1000n }, { tNIGHT: -999n }])).toBe(false);
  });

  it('accepts an empty set trivially', () => {
    expect(balanceVectorNetsToZero([])).toBe(true);
  });

  it('supports more than two parties — the primitive is n-way', () => {
    expect(balanceVectorNetsToZero([
      { A: 10n, B: -5n },
      { A: -4n, B: 2n },
      { A: -6n, B: 3n },
    ])).toBe(true);
  });
});

describe('balanceKey — shielded and unshielded balances must not offset each other', () => {
  const raw = '00'.repeat(32);

  it('keeps the same raw token distinct across kinds', () => {
    expect(balanceKey({ tag: 'unshielded', raw })).not.toBe(balanceKey({ tag: 'shielded', raw }));
  });

  it('so a shielded/unshielded pair of the same token does NOT net to zero', () => {
    // If these collapsed to one key, a transaction that creates shielded tokens out of unshielded
    // ones would look settled client-side and be rejected on-chain.
    expect(balanceVectorNetsToZero([
      { [balanceKey({ tag: 'unshielded', raw })]: 1000n },
      { [balanceKey({ tag: 'shielded', raw })]: -1000n },
    ])).toBe(false);
  });

  it('gives DUST a stable key of its own', () => {
    expect(balanceKey({ tag: 'dust' })).toBe('dust');
  });
});

describe('tradeableBalance — DUST is the fee token, not a tradeable one', () => {
  it('drops only the dust entry', () => {
    expect(tradeableBalance({ 'unshielded:aa': 5n, dust: 300000000000001n })).toEqual({ 'unshielded:aa': 5n });
  });

  it('is what makes a correctly-fee-funded settlement pass the nets-to-zero check', () => {
    // A ready-to-submit settlement deliberately carries a DUST surplus — that surplus IS the fee.
    // Checking the raw vector for zero would reject every valid settlement there is; the first live
    // `pnpm run e2e-settle` run was refused by exactly that mistake.
    const settled = { dust: 300000000000001n };
    expect(balanceVectorNetsToZero([settled])).toBe(false);
    expect(balanceVectorNetsToZero([tradeableBalance(settled)])).toBe(true);
  });
});

describe('deserializeOffer — a malformed offer file must fail loudly, not silently', () => {
  it('rejects an empty payload', () => {
    expect(() => deserializeOffer('')).toThrow(OfferError);
  });

  it('rejects bytes that are not a proved, bound transaction', () => {
    expect(() => deserializeOffer(Buffer.from('not an offer file').toString('base64'))).toThrow(OfferError);
  });
});

// A wallet stub that throws if touched. These tests assert the guards fire BEFORE any wallet or
// proof-server work happens — i.e. that the rule is enforced inside construction rather than by
// convention at the call site, which is the whole point of putting it there.
const untouchableWallet = new Proxy({} as OfferWallet, {
  get(_t, prop) {
    throw new Error(`wallet was touched (.${String(prop)}) — the guard should have fired first`);
  },
});

describe('buildAndProveOffer — guards fire before any wallet work', () => {
  it('refuses an offer that would expire inside the quote validity window', async () => {
    await expect(
      buildAndProveOffer({
        wallet: untouchableWallet,
        give: { kind: 'unshielded', token: '00'.repeat(32), amount: 1000n },
        validitySecs: 600,
        lifetimeSecs: 500, // dies mid-window — guarantees the dealer cannot settle
      }),
    ).rejects.toThrow(/expire inside the quote window/);
  });

  it('refuses an offer that outlives the quote but not the settlement margin', async () => {
    await expect(
      buildAndProveOffer({
        wallet: untouchableWallet,
        give: { kind: 'unshielded', token: '00'.repeat(32), amount: 1000n },
        validitySecs: 600,
        settlementMarginSecs: 300,
        lifetimeSecs: 700, // survives the quote, leaves no time to actually submit
      }),
    ).rejects.toThrow(/expire inside the quote window/);
  });

  it('rejects a non-positive give amount', async () => {
    await expect(
      buildAndProveOffer({
        wallet: untouchableWallet,
        give: { kind: 'unshielded', token: '00'.repeat(32), amount: 0n },
      }),
    ).rejects.toThrow(/give.amount must be positive/);
  });

  it('rejects a non-positive want amount', async () => {
    await expect(
      buildAndProveOffer({
        wallet: untouchableWallet,
        give: { kind: 'unshielded', token: '00'.repeat(32), amount: 1000n },
        want: { kind: 'unshielded', token: '11'.repeat(32), amount: -1n },
      }),
    ).rejects.toThrow(/want.amount must be positive/);
  });
});

describe('settleFromOffer — refuses an expired offer before building anything', () => {
  it('rejects an offer whose expiry has passed', async () => {
    await expect(
      settleFromOffer({
        wallet: untouchableWallet,
        offerFileBase64: 'ignored — expiry is checked first',
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }),
    ).rejects.toThrow(OfferError);
  });
});
