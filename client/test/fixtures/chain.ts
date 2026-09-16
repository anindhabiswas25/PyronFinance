// ChainPort over the fixture dataset. Simulates indexer latency, an indexer outage (scenario
// "indexer-down"), and a trickle of new public events so the Activity feed's "new events" pill has
// something to show. New events are folded into the same ledger, so pages stay consistent.

import type { ChainReader } from '@otc/sdk/browser';
import type { Clock } from '../../src/design/clock';
import type { BondView, ChainPort, DealerView, EventUpdate, IndexedTransaction, LedgerSnapshot, ProtocolEvent, ProtocolEventBody } from '../../src/data/ports';
import { hexToBytes, bytesToHex } from '../../src/lib/hex';
import { IndexerError } from '../../src/data/live/indexer-http';
import { applyEvent, ENTRY_POINT_OF } from './ledger';
import { FIXTURE_BLOCK_SECS, type FixtureDataset } from './dataset';
import { createRng } from './rng';
import type { ScenarioName } from './scenario';

export interface FixtureChainOptions {
  dataset: FixtureDataset;
  clock: Clock;
  scenario: ScenarioName;
  /** Scenario seconds between ambient public events; 0 disables them. */
  ambientEverySecs?: number;
  latencyMs?: number;
  /** Scenario speed factor, so ambient events keep pace with the scenario clock. */
  speed?: number;
}

export interface FixtureChain extends ChainPort {
  /** Appends events (e.g. the trade scenario's commits) and notifies followers. */
  append(bodies: ProtocolEventBody[]): ProtocolEvent[];
  /** Replaces a dealer's quote key with a real one (the trade scenario signs with it). */
  setQuoteKey(dealerCmt: string, quotePk: BondView['quotePk']): void;
  markInputSpent(input: string, byTx: string): void;
  /** Makes a submitted sample settlement visible to transaction lookups. */
  registerTransaction(tx: { hash: string; identifiers: string[]; status?: string }): void;
  dataset: FixtureDataset;
  dispose(): void;
}

export function createFixtureChain(o: FixtureChainOptions): FixtureChain {
  const { dataset, clock } = o;
  const ledger = dataset.ledger;
  const events = dataset.events;
  const txs = new Map<string, IndexedTransaction>(events.map((e) => [e.txHash, { hash: e.txHash, identifiers: [`00${e.txHash}`], status: 'SUCCESS', blockHeight: e.height }]));
  const spentInputs = new Map<string, string>();
  const listeners = new Set<(events: ProtocolEvent[]) => void>();
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const rng = createRng(0xa11ce);
  const latency = o.latencyMs ?? 250;
  const nowSecs = () => Math.floor(clock.nowMs() / 1000);
  const heightAt = (ts: number) => dataset.tipHeight + Math.floor((ts - dataset.now) / FIXTURE_BLOCK_SECS);

  const wait = (ms = latency) => new Promise((r) => setTimeout(r, ms));
  const guard = async () => {
    await wait();
    if (o.scenario === 'indexer-down') throw new IndexerError("Can't reach the indexer (sample scenario: indexer down)", 'network');
  };

  function append(bodies: ProtocolEventBody[]): ProtocolEvent[] {
    const at = nowSecs();
    const added = bodies.map((body) => {
      const txHash = rng.hex32();
      const e = { id: `${txHash}:0`, txHash, height: heightAt(at), timestamp: at, entryPoint: ENTRY_POINT_OF[body.kind], ...body } as ProtocolEvent;
      applyEvent(ledger, e);
      events.push(e);
      txs.set(txHash, { hash: txHash, identifiers: [`00${txHash}`], status: 'SUCCESS', blockHeight: e.height });
      return e;
    });
    for (const l of listeners) l(added);
    return added;
  }

  // Ambient activity: an active dealer seals a quote, and half a minute later it settles.
  const ambientEvery = o.ambientEverySecs ?? 40;
  if (ambientEvery > 0 && o.scenario !== 'indexer-down') {
    const active = () => dataset.dealers.filter((d) => d.status === 'active' && !d.role && ledger.bonds.get(d.dealerCmt)?.active);
    let pending: { dealerCmt: string; quoteId: string; notional: bigint } | undefined;
    const tick = () => {
      if (pending) {
        append([{ kind: 'quote-settled', ...pending }]);
        pending = undefined;
      } else {
        const d = rng.pick(active());
        if (d) {
          const quoteId = rng.hex32();
          const notional = 250_000_000n;
          append([{ kind: 'quote-sealed', dealerCmt: d.dealerCmt, quoteId, rfqId: rng.hex32(), commitment: rng.hex32(), notional, validUntil: BigInt(nowSecs() + 600) }]);
          pending = { dealerCmt: d.dealerCmt, quoteId, notional };
        }
      }
    };
    // Wall-clock interval scaled by the scenario speed; cleared by dispose().
    timers.push(setInterval(tick, (ambientEvery * 1000) / Math.max(1, o.speed ?? 1)));
  }

  function dealerView(dealerCmt: string): DealerView {
    const bond = ledger.bonds.get(dealerCmt);
    const settled = ledger.settled.get(dealerCmt);
    const slashed = ledger.slashed.get(dealerCmt);
    return { dealerCmt, bond, settled: settled ?? 0n, slashed: slashed ?? 0n, known: Boolean(bond || settled !== undefined || slashed !== undefined) };
  }

  const reader: ChainReader = {
    async quote(id) {
      await guard();
      const q = ledger.quotes.get(bytesToHex(id));
      if (!q) return undefined;
      return { dealerCmt: hexToBytes(q.dealerCmt), commitment: hexToBytes(q.commitment), validUntil: q.validUntil, rfqId: hexToBytes(q.rfqId), notional: q.notional, resolved: q.resolved };
    },
    async dealer(cmt) {
      await guard();
      const d = dealerView(bytesToHex(cmt));
      return { bond: d.bond ? { amount: d.bond.amount, quotePk: d.bond.quotePk, active: d.bond.active } : undefined, settled: d.settled, slashed: d.slashed };
    },
  };

  return {
    dataset,
    append,
    dispose() {
      for (const t of timers.splice(0)) clearInterval(t);
      listeners.clear();
    },
    setQuoteKey(dealerCmt, quotePk) {
      const b = ledger.bonds.get(dealerCmt);
      if (b) b.quotePk = quotePk;
    },
    markInputSpent(input, byTx) {
      spentInputs.set(input, byTx);
    },
    registerTransaction(tx) {
      txs.set(tx.hash, { hash: tx.hash, identifiers: tx.identifiers, status: tx.status ?? 'SUCCESS', blockHeight: heightAt(nowSecs()) });
    },
    async snapshot(): Promise<LedgerSnapshot> {
      await guard();
      return { view: ledger, height: heightAt(nowSecs()) };
    },
    async quote(quoteId) {
      await guard();
      return ledger.quotes.get(quoteId);
    },
    async dealer(dealerCmt) {
      await guard();
      return dealerView(dealerCmt);
    },
    events(options = {}): AsyncIterable<EventUpdate> {
      return {
        async *[Symbol.asyncIterator]() {
          await guard();
          const from = options.fromHeight ?? 0;
          yield { events: events.filter((e) => e.height >= from), height: heightAt(nowSecs()), live: true };
          const queue: ProtocolEvent[][] = [];
          let wake: (() => void) | undefined;
          const listener = (added: ProtocolEvent[]) => {
            queue.push(added);
            wake?.();
          };
          listeners.add(listener);
          try {
            while (!options.signal?.aborted) {
              if (queue.length === 0) {
                await new Promise<void>((r) => {
                  wake = r;
                  options.signal?.addEventListener('abort', () => r(), { once: true });
                });
                wake = undefined;
                continue;
              }
              const batch = queue.splice(0).flat();
              yield { events: batch, height: heightAt(nowSecs()), live: true };
            }
          } finally {
            listeners.delete(listener);
          }
        },
      };
    },
    async transaction(by) {
      await guard();
      if ('hash' in by) return txs.get(by.hash);
      return [...txs.values()].find((t) => t.identifiers.includes(by.identifier));
    },
    async ledgerParameters() {
      await guard();
      // Fixture trades run the real offer checks against the ledger's initial parameters, loaded with
      // the SDK only on /trade. Not the live chain's parameters; the page says so.
      const sdk = await import('@otc/sdk/browser');
      return { height: heightAt(nowSecs()), params: sdk.initialLedgerParameters() };
    },
    async inputSpent(intentHash, outputNo) {
      await guard();
      const by = spentInputs.get(`${intentHash}:${outputNo}`);
      return by ? { spent: true, byTx: by } : { spent: false };
    },
    chainReader: () => reader,
  };
}
