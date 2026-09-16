import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock } from 'lucide-react';
import { Button, Hash, Tabs, TabPanel } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useEventFeed, useSnapshot } from '../../data/hooks';
import { useNow } from '../../design/clock';
import { useWalletStore } from '../../state/wallet';
import { isHex32, normalizeHex } from '../../lib/hex';
import { useDealer } from './dealerVault';
import type { Actor } from './rules';
import { OverviewTab } from './OverviewTab';
import { QuotesTab } from './QuotesTab';
import { BondTab } from './BondTab';
import { ManualQuoteTab } from './ManualQuoteTab';
import { KeysTab } from './KeysTab';

export type DeskTab = 'overview' | 'quotes' | 'bond' | 'rfq' | 'keys';

const TABS: Array<{ id: DeskTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'bond', label: 'Bond' },
  { id: 'rfq', label: 'Manual quote' },
  { id: 'keys', label: 'Keys' },
];

export interface DeskView {
  /** The dealer shown: your unlocked key, or any key opened read-only. */
  dealerCmt?: string;
  /** True when dealerCmt is your own unlocked key. */
  own: boolean;
  snap: ReturnType<typeof useSnapshot>;
  feed: ReturnType<typeof useEventFeed>;
  now: number;
  actor: Actor;
  go(tab: DeskTab): void;
}

export default function DeskPage() {
  const ports = useData();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: DeskTab = TABS.some((t) => t.id === raw) ? (raw as DeskTab) : 'overview';
  const dealer = useDealer();
  const walletStatus = useWalletStore((s) => s.status);
  const feed = useEventFeed();
  const snap = useSnapshot(feed.events.length, 15_000);
  const now = useNow(1000);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void useDealer.getState().bind(ports);
  }, [ports]);

  const viewed = normalizeHex(params.get('dealer') ?? '');
  const own = Boolean(dealer.identity);
  const dealerCmt = dealer.identity?.dealerCmt ?? (isHex32(viewed) ? viewed : undefined);

  const go = (t: DeskTab) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const view: DeskView = {
    dealerCmt,
    own,
    snap,
    feed,
    now,
    actor: { hasKey: own, backedUp: Boolean(dealer.key?.backedUpAt), walletConnected: walletStatus === 'connected' && ports.wallet.connected() },
    go,
  };

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 id="page-title" className="font-display font-bold text-30">
            Desk
          </h1>
          <p className="text-mu max-w-[62ch]">
            Your bond, quotes and manual quoting on {ports.network.label}. Most dealers run the <Link to="/deal" className="underline underline-offset-2 hover:text-tx">Dealer Node</Link>; this desk is for quoting by hand and for looking after a bond.
          </p>
        </div>
        {own && dealer.identity ? (
          <div className="flex flex-wrap items-center gap-3 text-13.5">
            <span className="flex items-center gap-1.5">
              <KeyRound size={14} aria-hidden="true" className="text-ok" />
              Your dealer <Hash value={dealer.identity.dealerCmt} label="dealer key" />
            </span>
            <Button size="sm" onClick={() => useDealer.getState().lock()}>
              <Lock size={14} aria-hidden="true" />
              Lock key
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const cmt = normalizeHex(draft.trim());
              if (!isHex32(cmt)) return;
              const next = new URLSearchParams(params);
              next.set('dealer', cmt);
              setParams(next, { replace: true });
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="desk-dealer" className="label">
                View a dealer (read-only)
              </label>
              <input
                id="desk-dealer"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="dealer key, 64 hex"
                spellCheck={false}
                className="h-control-sm w-[300px] max-w-full rounded-btn-sm border border-line bg-bg px-3 font-mono text-12.5 outline-none focus:border-mu"
              />
            </div>
            <Button size="sm" type="submit" disabled={!isHex32(normalizeHex(draft.trim()))}>
              Open
            </Button>
          </form>
        )}
      </div>

      <Tabs idPrefix="desk" label="Desk sections" value={tab} onChange={go} tabs={TABS} />
      <TabPanel idPrefix="desk" id={tab}>
        {tab === 'overview' && <OverviewTab view={view} />}
        {tab === 'quotes' && <QuotesTab view={view} />}
        {tab === 'bond' && <BondTab view={view} />}
        {tab === 'rfq' && <ManualQuoteTab view={view} />}
        {tab === 'keys' && <KeysTab view={view} />}
      </TabPanel>
    </section>
  );
}
