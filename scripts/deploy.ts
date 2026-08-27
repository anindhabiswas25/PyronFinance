// Compile check → deploy → write address → verify by reading state back. See midnight-deployment
// SKILL.md §3: "A deploy transaction that is accepted is not proof the contract is queryable."

import fs from 'node:fs';
import path from 'node:path';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { emptyPrivateState } from '../packages/sdk/src/private-state.js';
import { pollForContractState } from '../packages/sdk/src/indexer.js';
import { ledger } from '../contracts/managed/otc-protocol/contract/index.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

console.log(`Deploying OTCProtocol to ${chain.network}...`);
const wallet = await createHeadlessWallet(seed, chain);
console.log('Waiting for wallet sync...');
await wallet.waitForSync();

const providers = buildOTCProviders(chain, wallet);

// `as any` on providers: NodeNext module resolution loads midnight-js-types' ZKIR brand
// (`unique symbol`) twice — once via this file's ESM import graph, once via a dependency's CJS
// import graph — producing two nominally distinct types for the same real value. This is a
// package/tooling dual-module-hazard, not a real type mismatch; the SDK's own providers.ts
// (packages/sdk/src/providers.ts) typechecks cleanly in isolation. Verify this doesn't mask a
// real error once this can be run end-to-end against a live proof server.
const deployed = await deployContract(providers as any, {
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: emptyPrivateState(),
});

const contractAddress = deployed.deployTxData.public.contractAddress;
console.log('Deployed. Contract address:', contractAddress);

// Persist the address where every component reads it (midnight-deployment SKILL.md §3) —
// deployments/<network>.json, committed to the repo.
const deploymentsDir = path.resolve(import.meta.dirname, '../deployments');
fs.mkdirSync(deploymentsDir, { recursive: true });
const deploymentFile = path.join(deploymentsDir, `${chain.network}.json`);
fs.writeFileSync(
  deploymentFile,
  JSON.stringify(
    { network: chain.network, address: contractAddress, deployedAt: Date.now() },
    null,
    2,
  ) + '\n',
);
console.log('Wrote', deploymentFile);

// Verify by reading back — never trust the deploy receipt alone. Uses the manual "latest state"
// query, NOT providers.publicDataProvider.queryContractState() without an offset — that path
// hits the offset:null bug on hosted indexers (indexer SKILL.md §2). Also polls, since indexer
// lag after a deploy is typically 2-10s, never immediate (indexer SKILL.md §11).
console.log('Verifying by reading ledger state back (polling for indexer catch-up)...');
const state = await pollForContractState(chain.indexerHttp, contractAddress);
if (!state) {
  throw new Error('Contract not found on the indexer after 60s — indexer lag or deploy failure');
}
const ledgerState = ledger(state.data);
console.log('Read back OK. burnedTotal =', ledgerState.burnedTotal, '(expect 0n for a fresh deploy)');
if (ledgerState.burnedTotal !== 0n) {
  throw new Error('Unexpected non-zero burnedTotal on fresh deploy — something is wrong');
}

console.log('\nDeploy verified. Set MN_CONTRACT_ADDRESS=' + contractAddress + ' in your .env, or read it from deployments/' + chain.network + '.json.');
process.exit(0);
