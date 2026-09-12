// TestToken — TESTNET SCAFFOLDING. Not part of the OTC protocol.
//
// See contracts/src/TestToken.compact for why this exists: Preprod has exactly one asset, so
// without a second minted asset `pnpm run e2e-settle` can only settle a one-sided offer and the
// protocol's central claim — a balance vector with TWO entries that nets to zero — stays an
// argument rather than a live run.
//
// Nothing in packages/sdk/src/offers.ts knows about this module, and it must stay that way: the
// settlement path is asset-generic (`SwapLeg.token` is just a RawTokenType), which is exactly what
// makes the Mainnet second leg a config change rather than a code change.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { rawTokenType, type RawTokenType } from '@midnight-ntwrk/ledger-v8';
import { Contract } from '../../../contracts/managed/test-token/contract/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const testTokenZkConfigPath = path.resolve(
  __dirname,
  '../../../contracts/managed/test-token',
);

/** TestToken declares NO witnesses, so this is `withVacantWitnesses` — unlike OTCProtocol, which
 *  has real ones and must use `withWitnesses`.
 *
 *  Note it is passed BY REFERENCE, not called: `withVacantWitnesses` is a plain
 *  `(self) => CompiledContract`, not a curried combinator like `withWitnesses(...)` /
 *  `withCompiledFileAssets(...)`. Calling it produces three confusing type errors that all point
 *  at the wrong line. */
export const compiledTestTokenContract = CompiledContract.make('TestToken', Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(testTokenZkConfigPath),
);

export const testTokenContractInstance = new Contract({});

export const TEST_TOKEN_PRIVATE_STATE_ID = 'testTokenState';

/** The domain separator in TestToken.compact, as `pad(32, "otc:testusd:v1")` produces it:
 *  UTF-8 bytes, right-padded with zeros to 32. */
export const TEST_TOKEN_DOMAIN_SEP: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode('otc:testusd:v1'));
  return out;
})();

/** Per-call mint cap, mirroring `MAX_MINT_PER_CALL()` in the contract. */
export const TEST_TOKEN_MAX_MINT_PER_CALL = 1_000_000_000_000n;

/** The RawTokenType of the asset a given TestToken deployment mints.
 *
 *  Contract-scoped by construction — derived from the deploying contract's address — so it can
 *  never collide with native tNIGHT, and two deployments of this same source mint two genuinely
 *  different assets. This is the value that goes into `SwapLeg.token`. */
export function testTokenType(contractAddress: string): RawTokenType {
  return rawTokenType(TEST_TOKEN_DOMAIN_SEP, contractAddress);
}
