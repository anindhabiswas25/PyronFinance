// B4 (task 3.4): the commit -> reveal state machine. Every transition and every failure the task
// names, against a fake chain and relay, with a REAL journal on disk, real Schnorr signatures and
// real reveal encryption.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuotingEngine, type ChainOps, type QuotingEvent, type RelayOps } from '../src/quoting.js';
import { QuoteJournal, recover, type OfferStatus, type QuoteRecord } from '../src/journal.js';
import { WarmPool } from '../src/pool.js';
import { deriveIdentity } from '../src/identity.js';
import { parseConfig, type DealerConfig } from '../src/config.js';
import { generateEncKeypair, decryptReveal, plaintextToTerms, RevealDecryptError, type RevealMessage } from '../../sdk/src/reveal-channel.js';
import { verifyReveal } from '../../sdk/src/quotes.js';
import { encodeTerms } from '../../sdk/src/terms.js';
import { decodeSignature, verifyBodySignature, type Envelope, type QuoteRefBody, type RfqBody } from '../../relay-node/src/schema.js';
import type { ProvedOffer } from '../../sdk/src/offers.js';

const NIGHT = '00'.repeat(32);
const USD = '53'.repeat(32);
const T = 1_800_000_000;
const EXAMPLE = path.resolve(import.meta.dirname, '../dealer.example.toml');

function config(over: (t: string) => string = (t) => t): DealerConfig {
  return parseConfig(over(fs.readFileSync(EXAMPLE, 'utf-8')), EXAMPLE);
}

interface Harness {
  engine: QuotingEngine;
  journal: QuoteJournal;
  pool: WarmPool;
  events: QuotingEvent[];
  refs: Envelope<QuoteRefBody>[];
  reveals: Array<{ rec: QuoteRecord; msg: RevealMessage }>;
  commits: string[];
  records: string[];
  releases: string[];
  released: string[];
  chainQuotes: Map<string, { resolved: boolean }>;
  offerStatus: Map<string, OfferStatus>;
  identity: ReturnType<typeof deriveIdentity>;
  taker: ReturnType<typeof generateEncKeypair>;
  file: string;
  now: { t: number };
  bond: { amount: bigint; active: boolean } | undefined;
  rfq(over?: Partial<RfqBody>): RfqBody;
  failCommit: boolean;
  releaseLandsButThrows: boolean;
  commitLandsAnyway: boolean;
  revealDown: boolean;
  journalOnDiskAtCommit: string;
}

async function harness(opts: { cfg?: DealerConfig; file?: string; bond?: bigint } = {}): Promise<Harness> {
  const cfg = opts.cfg ?? config();
  const file = opts.file ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dn-q-')), 'journal.log');
  const now = { t: T };
  const identity = deriveIdentity(new Uint8Array(32).fill(4));
  const taker = generateEncKeypair();
  const journal = QuoteJournal.open(file, { now: () => now.t });
  let n = 0;
  const released: string[] = [];
  const pool = new WarmPool({
    policy: cfg.policies[0],
    tokens: { base: { kind: 'unshielded', token: NIGHT }, counter: { kind: 'unshielded', token: USD } },
    inventory: { balance: async () => 10_000_000_000n },
    reserve: {},
    mid: async () => ({ price: '41.44', ts: now.t }),
    now: () => now.t,
    builder: {
      async build() {
        const id = `offer-${++n}`;
        const offer: ProvedOffer = {
          offerFileBase64: Buffer.from(id).toString('base64'),
          provedAt: now.t,
          expiresAt: now.t + 3600,
          balanceVector: {},
          inputs: [`${id}:0`],
          release: async () => void released.push(id),
        };
        return offer;
      },
    },
  });
  await pool.tick();

  const h = {
    journal, pool, released, file, now, identity, taker,
    events: [] as QuotingEvent[],
    refs: [] as Envelope<QuoteRefBody>[],
    reveals: [] as Array<{ rec: QuoteRecord; msg: RevealMessage }>,
    commits: [] as string[],
    records: [] as string[],
    releases: [] as string[],
    chainQuotes: new Map<string, { resolved: boolean }>(),
    offerStatus: new Map<string, OfferStatus>(),
    bond: { amount: opts.bond ?? 1000n, active: true } as { amount: bigint; active: boolean } | undefined,
    failCommit: false,
    releaseLandsButThrows: false,
    commitLandsAnyway: false,
    revealDown: false,
    journalOnDiskAtCommit: '',
    rfq(over: Partial<RfqBody> = {}): RfqBody {
      return {
        rfqId: crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''),
        pair: 'tNIGHT/TESTUSD',
        side: 'sell',
        size: '0.001',
        expiry: now.t + 600,
        takerEncPk: Buffer.from(taker.pk).toString('hex'),
        replyTo: [],
        ...over,
      };
    },
  } as unknown as Harness;

  const chain: ChainOps = {
    async commit(sealed) {
      h.journalOnDiskAtCommit = fs.readFileSync(file, 'utf-8');
      const qid = [...journal.all()].reverse()[0].quoteId;
      h.commits.push(qid);
      if (h.failCommit) {
        if (h.commitLandsAnyway) h.chainQuotes.set(qid, { resolved: false });
        throw new Error('wallet: submission failed');
      }
      void sealed;
      h.chainQuotes.set(qid, { resolved: false });
      return { txHash: 'ab'.repeat(32) };
    },
    async quoteOnChain(id) {
      return h.chainQuotes.get(id);
    },
    async bond() {
      return h.bond;
    },
    async offerStatus(rec) {
      return h.offerStatus.get(rec.quoteId) ?? 'unspent';
    },
    async recordSettlement(id) {
      h.records.push(id);
      h.chainQuotes.set(id, { resolved: true });
    },
    async release(id) {
      h.releases.push(id);
      h.chainQuotes.set(id, { resolved: true });
      if (h.releaseLandsButThrows) throw new Error('Transaction submission error\n  RpcError: 1010: Invalid Transaction: Custom error: 104');
    },
    nowSecs: () => now.t,
  };
  const relay: RelayOps = {
    publishQuoteRef: (env) => void h.refs.push(env),
    async deliverReveal(rec, msg) {
      if (h.revealDown) throw new Error('ECONNREFUSED mailbox');
      h.reveals.push({ rec, msg });
    },
  };
  h.engine = new QuotingEngine({
    config: cfg,
    policy: cfg.policies[0],
    identity,
    journal,
    pool,
    chain,
    relay,
    dealerEndpoint: 'http://127.0.0.1:18787',
    revealVia: 'mailbox',
    visibilityPollMs: 1,
    onEvent: (e) => h.events.push(e),
  });
  return h;
}

const states = (h: Harness, id: string) => h.journal.get(id)!.history.map((x) => x.state);

describe('QuotingEngine — happy path', () => {
  it('filter -> take -> persist -> commit -> gossip -> reveal, in that order', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    expect(states(h, id)).toEqual(['intent', 'submitted', 'committed', 'announced', 'revealed']);
    // The nonce was on disk before commitQuote was called.
    expect(h.journalOnDiskAtCommit).toContain(h.journal.get(id)!.nonce);
  });

  it('the taker (and only the taker) decrypts a reveal that opens the commitment', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq({ side: 'sell' })))!;
    const { msg } = h.reveals[0];
    const { plaintext, encodedTermsSignature } = decryptReveal(msg, h.taker.sk, h.identity.reveal.pk);
    const rec = h.journal.get(id)!;
    const terms = plaintextToTerms(plaintext);
    expect(terms.side).toBe('buy'); // taker sells base -> dealer buys
    const check = verifyReveal(
      { terms, encodedTerms: encodeTerms(terms), nonce: Buffer.from(plaintext.nonce, 'hex'), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
      Buffer.from(rec.commitment, 'hex'),
      h.identity.quotePk,
      BigInt(rec.notional),
    );
    expect(check).toEqual({ valid: true });
    expect(() => decryptReveal(msg, generateEncKeypair().sk, h.identity.reveal.pk)).toThrow(RevealDecryptError);
  });

  it('gossips a quote_ref signed by the quote key, carrying no price', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq());
    const ref = h.refs[0];
    expect(verifyBodySignature(ref.body, decodeSignature(ref.sig!), h.identity.quotePk)).toBe(true);
    expect(JSON.stringify(ref)).not.toMatch(/41\.|price/);
  });

  it('records a settlement once the chain shows one containing our offer, then frees the coins', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.offerStatus.set(id, 'settled');
    await h.engine.watch();
    expect(h.records).toEqual([id]);
    expect(h.journal.get(id)!.state).toBe('recorded');
  });

  it('uses a fresh nonce per quote', async () => {
    const h = await harness();
    const a = (await h.engine.handleRfq(h.rfq({ side: 'sell' })))!;
    const b = (await h.engine.handleRfq(h.rfq({ side: 'buy' })))!;
    expect(h.journal.get(a)!.nonce).not.toBe(h.journal.get(b)!.nonce);
  });
});

describe('QuotingEngine — failures', () => {
  it('commit fails and never landed: abandoned, offer coins released, nothing revealed', async () => {
    const h = await harness();
    h.failCommit = true;
    expect(await h.engine.handleRfq(h.rfq())).toBeUndefined();
    const rec = h.journal.all()[0];
    expect(rec.state).toBe('abandoned');
    expect(h.released).toHaveLength(1);
    expect(h.reveals).toHaveLength(0);
    expect(h.refs).toHaveLength(0);
  });

  it('commit "fails" but actually landed: adopted, gossiped and revealed — never abandoned', async () => {
    const h = await harness();
    h.failCommit = true;
    h.commitLandsAnyway = true;
    const id = (await h.engine.handleRfq(h.rfq()))!;
    expect(h.journal.get(id)!.state).toBe('revealed');
    expect(h.released).toHaveLength(0);
  });

  it('reveal endpoint down: stays announced, and watch() retries the reveal while live', async () => {
    const h = await harness();
    h.revealDown = true;
    const id = (await h.engine.handleRfq(h.rfq()))!;
    expect(h.journal.get(id)!.state).toBe('announced');
    expect(h.events.some((e) => e.kind === 'reveal-failed')).toBe(true);
    h.revealDown = false;
    await h.engine.watch();
    expect(h.journal.get(id)!.state).toBe('revealed');
  });

  it('offer inputs spent elsewhere: ALERT, halt, and NO recorded settlement', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.offerStatus.set(id, 'spent-elsewhere');
    await h.engine.watch();
    expect(h.records).toEqual([]);
    expect(h.engine.isHalted).toBe(true);
    expect(h.events.some((e) => e.kind === 'ALERT')).toBe(true);
    expect(await h.engine.handleRfq(h.rfq())).toBeUndefined();
  });

  it('inputs of an EXPIRED offer spent elsewhere: no ALERT, no halt — dead offers are free inventory (live run #3)', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.now.t += 3600 + 60; // past the Offer File's expiry (built at T with a 3600 s life)
    h.offerStatus.set(id, 'spent-elsewhere'); // e.g. the inventory keeper split the freed coins
    await h.engine.watch();
    expect(h.events.some((e) => e.kind === 'ALERT')).toBe(false);
    expect(h.engine.isHalted).toBe(false);
    expect(h.records).toEqual([]);
    expect(h.journal.get(id)!.state).toBe('expired');
    h.now.t += 3600; // past validUntil + grace
    await h.engine.watch();
    expect(h.releases).toEqual([id]);
  });

  it('expired unsettled: expired at validUntil, released only after the grace period, coins freed after offer expiry', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.now.t += 300;
    await h.engine.watch();
    expect(h.journal.get(id)!.state).toBe('expired');
    expect(h.releases).toEqual([]);
    const releasedBefore = h.released.length;
    h.now.t += 3299; // T + 3599: offer file still alive (built at T, 3600 s life), grace still open
    await h.engine.watch();
    expect(h.releases).toEqual([]);
    expect(h.released.length).toBe(releasedBefore); // a taker could still settle the offer: coins stay booked
    h.now.t += 1; // T + 3600: the offer file has expired, so its coins are freed — the quote is not yet releasable
    await h.engine.watch();
    expect(h.released.length).toBe(releasedBefore + 1);
    expect(h.releases).toEqual([]);
    h.now.t += 300; // T + 3900 = validUntil + PROOF_GRACE_PERIOD
    await h.engine.watch();
    expect(h.releases).toEqual([id]);
    expect(h.journal.get(id)!.state).toBe('released');
  });

  it('release "fails" but landed (live, run #3, code 104): released, no false "another party" alert', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.releaseLandsButThrows = true;
    h.now.t += 3900;
    await h.engine.watch();
    expect(h.journal.get(id)!.state).toBe('released');
    await h.engine.watch();
    expect(h.journal.get(id)!.state).toBe('released');
    expect(h.events.some((e) => e.kind === 'ALERT' || e.kind === 'release-failed')).toBe(false);
  });

  it('a quote resolved by someone else is closed with an alert', async () => {
    const h = await harness();
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.chainQuotes.set(id, { resolved: true });
    await h.engine.watch();
    expect(h.journal.get(id)!.state).toBe('closed');
    expect(h.events.some((e) => e.kind === 'ALERT')).toBe(true);
  });

  it('a slashed bond halts all quoting (halt_on_slash)', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq());
    h.bond = { amount: 0n, active: false };
    await h.engine.watch();
    expect(h.engine.isHalted).toBe(true);
    expect(h.pool.size).toBe(0);
  });
});

describe('QuotingEngine — risk filters (all silent)', () => {
  const ignoredBecause = (h: Harness) => h.events.filter((e) => e.kind === 'ignored').map((e) => (e as { reason: string }).reason);

  it('ignores an expired RFQ', async () => {
    const h = await harness();
    expect(await h.engine.handleRfq(h.rfq({ expiry: T }))).toBeUndefined();
    expect(ignoredBecause(h)).toEqual(['rfq expired']);
  });

  it('ignores a size off the ladder or outside the policy', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq({ size: '0.0015' }));
    await h.engine.handleRfq(h.rfq({ size: '5' }));
    expect(ignoredBecause(h)).toEqual(['size not on the ladder', 'size outside policy']);
    expect(h.commits).toEqual([]);
  });

  it('ignores another pair', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq({ pair: 'tNIGHT/USDM' }));
    expect(ignoredBecause(h)).toEqual(['pair not quoted']);
  });

  it('enforces max_live_quotes', async () => {
    const h = await harness({ cfg: config((t) => t.replace(/max_live_quotes\s*=\s*\d+/, 'max_live_quotes = 1')) });
    await h.engine.handleRfq(h.rfq());
    await h.engine.handleRfq(h.rfq({ side: 'buy' }));
    expect(ignoredBecause(h)).toEqual(['max_live_quotes reached']);
  });

  it('enforces max_total_notional across live quotes (the contract cap is per quote only)', async () => {
    const h = await harness({ cfg: config((t) => t.replace('max_total_notional = "0.02"', 'max_total_notional = "0.003"')) });
    await h.engine.handleRfq(h.rfq({ size: '0.002' }));
    await h.engine.handleRfq(h.rfq({ size: '0.002', side: 'buy' }));
    expect(ignoredBecause(h)).toEqual(['max_total_notional reached']);
  });

  it('never quotes a notional above bond x 20', async () => {
    const h = await harness({ bond: 60n, cfg: config((t) => t.replace('minimum_balance = "0.0001"', 'minimum_balance = "0.00005"')) }); // cap 1200: 0.001 ok, 0.002 not
    expect(await h.engine.handleRfq(h.rfq({ size: '0.002' }))).toBeUndefined();
    expect(ignoredBecause(h)).toEqual(['notional above bond cap']);
    expect(await h.engine.handleRfq(h.rfq({ size: '0.001' }))).toBeDefined();
  });

  it('stops below minimum_balance', async () => {
    const h = await harness({ bond: 99n }); // example minimum_balance "0.0001" = 100
    await h.engine.handleRfq(h.rfq());
    expect(ignoredBecause(h)).toEqual(['bond below minimum_balance']);
  });

  it('ignores when there is no warm offer', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq());
    await h.engine.handleRfq(h.rfq()); // the one 0.001 sell-side offer is taken
    expect(ignoredBecause(h)).toEqual(['no warm offer for this side and size']);
  });

  it('answers a deferred RFQ once the pool refills while it is still open (live, run #3, cycle 2)', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq());
    const late = h.rfq();
    expect(await h.engine.handleRfq(late)).toBeUndefined();
    expect(h.commits).toHaveLength(1);
    await h.pool.tick();
    const quoted = await h.engine.retryDeferred();
    expect(quoted).toHaveLength(1);
    expect(h.journal.get(quoted[0])!.rfqId).toBe(late.rfqId);
    expect(await h.engine.retryDeferred()).toEqual([]); // answered once, never twice
  });

  it('drops a deferred RFQ too close to its expiry to be verified by the taker', async () => {
    const h = await harness();
    await h.engine.handleRfq(h.rfq());
    await h.engine.handleRfq(h.rfq({ expiry: h.now.t + 30 }));
    await h.pool.tick();
    expect(await h.engine.retryDeferred()).toEqual([]);
    expect(h.commits).toHaveLength(1);
  });
});

describe('QuotingEngine — restart', () => {
  it('a crash after commit, before reveal: a new process recovers and reveals from the journal', async () => {
    const h = await harness();
    h.revealDown = true;
    const id = (await h.engine.handleRfq(h.rfq()))!;
    h.journal.close();

    const h2 = await harness({ file: h.file });
    h2.chainQuotes.set(id, { resolved: false });
    const { actions } = await recover(h2.journal, {
      quote: async (q) => h2.chainQuotes.get(q),
      offerStatus: async () => 'unspent',
      nowSecs: () => h2.now.t,
    });
    await h2.engine.resume(actions);
    expect(h2.journal.get(id)!.state).toBe('revealed');
    expect(h2.reveals[0].msg.quoteId).toBe(id);
  });

  it('a quote persisted but never submitted is abandoned on restart, not resubmitted', async () => {
    const h = await harness();
    const rec = h.journal.recordIntent({
      quoteId: 'cd'.repeat(32), rfqId: 'ce'.repeat(32), pair: 'tNIGHT/TESTUSD', side: 'buy', price: '41.3', size: '0.001',
      nonce: 'cf'.repeat(32), commitment: 'd0'.repeat(32), validUntil: T + 300, notional: '1000',
      offerFile: 'eA==', offerExpiresAt: T + 3600, offerInputs: ['x:0'], takerEncPk: 'd1'.repeat(32),
      revealVia: 'mailbox', dealerEndpoint: 'http://x',
    });
    const { actions } = await recover(h.journal, { quote: async () => undefined, offerStatus: async () => 'unspent', nowSecs: () => T + 5 });
    await h.engine.resume(actions);
    expect(h.journal.get(rec.quoteId)!.state).toBe('abandoned');
    expect(h.commits).toEqual([]);
  });
});
