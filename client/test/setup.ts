import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useOverlays } from '../src/state/overlays';
import { useWalletStore } from '../src/state/wallet';
import { useTray } from '../src/state/tray';
import { useNotifications } from '../src/state/notifications';
import { useTradeRuntime } from '../src/state/trade-runtime';

afterEach(() => {
  cleanup();
  // Zustand stores are module singletons: reset them so one test's open dialog can't leak into the next.
  useOverlays.setState({ open: undefined, readiness: {} });
  useWalletStore.getState().reset();
  useTray.setState({ entries: [] });
  useNotifications.setState({ entries: [], dismissed: [] });
  useTradeRuntime.setState({ engine: undefined, ports: undefined });
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no scrolling; React Router's ScrollRestoration calls it on every navigation.
if (typeof window !== 'undefined') window.scrollTo = (() => undefined) as typeof window.scrollTo;
