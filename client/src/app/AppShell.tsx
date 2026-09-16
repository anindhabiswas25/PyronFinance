import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cx } from '../design/cx';
import { Toaster } from '../design/primitives';
import { TopBar } from './TopBar';
import { AppErrorBoundary } from './ErrorBoundary';
import { PageSkeleton } from './PageSkeleton';
import { DataProvider } from '../data/DataProvider';
import { WalletWatcher } from '../data/useWallet';
import { Overlays } from '../overlays/Overlays';
import { TopBarActions } from './TopBarActions';
import { TradeRuntime } from './TradeRuntime';

export function AppShell() {
  // The trade screen carries a chart beside the swap card, so it takes the full width with slim gutters.
  const wide = useLocation().pathname.startsWith('/trade');
  return (
    <DataProvider>
    <div className="min-h-screen flex flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-btn-sm focus:bg-tx focus:text-bg focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar right={<TopBarActions />} />
      <main
        id="main"
        tabIndex={-1}
        className={cx('flex-1 w-full mx-auto px-4 py-6 md:py-8 outline-none', wide ? 'max-w-[1920px] md:px-5' : 'max-w-content md:px-gutter')}
      >
        <AppErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </AppErrorBoundary>
      </main>
      <Toaster />
      <Overlays />
      <WalletWatcher />
      <TradeRuntime />
    </div>
    </DataProvider>
  );
}
