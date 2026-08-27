// Bonding circuit helpers — postBond, topUpBond, requestBondWithdrawal, withdrawBond.
// Mirrors OTCProtocol.compact §5.1. `now` params are caller-supplied and chain-validated by the
// contract (see docs/CONTRACTS.md's "UPDATED during M1 build" notes and compact-contracts SKILL.md §9).

import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import type { DeployedOTCContract } from './types.js';

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
