import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RouteError } from './ErrorBoundary';
import { NotFound } from './NotFound';

// Every page is its own chunk. Public routes must never pull in @otc/sdk/browser or WASM; /trade,
// /verify and /desk load them lazily inside the page.

const VenuePage = lazy(() => import('../features/venue/VenuePage'));
const ActivityPage = lazy(() => import('../features/activity/ActivityPage'));
const DealersPage = lazy(() => import('../features/dealers/DealersPage'));
const DealerProfilePage = lazy(() => import('../features/dealers/DealerProfilePage'));
const TradePage = lazy(() => import('../features/trade/TradePage'));
const ReceiptPage = lazy(() => import('../features/receipt/ReceiptPage'));
const PortfolioPage = lazy(() => import('../features/portfolio/PortfolioPage'));
const DealPage = lazy(() => import('../features/deal/DealPage'));
const DeskPage = lazy(() => import('../features/desk/DeskPage'));
const VerifyPage = lazy(() => import('../features/verify/VerifyPage'));

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/settle-probe',
        lazy: async () => {
          const { SettleProbe } = await import('../dev/SettleProbe');
          return { Component: SettleProbe };
        },
      },
      {
        path: 'dev/circuits',
        lazy: async () => {
          const { CircuitProbe } = await import('../dev/CircuitProbe');
          return { Component: CircuitProbe };
        },
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <VenuePage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'dealers', element: <DealersPage /> },
      { path: 'dealers/:dealerCmt', element: <DealerProfilePage /> },
      { path: 'trade', element: <TradePage /> },
      { path: 'trade/:quoteId', element: <ReceiptPage /> },
      { path: 'me', element: <PortfolioPage /> },
      { path: 'deal', element: <DealPage /> },
      { path: 'desk', element: <DeskPage /> },
      { path: 'verify', element: <VerifyPage /> },
      ...devRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
