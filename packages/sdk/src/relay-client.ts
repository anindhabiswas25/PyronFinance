// Multi-relay aggregation with client-side chain verification — docs/RELAY.md §3.2 and §6
// (M2 task 2.4).
//
// THE INVARIANT THIS FILE EXISTS TO HOLD. A relay is untrusted infrastructure. It only ever sees
// `dealerCmt` — a one-way hash — and must not resolve it against the chain, so it cannot verify a
// `quote_ref` signature or know whether the quote it carries exists. That makes every field a relay
// hands us a HINT. The client turns hints into facts by reading the chain itself:
//
//   1. the quote exists on-chain under `quoteId`, and `quoteId` really is
//      H("otc:quote:v1" ‖ dealerCmt ‖ rfqId ‖ commitment) of the ON-CHAIN record;
//   2. the dealer's bond is read from the chain — amount, active flag, settled/slashed counts;
//   3. the signature verifies under the ON-CHAIN `quotePk`.
//
// Step 3 is what authenticates the rest of the body. `dealerEndpoint` and `dealerEncPk` are not on
// the chain at all; they are trustworthy only because the dealer's quote key signed them, so a
// relay that rewrites where the taker sends its reveal request breaks the signature.
//
// AGGREGATION IS UNION, NEVER INTERSECTION (§6.4). A quote seen on one relay and not another is
// still a quote; intersecting would amplify exactly the censorship multi-relay exists to resist.
// Envelopes are kept by their content-addressed id, not by quoteId, so a tampered variant of a
// genuine quote_ref can never shadow the genuine one by arriving first.

import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { hexToBytes as aeadHexToBytes, bytesToHex as aeadBytesToHex } from './aead.js';
import { deriveQuoteId } from './domain.js';
import { notionalOf } from './terms.js';
import { NOTIONAL_CAP_K } from './bonding.js';
import { queryLatestContractState } from './indexer.js';
import { ledger as otcLedger } from '../../../contracts/managed/otc-protocol/contract/index.js';
// The wire schema and validator are shared with the relay node on purpose — client and node must
// never disagree about canonical JSON, content-addressed ids or envelope shape (RELAY.md §7).
import {
  WIRE_VERSION,
  computeId,
  decodeSignature,
  verifyBodySignature,
  type Envelope,
  type QuoteRefBody,
  type RfqBody,
} from '../../relay-node/src/schema.js';
import { parseAndValidate } from '../../relay-node/src/validate.js';

// ---------------------------------------------------------------------------------------------
// The chain, as the client sees it
// ---------------------------------------------------------------------------------------------

export interface ChainQuote {
  dealerCmt: Uint8Array;
  commitment: Uint8Array;
  validUntil: bigint;
  rfqId: Uint8Array;
  notional: bigint;
  resolved: boolean;
}

export interface ChainBond {
  amount: bigint;
  quotePk: JubjubPoint;
  active: boolean;
}

export interface ChainDealer {
  bond?: ChainBond;
  settled: bigint;
  slashed: bigint;
}

/** Everything verification needs from the chain. Kept narrow so a browser client, the indexer, or
 *  the contract simulator (tests) can each supply it. */
export interface ChainReader {
  quote(quoteId: Uint8Array): Promise<ChainQuote | undefined>;
  dealer(dealerCmt: Uint8Array): Promise<ChainDealer>;
}

/** A `ChainReader` over a public indexer's latest contract state. State is re-read at most once per
 *  `maxAgeMs`, so verifying a burst of quote_refs costs one indexer round trip, not one per ref. */
export function indexerChainReader(
  indexerHttpUrl: string,
  contractAddress: string,
  maxAgeMs = 2_000,
): ChainReader {
  let cached: { at: number; state: ReturnType<typeof otcLedger> } | undefined;
  async function state(): Promise<ReturnType<typeof otcLedger>> {
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.state;
    const raw = await queryLatestContractState(indexerHttpUrl, contractAddress);
    if (!raw) throw new Error(`contract ${contractAddress} not found on the indexer`);
    cached = { at: Date.now(), state: otcLedger(raw.data) };
    return cached.state;
  }
  return {
    async quote(quoteId) {
      const l = await state();
      return l.quotes.member(quoteId) ? l.quotes.lookup(quoteId) : undefined;
    },
    async dealer(dealerCmt) {
      const l = await state();
      return {
        bond: l.bonds.member(dealerCmt) ? l.bonds.lookup(dealerCmt) : undefined,
        settled: l.settled.member(dealerCmt) ? l.settled.lookup(dealerCmt).read() : 0n,
        slashed: l.slashed.member(dealerCmt) ? l.slashed.lookup(dealerCmt).read() : 0n,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Verifying one reference
// ---------------------------------------------------------------------------------------------

/** A quote whose every load-bearing field was checked against the chain. Relay-sourced fields
 *  that survive are only the ones the dealer's on-chain key signed. */
export interface VerifiedQuote {
  quoteId: string;
  dealerCmt: string;
  /** From the chain, not the relay. */
  validUntil: bigint;
  notional: bigint;
  bondAmount: bigint;
  settled: bigint;
  slashed: bigint;
  /** Signed by the dealer's quote key — authentic, but still only a transport address. */
  dealerEndpoint: string;
  dealerEncPk: string;
  revealVia: QuoteRefBody['revealVia'];
}

export type QuoteRefVerdict = { ok: true; quote: VerifiedQuote } | { ok: false; reason: string };

const hexToBytes = aeadHexToBytes;
const bytesToHex = aeadBytesToHex;

/** Verifies one `quote_ref` against the chain for the RFQ the taker actually sent. RELAY.md §3.2.
 *  Never throws on a bad reference — a bad reference is ordinary input from an untrusted relay —
 *  but does let a failing `ChainReader` throw, because "could not check" must not read as
 *  "checked and rejected". */
export async function verifyQuoteRef(
  envelope: Envelope<QuoteRefBody>,
  rfq: RfqBody,
  chain: ChainReader,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<QuoteRefVerdict> {
  const body = envelope.body;
  const reject = (reason: string): QuoteRefVerdict => ({ ok: false, reason });

  if (body.rfqId !== rfq.rfqId) return reject('quote_ref answers a different RFQ');

  // 1. Existence, and that the id really commits to the on-chain record.
  const quoteIdBytes = hexToBytes(body.quoteId);
  const q = await chain.quote(quoteIdBytes);
  if (!q) return reject('quoteId not found on-chain — a reference with no commitment behind it');
  if (bytesToHex(deriveQuoteId(q.dealerCmt, q.rfqId, q.commitment)) !== body.quoteId) {
    return reject('quoteId does not derive from the on-chain dealerCmt/rfqId/commitment');
  }
  if (bytesToHex(q.dealerCmt) !== body.dealerCmt) return reject('dealerCmt hint does not match the chain');
  if (bytesToHex(q.rfqId) !== rfq.rfqId) return reject('on-chain quote was committed for a different rfqId');
  if (BigInt(body.validUntil) !== q.validUntil) return reject('validUntil hint does not match the chain');
  if (q.resolved) return reject('quote is already resolved on-chain (settled, slashed or released)');
  if (q.validUntil <= BigInt(nowSecs)) return reject('quote has expired on-chain');

  // 2. The bond, read from the chain.
  const dealer = await chain.dealer(q.dealerCmt);
  if (!dealer.bond) return reject('dealer has no bond on-chain');

  // 3. The signature, under the ON-CHAIN key. This is what authenticates the off-chain fields.
  if (!envelope.sig) return reject('quote_ref is unsigned');
  let signatureOk = false;
  try {
    signatureOk = verifyBodySignature(body, decodeSignature(envelope.sig), dealer.bond.quotePk);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return reject('signature does not verify under the on-chain quotePk');

  if (!dealer.bond.active) return reject('dealer is not active (withdrawing or slashed)');
  // Defence in depth: commitQuote enforces this at commit time, but a top-up cannot lower it and a
  // slash deactivates, so a violation here means the reader or the contract is not what we think.
  if (q.notional > dealer.bond.amount * NOTIONAL_CAP_K) return reject('quote notional exceeds the bond cap');

  // The dealer must be quoting the size that was asked for. Size is gossiped publicly, so this
  // leaks nothing; skipping it would let a dealer answer an RFQ with a quote for a different trade.
  let requested: bigint;
  try {
    requested = notionalOf({ pair: rfq.pair, side: rfq.side, price: '0', size: rfq.size });
  } catch (err) {
    return reject(`cannot size the RFQ in the bond asset: ${(err as Error).message}`);
  }
  if (q.notional !== requested) {
    return reject(`on-chain notional ${q.notional} does not match the requested size ${requested}`);
  }

  return {
    ok: true,
    quote: {
      quoteId: body.quoteId,
      dealerCmt: body.dealerCmt,
      validUntil: q.validUntil,
      notional: q.notional,
      bondAmount: dealer.bond.amount,
      settled: dealer.settled,
      slashed: dealer.slashed,
      dealerEndpoint: body.dealerEndpoint,
      dealerEncPk: body.dealerEncPk,
      revealVia: body.revealVia,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Aggregating across relays
// ---------------------------------------------------------------------------------------------

/** The minimal WebSocket surface `RelayAggregator` needs — satisfied by both a browser's native
 *  `WebSocket` and the `ws` package's client (both implement the same W3C event-listener API),
 *  so this file never imports either directly. `browser.ts` re-exports this type so `client/`
 *  can pass `(url) => new WebSocket(url)`; Node scripts pass `nodeSocketFactory` from
 *  `relay-client-node.ts` instead. */
export interface WebSocketLike {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (ev?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => WebSocketLike;

/** RELAY.md §6: a taker MUST connect to at least two relays. */
export const MIN_RELAYS = 2;

export class InsufficientRelaysError extends Error {
  constructor(readonly connected: number, readonly required: number) {
    super(
      `connected to ${connected} relay(s), need at least ${required}. A single-relay taker has ` +
        'silently accepted a censoring intermediary (docs/RELAY.md §6).',
    );
    this.name = 'InsufficientRelaysError';
  }
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface VerifiedAggregate extends VerifiedQuote {
  /** Every relay this quote arrived through. */
  relays: string[];
}

export interface RejectedRef {
  envelopeId: string;
  quoteId: string;
  relays: string[];
  reason: string;
}

export interface AggregationResult {
  relaysConnected: number;
  relaysTotal: number;
  verified: VerifiedAggregate[];
  rejected: RejectedRef[];
}

export interface RelayAggregatorOptions {
  relays: string[];
  chain: ChainReader;
  /** Constructs one relay connection. Required — this file never assumes a WebSocket
   *  implementation. `client/` passes the browser global; Node code passes
   *  `nodeSocketFactory` from `relay-client-node.ts`. */
  socketFactory: SocketFactory;
  minRelays?: number;
  connectTimeoutMs?: number;
}

export class RelayAggregator {
  private readonly sockets = new Map<string, WebSocketLike>();
  private readonly connected = new Set<string>();
  /** envelope id -> the envelope and every relay it came through. */
  private readonly refs = new Map<string, { envelope: Envelope<QuoteRefBody>; relays: Set<string> }>();
  private readonly verdicts = new Map<string, Promise<QuoteRefVerdict>>();
  private readonly minRelays: number;

  constructor(private readonly options: RelayAggregatorOptions) {
    this.minRelays = options.minRelays ?? MIN_RELAYS;
  }

  /** Opens every relay connection. Resolves once each has opened, failed or timed out; a dead
   *  relay is reported in the status, never thrown — the caller decides whether enough are up. */
  async connect(): Promise<RelayStatus[]> {
    const timeoutMs = this.options.connectTimeoutMs ?? 5_000;
    await Promise.all(
      this.options.relays.map(
        (url) =>
          new Promise<void>((resolve) => {
            const ws = this.options.socketFactory(url);
            this.sockets.set(url, ws);
            const timer = setTimeout(() => {
              ws.close();
              resolve();
            }, timeoutMs);
            ws.addEventListener('open', () => {
              clearTimeout(timer);
              this.connected.add(url);
              resolve();
            });
            ws.addEventListener('message', (ev) => this.handleFrame(url, String(ev.data)));
            ws.addEventListener('close', () => this.connected.delete(url));
            ws.addEventListener('error', () => {
              clearTimeout(timer);
              this.connected.delete(url);
              resolve();
            });
          }),
      ),
    );
    return this.status();
  }

  /** Per-relay connection state. RELAY.md §6: the client MUST surface how many are connected. */
  status(): RelayStatus[] {
    return this.options.relays.map((url) => ({ url, connected: this.connected.has(url) }));
  }

  get connectedCount(): number {
    return this.connected.size;
  }

  /** Number of distinct quote_ref envelopes received so far, across all relays. */
  get referenceCount(): number {
    return this.refs.size;
  }

  /** Publishes an RFQ to EVERY connected relay (§6.1). Refuses outright below the relay minimum
   *  rather than warning: a warning is what gets ignored. */
  publishRfq(body: RfqBody, ttl = 8): Envelope<RfqBody> {
    if (this.connected.size < this.minRelays) {
      throw new InsufficientRelaysError(this.connected.size, this.minRelays);
    }
    const envelope: Envelope<RfqBody> = {
      v: WIRE_VERSION,
      type: 'rfq',
      id: computeId(body),
      ts: Math.floor(Date.now() / 1000),
      ttl,
      body,
    };
    const raw = JSON.stringify(envelope);
    for (const url of this.connected) this.sockets.get(url)?.send(raw);
    return envelope;
  }

  /** Verifies every reference received for `rfq` against the chain and returns the union. */
  async collect(rfq: RfqBody, nowSecs: number = Math.floor(Date.now() / 1000)): Promise<AggregationResult> {
    const byQuote = new Map<string, VerifiedAggregate>();
    const rejected: RejectedRef[] = [];

    for (const [envelopeId, { envelope, relays }] of this.refs) {
      if (envelope.body.rfqId !== rfq.rfqId) continue;
      // Only ACCEPTED verdicts are cached. A rejection can be transient — most importantly "quoteId not
      // found on-chain" while the indexer is still behind the dealer's commit, which a live indexer
      // makes routine — and caching it would drop an honest quote permanently. Re-verifying a
      // rejected ref costs a chain read that the ChainReader already rate-limits.
      let verdict = this.verdicts.get(envelopeId);
      if (!verdict) {
        verdict = verifyQuoteRef(envelope, rfq, this.options.chain, nowSecs);
      }
      const v = await verdict;
      if (v.ok) this.verdicts.set(envelopeId, verdict);
      else this.verdicts.delete(envelopeId);
      if (!v.ok) {
        rejected.push({ envelopeId, quoteId: envelope.body.quoteId, relays: [...relays], reason: v.reason });
        continue;
      }
      // Two genuine envelopes for one quote (e.g. re-announced with a new ts-independent body)
      // collapse to one quote; the relay sets union.
      const existing = byQuote.get(v.quote.quoteId);
      if (existing) {
        existing.relays = [...new Set([...existing.relays, ...relays])];
      } else {
        byQuote.set(v.quote.quoteId, { ...v.quote, relays: [...relays] });
      }
    }

    return {
      relaysConnected: this.connected.size,
      relaysTotal: this.options.relays.length,
      verified: [...byQuote.values()],
      rejected,
    };
  }

  async close(): Promise<void> {
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
    this.connected.clear();
  }

  private handleFrame(url: string, raw: string): void {
    // The relay's own validator: a frame that a conforming relay would drop is dropped here too.
    const result = parseAndValidate(raw);
    if (!result.ok || result.envelope.type !== 'quote_ref') return;
    const envelope = result.envelope as Envelope<QuoteRefBody>;
    const entry = this.refs.get(envelope.id);
    if (entry) entry.relays.add(url);
    else this.refs.set(envelope.id, { envelope, relays: new Set([url]) });
  }
}
