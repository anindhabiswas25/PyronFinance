// Warm pool of pre-proved Offer Files — DEALER-NODE.md §5, task 3.2.
//
// Why a pool at all: a shielded offer proves in ~3 s (cold ~6.5 s) and the proof server does NOT
// parallelise (ROADMAP 2.8). A quote cannot wait for that, and `commitQuote` already costs 19–53 s.
// So offers are proved ahead of time at ladder points around the mid and handed to quotes on demand.
//
// Rules this module enforces, each with the failure it prevents:
//   * canBackQuote: an offer is only handed out if its remaining life exceeds validity + settlement
//     margin. Otherwise the taker holds a committed quote that cannot settle.
//   * expiry_margin: offers closer than this to expiry are discarded each tick and their coins released.
//   * mid move > spread_bps / 2: the whole side is re-proved. A pool priced off a stale mid writes
//     free options.
//   * stale mid (older than refresh_secs / 2): HARD STOP — the pair's pool is emptied and nothing is
//     refilled or handed out until a fresh mid arrives (DEALER-NODE.md §4).
//   * serial refill: one build at a time. The proof server serialises anyway; queueing more only
//     books more coins for longer.
//   * reserve: the pool never commits a token's value below its reserve, so a top-up bond or a
//     consolidation always has something to spend. See DEALER-NODE.md §5 for why, after Class B's
//     removal, only unshielded tNIGHT needs one: offers are built with payFees:false, so they never
//     book DUST, and commitQuote / recordSettlement / releaseExpiredQuote pay fees in DUST.
//   * dismiss headroom: the builder refuses halves using too much of the time-to-dismiss allowance,
//     because the taker's balancing adds inputs and DUST spends on top (ROADMAP S5).
//
// Pricing, with the rounding always against the dealer (terms.ts counterAmountFor does the amounts):
//   dealer 'buy'  (taker sells base): price = floor(mid × (10000 − bps) / 10000)
//   dealer 'sell' (taker buys base) : price = ceil (mid × (10000 + bps) / 10000)

import type { SwapLeg, ProvedOffer } from '../../sdk/src/offers.js';
import { canBackQuote } from '../../sdk/src/offers.js';
import { counterAmountFor, encodeTerms, PRICE_DECIMALS, type QuoteTerms } from '../../sdk/src/terms.js';
import type { QuotePolicy } from './config.js';

export type DealerSide = 'buy' | 'sell';

export interface PairTokens {
  base: { kind: SwapLeg['kind']; token: string };
  counter: { kind: SwapLeg['kind']; token: string };
}

export interface Mid {
  /** Decimal string, 6 dp. */
  price: string;
  /** Unix seconds the mid was observed. */
  ts: number;
}

export interface OfferBuilder {
  build(req: { give: SwapLeg; want: SwapLeg; validitySecs: number; settlementMarginSecs: number }): Promise<ProvedOffer>;
}

export interface InventoryView {
  /** Wallet balance of a token, in base units, as the wallet reports it. */
  balance(token: string): Promise<bigint>;
}

export interface PoolEntry {
  key: string;
  pair: string;
  side: DealerSide;
  size: bigint;
  terms: QuoteTerms;
  offer: ProvedOffer;
  give: SwapLeg;
  midAtBuild: bigint;
  builtAt: number;
}

export interface PoolEvent {
  kind: 'built' | 'discarded' | 'build-failed' | 'stale-mid' | 'reserve-blocked' | 'taken';
  key: string;
  detail?: string;
}

export interface WarmPoolOptions {
  policy: QuotePolicy;
  tokens: PairTokens;
  builder: OfferBuilder;
  inventory: InventoryView;
  mid: () => Promise<Mid>;
  /** Base units per token that must never be committed to offers. */
  reserve: Record<string, bigint>;
  now?: () => number;
  onEvent?: (e: PoolEvent) => void;
}

const SCALE = 10n ** BigInt(PRICE_DECIMALS);

export function toFixed(decimal: string): bigint {
  return encodeTerms({ pair: 'tNIGHT/USDM', side: 'buy', price: decimal, size: '0' })[2];
}

export function fromFixed(v: bigint): string {
  return `${v / SCALE}.${(v % SCALE).toString().padStart(PRICE_DECIMALS, '0')}`;
}

export function quotePrice(mid: bigint, side: DealerSide, spreadBps: number): bigint {
  const bps = BigInt(spreadBps);
  if (side === 'buy') return (mid * (10000n - bps)) / 10000n;
  const num = mid * (10000n + bps);
  return num % 10000n === 0n ? num / 10000n : num / 10000n + 1n;
}

/** |mid − built| > spread / 2, i.e. |Δ| × 20000 > built × bps. */
export function midMovedTooFar(built: bigint, mid: bigint, spreadBps: number): boolean {
  const delta = mid > built ? mid - built : built - mid;
  return delta * 20000n > built * BigInt(spreadBps);
}

export class WarmPool {
  private readonly entries = new Map<string, PoolEntry>();
  /** Give amounts per token held by offers that have left the pool but not yet retired (live quotes). */
  private readonly outstanding = new Map<string, bigint>();
  private readonly now: () => number;
  private halted = false;
  private building = false;

  constructor(private readonly o: WarmPoolOptions) {
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  get size(): number {
    return this.entries.size;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  list(): PoolEntry[] {
    return [...this.entries.values()];
  }

  static keyOf(pair: string, side: DealerSide, size: bigint): string {
    return `${pair}|${side}|${size}`;
  }

  /** One refresh cycle. Never runs two builds at once; a second concurrent tick returns immediately. */
  async tick(): Promise<void> {
    if (this.building) return;
    this.building = true;
    try {
      await this.cycle();
    } finally {
      this.building = false;
    }
  }

  /** Hands an offer to a quote. Returns undefined when no pooled offer can safely back it. */
  take(side: DealerSide, size: bigint): PoolEntry | undefined {
    if (this.halted) return undefined;
    const p = this.o.policy;
    const key = WarmPool.keyOf(p.pair, side, size);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!canBackQuote(entry.offer.expiresAt, p.validitySecs, p.settlementMarginSecs, this.now())) {
      void this.discard(entry, 'too close to expiry to back a quote');
      return undefined;
    }
    this.entries.delete(key);
    this.addOutstanding(entry.give.token, entry.give.amount);
    this.o.onEvent?.({ kind: 'taken', key });
    return entry;
  }

  /** A quote that took an offer is terminal: stop counting its give amount against the reserve.
   *  `release` un-books the coins too — pass it only if the offer can no longer be settled. */
  async retire(entry: PoolEntry, opts: { release: boolean }): Promise<void> {
    this.addOutstanding(entry.give.token, -entry.give.amount);
    if (opts.release) await entry.offer.release();
  }

  /** Stops quoting and releases every pooled offer (halt_on_slash, operator stop). */
  async halt(reason: string): Promise<void> {
    this.halted = true;
    for (const e of [...this.entries.values()]) await this.discard(e, `halt: ${reason}`);
  }

  private addOutstanding(token: string, delta: bigint): void {
    this.outstanding.set(token, (this.outstanding.get(token) ?? 0n) + delta);
  }

  private committed(token: string): bigint {
    let sum = this.outstanding.get(token) ?? 0n;
    for (const e of this.entries.values()) if (e.give.token === token) sum += e.give.amount;
    return sum;
  }

  private async discard(entry: PoolEntry, why: string): Promise<void> {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    await entry.offer.release();
    this.o.onEvent?.({ kind: 'discarded', key: entry.key, detail: why });
  }

  private async cycle(): Promise<void> {
    if (this.halted) return;
    const p = this.o.policy;
    const now = this.now();

    let mid: Mid | undefined;
    try {
      mid = await this.o.mid();
    } catch (err) {
      mid = undefined;
      this.o.onEvent?.({ kind: 'stale-mid', key: p.pair, detail: (err as Error).message });
    }
    if (!mid || now - mid.ts > p.refreshSecs / 2) {
      if (mid) this.o.onEvent?.({ kind: 'stale-mid', key: p.pair, detail: `mid is ${now - mid.ts}s old` });
      for (const e of [...this.entries.values()]) await this.discard(e, 'stale mid');
      return;
    }
    const midFixed = toFixed(mid.price);

    for (const e of [...this.entries.values()]) {
      if (e.offer.expiresAt - now <= p.expiryMarginSecs) await this.discard(e, 'within expiry margin');
      else if (midMovedTooFar(e.midAtBuild, midFixed, p.spreadBps)) await this.discard(e, 'mid moved beyond spread/2');
    }

    if (!p.enabled) return;
    for (const side of ['buy', 'sell'] as const) {
      for (const size of p.ladderSizes) {
        const key = WarmPool.keyOf(p.pair, side, size);
        if (this.entries.has(key)) continue;
        await this.buildRung(key, side, size, midFixed);
        if (this.halted) return;
      }
    }
  }

  private async buildRung(key: string, side: DealerSide, size: bigint, midFixed: bigint): Promise<void> {
    const p = this.o.policy;
    const { base, counter } = this.o.tokens;
    const price = quotePrice(midFixed, side, p.spreadBps);
    const terms: QuoteTerms = { pair: p.pair, side, price: fromFixed(price), size: fromFixed(size) };
    const counterAmount = counterAmountFor(terms);
    if (counterAmount <= 0n) {
      this.o.onEvent?.({ kind: 'build-failed', key, detail: 'counter amount rounds to zero' });
      return;
    }
    const baseLeg: SwapLeg = { kind: base.kind, token: base.token, amount: size };
    const counterLeg: SwapLeg = { kind: counter.kind, token: counter.token, amount: counterAmount };
    const give = side === 'sell' ? baseLeg : counterLeg;
    const want = side === 'sell' ? counterLeg : baseLeg;

    // Reserve and inventory floor, by value: selection is smallest-first and booked coins are held for
    // the offer's life, so what matters is how much of each token the pool has already committed.
    const balance = await this.o.inventory.balance(give.token);
    const reserve = this.o.reserve[give.token] ?? 0n;
    const floor = side === 'sell' ? p.inventoryFloor : 0n;
    const headroom = balance - reserve - floor - this.committed(give.token);
    if (headroom < give.amount) {
      this.o.onEvent?.({
        kind: 'reserve-blocked',
        key,
        detail: `needs ${give.amount}, headroom ${headroom} (balance ${balance}, reserve ${reserve}, floor ${floor}, committed ${this.committed(give.token)})`,
      });
      return;
    }

    try {
      const offer = await this.o.builder.build({
        give,
        want,
        validitySecs: p.validitySecs,
        settlementMarginSecs: p.settlementMarginSecs,
      });
      this.entries.set(key, { key, pair: p.pair, side, size, terms, offer, give, midAtBuild: midFixed, builtAt: this.now() });
      this.o.onEvent?.({ kind: 'built', key, detail: `${terms.side} ${terms.size} @ ${terms.price}` });
    } catch (err) {
      this.o.onEvent?.({ kind: 'build-failed', key, detail: (err as Error).message.split('\n')[0] });
    }
  }
}
