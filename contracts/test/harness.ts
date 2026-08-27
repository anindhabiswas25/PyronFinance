// Offline simulator harness for OTCProtocol.compact.
//
// Executes real circuits via @midnight-ntwrk/compact-runtime with NO wallet, NO proof server,
// NO indexer and NO deployment. This is what makes the whole contract testable in an environment
// where the Preprod faucet and Docker are unavailable (docs/ROADMAP.md M1 blockers).
//
// What this DOES verify: circuit logic, ledger state transitions, assertion failures, block-time
// gating, and the witness-provider contract.
// What this does NOT verify: real ZK proof generation, transaction balancing, submission, or
// indexer round-trips. Simulation is not chain integration — keep the distinction in ROADMAP.
//
// BLOCK TIME: createCircuitContext's trailing `time` argument is the raw block-time value the
// circuit's blockTimeGte() compares against. It is NOT implicitly milliseconds — whatever unit you
// pass is the unit the contract sees. All contract constants are in seconds, so we pass seconds.
// (Pinned empirically: with time=T, requestBondWithdrawal accepts now=T and now=T-100, and rejects
// now=T-400 (TIME_SLACK=300) and now=T+100.)

import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
  type ImpureCircuits,
} from '../managed/otc-protocol/contract/index.js';
import { otcWitnesses } from '../../packages/sdk/src/witnesses.js';
import type { OTCPrivateState } from '../../packages/sdk/src/private-state.js';
import { dealerCommitment } from '../../packages/sdk/src/domain.js';
import { schnorrPublicKey } from '../../packages/sdk/src/schnorr.js';

// ── Contract constants, mirrored for tests ────────────────────────────────
// These mirror the nullary pure circuits in OTCProtocol.compact. Tests assert against them, so a
// contract change that forgets to update them shows up as a failure rather than silent drift.
export const MAX_QUOTE_VALIDITY = 900;
export const CHALLENGE_WINDOW = 600;
export const PROOF_GRACE_PERIOD = 3600;
export const BOND_WITHDRAW_DELAY = 86400;
export const TIME_SLACK = 300;
export const SLASH_TAKER_BPS = 6000n;
export const SLASH_PROVER_BPS = 1000n;

/** A plausible unix-seconds base time. Arbitrary but fixed, so tests are deterministic. */
export const T0 = 1_800_000_000;

// A CoinPublicKey is a hex string at this API boundary, not encoded bytes. The simulator does
// not care about its value — the contract's identity logic runs off the dealerSecretKey witness,
// not the Zswap coin key.
const COIN_PK = '0'.repeat(64);
const CONTRACT_ADDR = dummyContractAddress();

type CircuitName = keyof ImpureCircuits<OTCPrivateState>;
type ArgsOf<K extends CircuitName> = ImpureCircuits<OTCPrivateState>[K] extends (
  ctx: never,
  ...rest: infer A
) => unknown
  ? A
  : never;

/** Who is calling. Maps directly onto the two identity witnesses. */
export interface Actor {
  dealerSecretKey?: Uint8Array | null;
  takerAddress?: Uint8Array | null;
}

export const ANON: Actor = {};
export const dealer = (sk: Uint8Array): Actor => ({ dealerSecretKey: sk, takerAddress: null });
export const taker = (addr: Uint8Array): Actor => ({ dealerSecretKey: null, takerAddress: addr });
/** A watchdog submitting a fraud proof: no dealer key, but names itself for the prover bounty. */
export const prover = (payoutAddr: Uint8Array): Actor => ({ dealerSecretKey: null, takerAddress: payoutAddr });

export interface CallResult {
  gasCost: unknown;
}

export class OTCSim {
  /** Current block time, in the same units the contract uses (seconds). */
  time: number;
  private state: unknown;

  constructor(opts: { time?: number } = {}) {
    this.time = opts.time ?? T0;
    const contract = new Contract<OTCPrivateState>(otcWitnesses);
    const init = contract.initialState(
      createConstructorContext<OTCPrivateState>(
        { dealerSecretKey: null, takerAddress: null },
        COIN_PK,
      ),
    );
    this.state = init.currentContractState.data;
  }

  /** Public ledger state as the chain would expose it. */
  get ledger(): Ledger {
    return ledger(this.state as never);
  }

  /** Execute a circuit as `actor`. Mutates simulator state on success; throws on assertion failure. */
  call<K extends CircuitName>(actor: Actor, name: K, ...args: ArgsOf<K>): CallResult {
    const contract = new Contract<OTCPrivateState>(otcWitnesses);
    const privateState: OTCPrivateState = {
      dealerSecretKey: actor.dealerSecretKey ?? null,
      takerAddress: actor.takerAddress ?? null,
    };
    const ctx = createCircuitContext<OTCPrivateState>(
      CONTRACT_ADDR,
      COIN_PK,
      this.state as never,
      privateState,
      undefined,
      undefined,
      this.time,
    );
    const fn = contract.impureCircuits[name] as (
      c: unknown,
      ...a: unknown[]
    ) => { context: { currentQueryContext: { state: unknown } }; gasCost: unknown };
    const res = fn(ctx, ...(args as unknown[]));
    this.state = res.context.currentQueryContext.state;
    return { gasCost: res.gasCost };
  }

  /**
   * Assert that a call fails, and return the failure message.
   * State is left untouched — a reverted transaction must not mutate the ledger.
   */
  expectRevert<K extends CircuitName>(actor: Actor, name: K, ...args: ArgsOf<K>): string {
    const before = this.state;
    try {
      this.call(actor, name, ...args);
    } catch (e: unknown) {
      this.state = before;
      return String((e as Error)?.message ?? e);
    }
    this.state = before;
    throw new Error(`expected ${String(name)} to revert, but it succeeded`);
  }

  advanceTo(t: number): this {
    this.time = t;
    return this;
  }

  advance(deltaSecs: number): this {
    this.time += deltaSecs;
    return this;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

let counter = 0;
/** Deterministic distinct 32-byte values — reproducible failures beat random ones. */
export function bytes32(seed: number = ++counter): Uint8Array {
  const out = new Uint8Array(32);
  out[0] = seed & 0xff;
  out[1] = (seed >> 8) & 0xff;
  for (let i = 2; i < 32; i++) out[i] = (seed * 31 + i) & 0xff;
  return out;
}

export const DEALER_SK = bytes32(0xd1);
export const DEALER_CMT = dealerCommitment(DEALER_SK);
export const TAKER_ADDR = bytes32(0x7a);
export const PROVER_ADDR = bytes32(0x9c);

/** The dealer's quote-signing scalar and its Jubjub pubkey (distinct from the dealer identity key). */
export const QUOTE_SK = 0x5eed_1234_5678_9abcn;
export const QUOTE_PK: JubjubPoint = schnorrPublicKey(QUOTE_SK);

/** Post a bond and return the dealer commitment. */
export function bondDealer(
  sim: OTCSim,
  amount = 1000n,
  sk: Uint8Array = DEALER_SK,
  pk: JubjubPoint = QUOTE_PK,
): Uint8Array {
  sim.call(dealer(sk), 'postBond', amount, pk);
  return dealerCommitment(sk);
}

export function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}
