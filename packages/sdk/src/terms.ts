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

/** The asset bonds are posted in. Notional must be denominated in it so the contract's bond cap
 *  needs no oracle (docs/CONTRACTS.md §7). */
export const BOND_ASSET = 'tNIGHT';

/** A quote's notional in bond-asset base units — the value `commitQuote` checks against
 *  `bond * 20` and stores on-chain.
 *
 *  Only defined for pairs whose BASE leg is the bond asset: there `size` is already tNIGHT, and
 *  SIZE_DECIMALS (6) equals tNIGHT's base-unit exponent, so the fixed-point size IS the notional. A
 *  pair with neither leg in the bond asset would need an oracle, which §7 puts out of scope — so it
 *  throws rather than guess. */
export function notionalOf(terms: QuoteTerms): bigint {
  const [base] = terms.pair.split('/');
  if (base !== BOND_ASSET) {
    throw new Error(
      `cannot size a bond for pair ${terms.pair}: its base leg is not ${BOND_ASSET}, and pricing ` +
        'notional in the bond asset would need an oracle (docs/CONTRACTS.md §7)',
    );
  }
  return encodeTerms(terms)[3];
}

/** The exact counter-asset amount a quote's Offer File must carry, in base units.
 *
 *  `size` (base asset) × `price` (counter per base) at 6 dp each. When that product is not a whole
 *  number of base units it is rounded AGAINST the dealer, and this function is the single
 *  definition both sides use:
 *    side 'buy'  — the dealer BUYS the base asset and PAYS counter      -> CEIL (taker gets at least the quote)
 *    side 'sell' — the dealer SELLS the base asset and RECEIVES counter -> FLOOR (taker pays at most the quote)
 *  (`side` here is the DEALER's side in the quote terms.) A taker who checks an Offer File against
 *  this can never be shorted by a rounding choice the dealer made. */
export function counterAmountFor(terms: QuoteTerms): bigint {
  const [, , price, size] = encodeTerms(terms);
  const scale = 10n ** BigInt(PRICE_DECIMALS);
  const product = size * price;
  const floor = product / scale;
  if (terms.side === 'sell') return floor;
  return product % scale === 0n ? floor : floor + 1n;
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
