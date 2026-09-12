// Bonding circuit helpers — postBond, topUpBond, requestBondWithdrawal, withdrawBond.
// Mirrors OTCProtocol.compact §5.1. `now` params are caller-supplied and chain-validated by the
// contract (see docs/CONTRACTS.md's "UPDATED during M1 build" notes and compact-contracts SKILL.md §9).

import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import type { DeployedOTCContract } from './types.js';

/** Mirrors `NOTIONAL_CAP_K()` in OTCProtocol.compact — docs/CONTRACTS.md §7. */
export const NOTIONAL_CAP_K = 20n;
/** Mirrors `CHALLENGE_BOND_PCT()` / `CHALLENGE_BOND_DENOM()` — docs/CONTRACTS.md §7a. */
export const CHALLENGE_BOND_PCT = 2n;
export const CHALLENGE_BOND_DENOM = 100n;
/** Mirrors `CHALLENGE_BOND_FLOOR()`. Its AMOUNT is an open M4 (4.1) value, not a decision. */
export const CHALLENGE_BOND_FLOOR = 1n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** Smallest bond that lets `commitQuote` accept a quote of this notional: `notional <= bond * 20`. */
export function minBondForNotional(notional: bigint): bigint {
  if (notional <= 0n) throw new Error('notional must be positive');
  return ceilDiv(notional, NOTIONAL_CAP_K);
}

/** Largest notional a bond may back in a single quote. */
export function maxNotionalForBond(bond: bigint): bigint {
  return bond * NOTIONAL_CAP_K;
}

/** Smallest challenge bond `openSettlementChallenge` accepts: `max(floor, ceil(2% of notional))`.
 *  Rounds UP, matching the contract's `bond * 100 >= notional * 2` check. */
export function minChallengeBond(notional: bigint): bigint {
  const pct = ceilDiv(notional * CHALLENGE_BOND_PCT, CHALLENGE_BOND_DENOM);
  return pct > CHALLENGE_BOND_FLOOR ? pct : CHALLENGE_BOND_FLOOR;
}

export async function postBond(contract: DeployedOTCContract, amount: bigint, quotePk: JubjubPoint) {
  return contract.callTx.postBond(amount, quotePk);
}

export async function topUpBond(contract: DeployedOTCContract, amount: bigint) {
  return contract.callTx.topUpBond(amount);
}

/** `now` should be the caller's best estimate of current Unix time; the contract independently
 *  bounds it to within TIME_SLACK (300s, placeholder) of actual chain time. */
export async function requestBondWithdrawal(contract: DeployedOTCContract, now: bigint = BigInt(Math.floor(Date.now() / 1000))) {
  return contract.callTx.requestBondWithdrawal(now);
}

export async function withdrawBond(contract: DeployedOTCContract, recipient: Uint8Array) {
  return contract.callTx.withdrawBond(recipient);
}
