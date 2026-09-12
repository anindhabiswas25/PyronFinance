// TestShieldedToken — TESTNET SCAFFOLDING. Not part of the OTC protocol.
//
// See contracts/src/TestShieldedToken.compact: it exists so M2 task 2.8 can measure what proving a
// SHIELDED offer actually costs. Every offer built before it was unshielded, and unshielded offers
// carry no ZK proof at all.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { rawTokenType, type RawTokenType } from '@midnight-ntwrk/ledger-v8';
import { Contract } from '../../../contracts/managed/test-shielded-token/contract/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const testShieldedTokenZkConfigPath = path.resolve(__dirname, '../../../contracts/managed/test-shielded-token');

/** No witnesses — passed by reference, as for TestToken (see test-token.ts for why). */
export const compiledTestShieldedTokenContract = CompiledContract.make('TestShieldedToken', Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(testShieldedTokenZkConfigPath),
);

export const TEST_SHIELDED_TOKEN_PRIVATE_STATE_ID = 'testShieldedTokenState';

/** `pad(32, "otc:testshusd:v1")`, exactly as the contract's DOMAIN_SEP() produces it. */
export const TEST_SHIELDED_TOKEN_DOMAIN_SEP: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode('otc:testshusd:v1'));
  return out;
})();

export const TEST_SHIELDED_TOKEN_MAX_MINT_PER_CALL = 1_000_000_000_000n;

/** The RawTokenType a given deployment mints. Contract-scoped, like TestToken's. */
export function testShieldedTokenType(contractAddress: string): RawTokenType {
  return rawTokenType(TEST_SHIELDED_TOKEN_DOMAIN_SEP, contractAddress);
}
