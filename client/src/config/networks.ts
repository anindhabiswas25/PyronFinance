// Per-network configuration. Deliberately free of SDK imports: public pages read this and must not
// pull in @otc/sdk/browser or any WASM. The token types below are cross-checked against the SDK's
// own tables (packages/sdk/src/assets.ts, deployments/*.json) in test/unit/networks.test.ts.

import { readEnv, type ClientEnv } from './env';

export type NetworkId = 'preprod' | 'preview' | 'mainnet';

export interface AssetConfig {
  symbol: string;
  /** 64-hex RawTokenType, or 'native' for tNIGHT/NIGHT (resolved with the SDK's nativeTokenRaw()). */
  tokenType: string;
  decimals: number;
  kind: 'unshielded';
}

export interface PairConfig {
  /** The pair string on the wire and in PAIR_CODES, e.g. "tNIGHT/TESTUSD". */
  code: string;
  base: AssetConfig;
  counter: AssetConfig;
  /** Shown next to the pair wherever it is picked. */
  note?: string;
}

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  /** The id passed to the wallet's connect(). */
  walletNetworkId: string;
  selectable: boolean;
  unavailableReason?: string;
  indexerHttp: string;
  indexerWs: string;
  contractAddress: string;
  pairs: PairConfig[];
  defaultRelays: string[];
}

const TNIGHT: AssetConfig = { symbol: 'tNIGHT', tokenType: 'native', decimals: 6, kind: 'unshielded' };

const LOCAL_RELAYS = ['ws://127.0.0.1:18787/gossip', 'ws://127.0.0.1:18788/gossip'];

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  preprod: {
    id: 'preprod',
    label: 'Preprod',
    walletNetworkId: 'preprod',
    selectable: true,
    indexerHttp: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    contractAddress: 'c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34',
    pairs: [
      {
        code: 'tNIGHT/TESTUSD',
        base: TNIGHT,
        counter: {
          symbol: 'TESTUSD',
          tokenType: '53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc',
          decimals: 6,
          kind: 'unshielded',
        },
        note: 'Test pair. TESTUSD is a Preprod stand-in for USDM, which does not exist on Midnight Preprod.',
      },
    ],
    defaultRelays: LOCAL_RELAYS,
  },
  preview: {
    id: 'preview',
    label: 'Preview',
    walletNetworkId: 'preview',
    selectable: true,
    indexerHttp: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    contractAddress: 'e35b4547d59c7132c021753344d662d445b739af0e78cc39bc771e58fd05d1fa',
    pairs: [
      {
        code: 'tNIGHT/USDM',
        base: TNIGHT,
        counter: { symbol: 'USDM', tokenType: '003bacd9a361ba0d425e408776020e40271375e8b8de42d73eec046a44947d73', decimals: 6, kind: 'unshielded' },
      },
    ],
    defaultRelays: LOCAL_RELAYS,
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    walletNetworkId: 'mainnet',
    selectable: false,
    unavailableReason: 'The protocol contract is deployed on Preprod and Preview only. Mainnet readiness is milestone M4.',
    indexerHttp: '',
    indexerWs: '',
    contractAddress: '',
    pairs: [
      {
        code: 'tNIGHT/USDM',
        base: { ...TNIGHT, symbol: 'NIGHT' },
        counter: { symbol: 'USDM', tokenType: '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b', decimals: 6, kind: 'unshielded' },
      },
    ],
    defaultRelays: [],
  },
};

export function isSelectableNetwork(id: string): id is NetworkId {
  return id in NETWORKS && NETWORKS[id as NetworkId].selectable;
}

export function defaultNetwork(env: ClientEnv = readEnv()): NetworkId {
  return env.network && isSelectableNetwork(env.network) ? env.network : 'preprod';
}

/** The network's config with build-time overrides applied (VITE_RELAYS, VITE_CONTRACT_ADDRESS, …). */
export function networkConfig(id: NetworkId, env: ClientEnv = readEnv()): NetworkConfig {
  const base = NETWORKS[id];
  const overridden = env.network === id || (!env.network && id === 'preprod');
  if (!overridden) return base;
  return {
    ...base,
    contractAddress: env.contractAddress ?? base.contractAddress,
    indexerHttp: env.indexerHttp ?? base.indexerHttp,
    indexerWs: env.indexerWs ?? base.indexerWs,
    defaultRelays: env.relays ?? base.defaultRelays,
  };
}
