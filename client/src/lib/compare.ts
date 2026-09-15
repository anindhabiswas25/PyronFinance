// Quote comparison, in the taker's browser only, on verified reveals. Bigint throughout; nothing here
// ever touches Number for an amount. Definitions: docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §7.1.
//
// "Amount" is the counter-asset amount the Offer File pays or charges — counterAmountFor(terms) in
// base units. A taker selling the base asset receives it (best = max); a taker buying pays it
// (best = min).

import type { Side } from './side';
import { takerReceivesCounter } from './side';
import { formatUnits } from './format';

export type QuoteState = 'valid' | 'expired' | 'seal-mismatch' | 'offer-mismatch' | 'invalid';

export interface OfferCheck {
  /** Unshielded inputs in the dealer's half. */
  inputs: number;
  /** checkTimeToDismiss on the dealer's half alone. */
  fits: boolean;
  computePs?: bigint;
  allowancePs?: bigint;
  reason?: string;
}

export interface CompareQuote {
  quoteId: string;
  dealerCmt: string;
  /** Counter-asset base units: what the taker receives (selling) or pays (buying). */
  amount: bigint;
  /** The revealed price, as its decimal string. */
  price: string;
  bond: bigint;
  /** On-chain notional, base-asset base units. */
  notional: bigint;
  settled: bigint;
  slashed: bigint;
  /** Unix seconds. */
  validUntil: number;
  /** When this client first saw the quote, unix seconds. */
  firstSeen: number;
  state: QuoteState;
  offer?: OfferCheck;
}

// ---------------------------------------------------------------------------------------------
// Rounding helpers
// ---------------------------------------------------------------------------------------------

/** numerator / denominator rounded to the nearest integer, halves away from zero. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

// ---------------------------------------------------------------------------------------------
// Core definitions
// ---------------------------------------------------------------------------------------------

export function isValidAt(q: CompareQuote, now: number): boolean {
  return q.state === 'valid' && q.validUntil > now;
}

export function validQuotes(quotes: readonly CompareQuote[], now: number): CompareQuote[] {
  return quotes.filter((q) => isValidAt(q, now));
}

/** Whether `a` is better than `b` for the taker. */
export function isBetter(a: bigint, b: bigint, takerSide: Side): boolean {
  return takerReceivesCounter(takerSide) ? a > b : a < b;
}

export function bestQuote(quotes: readonly CompareQuote[], takerSide: Side, now: number): CompareQuote | undefined {
  let best: CompareQuote | undefined;
  for (const q of validQuotes(quotes, now)) {
    // Ties go to the earlier-seen quote, then the lower quote id, so "best" never flickers.
    if (!best || isBetter(q.amount, best.amount, takerSide) || (q.amount === best.amount && (q.firstSeen < best.firstSeen || (q.firstSeen === best.firstSeen && q.quoteId < best.quoteId)))) best = q;
  }
  return best;
}

export interface VsBest {
  /** Signed from the taker's side: worse is negative. */
  diff: bigint;
  /** round((amount / best − 1) × 10 000), signed from the taker's side. */
  bps: bigint;
}

export function vsBest(amount: bigint, best: bigint, takerSide: Side): VsBest {
  if (best === 0n) return { diff: 0n, bps: 0n };
  const raw = amount - best; // receiving: less is worse; paying: more is worse
  const diff = takerReceivesCounter(takerSide) ? raw : -raw;
  return { diff, bps: roundDiv(diff * 10_000n, best) };
}

/** Median of amounts. Even count → mean of the middle two, rounded toward the taker's worse side
 *  (down when receiving, up when paying). */
export function medianAmount(amounts: readonly bigint[], takerSide: Side): bigint | undefined {
  if (amounts.length === 0) return undefined;
  const sorted = [...amounts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  const sum = sorted[mid - 1] + sorted[mid];
  const floor = sum / 2n;
  return takerReceivesCounter(takerSide) || sum % 2n === 0n ? floor : floor + 1n;
}

export interface Spread {
  abs: bigint;
  /** Relative to the best amount, non-negative. */
  bps: bigint;
  best: bigint;
  worst: bigint;
}

export function spreadOf(amounts: readonly bigint[], takerSide: Side): Spread | undefined {
  if (amounts.length === 0) return undefined;
  let best = amounts[0];
  let worst = amounts[0];
  for (const a of amounts) {
    if (isBetter(a, best, takerSide)) best = a;
    if (isBetter(worst, a, takerSide)) worst = a;
  }
  const abs = best > worst ? best - worst : worst - best;
  return { abs, bps: best === 0n ? 0n : roundDiv(abs * 10_000n, best), best, worst };
}

/** bond / notional as tenths of a percent, rounded half up: 5_200 on 50_000 → 104n (10.4 %). */
export function bondPercentTenths(bond: bigint, notional: bigint): bigint | undefined {
  if (notional <= 0n) return undefined;
  return roundDiv(bond * 1000n, notional);
}

export type BondTone = 'ok' | 'neutral' | 'warn';

export function bondTone(tenths: bigint): BondTone {
  if (tenths >= 500n) return 'ok';
  if (tenths >= 200n) return 'neutral';
  return 'warn';
}

export function formatPercentTenths(tenths: bigint): string {
  return `${formatUnits(tenths, 1, { minFraction: tenths % 10n === 0n && tenths >= 1000n ? 0 : 1 })}%`;
}

/** The revealed price with 5 decimals, e.g. "41.440000" → "41.44000", "0.041440" → "0.04144". */
export function formatRate(price: string): string {
  const [whole = '0', frac = ''] = price.split('.');
  const padded = (frac + '000000').slice(0, 6);
  return formatUnits(BigInt(whole || '0') * 1_000_000n + BigInt(padded), 6, { maxFraction: 5, minFraction: 5, round: 'half-up', group: true });
}

/** Remaining validity as permille of the window this client saw (validUntil − firstSeen). */
export function validityPermille(q: Pick<CompareQuote, 'validUntil' | 'firstSeen'>, now: number): number {
  const total = q.validUntil - q.firstSeen;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1000, Math.floor(((q.validUntil - now) * 1000) / total)));
}

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------

export interface CompareSummary {
  opened: number;
  valid: number;
  expired: number;
  mismatches: number;
  offerMismatches: number;
  best?: CompareQuote;
  median?: bigint;
  spread?: Spread;
  firstToExpire?: CompareQuote;
  checkedOnChain: number;
  announced: number;
}

export function summarize(quotes: readonly CompareQuote[], takerSide: Side, now: number, announced = quotes.length): CompareSummary {
  const valid = validQuotes(quotes, now);
  const amounts = valid.map((q) => q.amount);
  let firstToExpire: CompareQuote | undefined;
  for (const q of valid) if (!firstToExpire || q.validUntil < firstToExpire.validUntil) firstToExpire = q;
  return {
    opened: quotes.length,
    valid: valid.length,
    expired: quotes.filter((q) => (q.state === 'valid' || q.state === 'expired') && !isValidAt(q, now)).length,
    mismatches: quotes.filter((q) => q.state === 'seal-mismatch').length,
    offerMismatches: quotes.filter((q) => q.state === 'offer-mismatch').length,
    best: bestQuote(quotes, takerSide, now),
    median: medianAmount(amounts, takerSide),
    spread: spreadOf(amounts, takerSide),
    firstToExpire,
    checkedOnChain: quotes.length,
    announced,
  };
}

// ---------------------------------------------------------------------------------------------
// Ordering and caution flags
// ---------------------------------------------------------------------------------------------

export type CompareSort = 'amount' | 'bond' | 'validity';

/** Rows the comparison table shows: everything except seal mismatches (those are a fraud banner).
 *  Valid quotes first by the chosen order, then expired and offer-mismatched ones; ties by quote id. */
export function sortForTable(quotes: readonly CompareQuote[], sort: CompareSort, takerSide: Side, now: number): CompareQuote[] {
  const rows = quotes.filter((q) => q.state !== 'seal-mismatch');
  const rank = (q: CompareQuote) => (isValidAt(q, now) ? 0 : 1);
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    let c = 0;
    if (sort === 'amount') c = a.amount === b.amount ? 0 : isBetter(a.amount, b.amount, takerSide) ? -1 : 1;
    else if (sort === 'bond') c = a.bond === b.bond ? 0 : a.bond > b.bond ? -1 : 1;
    else c = b.validUntil - a.validUntil;
    return c || (a.quoteId < b.quoteId ? -1 : 1);
  });
}

/** The weakest record among valid quotes: most slashes, then fewest settled, then smallest bond. */
export function weakestRecord(quotes: readonly CompareQuote[], now: number): CompareQuote | undefined {
  let weakest: CompareQuote | undefined;
  for (const q of validQuotes(quotes, now)) {
    if (
      !weakest ||
      q.slashed > weakest.slashed ||
      (q.slashed === weakest.slashed && (q.settled < weakest.settled || (q.settled === weakest.settled && q.bond < weakest.bond)))
    ) {
      weakest = q;
    }
  }
  return weakest;
}

export interface Cautions {
  slashes?: bigint;
  smallBond: boolean;
  /** Best price and the weakest record among the valid quotes (only when there is a choice). */
  bestButWeakest: boolean;
}

export function cautionsFor(q: CompareQuote, quotes: readonly CompareQuote[], takerSide: Side, now: number): Cautions {
  const valid = validQuotes(quotes, now);
  return {
    slashes: q.slashed > 0n ? q.slashed : undefined,
    // Exact ratio, not the displayed tenths: 9.998 % shows as "10.0%" but is still under 10 %.
    smallBond: q.notional > 0n && q.bond * 10n < q.notional,
    bestButWeakest: valid.length > 1 && bestQuote(quotes, takerSide, now)?.quoteId === q.quoteId && weakestRecord(quotes, now)?.quoteId === q.quoteId,
  };
}

// ---------------------------------------------------------------------------------------------
// Pairwise sentence
// ---------------------------------------------------------------------------------------------

/** "a / b" as a multiple with one decimal ("8.7×"), or undefined when b is zero. */
export function ratioTenths(a: bigint, b: bigint): bigint | undefined {
  if (b <= 0n) return undefined;
  return roundDiv(a * 10n, b);
}

/** One plain sentence from the numbers, never beyond them. `chosen` is compared against `other`. */
export function pairwiseSentence(
  chosen: CompareQuote,
  other: CompareQuote,
  takerSide: Side,
  fmt: { amount(v: bigint): string; symbol: string; dealer(cmt: string): string },
): string {
  const { diff } = vsBest(chosen.amount, other.amount, takerSide);
  const pct = other.amount === 0n ? 0n : roundDiv((diff < 0n ? -diff : diff) * 10_000n, other.amount);
  const pctText = `${formatUnits(pct, 2, { minFraction: 2 })}%`;
  const verb = takerReceivesCounter(takerSide) ? ['gives up', 'gains'] : ['pays', 'saves'];
  const priceClause =
    diff === 0n
      ? `gets the same price as ${fmt.dealer(other.dealerCmt)}`
      : diff < 0n
        ? `${verb[0]} ${fmt.amount(-diff)} ${fmt.symbol} (${pctText}) ${takerReceivesCounter(takerSide) ? '' : 'more '}`.trimEnd()
        : `${verb[1]} ${fmt.amount(diff)} ${fmt.symbol} (${pctText})`;

  const facts: string[] = [];
  const r = ratioTenths(chosen.bond, other.bond);
  if (r !== undefined && r !== 10n) {
    facts.push(r > 10n ? `${formatUnits(r, 1, { minFraction: 1 })}× the bond` : `${formatUnits(ratioTenths(other.bond, chosen.bond) ?? 0n, 1, { minFraction: 1 })}× less bond`);
  } else if (r === 10n) {
    facts.push('the same bond');
  }
  if (chosen.slashed === 0n && other.slashed > 0n) facts.push('no slashes');
  else if (chosen.slashed > other.slashed) facts.push(`${chosen.slashed - other.slashed} more slash${chosen.slashed - other.slashed === 1n ? '' : 'es'}`);
  if (chosen.settled !== other.settled) {
    const d = chosen.settled - other.settled;
    facts.push(`${d > 0n ? d : -d} ${d > 0n ? 'more' : 'fewer'} recorded trade${d === 1n || d === -1n ? '' : 's'}`);
  }

  const who = fmt.dealer(chosen.dealerCmt);
  if (facts.length === 0) return `Choosing ${who} ${priceClause}.`;
  const joined = facts.length === 1 ? facts[0] : `${facts.slice(0, -1).join(', ')} and ${facts[facts.length - 1]}`;
  return `Choosing ${who} ${priceClause} for a dealer with ${joined}.`;
}
