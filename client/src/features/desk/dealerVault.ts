// The dealer key and quote journal, encrypted together under one passphrase in IndexedDB (owner
// decision 2026-09-15: encrypted in the browser, backup forced before first use). The unlocked key
// lives in memory only and is dropped on lock or when the tab closes.
//
// The journal is the browser's version of the Dealer Node's crash journal: a quote's nonce, terms and
// Offer File are written BEFORE commitQuote is submitted, so a reload between commit and reveal never
// leaves the dealer bound to a seal it can no longer open.

import { create } from 'zustand';
import type { DataPorts } from '../../data/ports';
import { createVault, type UnlockedVault } from '../../lib/crypto-store';
import { bytesToHex } from '../../lib/hex';
import { deriveDealerIdentity, type DealerIdentity } from './identity';

export interface DealerKeyRecord {
  /** 64 hex: the Dealer Node's key file format. */
  secret: string;
  source: 'generated' | 'imported';
  createdAt: number;
  /** Set once the user confirms a backup exists. Imported keys already exist elsewhere. */
  backedUpAt?: number;
}

export type JournalState = 'intent' | 'committed' | 'revealed' | 'recorded' | 'abandoned';

export interface DealerJournalEntry {
  quoteId: string;
  rfqId: string;
  terms: { pair: string; side: 'buy' | 'sell'; price: string; size: string };
  nonce: string;
  commitment: string;
  validUntil: number;
  notional: bigint;
  offerFile: string;
  offerExpiresAt: number;
  takerEncPk: string;
  dealerEndpoint: string;
  state: JournalState;
  txHash?: string;
  error?: string;
  updatedAt: number;
}

interface DealerVaultValue {
  key: DealerKeyRecord;
  journal: DealerJournalEntry[];
}

export const DEALER_VAULT_KEY = 'dealer-vault';

type Ports = Pick<DataPorts, 'storage' | 'network' | 'clock'>;

interface DealerState {
  status: 'checking' | 'none' | 'locked' | 'unlocked';
  networkId?: string;
  identity?: DealerIdentity;
  key?: DealerKeyRecord;
  journal: DealerJournalEntry[];
  bind(ports: Ports): Promise<void>;
  generate(ports: Ports, passphrase: string): Promise<void>;
  importKey(ports: Ports, secret: Uint8Array, passphrase: string): Promise<void>;
  unlock(ports: Ports, passphrase: string): Promise<void>;
  lock(): void;
  markBackedUp(ports: Ports): Promise<void>;
  putJournal(entry: DealerJournalEntry): Promise<void>;
  destroy(ports: Ports): Promise<void>;
}

let open: { networkId: string; vault: UnlockedVault<DealerVaultValue> } | undefined;

const vaultFor = (ports: Ports) => createVault<DealerVaultValue>(ports.storage.idb, DEALER_VAULT_KEY);
const nowSecs = (ports: Ports) => Math.floor(ports.clock.nowMs() / 1000);

export const useDealer = create<DealerState>((set, get) => {
  async function opened(ports: Ports, vault: UnlockedVault<DealerVaultValue>) {
    const value = vault.read();
    const identity = await deriveDealerIdentity(Uint8Array.from(value.key.secret.match(/../g)!.map((b) => parseInt(b, 16))));
    open = { networkId: ports.network.id, vault };
    set({ status: 'unlocked', networkId: ports.network.id, identity, key: value.key, journal: value.journal });
  }

  async function create(ports: Ports, passphrase: string, key: DealerKeyRecord) {
    const vault = await vaultFor(ports).create(passphrase, { key, journal: [] });
    await opened(ports, vault);
  }

  return {
    status: 'checking',
    journal: [],

    async bind(ports) {
      if (open && open.networkId === ports.network.id) return;
      open = undefined;
      set({ status: 'checking', networkId: ports.network.id, identity: undefined, key: undefined, journal: [] });
      set({ status: (await vaultFor(ports).exists()) ? 'locked' : 'none' });
    },

    async generate(ports, passphrase) {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      await create(ports, passphrase, { secret: bytesToHex(secret), source: 'generated', createdAt: nowSecs(ports) });
    },

    async importKey(ports, secret, passphrase) {
      await create(ports, passphrase, { secret: bytesToHex(secret), source: 'imported', createdAt: nowSecs(ports), backedUpAt: nowSecs(ports) });
    },

    async unlock(ports, passphrase) {
      await opened(ports, await vaultFor(ports).unlock(passphrase));
    },

    lock() {
      open = undefined;
      set({ status: 'locked', identity: undefined, key: undefined, journal: [] });
    },

    async markBackedUp(ports) {
      if (!open) throw new Error('Unlock the dealer key first.');
      const value = open.vault.read();
      const key = { ...value.key, backedUpAt: nowSecs(ports) };
      await open.vault.write({ ...value, key });
      set({ key });
    },

    async putJournal(entry) {
      if (!open) throw new Error('Unlock the dealer key first: the quote journal is encrypted with it.');
      const value = open.vault.read();
      const journal = [...value.journal.filter((e) => e.quoteId !== entry.quoteId), entry].sort((a, b) => b.updatedAt - a.updatedAt);
      await open.vault.write({ ...value, journal });
      if (get().status === 'unlocked') set({ journal });
    },

    async destroy(ports) {
      await vaultFor(ports).destroy();
      open = undefined;
      set({ status: 'none', identity: undefined, key: undefined, journal: [] });
    },
  };
});

export function resetDealerForTests(): void {
  open = undefined;
  useDealer.setState({ status: 'checking', networkId: undefined, identity: undefined, key: undefined, journal: [] });
}
