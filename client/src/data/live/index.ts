import type { DataPorts } from '../ports';
import type { NetworkConfig } from '../../config/networks';
import { readEnv } from '../../config/env';
import { wallClock } from '../../design/clock';
import { createStorage } from '../storage';
import { pendingRelays, pendingWallet } from '../pending';
import { createLiveChain } from './chain';

export function createLivePorts(network: NetworkConfig): DataPorts {
  const storage = createStorage(`live:${network.id}`);
  return {
    source: 'live',
    network,
    clock: wallClock,
    chain: createLiveChain({
      networkId: network.id,
      indexerHttp: network.indexerHttp,
      indexerWs: network.indexerWs,
      contractAddress: network.contractAddress,
      deployHeight: network.deployHeight,
      store: storage.idb,
    }),
    relays: pendingRelays(),
    wallet: pendingWallet('live'),
    storage,
    capabilities: {
      settleInBrowser: 'unverified',
      circuitsInBrowser: readEnv().enableCircuits,
      inputSpentLookup: false,
    },
  };
}
