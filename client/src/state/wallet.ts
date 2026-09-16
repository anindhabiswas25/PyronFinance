import { create } from 'zustand';
import type { WalletConfig, WalletInfo } from '../data/ports';

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'lost';

interface WalletState {
  status: WalletStatus;
  info?: WalletInfo;
  address?: string;
  config?: WalletConfig;
  error?: string;
  /** Set when the wallet's indexer differs from this app's configured one. */
  indexerNotice?: { wallet: string; app: string };
  set(patch: Partial<Omit<WalletState, 'set' | 'reset'>>): void;
  reset(): void;
}

const LAST_KEY = 'pyron:last-wallet';

export const useWalletStore = create<WalletState>((set) => ({
  status: 'disconnected',
  set: (patch) => set(patch),
  reset: () => set({ status: 'disconnected', info: undefined, address: undefined, config: undefined, error: undefined, indexerNotice: undefined }),
}));

/** The last wallet the user connected (a preference; never used to auto-connect). */
export function lastWalletRdns(): string | undefined {
  try {
    return localStorage.getItem(LAST_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberWallet(rdns: string): void {
  try {
    localStorage.setItem(LAST_KEY, rdns);
  } catch {
    // preference only
  }
}
