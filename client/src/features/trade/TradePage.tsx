import { lazy, Suspense } from 'react';
import { VerifierSkeleton } from '../../app/PageSkeleton';

// The trade screens import the SDK (and its WASM). This wrapper keeps that out of the route chunk, so
// the shell and a skeleton render while the verifier downloads.
const TradeApp = lazy(() => import('./TradeApp'));

export default function TradePage() {
  return (
    <Suspense fallback={<VerifierSkeleton />}>
      <TradeApp />
    </Suspense>
  );
}
