// Trade history on this device (/me). Encrypted at rest under a passphrase (lib/crypto-store.ts) and
// kept per network. A trade that finishes while the history is locked waits in this tab's session
// and is added the next time it is unlocked here.

import { create } from 'zustand';
import type { DataPorts } from './ports';
import { createVault, type UnlockedVault } from '../lib/crypto-store';

export interface TradeHistoryEntry {
  /** The quote that was taken. */
  id: string;
  network: string;
  pair: string;
  takerSide: 'buy' | 'sell';
  size: string;
  dealerCmt: string;
  outcome: 'settled' | 'failed' | 'expired';
  price?: string;
  /** Counter-asset base units received or paid. */
  amount?: bigint;
  baseSymbol: string;
  counterSymbol: string;
  counterDecimals: number;
  txHash?: string;
  blockHeight?: number;
  failure?: { reason: string; detail: string; code?: number };
  /** Unix seconds. */
  at: number;
}

export const HISTORY_KEY = 'trade-history';
export const PENDING_KEY = 'history:pending';

type Ports = Pick<DataPorts, 'storage' | 'network'>;

export type HistoryStatus = 'checking' | 'none' | 'locked' | 'unlocked';

interface HistoryState {
  status: HistoryStatus;
  networkId?: string;
  entries: TradeHistoryEntry[];
  pending: number;
  bind(ports: Ports): Promise<void>;
  create(ports: Ports, passphrase: string): Promise<void>;
  unlock(ports: Ports, passphrase: string): Promise<void>;
  lock(): void;
  add(ports: Ports, entry: TradeHistoryEntry): Promise<void>;
  destroy(ports: Ports): Promise<void>;
}

// The unlocked vault holds the derived key; it lives in memory only, outside the store's state.
let unlocked: { networkId: string; vault: UnlockedVault<TradeHistoryEntry[]> } | undefined;

const vaultFor = (ports: Ports) => createVault<TradeHistoryEntry[]>(ports.storage.idb, HISTORY_KEY);

function merge(entries: TradeHistoryEntry[], more: TradeHistoryEntry[]): TradeHistoryEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of more) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

function takePending(ports: Ports): TradeHistoryEntry[] {
  const pending = ports.storage.session.get<TradeHistoryEntry[]>(PENDING_KEY) ?? [];
  return pending.filter((e) => e.network === ports.network.id);
}

export const useHistory = create<HistoryState>((set, get) => ({
  status: 'checking',
  entries: [],
  pending: 0,

  async bind(ports) {
    const pending = takePending(ports).length;
    if (unlocked && unlocked.networkId === ports.network.id) return set({ status: 'unlocked', networkId: ports.network.id, entries: unlocked.vault.read(), pending });
    unlocked = undefined;
    set({ status: 'checking', networkId: ports.network.id, entries: [], pending });
    const exists = await vaultFor(ports).exists();
    set({ status: exists ? 'locked' : 'none' });
  },

  async create(ports, passphrase) {
    const initial = merge([], takePending(ports));
    const vault = await vaultFor(ports).create(passphrase, initial);
    ports.storage.session.remove(PENDING_KEY);
    unlocked = { networkId: ports.network.id, vault };
    set({ status: 'unlocked', networkId: ports.network.id, entries: initial, pending: 0 });
  },

  async unlock(ports, passphrase) {
    const vault = await vaultFor(ports).unlock(passphrase); // throws WrongPassphraseError, changing nothing
    const pending = takePending(ports);
    if (pending.length) {
      await vault.write(merge(vault.read(), pending));
      ports.storage.session.remove(PENDING_KEY);
    }
    unlocked = { networkId: ports.network.id, vault };
    set({ status: 'unlocked', networkId: ports.network.id, entries: vault.read(), pending: 0 });
  },

  lock() {
    unlocked = undefined;
    set({ status: 'locked', entries: [] });
  },

  async add(ports, entry) {
    if (unlocked && unlocked.networkId === ports.network.id) {
      const next = merge(unlocked.vault.read(), [entry]);
      await unlocked.vault.write(next);
      if (get().networkId === ports.network.id) set({ entries: next });
      return;
    }
    const pending = ports.storage.session.get<TradeHistoryEntry[]>(PENDING_KEY) ?? [];
    ports.storage.session.set(PENDING_KEY, [...pending.filter((e) => e.id !== entry.id), entry]);
    if (get().networkId === ports.network.id) set({ pending: takePending(ports).length });
  },

  async destroy(ports) {
    await vaultFor(ports).destroy();
    ports.storage.session.remove(PENDING_KEY);
    unlocked = undefined;
    set({ status: 'none', entries: [], pending: 0 });
  },
}));

/** Called by the trade engine when a trade reaches an outcome. Never throws into the trade flow. */
export function recordTrade(ports: Ports, entry: TradeHistoryEntry): void {
  useHistory
    .getState()
    .add(ports, entry)
    .catch((err) => console.warn(`[history] could not record ${entry.id}: ${(err as Error).message}`));
}

/** Test helper: forget the unlocked key. */
export function resetHistoryForTests(): void {
  unlocked = undefined;
  useHistory.setState({ status: 'checking', networkId: undefined, entries: [], pending: 0 });
}
