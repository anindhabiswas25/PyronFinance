// M2 task 2.4 — multi-relay aggregation with client-side chain verification (docs/RELAY.md §3.2, §6).
//
// The "chain" here is the real compiled OTCProtocol contract running in the compact-runtime
// simulator, so every quote a test calls honest was genuinely committed by `commitQuote` under the
// real bond cap, and every quote_ref signature is a real Jubjub Schnorr signature by the key
// registered in `postBond`. The relays are real `startRelayServer` instances on real sockets.
//
// The negative cases are the point. Each one is a lie an untrusted relay (or a dealer) can tell.

import { describe, expect, it, afterEach } from 'vitest';
import {
  OTCSim, bondDealer, dealer, bytes32, T0, DEALER_SK, DEALER_CMT, QUOTE_SK,
} from '../../../contracts/test/harness.js';
import { deriveQuoteId } from '../src/domain.js';
import { freshNonce } from '../src/schnorr.js';
import {
  RelayAggregator,
  InsufficientRelaysError,
  verifyQuoteRef,
  type ChainReader,
} from '../src/relay-client.js';
import { startRelayServer, type RelayServer } from '../../relay-node/src/server.js';
import {
  computeId,
  encodeSignature,
  signBody,
  WIRE_VERSION,
  type Envelope,
  type QuoteRefBody,
  type RfqBody,
} from '../../relay-node/src/schema.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nowSecs = () => Math.floor(Date.now() / 1000);

/** The contract simulator, read through the same interface the indexer reader implements. */
function simChain(sim: OTCSim): ChainReader {
  return {
    async quote(quoteId) {
      const l = sim.ledger;
      return l.quotes.member(quoteId) ? l.quotes.lookup(quoteId) : undefined;
    },
    async dealer(cmt) {
      const l = sim.ledger;
      return {
        bond: l.bonds.member(cmt) ? l.bonds.lookup(cmt) : undefined,
        settled: l.settled.member(cmt) ? l.settled.lookup(cmt).read() : 0n,
        slashed: l.slashed.member(cmt) ? l.slashed.lookup(cmt).read() : 0n,
      };
    },
  };
}

const RFQ_ID = bytes32(0x51);
const VALID_UNTIL = T0 + 600;
const NOTIONAL = 1000n; // size '0.001' tNIGHT

function rfqBody(overrides: Partial<RfqBody> = {}): RfqBody {
  return {
    rfqId: hex(RFQ_ID),
    pair: 'tNIGHT/USDM',
    side: 'buy',
    size: '0.001',
    expiry: nowSecs() + 300,
    takerEncPk: 'ab'.repeat(32),
    replyTo: [],
    ...overrides,
  };
}

/** Bonds the dealer and commits one quote for RFQ_ID. Returns the quoteId. */
function commit(sim: OTCSim, opts: { rfqId?: Uint8Array; commitment?: Uint8Array; notional?: bigint } = {}) {
  const rfqId = opts.rfqId ?? RFQ_ID;
  const commitment = opts.commitment ?? bytes32(0x60);
  sim.call(dealer(DEALER_SK), 'commitQuote', rfqId, commitment, BigInt(VALID_UNTIL), opts.notional ?? NOTIONAL);
  return deriveQuoteId(DEALER_CMT, rfqId, commitment);
}

function quoteRef(
  quoteId: Uint8Array,
  overrides: Partial<QuoteRefBody> = {},
  signingKey: bigint = QUOTE_SK,
): Envelope<QuoteRefBody> {
  const body: QuoteRefBody = {
    rfqId: hex(RFQ_ID),
    dealerCmt: hex(DEALER_CMT),
    quoteId: hex(quoteId),
    validUntil: VALID_UNTIL,
    txHash: 'ee'.repeat(32),
    revealVia: 'direct',
    dealerEndpoint: 'wss://dealer-a.example/reveal',
    dealerEncPk: 'cd'.repeat(32),
    ...overrides,
  };
  return {
    v: WIRE_VERSION,
    type: 'quote_ref',
    id: computeId(body),
    ts: nowSecs(),
    ttl: 8,
    body,
    sig: encodeSignature(signBody(body, signingKey, freshNonce())),
  };
}

function fresh() {
  const sim = new OTCSim();
  bondDealer(sim, 1000n); // cap 20000
  return sim;
}

// ── Pure verification: every lie a relay or dealer can tell ──────────────────────────────────
describe('verifyQuoteRef — relay-sourced fields are hints, chain-sourced fields are facts', () => {
  it('accepts an honest reference and reports chain values, not relay values', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.quote.bondAmount).toBe(1000n);
    expect(v.quote.notional).toBe(NOTIONAL);
    expect(v.quote.validUntil).toBe(BigInt(VALID_UNTIL));
    expect(v.quote.settled).toBe(0n);
  });

  it('REJECTS a well-formed reference to a quote that was never committed', async () => {
    const sim = fresh();
    const v = await verifyQuoteRef(quoteRef(bytes32(0x99)), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/not found on-chain/) });
  });

  it('REJECTS a reference signed by a key other than the on-chain quotePk', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid, {}, 0xbadbadn), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/signature/) });
  });

  it('REJECTS a relay that redirects the reveal endpoint — the signature covers it', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const genuine = quoteRef(qid);
    const body = { ...genuine.body, dealerEndpoint: 'wss://attacker.example/reveal' };
    const tampered: Envelope<QuoteRefBody> = { ...genuine, body, id: computeId(body) };
    const v = await verifyQuoteRef(tampered, rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/signature/) });
  });

  it('REJECTS a dealerCmt hint that disagrees with the chain', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid, { dealerCmt: 'aa'.repeat(32) }), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/dealerCmt/) });
  });

  it('REJECTS a quote committed for a different RFQ but relabelled as ours', async () => {
    const sim = fresh();
    const qid = commit(sim, { rfqId: bytes32(0x77) });
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/different rfqId/) });
  });

  it('REJECTS a validUntil hint that disagrees with the chain', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid, { validUntil: VALID_UNTIL + 300 }), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/validUntil/) });
  });

  it('REJECTS a quote already resolved on-chain', async () => {
    const sim = fresh();
    const qid = commit(sim);
    sim.call(dealer(DEALER_SK), 'recordSettlement', qid, { is_some: false, value: bytes32(0) }, bytes32(0xab));
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/already resolved/) });
  });

  it('REJECTS a quote that has expired on-chain', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim), VALID_UNTIL);
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/expired/) });
  });

  it('REJECTS a dealer who has deactivated (requested withdrawal) since committing', async () => {
    const sim = fresh();
    const qid = commit(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/not active/) });
  });

  it('REJECTS a quote whose on-chain notional is not the size the taker asked for', async () => {
    const sim = fresh();
    const qid = commit(sim, { notional: 2000n });
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody(), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/does not match the requested size/) });
  });

  it('REJECTS a reference that answers a different RFQ', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const v = await verifyQuoteRef(quoteRef(qid), rfqBody({ rfqId: 'ff'.repeat(32) }), simChain(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/different RFQ/) });
  });

  it('lets a failing chain reader THROW — "could not check" is not "checked and rejected"', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const broken: ChainReader = {
      quote: async () => { throw new Error('indexer down'); },
      dealer: async () => { throw new Error('indexer down'); },
    };
    await expect(verifyQuoteRef(quoteRef(qid), rfqBody(), broken)).rejects.toThrow(/indexer down/);
  });
});

// ── Aggregation over real relay servers on real sockets ──────────────────────────────────────
const servers: RelayServer[] = [];
const aggregators: RelayAggregator[] = [];
afterEach(async () => {
  await Promise.all(aggregators.splice(0).map((a) => a.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function relay(): { server: RelayServer; url: string } {
  const server = startRelayServer({ port: 0 });
  servers.push(server);
  const addr = server.http.address();
  if (addr === null || typeof addr === 'string') throw new Error('relay not listening');
  return { server, url: `ws://127.0.0.1:${addr.port}/gossip` };
}

async function listening(server: RelayServer): Promise<void> {
  if (server.http.listening) return;
  await new Promise((r) => server.http.once('listening', r));
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function aggregatorOver(urls: string[], chain: ChainReader): Promise<RelayAggregator> {
  const agg = new RelayAggregator({ relays: urls, chain, connectTimeoutMs: 1000 });
  aggregators.push(agg);
  await agg.connect();
  return agg;
}

describe('RelayAggregator — union across untrusted relays', () => {
  it('publishes the RFQ to every connected relay', async () => {
    const a = relay();
    const b = relay();
    await Promise.all([listening(a.server), listening(b.server)]);
    const agg = await aggregatorOver([a.url, b.url], simChain(fresh()));

    const env = agg.publishRfq(rfqBody());
    await waitFor(() => a.server.gossip.getRfqs().length === 1 && b.server.gossip.getRfqs().length === 1);
    expect(a.server.gossip.getRfqs()[0].id).toBe(env.id);
    expect(b.server.gossip.getRfqs()[0].id).toBe(env.id);
  });

  it('refuses to publish with fewer than two relays connected, and surfaces the count', async () => {
    const a = relay();
    await listening(a.server);
    const agg = await aggregatorOver([a.url, 'ws://127.0.0.1:9/gossip'], simChain(fresh()));
    expect(agg.connectedCount).toBe(1);
    expect(agg.status()).toEqual([
      { url: a.url, connected: true },
      { url: 'ws://127.0.0.1:9/gossip', connected: false },
    ]);
    expect(() => agg.publishRfq(rfqBody())).toThrow(InsufficientRelaysError);
  });

  it('keeps a quote seen on only ONE relay — union, never intersection', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const a = relay();
    const b = relay();
    await Promise.all([listening(a.server), listening(b.server)]);
    const agg = await aggregatorOver([a.url, b.url], simChain(sim));

    b.server.gossip.publishLocal(quoteRef(qid)); // relay A never carries it
    await waitFor(() => agg.referenceCount === 1);

    const res = await agg.collect(rfqBody());
    expect(res.verified).toHaveLength(1);
    expect(res.verified[0].relays).toEqual([b.url]);
    expect(res.relaysConnected).toBe(2);
  });

  it('collapses the same quote from several relays into one entry listing every relay', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const a = relay();
    const b = relay();
    await Promise.all([listening(a.server), listening(b.server)]);
    const agg = await aggregatorOver([a.url, b.url], simChain(sim));

    const env = quoteRef(qid);
    a.server.gossip.publishLocal(env);
    b.server.gossip.publishLocal(env);
    await waitFor(() => (agg as unknown as { refs: Map<string, { relays: Set<string> }> }).refs.get(env.id)?.relays.size === 2);

    const res = await agg.collect(rfqBody());
    expect(res.verified).toHaveLength(1);
    expect(new Set(res.verified[0].relays)).toEqual(new Set([a.url, b.url]));
  });

  it('a lying relay cannot suppress the genuine quote by injecting a tampered copy of it first', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const honest = relay();
    const liar = relay();
    await Promise.all([listening(honest.server), listening(liar.server)]);
    const agg = await aggregatorOver([liar.url, honest.url], simChain(sim));

    const genuine = quoteRef(qid);
    const redirected = { ...genuine.body, dealerEndpoint: 'wss://attacker.example/reveal' };
    liar.server.gossip.publishLocal({ ...genuine, body: redirected, id: computeId(redirected) });
    await waitFor(() => agg.referenceCount === 1);
    honest.server.gossip.publishLocal(genuine);
    await waitFor(() => agg.referenceCount === 2);

    const res = await agg.collect(rfqBody());
    expect(res.verified).toHaveLength(1);
    expect(res.verified[0].dealerEndpoint).toBe('wss://dealer-a.example/reveal');
    expect(res.verified[0].relays).toEqual([honest.url]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].relays).toEqual([liar.url]);
    expect(res.rejected[0].reason).toMatch(/signature/);
  });

  it('a relay fabricating quotes for our RFQ gets them rejected without affecting honest ones', async () => {
    const sim = fresh();
    const qid = commit(sim);
    const a = relay();
    const b = relay();
    await Promise.all([listening(a.server), listening(b.server)]);
    const agg = await aggregatorOver([a.url, b.url], simChain(sim));

    a.server.gossip.publishLocal(quoteRef(qid));
    b.server.gossip.publishLocal(quoteRef(bytes32(0x42))); // no such commitment
    b.server.gossip.publishLocal(quoteRef(bytes32(0x43), {}, 0x1234n)); // wrong key too
    await waitFor(() => agg.referenceCount === 3);

    const res = await agg.collect(rfqBody());
    expect(res.verified.map((q) => q.quoteId)).toEqual([hex(qid)]);
    expect(res.rejected).toHaveLength(2);
    for (const r of res.rejected) expect(r.reason).toMatch(/not found on-chain/);
  });

  it('ignores references for other RFQs entirely', async () => {
    const sim = fresh();
    const qid = commit(sim, { rfqId: bytes32(0x77) });
    const a = relay();
    const b = relay();
    await Promise.all([listening(a.server), listening(b.server)]);
    const agg = await aggregatorOver([a.url, b.url], simChain(sim));

    a.server.gossip.publishLocal(quoteRef(qid, { rfqId: hex(bytes32(0x77)) }));
    await waitFor(() => agg.referenceCount === 1);
    const res = await agg.collect(rfqBody());
    expect(res.verified).toHaveLength(0);
    expect(res.rejected).toHaveLength(0);
  });
});
