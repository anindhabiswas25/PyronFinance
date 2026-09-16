// @vitest-environment node
// The live relay adapter against two real relay-node servers started in-process on free ports
// (never the long-running dev relays on 18787/18788).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { startRelayServer, type RelayServer } from '../../../packages/relay-node/src/server';
import { createLiveRelays } from '../../src/data/live/relays';
import type { ChainPort, SyncStore } from '../../src/data/ports';

// Node has no sessionStorage; an in-memory store stands in (jsdom tests cover the real one).
function memoryStore(): SyncStore {
  const m = new Map<string, unknown>();
  return { get: <T,>(k: string) => m.get(k) as T | undefined, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k), keys: (p = '') => [...m.keys()].filter((k) => k.startsWith(p)) };
}

const servers: RelayServer[] = [];
let urls: string[] = [];

async function start(): Promise<string> {
  const s = startRelayServer({ port: 0, enableMailbox: true, sweepIntervalMs: 60_000 });
  servers.push(s);
  if (!s.http.listening) await new Promise((r) => s.http.once('listening', r));
  return `ws://127.0.0.1:${(s.http.address() as AddressInfo).port}/gossip`;
}

beforeAll(async () => {
  urls = [await start(), await start()];
});
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

const chain = { chainReader: () => ({ quote: async () => undefined, dealer: async () => ({ settled: 0n, slashed: 0n }) }) } as unknown as ChainPort;

describe('live relays against real relay-node servers', () => {
  it('connects, reads /health, publishes an RFQ, and reads a mailbox with persistence', async () => {
    const session = memoryStore();
    const relays = createLiveRelays({ chain, session, socket: (u) => new WebSocket(u) });
    const states = await relays.connect(urls);
    expect(states.map((s) => s.connected)).toEqual([true, true]);

    const h = await relays.health(urls[0]);
    expect(h).toMatchObject({ ok: true, version: '1' });
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);

    const rfq = { rfqId: 'a'.repeat(64), pair: 'tNIGHT/TESTUSD', side: 'sell' as const, size: '0.001', expiry: Math.floor(Date.now() / 1000) + 120, takerEncPk: 'b'.repeat(64), replyTo: urls };
    relays.publishRfq(rfq);
    const base = urls[0].replace('ws:', 'http:').replace('/gossip', '');
    for (let i = 0; i < 20; i++) {
      const listed = (await (await fetch(`${base}/rfqs`)).json()) as Array<{ rfqId?: string; body?: { rfqId: string } }>;
      if (JSON.stringify(listed).includes(rfq.rfqId)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(JSON.stringify(await (await fetch(`${base}/rfqs`)).json())).toContain(rfq.rfqId);

    const msg = { v: 1, type: 'reveal', quoteId: 'c'.repeat(64), ciphertext: 'Y2lwaGVydGV4dA==', sig: 'd'.repeat(192) };
    const post = await fetch(`${base}/mailbox/${rfq.takerEncPk}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) });
    expect(post.status).toBe(202);
    const got = await relays.fetchMailbox(base, rfq.takerEncPk);
    expect(got.map((m) => m.quoteId)).toEqual([msg.quoteId]);
    // The relay deleted it on read; our copy is the only one left.
    expect(await relays.fetchMailbox(base, rfq.takerEncPk)).toEqual([]);
    expect(session.get<unknown[]>(`reveals:${rfq.takerEncPk}`)).toHaveLength(1);

    await relays.close();
    expect(relays.status().some((s) => s.connected)).toBe(false);
    expect(() => relays.publishRfq(rfq)).toThrow(/at least 2/);
  });
});
