// Small shims so tests can exercise witness logic without constructing a WitnessContext.

import { otcWitnesses } from '../src/witnesses.js';
import type { OTCPrivateState } from '../src/private-state.js';

const EMPTY: OTCPrivateState = { dealerSecretKey: null, takerAddress: null };

/** Calls the real computeSlashShares witness the circuit range-checks against. */
export function computeSlashSharesFor(amount: bigint): { takerCut: bigint; proverCut: bigint } {
  const [, [takerCut, proverCut]] = otcWitnesses.computeSlashShares(
    { ledger: undefined as never, privateState: EMPTY, contractAddress: undefined as never },
    amount,
  );
  return { takerCut, proverCut };
}
