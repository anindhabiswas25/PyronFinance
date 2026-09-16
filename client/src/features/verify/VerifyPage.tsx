import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabPanel, Skeleton } from '../../design/primitives';

// The checks import the SDK and its WASM; the page header renders without them.
const CheckQuote = lazy(() => import('./CheckQuote'));
const OpenNote = lazy(() => import('./OpenNote'));

type TabId = 'check' | 'note';

export default function VerifyPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'note' ? 'note' : 'check';
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-5 max-w-[920px]">
      <div className="flex flex-col gap-2">
        <h1 id="page-title" className="font-display font-bold text-30">
          Verify
        </h1>
        <p className="text-mu max-w-[62ch]">
          Check a dealer’s signed price against the chain, or open a disclosure note addressed to you. Everything runs in this browser: nothing you paste or load leaves it.
        </p>
      </div>
      <Tabs
        idPrefix="verify"
        label="What to verify"
        value={tab}
        onChange={(t) => setParams(t === 'check' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { id: 'check', label: 'Check a quote' },
          { id: 'note', label: 'Open a note' },
        ]}
      />
      <TabPanel idPrefix="verify" id={tab}>
        <Suspense
          fallback={
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the verifier">
              <Skeleton height={120} />
              <Skeleton height={20} width="40%" />
            </div>
          }
        >
          {tab === 'check' ? <CheckQuote /> : <OpenNote />}
        </Suspense>
      </TabPanel>
    </section>
  );
}
