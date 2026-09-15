// Bond sizing — docs/CONTRACTS.md §7. Mirrors packages/sdk/src/bonding.ts, duplicated here so
// public pages (/deal, /dealers) never load the SDK and its WASM. test/unit/bond.test.ts checks
// the two agree.

/** commitQuote accepts `notional <= bond * NOTIONAL_CAP_K`. */
export const NOTIONAL_CAP_K = 20n;

/** Timing constants from OTCProtocol.compact, in seconds. */
export const MAX_QUOTE_VALIDITY_SECS = 900;
export const PROOF_GRACE_PERIOD_SECS = 3600;
export const BOND_WITHDRAW_DELAY_SECS = 86_400;

export function minBondForNotional(notional: bigint): bigint {
  if (notional <= 0n) throw new Error('notional must be positive');
  return (notional + NOTIONAL_CAP_K - 1n) / NOTIONAL_CAP_K;
}

export function maxNotionalForBond(bond: bigint): bigint {
  return bond * NOTIONAL_CAP_K;
}
