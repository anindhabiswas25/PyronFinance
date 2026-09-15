import { Suspense } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { Toaster } from '../design/primitives';
import { TopBar } from './TopBar';
import { FixtureBanner } from './FixtureBanner';
import { AppErrorBoundary } from './ErrorBoundary';
import { PageSkeleton } from './PageSkeleton';
import { DataProvider } from '../data/DataProvider';
import { WalletWatcher } from '../data/useWallet';
import { Overlays } from '../overlays/Overlays';
import { TopBarActions } from './TopBarActions';

export function AppShell() {
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
      <FixtureBanner />
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-content mx-auto px-4 md:px-gutter py-6 md:py-8 outline-none">
        <AppErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </AppErrorBoundary>
      </main>
      <Toaster />
      <Overlays />
      <WalletWatcher />
      <ScrollRestoration />
    </div>
    </DataProvider>
  );
}
