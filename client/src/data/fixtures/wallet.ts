// The fixture wallet. It exposes the same WalletPort and says plainly that it is part of the sample
// data: its name, its address and every balance are made up, and it never claims to be an extension.

import type { NetworkConfig } from '../../config/networks';
import { NATIVE_TOKEN_RAW, tokenTypeOf } from '../../config/networks';
import type { WalletPort } from '../ports';
import { WalletError } from '../../lib/errors';
import type { ScenarioName } from './scenario';

export const FIXTURE_WALLET_RDNS = 'data.sample.pyron';

export interface FixtureWallet extends WalletPort {
  /** The trade scenario decides what balancing and submitting do. */
  setHandlers(h: { balanceSealed?(txHex: string): Promise<string>; submit?(txHex: string): Promise<void> }): void;
}

export function createFixtureWallet(o: { network: NetworkConfig; scenario: ScenarioName; speed?: number }): FixtureWallet {
  let connected = false;
  let handlers: { balanceSealed?(txHex: string): Promise<string>; submit?(txHex: string): Promise<void> } = {};
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms / Math.max(1, o.speed ?? 1)));
  const need = () => {
    if (!connected) throw new WalletError('Connect a wallet first.', 'disconnected');
  };
  const counter = o.network.pairs[0]?.counter;

  return {
    kind: 'fixture',
    discover: () => [
      { rdns: FIXTURE_WALLET_RDNS, name: 'Sample wallet', icon: '', apiVersion: '4.0.1', supported: true },
    ],
    async connect(rdns, networkId) {
      if (rdns !== FIXTURE_WALLET_RDNS) throw new WalletError('Only the sample wallet is available with sample data.', 'not-found');
      await wait(500);
      if (networkId !== o.network.walletNetworkId) throw new WalletError(`The sample wallet is on ${o.network.walletNetworkId}.`, 'network');
      connected = true;
    },
    disconnect() {
      connected = false;
    },
    connected: () => connected,
    async config() {
      need();
      return { indexerUri: o.network.indexerHttp, indexerWsUri: o.network.indexerWs, substrateNodeUri: '', networkId: o.network.walletNetworkId };
    },
    async address() {
      need();
      return `mn_addr_${o.network.walletNetworkId}1sampledata0notarealaddress0e7wg`;
    },
    async balances() {
      need();
      await wait(200);
      return {
        [NATIVE_TOKEN_RAW]: 104_220_500_000n,
        ...(counter ? { [tokenTypeOf(counter)]: 2_310_000_000n } : {}),
      };
    },
    async dust() {
      need();
      await wait(150);
      return { balance: 15_070_000_000_000_000n, cap: 20_000_000_000_000_000n };
    },
    async balanceSealed(txHex) {
      need();
      if (handlers.balanceSealed) return handlers.balanceSealed(txHex);
      await wait(1200);
      return txHex;
    },
    async balanceUnsealed(txHex) {
      need();
      await wait(1200);
      return txHex;
    },
    async submit(txHex) {
      need();
      if (handlers.submit) return handlers.submit(txHex);
      await wait(2000);
    },
    async history() {
      need();
      return [];
    },
    async status() {
      return connected ? { connected: true, networkId: o.network.walletNetworkId } : { connected: false };
    },
    async provingProvider() {
      throw new WalletError('The sample wallet cannot prove circuits; sample actions are simulated instead.', 'unavailable');
    },
    setHandlers(h) {
      handlers = h;
    },
  };
}
