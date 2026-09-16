import type { DataPorts } from '../ports';
import type { NetworkConfig } from '../../config/networks';
import { wallClock } from '../../design/clock';
import { createStorage } from '../storage';
import { createLiveChain } from './chain';
import { createLiveCircuits } from './circuits';
import { createLiveRelays } from './relays';
import { createLiveWallet } from './wallet';

export function createLivePorts(network: NetworkConfig): DataPorts {
  const storage = createStorage(`live:${network.id}`);
  const chain = createLiveChain({
    networkId: network.id,
    indexerHttp: network.indexerHttp,
    indexerWs: network.indexerWs,
    contractAddress: network.contractAddress,
    deployHeight: network.deployHeight,
    store: storage.idb,
  });
  const wallet = createLiveWallet();
  return {
    source: 'live',
    network,
    clock: wallClock,
    chain,
    relays: createLiveRelays({ chain, session: storage.session }),
    wallet,
    circuits: createLiveCircuits({ wallet, chain, contractAddress: network.contractAddress }),
    storage,
    capabilities: {
      settleInBrowser: 'unverified',
      circuitsInBrowser: true,
      inputSpentLookup: true,
    },
  };
}
