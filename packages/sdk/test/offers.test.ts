// Offer File lifecycle arithmetic (zswap-offer-files SKILL.md §4).
//
// buildAndProveOffer itself needs a running proof server and is a documented stub, but the
// expiry accounting around it is pure — and it is the rule that stops a dealer being slashed
// for something entirely preventable.

import { describe, expect, it } from 'vitest';
import { canBackQuote, balanceVectorNetsToZero, OFFER_FILE_EXPIRY_SECS } from '../src/offers.js';

describe('canBackQuote — the rule that prevents self-inflicted slashing', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a freshly proved offer for a short quote', () => {
    expect(canBackQuote(now(), 600, 300)).toBe(true);
  });

  it('rejects an offer that would expire inside the quote validity window', () => {
    // Committing to a quote backed by an Offer File that dies mid-window guarantees the dealer
    // cannot settle, which guarantees a slash. This is entirely preventable at quote time.
    const almostExpired = now() - (OFFER_FILE_EXPIRY_SECS - 500);
    expect(canBackQuote(almostExpired, 600, 300)).toBe(false);
  });

  it('rejects an already-expired offer', () => {
    expect(canBackQuote(now() - OFFER_FILE_EXPIRY_SECS - 1, 60, 30)).toBe(false);
  });

  it('enforces remainingLife > validity + margin at the boundary', () => {
    // Exactly at the boundary must fail: the inequality is strict for a reason — chain time is
    // coarse, and "just barely enough" is not enough.
    const provedAt = now() - (OFFER_FILE_EXPIRY_SECS - 900);
    expect(canBackQuote(provedAt, 600, 300)).toBe(false);
    expect(canBackQuote(provedAt + 5, 600, 300)).toBe(true);
  });

  it('accounts for the settlement margin', () => {
    const provedAt = now() - (OFFER_FILE_EXPIRY_SECS - 800);
    expect(canBackQuote(provedAt, 600, 100)).toBe(true);
    expect(canBackQuote(provedAt, 600, 300)).toBe(false);
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
