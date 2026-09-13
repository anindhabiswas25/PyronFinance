// Production adapters: the interfaces quoting.ts / pool.ts / journal.ts depend on, implemented over the
// SDK, the public indexer and real relay sockets. Everything on-chain goes through packages/sdk; this
// file holds wiring, not contract logic (DEALER-NODE.md §7).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { HeadlessWallet } from '../../sdk/src/wallet.js';
import type { DeployedOTCContract } from '../../sdk/src/types.js';
import { commitQuote } from '../../sdk/src/quotes.js';
import { recordSettlement, releaseExpiredQuote } from '../../sdk/src/fraud.js';
import { indexerChainReader } from '../../sdk/src/relay-client.js';
import { queryLedgerParameters } from '../../sdk/src/indexer.js';
import { buildAndProveOffer, OfferError, type ProvedOffer } from '../../sdk/src/offers.js';
import { counterAmountFor } from '../../sdk/src/terms.js';
import { parseAndValidate } from '../../relay-node/src/validate.js';
import type { Envelope, QuoteRefBody, RfqBody } from '../../relay-node/src/schema.js';
import type { RevealMessage } from '../../sdk/src/reveal-channel.js';
import type { ChainOps, RelayOps } from './quoting.js';
import type { OfferStatus, QuoteRecord, RecoveryChain } from './journal.js';
import type { InventoryView, Mid, OfferBuilder, PairTokens } from './pool.js';
import type { QuotePolicy } from './config.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nowSecs = () => Math.floor(Date.now() / 1000);

async function retry<T>(what: string, fn: () => Promise<T>, attempts = 6, delayMs = 5000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      // Preprod's indexer times out on connect intermittently (ROADMAP "Reliability"); retry, don't fail.
      if (i >= attempts) throw new Error(`${what} failed after ${attempts} attempts: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Unshielded activity on the dealer's address, over the indexer's graphql-transport-ws subscription
// ─────────────────────────────────────────────────────────────────────────────────────────────────

interface UtxoRef {
  owner: string;
  value: string;
  tokenType: string;
  intentHash: string;
  outputIndex: number;
}
interface SeenTx {
  hash: string;
  created: UtxoRef[];
  spent: UtxoRef[];
}

/** Keeps, for every unshielded UTXO the dealer's address has ever spent, the transaction that spent it.
 *  `offerStatus` reads it: an offer input spent by a transaction that pays the dealer exactly its want
 *  leg is the taker's settlement; spent by anything else, the node double-spent its own quote. */
export class UnshieldedActivity {
  private ws?: WebSocket;
  private readonly spentBy = new Map<string, SeenTx>();
  private closed = false;
  private lastTxId?: number;

  constructor(private readonly indexerWs: string, private readonly address: string, private readonly log: (m: string) => void) {}

  start(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.indexerWs, 'graphql-transport-ws');
    this.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init' })));
    ws.on('message', (raw) => {
      let msg: { type: string; id?: string; payload?: { data?: { unshieldedTransactions?: Record<string, unknown> } } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (msg.type === 'connection_ack') {
        ws.send(
          JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: {
              query: `subscription($address: UnshieldedAddress!, $transactionId: Int) {
                unshieldedTransactions(address: $address, transactionId: $transactionId) {
                  __typename
                  ... on UnshieldedTransaction {
                    transaction { id hash }
                    createdUtxos { owner value tokenType intentHash outputIndex }
                    spentUtxos { owner value tokenType intentHash outputIndex }
                  }
                }
              }`,
              variables: { address: this.address, transactionId: this.lastTxId },
            },
          }),
        );
      }
      if (msg.type === 'next') {
        const ev = msg.payload?.data?.unshieldedTransactions as
          | { __typename: string; transaction?: { id: number; hash: string }; createdUtxos?: UtxoRef[]; spentUtxos?: UtxoRef[] }
          | undefined;
        if (ev?.__typename === 'UnshieldedTransaction' && ev.transaction) {
          this.lastTxId = ev.transaction.id;
          const seen: SeenTx = { hash: ev.transaction.hash, created: ev.createdUtxos ?? [], spent: ev.spentUtxos ?? [] };
          for (const s of seen.spent) this.spentBy.set(`${s.intentHash}:${s.outputIndex}`, seen);
        }
      }
      if (msg.type === 'error') this.log(`[activity] subscription error: ${JSON.stringify(msg.payload)}`);
    });
    ws.on('close', () => {
      // A missed event could hide a settlement; reconnect and resume from the last transaction seen.
      if (!this.closed) setTimeout(() => this.start(), 5000);
    });
    ws.on('error', (err) => this.log(`[activity] socket error: ${err.message}`));
  }

  close(): void {
    this.closed = true;
    this.ws?.terminate();
  }

  spendingTx(input: string): SeenTx | undefined {
    return this.spentBy.get(input.replace(/^0x/, ''));
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Chain
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface LiveChainOptions {
  contract: DeployedOTCContract;
  indexerHttp: string;
  contractAddress: string;
  dealerCmt: Uint8Array;
  dealerAddress: string;
  tokens: PairTokens;
  activity: UnshieldedActivity;
}

export function liveChain(o: LiveChainOptions): ChainOps & RecoveryChain {
  const reader = indexerChainReader(o.indexerHttp, o.contractAddress, 2000);

  /** What the dealer's own half must receive: the taker's settlement creates exactly this output. */
  function wantLeg(rec: QuoteRecord): { token: string; amount: bigint } {
    const terms = { pair: rec.pair, side: rec.side, price: rec.price, size: rec.size };
    return rec.side === 'sell'
      ? { token: o.tokens.counter.token, amount: counterAmountFor(terms) }
      : { token: o.tokens.base.token, amount: BigInt(rec.notional) };
  }

  const ops: ChainOps & RecoveryChain = {
    async commit(sealed) {
      const res = await commitQuote(o.contract, sealed);
      return { txHash: res.public.txHash };
    },
    async quoteOnChain(quoteId) {
      const q = await retry('indexer quote read', () => reader.quote(Buffer.from(quoteId, 'hex')));
      return q ? { resolved: q.resolved } : undefined;
    },
    async quote(quoteId) {
      return ops.quoteOnChain(quoteId);
    },
    async bond() {
      const d = await retry('indexer bond read', () => reader.dealer(o.dealerCmt));
      return d.bond ? { amount: d.bond.amount, active: d.bond.active } : undefined;
    },
    async offerStatus(rec): Promise<OfferStatus> {
      const spenders = rec.offerInputs.map((i) => o.activity.spendingTx(i)).filter((t): t is SeenTx => !!t);
      if (spenders.length === 0) return 'unspent';
      const want = wantLeg(rec);
      const pays = spenders.some((tx) =>
        tx.created.some((u) => u.owner === o.dealerAddress && u.tokenType.replace(/^0x/, '') === want.token && BigInt(u.value) === want.amount),
      );
      return pays ? 'settled' : 'spent-elsewhere';
    },
    async recordSettlement(quoteId) {
      await recordSettlement(o.contract, Buffer.from(quoteId, 'hex'));
    },
    async release(quoteId) {
      await releaseExpiredQuote(o.contract, Buffer.from(quoteId, 'hex'));
    },
    nowSecs,
  };
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Offers and inventory
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function liveBuilder(wallet: HeadlessWallet, indexerHttp: string, maxInputs: number): OfferBuilder {
  let params: { at: number; value: ledger.LedgerParameters } | undefined;
  return {
    async build(req): Promise<ProvedOffer> {
      if (!params || nowSecs() - params.at > 600) {
        params = { at: nowSecs(), value: (await retry('ledger parameters', () => queryLedgerParameters(indexerHttp))).params };
      }
      const offer = await buildAndProveOffer({ wallet, ...req, ledgerParameters: params.value });
      if (offer.inputs.length > maxInputs) {
        await offer.release();
        throw new OfferError(
          `offer half spends ${offer.inputs.length} coins (max_offer_inputs ${maxInputs}); consolidate inventory — ` +
            'coin selection is smallest-first, so every coin smaller than the give amount is swept in',
        );
      }
      return offer;
    },
  };
}

export function liveInventory(wallet: HeadlessWallet): InventoryView {
  return {
    async balance(token) {
      const s = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
      return (s.unshielded.balances[token] ?? 0n) as bigint;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mid sources (DEALER-NODE.md §4)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function midSource(policy: QuotePolicy): () => Promise<Mid> {
  switch (policy.midSource) {
    case 'manual':
      // A manual mid is "fresh" by definition; SIGHUP reload re-reads config.
      return async () => ({ price: policy.midPrice!, ts: nowSecs() });
    case 'external':
      return async () => {
        if (!policy.midUrl) throw new Error('mid_source = external needs mid_url');
        const res = await fetch(policy.midUrl, { signal: AbortSignal.timeout(5000) });
        const body = (await res.json()) as { mid?: unknown; ts?: unknown };
        if (typeof body.mid !== 'string' || typeof body.ts !== 'number') throw new Error('external mid must be {"mid": "<decimal string>", "ts": <unix secs>}');
        return { price: body.mid, ts: body.ts };
      };
    case 'script':
      return async () => {
        if (!policy.midCommand) throw new Error('mid_source = script needs mid_command');
        const [cmd, ...args] = policy.midCommand.split(/\s+/);
        const { stdout } = await promisify(execFile)(cmd, args, { timeout: 5000 });
        const price = stdout.trim();
        if (!/^\d+(\.\d{1,6})?$/.test(price)) throw new Error(`script mid "${price}" is not a decimal string`);
        return { price, ts: nowSecs() };
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Relays
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Gossip sockets to every configured relay: inbound RFQs, outbound quote_refs. Reveals go to a relay
 *  MAILBOX over HTTP — never over gossip (RELAY.md §4). */
export class LiveRelays implements RelayOps {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly seenRfq = new Set<string>();
  private closed = false;

  constructor(
    private readonly endpoints: string[],
    private readonly onRfq: (rfq: RfqBody) => void,
    private readonly log: (m: string) => void,
  ) {}

  /** The relay whose mailbox receives reveals, as its HTTP base URL. */
  get mailboxBase(): string {
    return this.endpoints[0].replace(/^ws/, 'http').replace(/\/gossip$/, '');
  }

  connect(): void {
    for (const url of this.endpoints) this.open(url);
  }

  connectedCount(): number {
    return [...this.sockets.values()].filter((s) => s.readyState === WebSocket.OPEN).length;
  }

  private open(url: string): void {
    if (this.closed) return;
    const ws = new WebSocket(url);
    this.sockets.set(url, ws);
    ws.on('open', () => this.log(`[relay] connected ${url}`));
    ws.on('message', (data) => {
      const v = parseAndValidate(data.toString());
      if (!v.ok || v.envelope.type !== 'rfq') return;
      const body = v.envelope.body as RfqBody;
      if (this.seenRfq.has(body.rfqId)) return; // the same RFQ arrives via every relay
      this.seenRfq.add(body.rfqId);
      this.onRfq(body);
    });
    ws.on('close', () => {
      if (!this.closed) setTimeout(() => this.open(url), 5000);
    });
    ws.on('error', (err) => this.log(`[relay] ${url}: ${err.message}`));
  }

  publishQuoteRef(envelope: Envelope<QuoteRefBody>): void {
    const raw = JSON.stringify(envelope);
    let sent = 0;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
        sent++;
      }
    }
    if (sent === 0) throw new Error('no relay connected — quote_ref not gossiped');
  }

  async deliverReveal(rec: QuoteRecord, message: RevealMessage): Promise<void> {
    const res = await fetch(`${rec.dealerEndpoint}/mailbox/${rec.takerEncPk}`, {
      method: 'POST',
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 202) throw new Error(`mailbox refused reveal: HTTP ${res.status} ${await res.text()}`);
  }

  close(): void {
    this.closed = true;
    for (const ws of this.sockets.values()) ws.terminate();
  }
}

export { hex };
