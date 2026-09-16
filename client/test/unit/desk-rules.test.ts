import { describe, expect, it } from 'vitest';
import type { BondView } from '../../src/data/ports';
import { bondGates, deskAlerts, manualQuoteGate, releaseGate, type Actor } from '../../src/features/desk/rules';
import type { DealerQuote } from '../../src/data/selectors';

const T = 1_800_000_000;
const ready: Actor = { hasKey: true, backedUp: true, walletConnected: true };
const bond = (patch: Partial<BondView> = {}): BondView => ({ dealerCmt: 'aa'.repeat(32), amount: 100_000_000n, quotePk: {} as BondView['quotePk'], withdrawRequested: 0n, liveQuotes: 0n, active: true, ...patch });
const reason = (g: { ok: boolean; reason?: string }) => (g.ok ? 'ok' : g.reason);

describe('bond gates', () => {
  it('allows posting only without a bond, and topping up only with one', () => {
    expect(bondGates(undefined, T, ready).post.ok).toBe(true);
    expect(reason(bondGates(bond(), T, ready).post)).toBe('This key is already bonded. Top up instead.');
    expect(reason(bondGates(undefined, T, ready).topUp)).toBe('Post a bond first.');
  });

  it('says why and when a withdrawal is blocked', () => {
    expect(reason(bondGates(bond(), T, ready).withdraw)).toMatch(/Request a withdrawal first/);
    const running = bondGates(bond({ withdrawRequested: BigInt(T - 3600) }), T, ready).withdraw;
    expect(running).toMatchObject({ ok: false, until: T - 3600 + 86_400 });
    expect(reason(running)).toMatch(/24 h timelock runs until/);
    expect(reason(bondGates(bond({ withdrawRequested: BigInt(T - 90_000), liveQuotes: 2n }), T, ready).withdraw)).toBe('2 quotes are still live. Each must be recorded as settled or released first.');
    expect(bondGates(bond({ withdrawRequested: BigInt(T - 90_000) }), T, ready).withdraw.ok).toBe(true);
    expect(reason(bondGates(bond({ withdrawRequested: BigInt(T - 10) }), T, ready).requestWithdrawal)).toMatch(/already requested/);
  });

  it('checks the chain first, then the key, the backup and the wallet', () => {
    expect(reason(bondGates(bond(), T, { hasKey: false, backedUp: false, walletConnected: false }).post)).toBe('This key is already bonded. Top up instead.');
    expect(reason(bondGates(undefined, T, { hasKey: false, backedUp: false, walletConnected: false }).post)).toMatch(/Unlock your dealer key/);
    expect(reason(bondGates(undefined, T, { hasKey: true, backedUp: false, walletConnected: true }).post)).toMatch(/Save a backup/);
    expect(reason(bondGates(undefined, T, { hasKey: true, backedUp: true, walletConnected: false }).post)).toMatch(/Connect a wallet/);
  });
});

describe('release gate', () => {
  it('opens one hour after expiry and needs only a wallet', () => {
    const q = { validUntil: BigInt(T), resolved: false };
    expect(releaseGate(q, T - 1, true)).toMatchObject({ ok: false, until: T });
    expect(releaseGate(q, T + 10, true)).toMatchObject({ ok: false, until: T + 3600 });
    expect(reason(releaseGate(q, T + 3600, false))).toMatch(/Connect a wallet/);
    expect(releaseGate(q, T + 3600, true).ok).toBe(true);
    expect(reason(releaseGate({ ...q, resolved: true }, T + 9999, true))).toBe('Already resolved.');
  });
});

describe('manual quote gate', () => {
  const facts = { bond: bond(), notional: 1_000_000n, validitySecs: 300, rfqExpiry: T + 60, now: T, priceValid: true, actor: ready };
  it('enforces the bond cap in the dealer’s numbers', () => {
    expect(manualQuoteGate(facts).ok).toBe(true);
    expect(reason(manualQuoteGate({ ...facts, notional: 2_000_000_001n }))).toBe('This size needs a bond of at least 100.000001 tNIGHT; yours is 100.');
  });
  it('refuses expired requests, inactive bonds and windows over 15 minutes', () => {
    expect(reason(manualQuoteGate({ ...facts, rfqExpiry: T }))).toBe('This request has expired.');
    expect(reason(manualQuoteGate({ ...facts, bond: bond({ active: false }) }))).toMatch(/not active/);
    expect(reason(manualQuoteGate({ ...facts, validitySecs: 901 }))).toMatch(/at most 15 minutes/);
    expect(reason(manualQuoteGate({ ...facts, priceValid: false }))).toMatch(/Enter a price/);
  });
});

describe('desk alerts', () => {
  const q = (outcome: DealerQuote['outcome'], validUntil: number): DealerQuote => ({ quoteId: String(validUntil), notional: 1n, validUntil: BigInt(validUntil), sealedAt: 0, outcome, txHash: '' });
  it('flags releasable and grace-period quotes, and a pending withdrawal', () => {
    const alerts = deskAlerts(bond({ withdrawRequested: BigInt(T - 100), liveQuotes: 1n }), 0n, [q('expired', T - 7200), q('expired', T - 60), q('live', T + 60)], T);
    expect(alerts.map((a) => a.title)).toEqual(['Withdrawal requested', '1 expired quote can be released', '1 expired quote in the grace period']);
    expect(deskAlerts(bond({ amount: 0n, active: false }), 1n, [], T)[0].title).toBe('Bond slashed');
  });
});
