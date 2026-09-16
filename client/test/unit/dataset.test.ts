import { describe, expect, it } from 'vitest';
import { buildDataset } from '../fixtures/dataset';
import { applyEvent, cloneLedger, emptyLedger } from '../fixtures/ledger';
import { deriveEvents, tallyEvents } from '../../src/data/derive-events';
import { resolveScenario, scenarioClock } from '../fixtures/scenario';

const NOW = 1_789_450_000;

function strip<T extends { id: string }>(e: T) {
  const { id: _id, ...rest } = e;
  return rest;
}

describe('fixture dataset', () => {
  const ds = buildDataset(NOW);

  it('has 23 dealers in every status', () => {
    expect(ds.dealers).toHaveLength(23);
    const count = (s: string) => ds.dealers.filter((d) => d.status === s).length;
    expect([count('active'), count('no-record'), count('withdrawing'), count('slashed')]).toEqual([13, 4, 3, 3]);
    expect(ds.dealers.filter((d) => d.role).map((d) => d.role).sort()).toEqual(['a', 'b', 'c', 'fraud']);
  });

  it('has about 120 events, all within the last 14 days, in order', () => {
    expect(ds.events.length).toBeGreaterThanOrEqual(110);
    expect(ds.events.length).toBeLessThanOrEqual(130);
    for (const e of ds.events) {
      expect(e.timestamp).toBeLessThanOrEqual(NOW);
      expect(e.timestamp).toBeGreaterThanOrEqual(NOW - 14 * 86_400);
    }
    for (let i = 1; i < ds.events.length; i++) expect(ds.events[i].timestamp).toBeGreaterThanOrEqual(ds.events[i - 1].timestamp);
  });

  it('is deterministic apart from the clock', () => {
    const other = buildDataset(NOW + 1000);
    expect(other.events.map((e) => e.txHash)).toEqual(ds.events.map((e) => e.txHash));
    expect(other.events.map((e) => e.timestamp - 1000)).toEqual(ds.events.map((e) => e.timestamp));
  });

  it('every event is exactly what the live derivation would produce from its state change', () => {
    const ledger = emptyLedger();
    for (const e of ds.events) {
      const before = cloneLedger(ledger);
      applyEvent(ledger, e);
      const derived = deriveEvents(before, ledger, { typename: 'ContractCall', entryPoint: e.entryPoint, txHash: e.txHash, height: e.height, timestamp: e.timestamp });
      expect(derived.map(strip)).toEqual([strip(e)]);
    }
  });

  it('keeps counters, totals and bond caps consistent with the events', () => {
    const tally = tallyEvents(ds.events);
    for (const d of ds.dealers) {
      expect(ds.ledger.settled.get(d.dealerCmt) ?? 0n).toBe(tally.settled.get(d.dealerCmt) ?? 0n);
      expect(ds.ledger.slashed.get(d.dealerCmt) ?? 0n).toBe(tally.slashed.get(d.dealerCmt) ?? 0n);
    }
    expect(ds.ledger.burnedTotal).toBe(tally.burned);
    for (const d of ds.dealers.filter((x) => x.status === 'no-record')) expect(ds.ledger.settled.get(d.dealerCmt)).toBe(0n);
    for (const d of ds.dealers.filter((x) => x.status === 'slashed')) {
      const b = ds.ledger.bonds.get(d.dealerCmt)!;
      expect([b.amount, b.active, ds.ledger.slashed.get(d.dealerCmt)]).toEqual([0n, false, 1n]);
    }
    for (const d of ds.dealers.filter((x) => x.status === 'withdrawing')) {
      const b = ds.ledger.bonds.get(d.dealerCmt)!;
      expect(b.active).toBe(false);
      expect(b.withdrawRequested > 0n).toBe(true);
      expect(b.liveQuotes).toBe(0n);
    }
  });
});

describe('scenario selection', () => {
  it('reads ?scenario= and ?speed=, remembers them, and falls back to happy at 1×', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(resolveScenario('', store)).toEqual({ scenario: 'happy', speed: 1 });
    expect(resolveScenario('?scenario=inputs-spent&speed=10', store)).toEqual({ scenario: 'inputs-spent', speed: 10 });
    expect(resolveScenario('?other=1', store)).toEqual({ scenario: 'inputs-spent', speed: 10 });
    expect(resolveScenario('?scenario=bogus&speed=999', store)).toEqual({ scenario: 'inputs-spent', speed: 60 });
  });

  it('runs the scenario clock faster than the wall clock', () => {
    let wall = 1000;
    const clock = scenarioClock(10, () => wall);
    wall += 500;
    expect(clock.nowMs()).toBe(1000 + 5000);
  });
});
