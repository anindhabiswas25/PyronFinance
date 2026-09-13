// Full provider set for Node.js / headless use — midnight-js SKILL.md §7.

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { ChainConfig } from './config.js';
import { requirePrivateStatePassword } from './config.js';
import type { HeadlessWallet } from './wallet.js';
import { zkConfigPath } from './contract.js';
import { testTokenZkConfigPath } from './test-token.js';
import { testShieldedTokenZkConfigPath } from './test-shielded-token.js';
import type { OTCCircuits, OTCPrivateStateId, OTCProviders } from './types.js';
import { OTCPrivateStateId as PRIVATE_STATE_ID } from './types.js';

/** LevelDB directory for private state, relative to cwd. LevelDB takes an exclusive LOCK on it, so
 *  two live processes sharing the default (e.g. a Preview run beside a Preprod run, or a dealer node
 *  beside a script) fail at open. Override with MN_PRIVATE_STATE_DB to run them side by side. */
export function privateStateDbName(): string {
  return process.env.MN_PRIVATE_STATE_DB ?? 'otc-midnight-db';
}

export function buildOTCProviders(chain: ChainConfig, wallet: HeadlessWallet): OTCProviders {
  const zkConfigProvider = new NodeZkConfigProvider<OTCCircuits>(zkConfigPath);
  const privateStatePassword = requirePrivateStatePassword();

  return {
    privateStateProvider: levelPrivateStateProvider<OTCPrivateStateId>({
      midnightDbName: privateStateDbName(),
      privateStateStoreName: 'otc-private-state',
      signingKeyStoreName: 'otc-signing-keys',
      privateStoragePasswordProvider: async () => privateStatePassword,
      accountId: wallet.unshieldedAddress,
    }),
    publicDataProvider: indexerPublicDataProvider(chain.indexerHttp, chain.indexerWs),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(chain.proofServer, zkConfigProvider),
    walletProvider: wallet.walletAndMidnightProvider,
    midnightProvider: wallet.walletAndMidnightProvider,
  } as OTCProviders;
}

export { PRIVATE_STATE_ID as OTC_PRIVATE_STATE_ID };

/** Provider set for the TESTNET-ONLY TestToken contract (contracts/src/TestToken.compact).
 *
 *  Separate from `buildOTCProviders` because the ZK config path and the private-state store must
 *  point at TestToken's own compiled assets — sharing OTCProtocol's `zkConfigProvider` would have
 *  it look for a `mint` circuit under `contracts/managed/otc-protocol/` and fail at proving time
 *  rather than at construction. */
export function buildTestTokenProviders(chain: ChainConfig, wallet: HeadlessWallet) {
  return testnetTokenProviders(chain, wallet, testTokenZkConfigPath, 'test-token');
}

/** Provider set for the TESTNET-ONLY TestShieldedToken contract (M2 task 2.8 measurement). Its own
 *  ZK assets and private-state store, for the same reason as `buildTestTokenProviders`. */
export function buildTestShieldedTokenProviders(chain: ChainConfig, wallet: HeadlessWallet) {
  return testnetTokenProviders(chain, wallet, testShieldedTokenZkConfigPath, 'test-shielded-token');
}

function testnetTokenProviders(chain: ChainConfig, wallet: HeadlessWallet, zkPath: string, storePrefix: string) {
  const zkConfigProvider = new NodeZkConfigProvider<'mint'>(zkPath);
  const privateStatePassword = requirePrivateStatePassword();

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: privateStateDbName(),
      privateStateStoreName: `${storePrefix}-private-state`,
      signingKeyStoreName: `${storePrefix}-signing-keys`,
      privateStoragePasswordProvider: async () => privateStatePassword,
      accountId: wallet.unshieldedAddress,
    }),
    publicDataProvider: indexerPublicDataProvider(chain.indexerHttp, chain.indexerWs),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(chain.proofServer, zkConfigProvider),
    walletProvider: wallet.walletAndMidnightProvider,
    midnightProvider: wallet.walletAndMidnightProvider,
  };
}
