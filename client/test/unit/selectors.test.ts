import { describe, expect, it } from 'vitest';
import { buildDataset } from '../fixtures/dataset';
import { activityMatches, bondHistory, dealerQuotes, dealerRows, inTab, matchesKey, protocolTotals, sortDealers } from '../../src/data/selectors';
import { niceCeiling } from '../../src/features/dealers/BondChart';
import { formatCompactUnits } from '../../src/lib/format';

const NOW = 1_789_450_000;
const ds = buildDataset(NOW);

describe('protocol totals', () => {
  it('counts from the ledger', () => {
    const t = protocolTotals(ds.ledger);
    const resolved = [...ds.ledger.quotes.values()].filter((q) => q.resolved).length;
    expect(t.resolvedQuotes).toBe(BigInt(resolved));
    expect(t.bondsSlashed).toBe(3n);
    expect(t.bondedDealers).toBe(17); // 13 active + 4 no-record; withdrawing and slashed are not active
    expect(t.burned).toBe(ds.ledger.burnedTotal);
    expect(t.totalBonded).toBe([...ds.ledger.bonds.values()].reduce((s, b) => s + b.amount, 0n));
  });
});

describe('dealer rows', () => {
  const rows = dealerRows(ds.ledger, ds.events);

  it('lists every dealer, slashed ones included in All', () => {
    expect(rows).toHaveLength(23);
    expect(rows.filter((r) => inTab(r, 'all') && r.status === 'slashed')).toHaveLength(3);
    expect(rows.filter((r) => inTab(r, 'withdrawing'))).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'slashed').every((r) => r.largestQuote === undefined && r.bond === 0n)).toBe(true);
  });

  it('never invents a failure count', () => {
    expect(rows.every((r) => r.failures === undefined)).toBe(true);
  });

  it('sorts stably and totally, ties broken by key', () => {
    for (const sort of ['bond', 'settled', 'slashed', 'failures', 'lastQuote'] as const) {
      const a = sortDealers(rows, sort).map((r) => r.dealerCmt);
      const b = sortDealers([...rows].reverse(), sort).map((r) => r.dealerCmt);
      expect(a).toEqual(b);
    }
    const bySettled = sortDealers(rows, 'settled');
    for (let i = 1; i < bySettled.length; i++) expect(bySettled[i - 1].settled >= bySettled[i].settled).toBe(true);
    const failures = sortDealers(rows, 'failures').map((r) => r.dealerCmt);
    expect(failures).toEqual([...failures].sort());
  });

  it('searches by key prefix, with or without 0x', () => {
    const key = rows[5].dealerCmt;
    expect(rows.filter((r) => matchesKey(r, key.slice(0, 6)))).toContainEqual(rows[5]);
    expect(rows.filter((r) => matchesKey(r, `0x${key.slice(0, 6).toUpperCase()}`))).toContainEqual(rows[5]);
  });
});

describe('one dealer', () => {
  const a = ds.dealers.find((d) => d.role === 'a')!;
  const slashed = ds.dealers.find((d) => d.status === 'slashed')!;

  it('bond history steps match the ledger', () => {
    const h = bondHistory(ds.events, a.dealerCmt);
    expect(h.map((p) => p.kind)).toEqual(['posted', 'topped-up']);
    expect(h[h.length - 1].amount).toBe(ds.ledger.bonds.get(a.dealerCmt)!.amount);
    const s = bondHistory(ds.events, slashed.dealerCmt);
    expect(s[s.length - 1]).toMatchObject({ kind: 'slashed', amount: 0n });
  });

  it('quote outcomes agree with the counters', () => {
    const q = dealerQuotes(ds.ledger, ds.events, a.dealerCmt, NOW);
    expect(BigInt(q.filter((x) => x.outcome === 'settled').length)).toBe(ds.ledger.settled.get(a.dealerCmt));
    for (let i = 1; i < q.length; i++) expect(q[i - 1].sealedAt >= q[i].sealedAt).toBe(true);
    expect(dealerQuotes(ds.ledger, ds.events, slashed.dealerCmt, NOW).some((x) => x.outcome === 'slashed')).toBe(true);
  });
});

describe('activity filters and chart helpers', () => {
  it('filters by category', () => {
    expect(ds.events.filter((e) => activityMatches(e, 'slashes'))).toHaveLength(3);
    expect(ds.events.filter((e) => activityMatches(e, 'all'))).toHaveLength(ds.events.length);
    expect(ds.events.filter((e) => activityMatches(e, 'bonds')).every((e) => e.kind.startsWith('bond') || e.kind === 'withdrawal-requested')).toBe(true);
  });

  it('rounds axis ceilings to nice numbers and compacts ticks', () => {
    expect(niceCeiling(45_000_000_000n)).toBe(50_000_000_000n);
    expect(niceCeiling(21_000_000_000n)).toBe(25_000_000_000n);
    expect(niceCeiling(1n)).toBe(1_000_000n);
    expect(formatCompactUnits(1_920_000_000_000n, 6)).toBe('1.92M');
    expect(formatCompactUnits(41_200_000_000n, 6)).toBe('41.2k');
    expect(formatCompactUnits(5_000_000_000n, 6)).toBe('5,000');
  });
});
