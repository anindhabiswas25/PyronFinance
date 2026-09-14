// Automated commit -> reveal state machine — DEALER-NODE.md §3, task 3.4.
//
// Every state change is journaled BEFORE the action it enables (journal.ts). The chain and relay are
// injected interfaces, so the machine is exercised in tests against fakes and in production against
// the SDK (contract calls, indexer, RelayAggregator-style sockets, relay mailbox).
//
// Order of operations for one RFQ, and why:
//   filter  -> silent on rejection: a reason is free information about inventory and risk limits
//   take    -> a pooled, pre-proved offer; never proved on the hot path
//   intent  -> nonce + terms + offer persisted (fsync) BEFORE commitQuote is submitted
//   commit  -> commitQuote, then wait until the INDEXER shows it: takers verify against the indexer,
//              and a reference they cannot find yet is indistinguishable from a lie
//   gossip  -> signed quote_ref (no price)
//   reveal  -> encrypted to the RFQ's takerEncPk, direct or via mailbox
//   watch   -> record a settlement only when the chain shows a settlement CONTAINING OUR OFFER;
//              inputs spent by anything else means the node double-spent its own quote -> alarm, halt
//
// Class B is gone (2026-09-14): there is no challenge to watch for.

import { deriveQuoteId } from '../../sdk/src/domain.js';
import { encodeTerms, type QuoteTerms } from '../../sdk/src/terms.js';
import { sealQuote, buildReveal, type SealedQuote } from '../../sdk/src/quotes.js';
import { encryptReveal, type RevealMessage } from '../../sdk/src/reveal-channel.js';
import { NOTIONAL_CAP_K } from '../../sdk/src/bonding.js';
import {
  computeId,
  encodeSignature,
  signBody,
  WIRE_VERSION,
  type Envelope,
  type QuoteRefBody,
  type RfqBody,
} from '../../relay-node/src/schema.js';
import type { DealerConfig, QuotePolicy } from './config.js';
import type { DealerIdentity } from './identity.js';
import {
  PROOF_GRACE_PERIOD_SECS,
  TERMINAL,
  type OfferStatus,
  type QuoteJournal,
  type QuoteRecord,
  type RecoveryAction,
} from './journal.js';
import { WarmPool, type DealerSide, type PoolEntry } from './pool.js';

export interface ChainOps {
  commit(sealed: SealedQuote): Promise<{ txHash: string }>;
  quoteOnChain(quoteId: string): Promise<{ resolved: boolean } | undefined>;
  bond(): Promise<{ amount: bigint; active: boolean } | undefined>;
  offerStatus(record: QuoteRecord): Promise<OfferStatus>;
  recordSettlement(quoteId: string): Promise<void>;
  release(quoteId: string): Promise<void>;
  nowSecs(): number;
}

export interface RelayOps {
  publishQuoteRef(envelope: Envelope<QuoteRefBody>): Promise<void> | void;
  deliverReveal(record: QuoteRecord, message: RevealMessage): Promise<void>;
}

export type QuotingEvent =
  | { kind: 'ignored'; rfqId: string; reason: string }
  | { kind: 'committed' | 'announced' | 'revealed' | 'settled' | 'recorded' | 'expired' | 'released' | 'abandoned'; quoteId: string; detail?: string }
  | { kind: 'reveal-failed' | 'commit-failed' | 'record-failed' | 'release-failed'; quoteId: string; detail: string }
  | { kind: 'ALERT'; quoteId?: string; detail: string }
  | { kind: 'halted'; detail: string };

export interface QuotingOptions {
  config: DealerConfig;
  policy: QuotePolicy;
  identity: DealerIdentity;
  journal: QuoteJournal;
  pool: WarmPool;
  chain: ChainOps;
  relay: RelayOps;
  dealerEndpoint: string;
  revealVia: 'direct' | 'mailbox';
  onEvent?: (e: QuotingEvent) => void;
  /** Poll interval while waiting for the indexer to show a commit. */
  visibilityPollMs?: number;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

/** Rebuilds the SealedQuote a reveal needs from a journal record — the restart path. */
export function sealedFromRecord(rec: QuoteRecord): SealedQuote {
  const terms: QuoteTerms = { pair: rec.pair, side: rec.side, price: rec.price, size: rec.size };
  return {
    terms,
    encodedTerms: encodeTerms(terms),
    nonce: unhex(rec.nonce),
    commitment: unhex(rec.commitment),
    rfqId: unhex(rec.rfqId),
    validUntil: BigInt(rec.validUntil),
    notional: BigInt(rec.notional),
  };
}

export class QuotingEngine {
  private halted = false;
  /** Quotes already alerted as invalidated. The live run logged the same ALERT every 15 s for 38 minutes;
   *  one alert per quote is the signal, the rest is noise that buries it. */
  private readonly alerted = new Set<string>();
  /** Offers handed to quotes, by quoteId, until their OFFER FILE expires — a taker may settle a
   *  revealed offer after validUntil, so the coins stay booked until then even if the quote is terminal. */
  private readonly taken = new Map<string, PoolEntry>();

  constructor(private readonly o: QuotingOptions) {}

  get isHalted(): boolean {
    return this.halted;
  }

  /** Inputs held by offers that were handed to quotes and may still settle. The consolidation keeper
   *  must never merge these: spending one invalidates a live quote. */
  bookedInputs(): string[] {
    return [...this.taken.values()].flatMap((e) => e.offer.inputs);
  }

  /** Offers handed to quotes that give `token` and may still settle — each holds one whole coin of it. The
   *  inventory keeper counts these toward `ladder_coins`, or it keeps splitting to replace coins that are
   *  merely in use (found live, M3 run #3). */
  offersGiving(token: string): number {
    return [...this.taken.values()].filter((e) => e.give.token === token).length;
  }

  private emit(e: QuotingEvent): void {
    this.o.onEvent?.(e);
  }

  async halt(detail: string): Promise<void> {
    if (this.halted) return;
    this.halted = true;
    await this.o.pool.halt(detail);
    this.emit({ kind: 'halted', detail });
  }

  // ── Filter ────────────────────────────────────────────────────────────────────────────────────
  private async filter(rfq: RfqBody): Promise<{ ok: true; side: DealerSide; size: bigint } | { ok: false; reason: string }> {
    const { policy, config, chain, journal } = this.o;
    const now = chain.nowSecs();
    if (this.halted) return { ok: false, reason: 'halted' };
    if (!policy.enabled || rfq.pair !== policy.pair) return { ok: false, reason: 'pair not quoted' };
    if (rfq.expiry <= now) return { ok: false, reason: 'rfq expired' };
    if (!/^[0-9a-f]{64}$/.test(rfq.rfqId) || !/^[0-9a-f]{64}$/.test(rfq.takerEncPk)) return { ok: false, reason: 'malformed rfq' };
    let size: bigint;
    try {
      size = encodeTerms({ pair: rfq.pair, side: 'buy', price: '0', size: rfq.size })[3];
    } catch {
      return { ok: false, reason: 'unparseable size' };
    }
    if (size < policy.minSize || size > policy.maxSize) return { ok: false, reason: 'size outside policy' };
    if (!policy.ladderSizes.includes(size)) return { ok: false, reason: 'size not on the ladder' };
    const live = journal.live();
    if (live.length >= config.risk.maxLiveQuotes) return { ok: false, reason: 'max_live_quotes reached' };
    const exposure = live.reduce((a, q) => a + BigInt(q.notional), 0n);
    if (exposure + size > config.risk.maxTotalNotional) return { ok: false, reason: 'max_total_notional reached' };
    const bond = await chain.bond();
    if (!bond) return { ok: false, reason: 'no bond on-chain' };
    if (!bond.active || bond.amount === 0n) {
      if (config.risk.haltOnSlash) await this.halt('bond inactive or slashed');
      return { ok: false, reason: 'bond inactive' };
    }
    if (bond.amount < config.bond.minimumBalance) return { ok: false, reason: 'bond below minimum_balance' };
    if (size > bond.amount * NOTIONAL_CAP_K) return { ok: false, reason: 'notional above bond cap' };
    return { ok: true, side: rfq.side === 'buy' ? 'sell' : 'buy', size };
  }

  // ── One RFQ ───────────────────────────────────────────────────────────────────────────────────
  async handleRfq(rfq: RfqBody): Promise<string | undefined> {
    const verdict = await this.filter(rfq);
    if (!verdict.ok) {
      this.emit({ kind: 'ignored', rfqId: rfq.rfqId, reason: verdict.reason });
      return undefined;
    }
    const { pool, journal, chain, identity, policy } = this.o;
    const entry = pool.take(verdict.side, verdict.size);
    if (!entry) {
      this.emit({ kind: 'ignored', rfqId: rfq.rfqId, reason: 'no warm offer for this side and size' });
      return undefined;
    }

    const validUntil = BigInt(chain.nowSecs() + policy.validitySecs);
    const sealed = sealQuote(entry.terms, unhex(rfq.rfqId), validUntil);
    const quoteId = hex(deriveQuoteId(identity.dealerCmt, sealed.rfqId, sealed.commitment));

    // PERSIST BEFORE SUBMIT. If this throws, nothing has been committed and the offer goes back.
    try {
      journal.recordIntent({
        quoteId,
        rfqId: rfq.rfqId,
        ...entry.terms,
        nonce: hex(sealed.nonce),
        commitment: hex(sealed.commitment),
        validUntil: Number(validUntil),
        notional: sealed.notional.toString(),
        offerFile: entry.offer.offerFileBase64,
        offerExpiresAt: entry.offer.expiresAt,
        offerInputs: entry.offer.inputs,
        takerEncPk: rfq.takerEncPk,
        revealVia: this.o.revealVia,
        dealerEndpoint: this.o.dealerEndpoint,
      });
    } catch (err) {
      await pool.retire(entry, { release: true });
      throw err;
    }
    this.taken.set(quoteId, entry);

    journal.transition(quoteId, 'submitted');
    let txHash: string | undefined;
    try {
      txHash = (await chain.commit(sealed)).txHash;
    } catch (err) {
      // The submission may still have landed. Only the chain can say.
      if (!(await chain.quoteOnChain(quoteId))) {
        journal.transition(quoteId, 'abandoned', { note: `commit failed: ${(err as Error).message.split('\n')[0]}` });
        this.emit({ kind: 'commit-failed', quoteId, detail: (err as Error).message.split('\n')[0] });
        await this.retireOffer(quoteId, true);
        return undefined;
      }
    }

    if (!(await this.waitVisible(quoteId, Number(validUntil)))) {
      journal.transition(quoteId, 'abandoned', { note: 'commit never became visible before validUntil' });
      this.emit({ kind: 'abandoned', quoteId });
      await this.retireOffer(quoteId, true);
      return undefined;
    }
    journal.transition(quoteId, 'committed', { txHash });
    this.emit({ kind: 'committed', quoteId, detail: txHash });

    const rec = journal.get(quoteId)!;
    await this.announce(rec, txHash);
    await this.reveal(rec);
    return quoteId;
  }

  private async waitVisible(quoteId: string, validUntil: number): Promise<boolean> {
    const pollMs = this.o.visibilityPollMs ?? 2000;
    for (;;) {
      if (await this.o.chain.quoteOnChain(quoteId)) return true;
      if (this.o.chain.nowSecs() >= validUntil) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  private async announce(rec: QuoteRecord, txHash: string | undefined): Promise<void> {
    const body: QuoteRefBody = {
      rfqId: rec.rfqId,
      dealerCmt: hex(this.o.identity.dealerCmt),
      quoteId: rec.quoteId,
      validUntil: rec.validUntil,
      // The relay schema requires a 32-byte hash; fall back to the commitment only if the wallet
      // returned none, which a taker then cannot use to confirm inclusion (it verifies via quoteId).
      txHash: txHash && /^[0-9a-f]{64}$/.test(txHash) ? txHash : rec.commitment,
      revealVia: rec.revealVia,
      dealerEndpoint: rec.dealerEndpoint,
      dealerEncPk: hex(this.o.identity.reveal.pk),
    };
    const envelope: Envelope<QuoteRefBody> = {
      v: WIRE_VERSION,
      type: 'quote_ref',
      id: computeId(body),
      ts: this.o.chain.nowSecs(),
      ttl: 8,
      body,
      sig: encodeSignature(signBody(body, this.o.identity.quoteSk)),
    };
    await this.o.relay.publishQuoteRef(envelope);
    this.o.journal.transition(rec.quoteId, 'announced');
    this.emit({ kind: 'announced', quoteId: rec.quoteId });
  }

  private async reveal(rec: QuoteRecord): Promise<boolean> {
    const sealed = sealedFromRecord(rec);
    const message = encryptReveal(
      unhex(rec.quoteId),
      buildReveal(sealed, this.o.identity.quoteSk, rec.offerFile, rec.offerExpiresAt),
      this.o.identity.reveal.sk,
      unhex(rec.takerEncPk),
    );
    try {
      await this.o.relay.deliverReveal(rec, message);
    } catch (err) {
      // Stay in `announced`; watch() retries while the quote is live.
      this.emit({ kind: 'reveal-failed', quoteId: rec.quoteId, detail: (err as Error).message });
      return false;
    }
    this.o.journal.transition(rec.quoteId, 'revealed');
    this.emit({ kind: 'revealed', quoteId: rec.quoteId });
    return true;
  }

  private async retireOffer(quoteId: string, release: boolean): Promise<void> {
    const entry = this.taken.get(quoteId);
    if (!entry) return;
    this.taken.delete(quoteId);
    await this.o.pool.retire(entry, { release });
  }

  // ── Watch loop ────────────────────────────────────────────────────────────────────────────────
  async watch(): Promise<void> {
    const { journal, chain, config } = this.o;
    const now = chain.nowSecs();

    const bond = await chain.bond();
    if (config.risk.haltOnSlash && (!bond || !bond.active || bond.amount === 0n) && journal.all().length > 0) {
      await this.halt('bond missing, inactive or slashed');
    }

    for (const rec of journal.live()) {
      const id = rec.quoteId;
      if (rec.state === 'intent' || rec.state === 'submitted') continue; // owned by handleRfq / resume

      const status = await chain.offerStatus(rec);
      if (status === 'settled' || rec.state === 'settled') {
        if (rec.state !== 'settled') {
          journal.transition(id, 'settled', { note: 'settlement containing our offer seen on-chain' });
          this.emit({ kind: 'settled', quoteId: id });
        }
        const onChain = await chain.quoteOnChain(id);
        if (onChain?.resolved) {
          journal.transition(id, 'closed', { note: 'settled, but the quote was already resolved on-chain' });
        } else {
          try {
            await chain.recordSettlement(id);
            journal.transition(id, 'recorded');
            this.emit({ kind: 'recorded', quoteId: id });
          } catch (err) {
            this.emit({ kind: 'record-failed', quoteId: id, detail: (err as Error).message });
            continue;
          }
        }
        await this.retireOffer(id, false);
        continue;
      }
      if (status === 'spent-elsewhere') {
        // Only a spend BEFORE the Offer File expires breaks a promise: until then a taker holding the reveal
        // could still settle it. After expiry the offer is dead and its coins are free inventory — the
        // keeper spending them is the normal case. Found live 2026-09-14 (run #3): the keeper split coins
        // freed from run #2's expired offers, this check fired an ALERT for each, and halted the node.
        if (now < rec.offerExpiresAt) {
          if (!this.alerted.has(id)) {
            this.alerted.add(id);
            this.emit({ kind: 'ALERT', quoteId: id, detail: 'offer inputs spent by another transaction while the offer was still settleable: this node invalidated its own live quote' });
          }
          await this.halt(`offer for ${id} invalidated`);
          if (now >= rec.validUntil && rec.state !== 'expired') journal.transition(id, 'expired', { note: 'offer invalidated' });
          continue;
        }
        // Dead offer: fall through to the ordinary expiry / release path below.
      }

      const onChain = await chain.quoteOnChain(id);
      if (onChain?.resolved) {
        journal.transition(id, 'closed', { note: 'resolved on-chain by another party' });
        this.emit({ kind: 'ALERT', quoteId: id, detail: 'quote resolved by another party (release or slash) — checking bond' });
        continue;
      }

      if (now < rec.validUntil) {
        if (rec.state === 'committed') await this.announce(rec, rec.txHash);
        if (journal.get(id)!.state === 'announced') await this.reveal(journal.get(id)!);
        continue;
      }
      if (rec.state !== 'expired') {
        journal.transition(id, 'expired');
        this.emit({ kind: 'expired', quoteId: id });
      }
      if (now >= rec.validUntil + PROOF_GRACE_PERIOD_SECS) {
        try {
          await chain.release(id);
          journal.transition(id, 'released');
          this.emit({ kind: 'released', quoteId: id });
        } catch (err) {
          this.emit({ kind: 'release-failed', quoteId: id, detail: (err as Error).message });
        }
      }
    }

    // Offers whose Offer File has expired can no longer settle: un-book their coins.
    for (const [id, entry] of [...this.taken]) {
      const rec = journal.get(id);
      if (now >= entry.offer.expiresAt && (!rec || TERMINAL.has(rec.state) || rec.state === 'expired')) {
        await this.retireOffer(id, true);
      }
    }
  }

  // ── Restart ───────────────────────────────────────────────────────────────────────────────────
  /** Executes recover()'s actions. Conservative by design: a quote that was persisted but never
   *  submitted is abandoned rather than resubmitted — nothing is owed yet, and after a restart its
   *  coins are no longer booked, so committing behind it could bind the dealer to an offer the wallet
   *  might spend. */
  async resume(actions: RecoveryAction[]): Promise<void> {
    const { journal, chain } = this.o;
    for (const a of actions) {
      switch (a.action) {
        case 'resubmit-commit':
          journal.transition(a.quoteId, 'abandoned', { note: 'restart: persisted but never submitted; not resubmitted' });
          this.emit({ kind: 'abandoned', quoteId: a.quoteId, detail: 'never submitted' });
          break;
        case 'reveal': {
          const rec = journal.get(a.quoteId)!;
          if (rec.state === 'committed') await this.announce(rec, rec.txHash);
          await this.reveal(journal.get(a.quoteId)!);
          break;
        }
        case 'record-settlement':
          try {
            await chain.recordSettlement(a.quoteId);
            journal.transition(a.quoteId, 'recorded');
            this.emit({ kind: 'recorded', quoteId: a.quoteId });
          } catch (err) {
            this.emit({ kind: 'record-failed', quoteId: a.quoteId, detail: (err as Error).message });
          }
          break;
        case 'release':
          try {
            await chain.release(a.quoteId);
            journal.transition(a.quoteId, 'released');
            this.emit({ kind: 'released', quoteId: a.quoteId });
          } catch (err) {
            this.emit({ kind: 'release-failed', quoteId: a.quoteId, detail: (err as Error).message });
          }
          break;
        case 'offer-invalidated':
          this.emit({ kind: 'ALERT', quoteId: a.quoteId, detail: 'restart: offer inputs spent by another transaction' });
          await this.halt('offer invalidated (found on restart)');
          break;
        case 'closed-externally':
          this.emit({ kind: 'ALERT', quoteId: a.quoteId, detail: 'restart: quote resolved by another party — checking bond' });
          break;
        case 'await-commit':
        case 'await-release':
        case 'abandon':
          break;
      }
    }
    await this.watch();
  }
}
