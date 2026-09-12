// Known real assets, per network.
//
// This is the file that makes "the Mainnet second leg is config, not code" literally true. Nothing
// in packages/sdk/src/offers.ts names an asset — `SwapLeg.token` is a bare RawTokenType — so
// pointing the protocol at a different counter-asset means adding a row here.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// USDM — Cardano's fiat-backed stablecoin, issued by Moneta Digital (formerly Mehen Finance), a
// US-regulated MSB; FinCEN-registered, MiCA-compliant, 1:1 USD reserves. It reaches Midnight over a
// VIA Labs lock-and-mint bridge — native movement, not a wrapper asset.
//
// ON MIDNIGHT IT IS AN UNSHIELDED LEDGER TOKEN, not a contract-internal balance map. That matters
// more than it sounds: an account-model contract token moves only by circuit call, never enters a
// Zswap offer, never appears in `Transaction.imbalances`, and could not be settled by this protocol
// at all. USDM is spendable straight from the wallet, which is the same shape
// contracts/src/TestToken.compact mints — so the Preprod test asset is a faithful stand-in.
//
// "Token color" is Zswap's word for a token type: the same 64-hex RawTokenType used here.
//
// ⚠️ THE NETWORK TRAP. USDM's testnet pairing is Cardano PREPROD <-> Midnight PREVIEW. There is NO
// USDM on Midnight PREPROD. "Preprod" in the bridge docs refers to the CARDANO side, and reading it
// as the Midnight side is the easy mistake — it would surface only after wiring a token type that
// does not exist on the chain you are on. Hence `requireUsdm`'s deliberately loud failure.
// ════════════════════════════════════════════════════════════════════════════════════════════

import type { RawTokenType } from '@midnight-ntwrk/ledger-v8';
import type { NetworkId } from './config.js';
import type { TokenKind } from './offers.js';

export interface KnownAsset {
  symbol: string;
  /** 64-hex RawTokenType — what Zswap calls the token "color". Goes straight into `SwapLeg.token`. */
  tokenType: RawTokenType;
  /** Base-unit exponent. USDM uses 6, which matches terms.ts's PRICE_DECIMALS/SIZE_DECIMALS and
   *  tNIGHT's 1e6 Star — so no rescaling is needed for the tNIGHT/USDM pair. */
  decimals: number;
  kind: TokenKind;
}

/** USDM, on the networks where it actually exists. Deliberately has NO `preprod` entry. */
export const USDM_BY_NETWORK: Partial<Record<NetworkId, KnownAsset>> = {
  preview: {
    symbol: 'USDM',
    tokenType: '003bacd9a361ba0d425e408776020e40271375e8b8de42d73eec046a44947d73',
    decimals: 6,
    kind: 'unshielded',
  },
  mainnet: {
    symbol: 'USDM',
    tokenType: '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b',
    decimals: 6,
    kind: 'unshielded',
  },
};

/** The USDM gateway contract the VIA Labs bridge mints through. Not called by this protocol —
 *  recorded so a balance that fails to appear can be traced to the bridge rather than to us. */
export const USDM_GATEWAY_BY_NETWORK: Partial<Record<NetworkId, string>> = {
  preview: '471dfe55c866fdbc085c9011a51f0cd0e9c9bfca6bb985c35f7716b6e73e485c',
  mainnet: '65023744190a4fc7c8ac9a3dfbc8cfc28f63d2aaa431ceda1d88fdb9a096a6a1',
};

export function usdmFor(network: NetworkId): KnownAsset | undefined {
  return USDM_BY_NETWORK[network];
}

/** USDM or a loud, specific failure. The failure text names the trap on purpose: "no USDM on this
 *  network" is not actionable, "you are on Midnight Preprod and USDM lives on Midnight Preview" is. */
export function requireUsdm(network: NetworkId): KnownAsset {
  const asset = usdmFor(network);
  if (asset) return asset;
  throw new Error(
    `USDM does not exist on Midnight ${network}. It is bridged on the Cardano-Preprod <-> ` +
      `Midnight-PREVIEW pairing, and on Midnight mainnet — note that the "Preprod" in the bridge ` +
      `docs is the CARDANO side, not Midnight's. Either set MN_NETWORK=preview, or use the ` +
      `testnet stand-in asset (pnpm run deploy-test-token), which mints the same kind of ` +
      `unshielded ledger token.`,
  );
}
