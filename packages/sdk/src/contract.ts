// Pre-compile the contract once at module load — not on every deploy/call (midnight-js SKILL.md §3).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from '../../../contracts/managed/otc-protocol/contract/index.js';
import { otcWitnesses } from './witnesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(__dirname, '../../../contracts/managed/otc-protocol');

// withWitnesses, NOT withVacantWitnesses — OTCProtocol has real witnesses (dealerSecretKey,
// takerAddress, computeSlashShares, getChallengeReduction). withVacantWitnesses is only for
// contracts that declare none; the midnight-js skill's example (which uses withVacantWitnesses)
// is for the witness-free counter tutorial contract, not applicable here.
export const compiledOTCContract = CompiledContract.make('OTCProtocol', Contract).pipe(
  CompiledContract.withWitnesses(otcWitnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export const otcContractInstance = new Contract(otcWitnesses);
