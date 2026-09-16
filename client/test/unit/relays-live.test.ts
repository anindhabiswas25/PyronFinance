// @vitest-environment node
// The live relay adapter against two real relay-node servers on real sockets: RFQ gossip across
// relays, a signed quote_ref reaching the taker's aggregator, the mailbox round trip, and the
// two-relay minimum. The chain is a stub that knows no quotes, so every reference is received and
// then (correctly) not verified.

import { afterEach, describe, expect, it } from 'vitest';
import * as sdk from '@otc/sdk/browser';
import { startRelayServer, type RelayServer } from '../../../packages/relay-node/src/server';
import { createLiveRelays } from '../../src/data/live/relays';
import { httpBaseOf } from '../../src/data/relay-util';
import type { ChainPort, SyncStore } from '../../src/data/ports';

const servers: RelayServer[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function start(peers: string[] = []): string {
  const s = startRelayServer({ port: 0, peers, enableMailbox: true, reconnectDelayMs: 100 });
  servers.push(s);
  const addr = s.http.address();
  if (!addr || typeof addr === 'string') throw new Error('not listening');
  return `ws://127.0.0.1:${addr.port}/gossip`;
}

function memoryStore(): SyncStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return { raw, get: <T>(k: string) => raw.get(k) as T | undefined, set: (k, v) => void raw.set(k, v), remove: (k) => void raw.delete(k), keys: (p = '') => [...raw.keys()].filter((k) => k.startsWith(p)) };
}

const stubChain = { chainReader: () => ({ quote: async () => undefined, dealer: async () => ({ settled: 0n, slashed: 0n }) }) } as unknown as ChainPort;

function adapter(session = memoryStore()) {
  const relays = createLiveRelays({ chain: stubChain, session, socket: (url) => new WebSocket(url) });
  closers.push(() => relays.close());
  return relays;
}

async function until<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const hex32 = () => sdk.bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

describe('live relays over real relay-node servers', () => {
  it('gossips an RFQ and a signed quote_ref between relays, and delivers a reveal through the mailbox once', async () => {
    const a = start();
    const b = start([a]);
    await until('relays peered', async () => ((await (await fetch(`${httpBaseOf(a)}/health`)).json()) as { peers: number }).peers > 0);

    const session = memoryStore();
    const taker = adapter(session);
    const dealer = adapter();
    expect((await taker.connect([a, b])).filter((s) => s.connected)).toHaveLength(2);
    await dealer.connect([b]);

    const takerEnc = sdk.generateEncKeypair();
    const rfq: sdk.RfqBody = { rfqId: hex32(), pair: 'tNIGHT/TESTUSD', side: 'sell', size: '0.001', expiry: Math.floor(Date.now() / 1000) + 300, takerEncPk: sdk.bytesToHex(takerEnc.pk), replyTo: [a, b] };
    taker.publishRfq(rfq);
    const heard = await until('dealer hears the RFQ on the other relay', () => dealer.incomingRfqs().find((r) => r.body.rfqId === rfq.rfqId));
    expect(heard.body.takerEncPk).toBe(rfq.takerEncPk);

    const quoteSk = 0x5eedn;
    const body: sdk.QuoteRefBody = { rfqId: rfq.rfqId, dealerCmt: hex32(), quoteId: hex32(), validUntil: rfq.expiry, txHash: hex32(), revealVia: 'mailbox', dealerEndpoint: httpBaseOf(a), dealerEncPk: hex32() };
    const sent = dealer.publishQuoteRef({ v: sdk.WIRE_VERSION, type: 'quote_ref', id: sdk.computeId(body), ts: Math.floor(Date.now() / 1000), ttl: 8, body, sig: sdk.encodeSignature(sdk.signBody(body, quoteSk)) });
    expect(sent).toBe(1);
    const agg = await until('taker receives the quote_ref', async () => {
      const r = await taker.collect(rfq);
      return r.rejected.length ? r : undefined;
    });
    expect(agg.rejected[0]).toMatchObject({ quoteId: body.quoteId, reason: expect.stringMatching(/not found on-chain/) });
    expect(agg.verified).toHaveLength(0);

    const message: sdk.RevealMessage = { v: 1, type: 'reveal', quoteId: body.quoteId, ciphertext: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', sig: 'ab'.repeat(96) };
    await dealer.postReveal(body.dealerEndpoint, rfq.takerEncPk, message);
    expect(await taker.fetchMailbox(body.dealerEndpoint, rfq.takerEncPk)).toEqual([message]);
    // The relay deleted it on read; the taker's session copy is the only one left.
    expect(await taker.fetchMailbox(body.dealerEndpoint, rfq.takerEncPk)).toEqual([]);
    expect(JSON.stringify([...session.raw.values()])).toContain(body.quoteId);
  }, 20_000);

  it('refuses to publish an RFQ through a single relay', async () => {
    const a = start();
    const taker = adapter();
    await taker.connect([a]);
    const rfq: sdk.RfqBody = { rfqId: hex32(), pair: 'tNIGHT/TESTUSD', side: 'buy', size: '1', expiry: Math.floor(Date.now() / 1000) + 60, takerEncPk: hex32(), replyTo: [a] };
    expect(() => taker.publishRfq(rfq)).toThrow(/at least 2/);
  });
});
