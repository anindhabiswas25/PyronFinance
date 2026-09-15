// Fixture relays: the same RelayPort with simulated connections and health. Scenario "one-relay"
// leaves only one connected. The trade scenario plugs in quote collection and mailboxes.

import type { AggregationResult, Envelope, QuoteRefBody, RevealMessage, RfqBody } from '@otc/sdk/browser';
import type { IncomingRfq, RelayHealth, RelayPort, RelayState, SyncStore } from '../../src/data/ports';
import { RelayCountError } from '../../src/lib/errors';
import { MIN_RELAYS, persistReveals } from '../../src/data/relay-util';
import type { ScenarioName } from './scenario';

export interface FixtureRelays extends RelayPort {
  published(): RfqBody[];
  setCollector(fn: ((rfq: RfqBody) => Promise<AggregationResult>) | undefined): void;
  setMailbox(fn: ((base: string, takerEncPk: string) => RevealMessage[]) | undefined): void;
  setIncoming(fn: (() => IncomingRfq[]) | undefined): void;
  readonly quoteRefs: Envelope<QuoteRefBody>[];
  readonly reveals: Array<{ base: string; takerEncPk: string; message: RevealMessage }>;
}

const LATENCIES = [42, 118, 3, 64];

export function createFixtureRelays(o: { scenario: ScenarioName; session: SyncStore; speed?: number }): FixtureRelays {
  let urls: string[] = [];
  const connected = new Set<string>();
  const health = new Map<string, RelayHealth>();
  const listeners = new Set<(s: RelayState[]) => void>();
  const published: RfqBody[] = [];
  let collector: ((rfq: RfqBody) => Promise<AggregationResult>) | undefined;
  let mailbox: ((base: string, pk: string) => RevealMessage[]) | undefined;
  let incoming: (() => IncomingRfq[]) | undefined;
  const quoteRefs: Envelope<QuoteRefBody>[] = [];
  const reveals: Array<{ base: string; takerEncPk: string; message: RevealMessage }> = [];
  const reachable = (url: string) => o.scenario !== 'one-relay' || urls.indexOf(url) === 0;

  const status = (): RelayState[] => urls.map((url) => ({ url, connected: connected.has(url), health: health.get(url) }));
  const emit = () => {
    const s = status();
    for (const l of listeners) l(s);
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms / Math.max(1, o.speed ?? 1)));

  async function checkHealth(url: string): Promise<RelayHealth> {
    await wait(150);
    const i = Math.max(0, urls.indexOf(url));
    const h: RelayHealth = reachable(url)
      ? { ok: true, peers: Math.max(1, urls.length - 1), version: '1', latencyMs: LATENCIES[i % LATENCIES.length], checkedAt: Date.now() }
      : { ok: false, checkedAt: Date.now(), error: 'Unreachable (sample scenario: one relay)' };
    health.set(url, h);
    emit();
    return h;
  }

  return {
    async connect(next) {
      urls = [...next];
      connected.clear();
      emit();
      await wait(600);
      for (const u of urls) if (reachable(u)) connected.add(u);
      for (const u of urls) void checkHealth(u);
      emit();
      return status();
    },
    status,
    onStatus(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    health: checkHealth,
    publishRfq(body) {
      if (connected.size < MIN_RELAYS) throw new RelayCountError(connected.size, MIN_RELAYS);
      published.push(body);
    },
    async collect(rfq) {
      if (collector) return collector(rfq);
      return { relaysConnected: connected.size, relaysTotal: urls.length, verified: [], rejected: [] };
    },
    async fetchMailbox(base, takerEncPk) {
      await wait(120);
      const messages = mailbox ? mailbox(base, takerEncPk) : [];
      persistReveals(o.session, takerEncPk, base, messages);
      return messages;
    },
    incomingRfqs: () => (incoming ? incoming() : []),
    quoteRefs,
    reveals,
    publishQuoteRef(envelope) {
      if (connected.size === 0) throw new Error('No relay is connected, so the quote reference was not sent.');
      quoteRefs.push(envelope);
      return connected.size;
    },
    async postReveal(base, takerEncPk, message) {
      await wait(100);
      reveals.push({ base, takerEncPk, message });
    },
    async close() {
      connected.clear();
      emit();
    },
    published: () => [...published],
    setCollector(fn) {
      collector = fn;
    },
    setMailbox(fn) {
      mailbox = fn;
    },
    setIncoming(fn) {
      incoming = fn;
    },
  };
}
