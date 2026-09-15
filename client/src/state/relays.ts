// The user's relay list, per network. One of the two things allowed in localStorage (with preferences).

import { create } from 'zustand';
import type { NetworkId } from '../config/networks';

const KEY = 'pyron:relays';

type Lists = Partial<Record<NetworkId, string[]>>;

function read(): Lists {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Lists = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k as NetworkId] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(lists: Lists) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lists));
  } catch {
    // Not persisted; still used for this session.
  }
}

interface RelayListState {
  lists: Lists;
  add(network: NetworkId, url: string, defaults: string[]): void;
  remove(network: NetworkId, url: string, defaults: string[]): void;
  reset(network: NetworkId): void;
}

export const useRelayList = create<RelayListState>((set, get) => ({
  lists: read(),
  add(network, url, defaults) {
    const current = get().lists[network] ?? defaults;
    const lists = { ...get().lists, [network]: [...current, url] };
    write(lists);
    set({ lists });
  },
  remove(network, url, defaults) {
    const current = get().lists[network] ?? defaults;
    const lists = { ...get().lists, [network]: current.filter((u) => u !== url) };
    write(lists);
    set({ lists });
  },
  reset(network) {
    const lists = { ...get().lists };
    delete lists[network];
    write(lists);
    set({ lists });
  },
}));

export function relaysFor(lists: Lists, network: NetworkId, defaults: string[]): string[] {
  return lists[network] ?? defaults;
}
