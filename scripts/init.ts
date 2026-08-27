// Post-deploy sanity check: reads deployments/<network>.json, queries the indexer, and asserts
// the ledger is in the expected fresh state. Run after scripts/deploy.ts.
//
// OTCProtocol.compact has no constructor() — every ledger field defaults to its zero value
// (empty Map, zero Counter, zero Uint) automatically, so "fresh state" here means every map is
// empty and burnedTotal is zero, not a set of constructor-assigned values.

import fs from 'node:fs';
import path from 'node:path';
import { loadChainConfig } from '../packages/sdk/src/config.js';
import { initNetworkId } from '../packages/sdk/src/wallet.js';
import { queryLatestContractState } from '../packages/sdk/src/indexer.js';
import { ledger } from '../contracts/managed/otc-protocol/contract/index.js';

const chain = loadChainConfig();
initNetworkId(chain.network);

const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
if (!fs.existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile} — run scripts/deploy.ts first`);
}
const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
console.log('Checking deployment:', deployment);

// Manual query, not providers.publicDataProvider.queryContractState() without an offset —
// that path hits the offset:null bug on hosted indexers (indexer SKILL.md §2).
const state = await queryLatestContractState(chain.indexerHttp, deployment.address);
if (!state) {
  throw new Error(`Contract ${deployment.address} not found on the indexer`);
}

const ledgerState = ledger(state.data);

const checks: Array<[string, boolean]> = [
  ['bonds is empty', ledgerState.bonds.isEmpty()],
  ['settled is empty', ledgerState.settled.isEmpty()],
  ['slashed is empty', ledgerState.slashed.isEmpty()],
  ['quotes is empty', ledgerState.quotes.isEmpty()],
  ['challenges is empty', ledgerState.challenges.isEmpty()],
  ['notes is empty', ledgerState.notes.isEmpty()],
  ['burnedTotal is zero', ledgerState.burnedTotal === 0n],
];

let allPassed = true;
for (const [label, passed] of checks) {
  console.log(passed ? 'PASS' : 'FAIL', '-', label);
  if (!passed) allPassed = false;
}

if (!allPassed) {
  throw new Error('Contract state does not match a fresh deploy — investigate before proceeding');
}
console.log('\nContract is live and in the expected fresh state.');
process.exit(0);
