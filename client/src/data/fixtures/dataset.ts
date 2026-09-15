// The fixture dataset: 23 dealers and about 120 protocol events over 14 days, generated from a fixed
// seed. Only timestamps move with the clock (everything is placed relative to `now`), so the content
// is identical on every load. The ledger is folded from the events, so counters, bonds and totals
// always agree with them.
//
// Sample data. Nothing here is from any chain; the UI labels it as such on every page.

import type { ProtocolEvent, ProtocolEventBody } from '../ports';
import { splitSlash } from '../../lib/slash';
import { BOND_WITHDRAW_DELAY_SECS, NOTIONAL_CAP_K, PROOF_GRACE_PERIOD_SECS } from '../../lib/bond';
import { applyEvent, emptyLedger, ENTRY_POINT_OF, type MutableLedger } from './ledger';
import { createRng } from './rng';

export const FIXTURE_SEED = 0x5eed_0715;
export const FIXTURE_TIP_HEIGHT = 2_600_000;
export const FIXTURE_BLOCK_SECS = 6;

const HOUR = 3600;
const DAY = 86_400;
const UNIT = 1_000_000n; // tNIGHT base units

export type FixtureDealerStatus = 'active' | 'no-record' | 'withdrawing' | 'slashed';
export type ScenarioRole = 'a' | 'b' | 'c' | 'fraud';

export interface FixtureDealer {
  dealerCmt: string;
  status: FixtureDealerStatus;
  /** Dealers that answer the /trade scenario. */
  role?: ScenarioRole;
}

export interface FixtureDataset {
  now: number;
  tipHeight: number;
  dealers: FixtureDealer[];
  events: ProtocolEvent[];
  ledger: MutableLedger;
}

interface DealerSpec {
  status: FixtureDealerStatus;
  role?: ScenarioRole;
  bond: bigint;
  settled: number;
  released: number;
  topUp?: bigint;
  live?: number;
  notes?: number;
  withdrawAgoSecs?: number;
}

const t = (n: number) => BigInt(n) * UNIT;

const SPECS: DealerSpec[] = [
  { status: 'active', role: 'a', bond: t(45_000), settled: 9, released: 1, topUp: t(5_000), notes: 2 },
  { status: 'active', role: 'b', bond: t(12_400), settled: 4, released: 1, notes: 1 },
  { status: 'active', role: 'c', bond: t(5_200), settled: 1, released: 0 },
  { status: 'active', role: 'fraud', bond: t(8_000), settled: 2, released: 1 },
  { status: 'active', bond: t(20_000), settled: 1, released: 1, topUp: t(2_500), live: 1 },
  { status: 'active', bond: t(3_500), settled: 1, released: 0 },
  { status: 'active', bond: t(60_000), settled: 1, released: 1, topUp: t(10_000), notes: 1 },
  { status: 'active', bond: t(9_000), settled: 1, released: 0 },
  { status: 'active', bond: t(15_000), settled: 1, released: 1, topUp: t(1_000), live: 1 },
  { status: 'active', bond: t(2_000), settled: 1, released: 0 },
  { status: 'active', bond: t(30_000), settled: 1, released: 0, topUp: t(4_000), notes: 1 },
  { status: 'active', bond: t(7_500), settled: 1, released: 1 },
  { status: 'active', bond: t(11_000), settled: 1, released: 0, topUp: t(500) },
  { status: 'no-record', bond: t(1_000), settled: 0, released: 1 },
  { status: 'no-record', bond: t(2_500), settled: 0, released: 0 },
  { status: 'no-record', bond: t(50), settled: 0, released: 0 },
  { status: 'no-record', bond: t(4_000), settled: 0, released: 0 },
  { status: 'withdrawing', bond: t(6_000), settled: 1, released: 0, withdrawAgoSecs: 30 * HOUR },
  { status: 'withdrawing', bond: t(25_000), settled: 1, released: 0, withdrawAgoSecs: 6 * HOUR },
  { status: 'withdrawing', bond: t(3_000), settled: 1, released: 0, withdrawAgoSecs: 2 * HOUR },
  { status: 'slashed', bond: t(4_000), settled: 1, released: 0 },
  { status: 'slashed', bond: t(10_000), settled: 1, released: 0 },
  { status: 'slashed', bond: t(1_500), settled: 1, released: 0 },
];

const SIZES = [t(1_000), t(250), t(5_000), t(50), t(100), t(2_000)];
const VALIDITIES = [300, 600, 900];

export function buildDataset(now: number): FixtureDataset {
  const rng = createRng(FIXTURE_SEED);
  const raw: Array<{ at: number; body: ProtocolEventBody }> = [];
  const dealers: FixtureDealer[] = [];

  const sealQuote = (dealerCmt: string, bond: bigint, sealAt: number) => {
    const notional = (() => {
      const n = rng.pick(SIZES);
      return n <= bond * NOTIONAL_CAP_K ? n : bond * NOTIONAL_CAP_K;
    })();
    const validity = rng.pick(VALIDITIES);
    const quoteId = rng.hex32();
    raw.push({
      at: sealAt,
      body: { kind: 'quote-sealed', dealerCmt, quoteId, rfqId: rng.hex32(), commitment: rng.hex32(), notional, validUntil: BigInt(sealAt + validity) },
    });
    return { quoteId, notional, validity };
  };

  for (const spec of SPECS) {
    const dealerCmt = rng.hex32();
    dealers.push({ dealerCmt, status: spec.status, role: spec.role });
    const bondedAt = spec.status === 'no-record' ? now - rng.int(HOUR, 40 * HOUR) : now - 14 * DAY + rng.int(0, 2 * DAY);
    raw.push({ at: bondedAt, body: { kind: 'bond-posted', dealerCmt, amount: spec.bond, maxQuote: spec.bond * NOTIONAL_CAP_K } });

    let bond = spec.bond;
    if (spec.topUp) {
      bond += spec.topUp;
      raw.push({ at: bondedAt + rng.int(DAY, 3 * DAY), body: { kind: 'bond-topped-up', dealerCmt, delta: spec.topUp, amount: bond } });
    }

    // Resolved quotes happen between bonding (+1 h, after any top-up) and a cut-off.
    const cutoff = spec.withdrawAgoSecs ? now - spec.withdrawAgoSecs - 2 * HOUR : spec.status === 'slashed' ? now - 11 * DAY : now - 2 * HOUR;
    const windowStart = bondedAt + (spec.topUp ? 3 * DAY + HOUR : HOUR);
    const firstBond = spec.bond; // the smaller amount is the safe cap for any quote
    let notesLeft = spec.notes ?? 0;

    for (let i = 0; i < spec.settled; i++) {
      const sealAt = rng.int(windowStart, Math.max(windowStart, cutoff - 20 * 60));
      const q = sealQuote(dealerCmt, firstBond, sealAt);
      const settledAt = sealAt + rng.int(30, 240);
      raw.push({ at: settledAt, body: { kind: 'quote-settled', dealerCmt, quoteId: q.quoteId, notional: q.notional } });
      if (notesLeft > 0) {
        notesLeft--;
        raw.push({ at: settledAt + rng.int(60, HOUR), body: { kind: 'note-attached', tradeId: q.quoteId, dealerCmt, policyTag: 1 } });
      }
    }
    for (let i = 0; i < spec.released; i++) {
      const latest = Math.max(windowStart, cutoff - 3 * HOUR);
      const sealAt = rng.int(windowStart, latest);
      const q = sealQuote(dealerCmt, firstBond, sealAt);
      raw.push({ at: Math.min(sealAt + q.validity + PROOF_GRACE_PERIOD_SECS + rng.int(60, 2 * HOUR), now - 60), body: { kind: 'quote-released', dealerCmt, quoteId: q.quoteId, notional: q.notional } });
    }
    for (let i = 0; i < (spec.live ?? 0); i++) {
      const sealAt = now - rng.int(60, 400);
      const quoteId = rng.hex32();
      raw.push({ at: sealAt, body: { kind: 'quote-sealed', dealerCmt, quoteId, rfqId: rng.hex32(), commitment: rng.hex32(), notional: t(250), validUntil: BigInt(sealAt + 900) } });
    }
    if (spec.withdrawAgoSecs) {
      const requestedAt = BigInt(now - spec.withdrawAgoSecs);
      raw.push({
        at: now - spec.withdrawAgoSecs,
        body: { kind: 'withdrawal-requested', dealerCmt, requestedAt, withdrawableAt: requestedAt + BigInt(BOND_WITHDRAW_DELAY_SECS) },
      });
    }
    if (spec.status === 'slashed') {
      const sealAt = now - rng.int(2 * DAY, 10 * DAY);
      const q = sealQuote(dealerCmt, firstBond, sealAt);
      const split = splitSlash(bond);
      raw.push({ at: sealAt + rng.int(60, 300), body: { kind: 'bond-slashed', dealerCmt, quoteId: q.quoteId, amount: bond, taker: split.taker, prover: split.prover, burned: split.burned } });
    }
  }

  raw.sort((x, y) => x.at - y.at);
  const ledger = emptyLedger();
  const events: ProtocolEvent[] = raw.map(({ at, body }) => {
    const txHash = rng.hex32();
    const event = {
      id: `${txHash}:0`,
      txHash,
      height: FIXTURE_TIP_HEIGHT - Math.floor((now - at) / FIXTURE_BLOCK_SECS),
      timestamp: at,
      entryPoint: ENTRY_POINT_OF[body.kind],
      ...body,
    } as ProtocolEvent;
    applyEvent(ledger, event);
    return event;
  });

  return { now, tipHeight: FIXTURE_TIP_HEIGHT, dealers, events, ledger };
}
