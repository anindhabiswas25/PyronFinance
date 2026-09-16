// The browser call path (prepareOtcCall) run offline: the real compiled contract, real witnesses and
// midnight-js's createUnprovenCallTx, against a constructor-built contract state carrying the
// compiled verifier keys. Proving, balancing and submitting belong to the wallet and are not here.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ContractOperation, createConstructorContext, dummyContractAddress, type ContractState } from '@midnight-ntwrk/compact-runtime';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/ledger-v8';
import { ShieldedCoinPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Contract } from '../../../contracts/managed/otc-protocol/contract/index.js';
import { otcWitnesses } from '../src/witnesses.js';
import { emptyPrivateState } from '../src/private-state.js';
import { schnorrPublicKey } from '../src/schnorr.js';
import { FetchZkConfigProvider, prepareOtcCall, type CallPublicState } from '../src/browser-contract.js';

const root = path.resolve(import.meta.dirname, '../../../contracts/managed/otc-protocol');

function deployedState(): ContractState {
  const init = new Contract(otcWitnesses).initialState(createConstructorContext(emptyPrivateState(), '0'.repeat(64)));
  const state = init.currentContractState;
  for (const file of fs.readdirSync(path.join(root, 'keys')).filter((f) => f.endsWith('.verifier'))) {
    const op = new ContractOperation();
    op.verifierKey = new Uint8Array(fs.readFileSync(path.join(root, 'keys', file)));
    state.setOperation(file.replace(/\.verifier$/, ''), op);
  }
  return state;
}

const zkConfig = new FetchZkConfigProvider('https://app.test/zk', async (url) => new Response(fs.readFileSync(path.join(root, url.replace('https://app.test/zk/', '')))));

const common = {
  networkId: 'preprod',
  indexerHttp: 'https://indexer.invalid/api/v4/graphql',
  contractAddress: dummyContractAddress(),
  zkConfig,
  coinPublicKey: '0'.repeat(64),
  encryptionPublicKey: '0'.repeat(64),
  publicState: async (): Promise<CallPublicState> => [new ZswapChainState(), deployedState(), LedgerParameters.initialParameters()],
};

const dealerSk = new Uint8Array(32).fill(0xd1);

describe('prepareOtcCall', () => {
  it('runs a dealer circuit locally and returns an unproven transaction', async () => {
    const tx = await prepareOtcCall({ ...common, circuit: 'postBond', args: [100n, schnorrPublicKey(7n)], privateState: { dealerSecretKey: dealerSk } });
    expect(tx.serialize().length).toBeGreaterThan(0);
  });

  it('accepts the wallet’s bech32m coin key as well as hex', async () => {
    const cpk = ShieldedCoinPublicKey.codec.encode('preprod' as never, new ShieldedCoinPublicKey(Buffer.alloc(32, 7))).asString();
    const tx = await prepareOtcCall({ ...common, coinPublicKey: cpk, circuit: 'postBond', args: [100n, schnorrPublicKey(7n)], privateState: { dealerSecretKey: dealerSk } });
    expect(tx.serialize().length).toBeGreaterThan(0);
  });

  it('surfaces the contract’s own refusal', async () => {
    await expect(prepareOtcCall({ ...common, circuit: 'releaseExpiredQuote', args: [new Uint8Array(32).fill(9)] })).rejects.toThrow(/Unknown quote/);
  });

  it('fails on the witness when a dealer circuit has no dealer key', async () => {
    await expect(prepareOtcCall({ ...common, circuit: 'topUpBond', args: [5n] })).rejects.toThrow(/dealerSecretKey not set/);
  });
});
