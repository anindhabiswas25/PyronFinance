// Implements the Witnesses<PS> interface generated from contracts/src/OTCProtocol.compact
// (contracts/managed/otc-protocol/contract/index.d.ts). See compact-contracts SKILL.md §7 —
// witnesses are untrusted by the circuit; the circuit validates their output against ledger
// state (e.g. dealerCommitment(dealerSecretKey()) must already exist in `bonds`).

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger, Witnesses } from '../../../contracts/managed/otc-protocol/contract/index.js';
import type { OTCPrivateState } from './private-state.js';
import { reduceChallengeToScalar } from './schnorr.js';

const FIELD_MODULUS =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

export const otcWitnesses: Witnesses<OTCPrivateState> = {
  dealerSecretKey(context: WitnessContext<Ledger, OTCPrivateState>): [OTCPrivateState, Uint8Array] {
    const sk = context.privateState.dealerSecretKey;
    if (!sk) throw new Error('dealerSecretKey not set in private state — not configured as a dealer');
    return [context.privateState, sk];
  },

  takerAddress(context: WitnessContext<Ledger, OTCPrivateState>): [OTCPrivateState, Uint8Array] {
    const addr = context.privateState.takerAddress;
    if (!addr) throw new Error('takerAddress not set in private state — not configured as a taker');
    return [context.privateState, addr];
  },

  // Matches schnorr.compact's getChallengeReduction witness — see schnorr.ts and
  // compact-contracts SKILL.md §9 for why the reduction (and its two-limb range check) exists.
  getChallengeReduction(
    context: WitnessContext<Ledger, OTCPrivateState>,
    challenge: bigint,
  ): [OTCPrivateState, [bigint, bigint, bigint]] {
    const { quotient, remHi, remLo } = reduceChallengeToScalar(challenge);
    return [context.privateState, [quotient, remHi, remLo]];
  },

  // Computes the pre-divided 60/10/30 slash shares — see OTCProtocol.compact's slashBond and
  // compact-contracts SKILL.md §9 (Compact has no division operator; the circuit range-checks
  // this witness's output against amount*bps via multiplication instead).
  computeSlashShares(
    context: WitnessContext<Ledger, OTCPrivateState>,
    amount: bigint,
  ): [OTCPrivateState, [bigint, bigint]] {
    const takerCut = (amount * 6000n) / 10000n; // SLASH_TAKER_BPS
    const proverCut = (amount * 1000n) / 10000n; // SLASH_PROVER_BPS
    return [context.privateState, [takerCut, proverCut]];
  },
};

export function assertValidFieldElement(v: bigint, label: string): void {
  if (v < 0n || v >= FIELD_MODULUS) {
    throw new Error(`${label} is out of Field range`);
  }
}
