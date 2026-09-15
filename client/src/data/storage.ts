// StoragePort over sessionStorage, localStorage and IndexedDB, namespaced per data source and
// network so sample data never mixes with live data. Everything is bigint-safe.
//
// Where things may live (docs/prompts/CLIENT-ALL-PAGES-PROMPT.md §9):
//   session — trade state (including the per-RFQ secret key, wiped at a terminal state) and reveals
//   local   — preferences and the relay list only
//   idb     — encrypted dealer keys and trade history, and public caches (derived events)

import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { parse, stringify } from '../lib/bigint-json';
import type { AsyncStore, StoragePort, SyncStore } from './ports';

function webStore(backing: () => Storage | undefined, prefix: string): SyncStore {
  const safe = () => {
    try {
      return backing();
    } catch {
      return undefined;
    }
  };
  return {
    get<T>(key: string) {
      try {
        const raw = safe()?.getItem(prefix + key);
        return raw == null ? undefined : parse<T>(raw);
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        safe()?.setItem(prefix + key, stringify(value));
      } catch (err) {
        // Quota or blocked storage. Trade state depends on this, so say so instead of hiding it.
        console.warn(`[storage] could not write ${prefix + key}: ${(err as Error).message}`);
      }
    },
    remove(key) {
      try {
        safe()?.removeItem(prefix + key);
      } catch {
        // ignore
      }
    },
    keys(p = '') {
      const s = safe();
      if (!s) return [];
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(prefix + p)) out.push(k.slice(prefix.length));
      }
      return out;
    },
  };
}

let idbStore: UseStore | undefined;

function idb(prefix: string): AsyncStore {
  // jsdom and some private windows have no IndexedDB: fall back to memory for the session.
  const memory = new Map<string, unknown>();
  const available = () => typeof indexedDB !== 'undefined';
  const store = () => (idbStore ??= createStore('pyron', 'kv'));
  return {
    async get<T>(key: string) {
      if (!available()) return memory.get(prefix + key) as T | undefined;
      return (await get(prefix + key, store())) as T | undefined;
    },
    async set(key, value) {
      if (!available()) {
        memory.set(prefix + key, value);
        return;
      }
      await set(prefix + key, value, store());
    },
    async remove(key) {
      if (!available()) {
        memory.delete(prefix + key);
        return;
      }
      await del(prefix + key, store());
    },
    async keys(p = '') {
      const all = available() ? ((await keys(store())) as IDBValidKey[]).map(String) : [...memory.keys()];
      return all.filter((k) => k.startsWith(prefix + p)).map((k) => k.slice(prefix.length));
    },
  };
}

export function createStorage(namespace: string): StoragePort {
  const prefix = `pyron:${namespace}:`;
  return {
    session: webStore(() => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage), prefix),
    local: webStore(() => (typeof localStorage === 'undefined' ? undefined : localStorage), prefix),
    idb: idb(prefix),
  };
}
