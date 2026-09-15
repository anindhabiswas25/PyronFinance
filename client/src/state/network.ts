import { create } from 'zustand';
import { defaultNetwork, isSelectableNetwork, type NetworkId } from '../config/networks';

const KEY = 'pyron:network';

function readNetwork(): NetworkId {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && isSelectableNetwork(saved)) return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return defaultNetwork();
}

interface NetworkState {
  network: NetworkId;
  setNetwork(network: NetworkId): void;
}

export const useNetwork = create<NetworkState>((set) => ({
  network: readNetwork(),
  setNetwork(network) {
    if (!isSelectableNetwork(network)) return;
    try {
      localStorage.setItem(KEY, network);
    } catch {
      // Not persisted; still applied for this session.
    }
    set({ network });
  },
}));
