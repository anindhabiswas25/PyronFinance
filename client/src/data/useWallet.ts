import { useCallback, useEffect } from 'react';
import { useData } from './DataProvider';
import { rememberWallet, useWalletStore } from '../state/wallet';
import { messageOf } from '../lib/errors';

const sameIndexer = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

export function useWallet() {
  const { wallet, network, chain } = useData();
  const state = useWalletStore();

  const connect = useCallback(
    async (rdns: string) => {
      const info = wallet.discover().find((w) => w.rdns === rdns);
      useWalletStore.getState().set({ status: 'connecting', info, error: undefined });
      try {
        await wallet.connect(rdns, network.walletNetworkId);
        const [config, address] = await Promise.all([wallet.config(), wallet.address()]);
        let indexerNotice: { wallet: string; app: string } | undefined;
        if (config.indexerUri && !sameIndexer(config.indexerUri, network.indexerHttp)) {
          indexerNotice = { wallet: config.indexerUri, app: network.indexerHttp };
          // Prefer the user's own indexer choice while their wallet is connected.
          chain.useIndexer?.(config.indexerUri, config.indexerWsUri || network.indexerWs);
        }
        rememberWallet(rdns);
        useWalletStore.getState().set({ status: 'connected', info, config, address, indexerNotice });
        return true;
      } catch (err) {
        wallet.disconnect();
        useWalletStore.getState().set({ status: 'disconnected', error: messageOf(err) });
        return false;
      }
    },
    [wallet, network, chain],
  );

  const disconnect = useCallback(() => {
    wallet.disconnect();
    if (useWalletStore.getState().indexerNotice) chain.useIndexer?.(network.indexerHttp, network.indexerWs);
    useWalletStore.getState().reset();
  }, [wallet, chain, network]);

  return { ...state, connect, disconnect, port: wallet };
}

/** Mounted once: resets wallet state when the data source or network changes, and polls the
 *  connection every 10 s so a dropped wallet shows as disconnected instead of failing later. */
export function WalletWatcher() {
  const { wallet } = useData();
  useEffect(() => {
    useWalletStore.getState().reset();
  }, [wallet]);
  useEffect(() => {
    const id = setInterval(async () => {
      const s = useWalletStore.getState();
      if (s.status !== 'connected') return;
      const st = await wallet.status();
      if (!st.connected) useWalletStore.getState().set({ status: 'lost', error: 'The wallet disconnected. Reconnect to settle; your request and quotes are kept.' });
    }, 10_000);
    return () => clearInterval(id);
  }, [wallet]);
  return null;
}
