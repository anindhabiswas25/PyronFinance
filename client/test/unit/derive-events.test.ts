import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTRY_POINTS, deriveEvents, type ActionMeta } from '../../src/data/derive-events';
import type { BondView, LedgerView, QuoteView } from '../../src/data/ports';
import { splitSlash } from '../../src/lib/slash';
import { maxNotionalForBond, minBondForNotional } from '../../src/lib/bond';

const pk = { x: 1n, y: 2n } as unknown as BondView['quotePk'];
const D = 'd'.repeat(64);
const Q = 'a'.repeat(64);

function bond(over: Partial<BondView> = {}): BondView {
  return { dealerCmt: D, amount: 100n, quotePk: pk, withdrawRequested: 0n, liveQuotes: 0n, active: true, ...over };
}
function quote(over: Partial<QuoteView> = {}): QuoteView {
  return { quoteId: Q, dealerCmt: D, commitment: 'c'.repeat(64), validUntil: 1_789_000_000n, rfqId: 'f'.repeat(64), notional: 1000n, resolved: false, ...over };
}
function view(over: Partial<{ bonds: BondView[]; quotes: QuoteView[]; notes: LedgerView['notes']; burnedTotal: bigint }> = {}): LedgerView {
  return {
    bonds: new Map((over.bonds ?? []).map((b) => [b.dealerCmt, b])),
    settled: new Map(),
    slashed: new Map(),
    quotes: new Map((over.quotes ?? []).map((q) => [q.quoteId, q])),
    notes: over.notes ?? new Map(),
    burnedTotal: over.burnedTotal ?? 0n,
  };
}
const meta = (entryPoint: string): ActionMeta => ({ typename: 'ContractCall', entryPoint, txHash: 'e'.repeat(64), height: 10, timestamp: 1_789_000_000 });

describe('entry points', () => {
  it('match the compiled contract', () => {
    const info = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/managed/otc-protocol/compiler/contract-info.json'), 'utf8'));
    expect([...ENTRY_POINTS].sort()).toEqual(info.circuits.map((c: { name: string }) => c.name).sort());
  });
});

describe('deriveEvents', () => {
  it('ignores the deployment', () => {
    expect(deriveEvents(undefined, view(), { ...meta(''), typename: 'ContractDeploy', entryPoint: undefined })).toEqual([]);
  });

  it('postBond → bond posted with the ×20 cap', () => {
    const [e] = deriveEvents(view(), view({ bonds: [bond()] }), meta('postBond'));
    expect(e).toMatchObject({ kind: 'bond-posted', dealerCmt: D, amount: 100n, maxQuote: 2000n, id: `${'e'.repeat(64)}:0` });
  });

  it('topUpBond → delta', () => {
    const [e] = deriveEvents(view({ bonds: [bond()] }), view({ bonds: [bond({ amount: 125n })] }), meta('topUpBond'));
    expect(e).toMatchObject({ kind: 'bond-topped-up', delta: 25n, amount: 125n });
  });

  it('requestBondWithdrawal → withdrawable 24 h later', () => {
    const [e] = deriveEvents(view({ bonds: [bond()] }), view({ bonds: [bond({ withdrawRequested: 1000n, active: false })] }), meta('requestBondWithdrawal'));
    expect(e).toMatchObject({ kind: 'withdrawal-requested', requestedAt: 1000n, withdrawableAt: 87_400n });
  });

  it('withdrawBond → bond withdrawn with the previous amount', () => {
    const [e] = deriveEvents(view({ bonds: [bond({ amount: 75n })] }), view(), meta('withdrawBond'));
    expect(e).toMatchObject({ kind: 'bond-withdrawn', amount: 75n });
  });

  it('commitQuote → quote sealed', () => {
    const [e] = deriveEvents(view({ bonds: [bond()] }), view({ bonds: [bond({ liveQuotes: 1n })], quotes: [quote()] }), meta('commitQuote'));
    expect(e).toMatchObject({ kind: 'quote-sealed', quoteId: Q, notional: 1000n, validUntil: 1_789_000_000n });
  });

  it('recordSettlement → quote settled', () => {
    const [e] = deriveEvents(view({ quotes: [quote()] }), view({ quotes: [quote({ resolved: true })] }), meta('recordSettlement'));
    expect(e).toMatchObject({ kind: 'quote-settled', quoteId: Q });
  });

  it('releaseExpiredQuote → quote released', () => {
    const [e] = deriveEvents(view({ quotes: [quote()] }), view({ quotes: [quote({ resolved: true })] }), meta('releaseExpiredQuote'));
    expect(e).toMatchObject({ kind: 'quote-released', quoteId: Q });
  });

  it('submitFraudProofMismatch → slash with split and the chain burn delta', () => {
    const before = view({ bonds: [bond({ amount: 1001n })], quotes: [quote()], burnedTotal: 10n });
    const after = view({ bonds: [bond({ amount: 0n, active: false })], quotes: [quote({ resolved: true })], burnedTotal: 10n + 301n });
    const [e] = deriveEvents(before, after, meta('submitFraudProofMismatch'));
    expect(e).toMatchObject({ kind: 'bond-slashed', amount: 1001n, taker: 600n, prover: 100n, burned: 301n, quoteId: Q });
  });

  it('attachDisclosureNote → note attached, linked to the dealer', () => {
    const note = { tradeId: Q, ciphertextHash: '1'.repeat(64), policyTag: 1, recipientHint: '2'.repeat(64) };
    const [e] = deriveEvents(view({ quotes: [quote({ resolved: true })] }), view({ quotes: [quote({ resolved: true })], notes: new Map([[Q, note]]) }), meta('attachDisclosureNote'));
    expect(e).toMatchObject({ kind: 'note-attached', tradeId: Q, dealerCmt: D, policyTag: 1 });
  });

  it('keeps unknown entry points and no-op actions visible instead of dropping them', () => {
    expect(deriveEvents(view(), view(), meta('somethingNew'))[0]).toMatchObject({ kind: 'unrecognized' });
    expect(deriveEvents(view(), view(), meta('topUpBond'))[0]).toMatchObject({ kind: 'unrecognized' });
    expect(deriveEvents(undefined, view(), meta('postBond'))[0]).toMatchObject({ kind: 'unrecognized' });
  });
});

describe('slash split', () => {
  it('floors both cuts and burns the remainder', () => {
    expect(splitSlash(100n)).toEqual({ taker: 60n, prover: 10n, burned: 30n, selfProving: 70n });
    expect(splitSlash(7n)).toEqual({ taker: 4n, prover: 0n, burned: 3n, selfProving: 4n });
    expect(splitSlash(0n)).toEqual({ taker: 0n, prover: 0n, burned: 0n, selfProving: 0n });
  });
});

describe('bond calculator', () => {
  it('matches the SDK', async () => {
    const sdk = await import('@otc/sdk/browser');
    for (const n of [1n, 19n, 20n, 21n, 1000n, 999_999_999_999n]) expect(minBondForNotional(n)).toBe(sdk.minBondForNotional(n));
    for (const b of [1n, 50n, 12_400n]) expect(maxNotionalForBond(b)).toBe(sdk.maxNotionalForBond(b));
    expect(() => minBondForNotional(0n)).toThrow();
  });
});
