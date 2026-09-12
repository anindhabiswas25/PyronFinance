// Quote terms encoding: [pair, side, price, size] as Vector<4, Field>. The contract treats these
// as four opaque Field values — CONTRACTS.md §1 is explicit that "no price oracle" / "no matching"
// means the chain never interprets them. This encoding is an SDK/client-side convention only.
//
// Amounts are decimal strings on the wire, never floats — see zswap-offer-files SKILL.md §7 (a
// rounding discrepancy between dealer and taker clients surfaces as an inexplicable settlement
// failure). Fixed-point with PRICE_DECIMALS / SIZE_DECIMALS avoids that entirely.

export const PRICE_DECIMALS = 6;
export const SIZE_DECIMALS = 6;

// First pair, per docs/CONTRACTS.md settled decisions — generic encoding so more pairs are
// config, not a migration. Extend this table as new pairs are added.
export const PAIR_CODES: Record<string, bigint> = {
  'tNIGHT/USDM': 1n,
  // PREPROD TEST PAIR ONLY — must never be offered on Mainnet.
  //
  // Preprod has exactly one native asset (tNIGHT); USDM does not exist there, and no substitute is
  // obtainable — shielded tNIGHT IS a distinct entry in the Zswap balance vector, but neither the
  // wallet SDK nor ledger-v8 exposes any unshielded -> shielded conversion, so a faucet-funded
  // wallet can never acquire a shielded balance to trade.
  //
  // TESTUSD is therefore minted by contracts/src/TestToken.compact (testnet scaffolding, deployed
  // via `pnpm run deploy-test-token`) purely so `pnpm run e2e-settle` can settle a balance vector
  // with TWO entries — which is what the protocol is actually about. It stands in for the USDM leg.
  'tNIGHT/TESTUSD': 2n,
};

export interface QuoteTerms {
  pair: string;
  side: 'buy' | 'sell';
  /** Decimal string, e.g. "0.0412" — never a JS number. */
  price: string;
  /** Decimal string, e.g. "1000.0" — never a JS number. */
  size: string;
}

function toFixedPointBigInt(decimalStr: string, decimals: number): bigint {
  const negative = decimalStr.startsWith('-');
  const s = negative ? decimalStr.slice(1) : decimalStr;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`value ${decimalStr} has more than ${decimals} decimal places`);
  }
  const paddedFrac = frac.padEnd(decimals, '0');
  const value = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(paddedFrac || '0');
  return negative ? -value : value;
}

/** Encodes quote terms into the Vector<4, Field> the contract's commitment/reveal circuits see. */
export function encodeTerms(terms: QuoteTerms): bigint[] {
  const pairCode = PAIR_CODES[terms.pair];
  if (pairCode === undefined) throw new Error(`unknown pair: ${terms.pair}`);
  const sideCode = terms.side === 'buy' ? 0n : 1n;
  const price = toFixedPointBigInt(terms.price, PRICE_DECIMALS);
  const size = toFixedPointBigInt(terms.size, SIZE_DECIMALS);
  if (price < 0n || size < 0n) throw new Error('price and size must be non-negative');
  return [pairCode, sideCode, price, size];
}
