// WalletPort over the Midnight DApp Connector API (@midnight-ntwrk/dapp-connector-api 4.0.1, typed
// from the installed api.d.ts). Wallets inject InitialAPI objects under window.midnight, keyed by
// arbitrary ids; they are enumerated, never looked up by a hardcoded key.
//
// Wallets do not always resolve with their declared shapes (1AM resolved makeTransfer with something
// other than { tx }), so every result is checked before use, and a wrong shape is a named error.

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { WalletInfo, WalletPort } from '../ports';
import { WalletError, messageOf } from '../../lib/errors';

/** Methods the client uses; passed to hintUsage so a wallet can ask for permissions up front. */
export const WALLET_METHODS = [
  'getConfiguration',
  'getUnshieldedAddress',
  'getShieldedAddresses',
  'getUnshieldedBalances',
  'getDustBalance',
  'balanceSealedTransaction',
  'balanceUnsealedTransaction',
  'submitTransaction',
  'getTxHistory',
  'getConnectionStatus',
  'getProvingProvider',
] as const;

type WindowLike = { midnight?: unknown };

function isInitialApi(v: unknown): v is InitialAPI {
  return Boolean(v) && typeof v === 'object' && typeof (v as InitialAPI).connect === 'function' && typeof (v as InitialAPI).name === 'string';
}

export function injectedWallets(win: WindowLike = globalThis as WindowLike): InitialAPI[] {
  const m = win.midnight;
  if (!m || typeof m !== 'object') return [];
  return Object.values(m as Record<string, unknown>).filter(isInitialApi);
}

export function describeWallet(w: InitialAPI): WalletInfo {
  const version = typeof w.apiVersion === 'string' ? w.apiVersion : 'unknown';
  const supported = version.split('.')[0] === '4';
  return {
    rdns: typeof w.rdns === 'string' && w.rdns ? w.rdns : w.name,
    name: w.name,
    icon: typeof w.icon === 'string' ? w.icon : '',
    apiVersion: version,
    supported,
    unsupportedReason: supported ? undefined : `Uses DApp Connector API ${version}; this app needs version 4.`,
  };
}

function shapeOf(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (typeof v !== 'object') return `a ${typeof v}`;
  const keys = Object.keys(v);
  return keys.length ? `an object with ${keys.join(', ')}` : 'an empty object';
}

/** The transaction hex from a wallet result declared as { tx: string }. */
export function txOf(result: unknown, method: string): string {
  if (typeof result === 'string' && result) return result;
  const tx = (result as { tx?: unknown } | null | undefined)?.tx;
  if (typeof tx === 'string' && tx) return tx;
  throw new WalletError(`The wallet’s ${method} returned no transaction (it returned ${shapeOf(result)}).`, 'shape');
}

function toBigInt(v: unknown, what: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  throw new WalletError(`The wallet reported ${what} as ${shapeOf(v)}, not an amount.`, 'shape');
}

export function createLiveWallet(win: WindowLike = globalThis as WindowLike): WalletPort {
  let api: ConnectedAPI | undefined;
  const need = (): ConnectedAPI => {
    if (!api) throw new WalletError('Connect a wallet first.', 'disconnected');
    return api;
  };

  return {
    kind: 'live',
    discover: () => injectedWallets(win).map(describeWallet),

    async connect(rdns, networkId) {
      const w = injectedWallets(win).find((x) => describeWallet(x).rdns === rdns);
      if (!w) throw new WalletError('That wallet is no longer on this page. Enable the extension and reload.', 'not-found');
      const info = describeWallet(w);
      if (!info.supported) throw new WalletError(info.unsupportedReason!, 'unsupported');
      let connected: ConnectedAPI;
      try {
        connected = await w.connect(networkId);
      } catch (err) {
        throw new WalletError(`${info.name} did not connect: ${messageOf(err)}`, 'rejected');
      }
      const config = await connected.getConfiguration();
      if (config?.networkId !== networkId) {
        throw new WalletError(`${info.name} is on ${config?.networkId ?? 'an unknown network'}. Switch the wallet to ${networkId}, or switch this app’s network.`, 'network');
      }
      try {
        await connected.hintUsage?.([...WALLET_METHODS]);
      } catch {
        // Optional in practice; a wallet that refuses a hint still asks per call.
      }
      api = connected;
    },

    disconnect() {
      api = undefined;
    },
    connected: () => Boolean(api),

    async config() {
      const c = await need().getConfiguration();
      return { indexerUri: c.indexerUri, indexerWsUri: c.indexerWsUri, substrateNodeUri: c.substrateNodeUri, networkId: c.networkId };
    },
    async address() {
      const a = await need().getUnshieldedAddress();
      if (typeof a?.unshieldedAddress !== 'string') throw new WalletError(`The wallet returned ${shapeOf(a)} for its address.`, 'shape');
      return a.unshieldedAddress;
    },
    async balances() {
      const b = (await need().getUnshieldedBalances()) ?? {};
      return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, toBigInt(v, `the balance of ${k.slice(0, 8)}…`)]));
    },
    async dust() {
      const d = await need().getDustBalance();
      return { cap: toBigInt(d?.cap, 'DUST cap'), balance: toBigInt(d?.balance, 'DUST balance') };
    },
    async balanceSealed(txHex) {
      return txOf(await need().balanceSealedTransaction(txHex), 'balanceSealedTransaction');
    },
    async balanceUnsealed(txHex) {
      return txOf(await need().balanceUnsealedTransaction(txHex), 'balanceUnsealedTransaction');
    },
    async submit(txHex) {
      await need().submitTransaction(txHex);
    },
    async history(page, size) {
      const h = (await need().getTxHistory(page, size)) ?? [];
      return h.map((e) => ({ txHash: e.txHash, status: e.txStatus?.status ?? 'unknown' }));
    },
    async status() {
      if (!api) return { connected: false };
      try {
        const s = await api.getConnectionStatus();
        return s.status === 'connected' ? { connected: true, networkId: s.networkId } : { connected: false };
      } catch {
        return { connected: false };
      }
    },
    async shieldedKeys() {
      const a = await need().getShieldedAddresses();
      if (typeof a?.shieldedCoinPublicKey !== 'string' || typeof a?.shieldedEncryptionPublicKey !== 'string') {
        throw new WalletError(`The wallet returned ${shapeOf(a)} for its shielded keys.`, 'shape');
      }
      return { coinPublicKey: a.shieldedCoinPublicKey, encryptionPublicKey: a.shieldedEncryptionPublicKey };
    },
    async provingProvider(keys) {
      return need().getProvingProvider(keys);
    },
  };
}
