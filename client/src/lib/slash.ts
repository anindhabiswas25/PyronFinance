// The Class A slash split — OTCProtocol.compact `slashBond`, docs/CONTRACTS.md §2.
//
// The contract checks takerCut*10000 <= amount*6000 < (takerCut+1)*10000 (and the same for the
// prover at 1000 bps), i.e. both cuts are floors, and burns the remainder. So rounding dust always
// goes to the burn, never to a party.

export const SLASH_TAKER_BPS = 6000n;
export const SLASH_PROVER_BPS = 1000n;
export const SLASH_BURN_BPS = 3000n;

export interface SlashSplit {
  /** 60 % to the wronged taker (the fraud proof's beneficiary). */
  taker: bigint;
  /** 10 % to whoever submits the proof. */
  prover: bigint;
  /** The remainder, retained forever by the contract. */
  burned: bigint;
  /** What a taker who proves the fraud themselves receives: taker + prover (70 %). */
  selfProving: bigint;
}

export function splitSlash(amount: bigint): SlashSplit {
  if (amount < 0n) throw new Error('bond amount cannot be negative');
  const taker = (amount * SLASH_TAKER_BPS) / 10_000n;
  const prover = (amount * SLASH_PROVER_BPS) / 10_000n;
  return { taker, prover, burned: amount - taker - prover, selfProving: taker + prover };
}
