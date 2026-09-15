// Relay and wallet adapters that exist in the port shape but report themselves unavailable. They
// are replaced by the real live and fixture adapters (client plan step 5); until then every action
// fails loudly instead of pretending to work.

import type { DataSource } from '../config/env';
import type { RelayPort, WalletPort } from './ports';

const notReady = (what: string) => new Error(`${what} is not available in this build yet`);

export function pendingRelays(): RelayPort {
  return {
    connect: async () => [],
    status: () => [],
    onStatus: () => () => undefined,
    health: async () => ({ ok: false, checkedAt: Date.now(), error: 'relay layer not available' }),
    publishRfq: () => {
      throw notReady('Publishing an RFQ');
    },
    collect: async () => {
      throw notReady('Collecting quotes');
    },
    fetchMailbox: async () => {
      throw notReady('Fetching reveals');
    },
    incomingRfqs: () => [],
    close: async () => undefined,
  };
}

export function pendingWallet(kind: DataSource): WalletPort {
  const fail = async (): Promise<never> => {
    throw notReady('The wallet');
  };
  return {
    kind,
    discover: () => [],
    connect: fail,
    disconnect: () => undefined,
    connected: () => false,
    config: fail,
    address: fail,
    balances: fail,
    dust: fail,
    balanceSealed: fail,
    balanceUnsealed: fail,
    submit: fail,
    history: fail,
    status: async () => ({ connected: false }),
    provingProvider: fail,
  };
}
