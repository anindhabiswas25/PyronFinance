// Deploys the TESTNET-ONLY TestToken contract and mints a balance to this wallet.
//
// This is scaffolding, not protocol. See contracts/src/TestToken.compact for why it exists: without
// a second minted asset, Preprod can only settle a one-sided offer, and the protocol's central
// claim — a balance vector with TWO entries that nets to zero — stays an argument.
//
// Idempotent-ish: re-running redeploys a NEW token contract, and therefore a NEW token type, since
// the type is derived from the contract address. That is deliberate — it makes accidental reuse of
// a stale type impossible rather than silently confusing. Re-run `pnpm run e2e-settle` afterwards.
//
// REFUSES TO RUN ON MAINNET. The second leg there is a real asset, not one we mint.

import fs from 'node:fs';
import path from 'node:path';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildTestTokenProviders } from '../packages/sdk/src/providers.js';
import {
  compiledTestTokenContract,
  TEST_TOKEN_PRIVATE_STATE_ID,
  TEST_TOKEN_MAX_MINT_PER_CALL,
  testTokenType,
} from '../packages/sdk/src/test-token.js';
import { pollForContractState } from '../packages/sdk/src/indexer.js';
import { ledger } from '../contracts/managed/test-token/contract/index.js';

/** How much TESTUSD to mint to this wallet. Enough for many e2e runs without re-minting. */
const MINT_AMOUNT = BigInt(process.env.TEST_TOKEN_MINT ?? '1000000000'); // 1e9 base units

const chain = loadChainConfig();
if (chain.network === 'mainnet') {
  throw new Error(
    'REFUSING to deploy TestToken to mainnet. It is testnet scaffolding — on mainnet the second ' +
      'leg is a real asset (docs/ROADMAP.md "The mainnet second asset").',
  );
}
if (MINT_AMOUNT <= 0n || MINT_AMOUNT > TEST_TOKEN_MAX_MINT_PER_CALL) {
  throw new Error(
    `TEST_TOKEN_MINT must be in (0, ${TEST_TOKEN_MAX_MINT_PER_CALL}] — the contract's per-call cap`,
  );
}

initNetworkId(chain.network);

console.log(`Deploying TestToken to ${chain.network}...`);
const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('Waiting for wallet sync...');
await wallet.waitForSync();

const providers = buildTestTokenProviders(chain, wallet);

// `as any` on providers for the same dual-module-hazard reason documented in scripts/deploy.ts:
// midnight-js-types' ZKIR brand (a `unique symbol`) is loaded twice under NodeNext resolution.
const deployed = await deployContract(providers as any, {
  compiledContract: compiledTestTokenContract,
  privateStateId: TEST_TOKEN_PRIVATE_STATE_ID,
  initialPrivateState: {},
} as any);

const contractAddress = deployed.deployTxData.public.contractAddress;
console.log('Deployed. TestToken address:', contractAddress);

// The token type is derived from the contract address, so it only exists once the address does.
const tokenType = testTokenType(contractAddress);
console.log('TESTUSD raw token type:', tokenType);

const deploymentsDir = path.resolve(import.meta.dirname, '../deployments');
fs.mkdirSync(deploymentsDir, { recursive: true });
const deploymentFile = path.join(deploymentsDir, `${chain.network}-test-token.json`);
fs.writeFileSync(
  deploymentFile,
  JSON.stringify(
    { network: chain.network, address: contractAddress, tokenType, deployedAt: Date.now() },
    null,
    2,
  ) + '\n',
);
console.log('Wrote', deploymentFile);

// Never trust the deploy receipt alone — read the ledger back (midnight-deployment SKILL.md §3).
console.log('Verifying by reading ledger state back...');
const state = await pollForContractState(chain.indexerHttp, contractAddress);
if (!state) {
  throw new Error('TestToken not found on the indexer after polling — indexer lag or deploy failure');
}
if (ledger(state.data).totalMinted !== 0n) {
  throw new Error('Fresh TestToken deploy has non-zero totalMinted — something is wrong');
}
console.log('Read back OK. totalMinted = 0n');

console.log(`\nMinting ${MINT_AMOUNT} TESTUSD to this wallet...`);
const contract = await findDeployedContract(providers as any, {
  contractAddress,
  compiledContract: compiledTestTokenContract,
  privateStateId: TEST_TOKEN_PRIVATE_STATE_ID,
  initialPrivateState: {},
} as any);

// Raw 32-byte address, NOT the bech32m form and NOT a commitment — see defect D2.
const recipient = Buffer.from(wallet.unshieldedAddressHex, 'hex');
if (recipient.length !== 32) throw new Error(`recipient must be 32 raw bytes, got ${recipient.length}`);

await (contract as any).callTx.mint(MINT_AMOUNT, new Uint8Array(recipient));
console.log('Mint submitted.');

const after = await pollForContractState(chain.indexerHttp, contractAddress);
if (!after) throw new Error('TestToken state not found after mint');
const mintedTotal = ledger(after.data).totalMinted;
console.log('totalMinted on-chain:', mintedTotal, `(expect ${MINT_AMOUNT})`);
if (mintedTotal !== MINT_AMOUNT) {
  throw new Error(`Mint did not land as expected: totalMinted=${mintedTotal}, expected ${MINT_AMOUNT}`);
}

// The mint credits an unshielded UTXO, so it must show up as a wallet balance under the derived
// token type. If this stays zero the token was minted into a form Zswap settlement cannot use,
// which is the exact failure mode an account-model contract token would have produced.
console.log('\nWaiting for the wallet to see the minted balance...');
const balance = await wallet.waitForUnshieldedTokenBalance(tokenType, MINT_AMOUNT);
console.log('Wallet TESTUSD balance:', balance);

await wallet.saveState();
console.log('\n✅ TestToken deployed and minted. Run `pnpm run e2e-settle` for a two-asset settlement.');
process.exit(0);
