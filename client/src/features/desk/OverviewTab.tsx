import { useMemo } from 'react';
import { Server } from 'lucide-react';
import { Banner, Button, ButtonLink, Card, EmptyState, ErrorState, LoadingRegion, Skeleton, StatTile } from '../../design/primitives';
import { dealerQuotes, dealerRows } from '../../data/selectors';
import { useData } from '../../data/DataProvider';
import { formatCount } from '../../lib/format';
import { DealerStatusChip, fmtBase } from '../shared/protocol';
import { deskAlerts } from './rules';
import type { DeskView } from './DeskPage';

export function OverviewTab({ view }: { view: DeskView }) {
  const { network } = useData();
  const { dealerCmt, snap, feed, now } = view;
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';

  const data = useMemo(() => {
    if (!snap.snapshot || !dealerCmt) return undefined;
    const v = snap.snapshot.view;
    const row = dealerRows(v, feed.events).find((r) => r.dealerCmt === dealerCmt);
    const quotes = dealerQuotes(v, feed.events, dealerCmt, now);
    const bond = v.bonds.get(dealerCmt);
    return { row, quotes, bond, alerts: deskAlerts(bond, v.slashed.get(dealerCmt) ?? 0n, quotes, now) };
  }, [snap.snapshot, feed.events, dealerCmt, now]);

  if (!dealerCmt) {
    return (
      <Card className="mt-4">
        <EmptyState
          title="Open a dealer"
          actions={
            <>
              <Button variant="primary" onClick={() => view.go('keys')}>
                Set up or unlock your key
              </Button>
              <ButtonLink to="/dealers">Browse dealers</ButtonLink>
            </>
          }
        >
          Unlock your dealer key to act, or enter any dealer key above to see its bond and quotes. Reading needs no key.
        </EmptyState>
      </Card>
    );
  }
  if (snap.status === 'error') {
    return (
      <Card className="mt-4">
        <ErrorState title="Can’t read this dealer from the chain" actions={<Button onClick={snap.retry}>Try again</Button>}>
          {snap.error}
        </ErrorState>
      </Card>
    );
  }
  if (!data) {
    return (
      <LoadingRegion label="Reading the dealer from the chain" className="flex flex-col gap-4 mt-4">
        <Skeleton height={92} className="rounded-card" />
        <Skeleton height={140} className="rounded-card" />
      </LoadingRegion>
    );
  }

  const { row, bond, quotes, alerts } = data;
  const live = quotes.filter((q) => q.outcome === 'live').length;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {row ? <DealerStatusChip status={row.status} /> : null}
        {!view.own && <span className="text-13.5 text-mu">Read-only: unlock this dealer’s key to act.</span>}
      </div>
      <Card padded={false} className="grid grid-cols-2 md:grid-cols-5">
        {[
          { label: 'Bond', value: `${fmtBase(bond?.amount ?? 0n)} ${symbol}` },
          { label: 'Largest quote (×20)', value: bond?.active ? `${fmtBase(bond.amount * 20n)} ${symbol}` : '—' },
          { label: 'Live on-chain', value: formatCount(bond?.liveQuotes ?? 0n), sub: `${live} within validity` },
          { label: 'Settled', value: row && row.settled > 0n ? formatCount(row.settled) : 'No record' },
          { label: 'Slashed', value: formatCount(row?.slashed ?? 0n) },
        ].map((t, i) => (
          <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} className={`px-5 py-4 ${i > 0 ? 'md:border-l border-line2' : ''} ${i >= 2 ? 'max-md:border-t border-line2' : ''}`} />
        ))}
      </Card>

      {alerts.length === 0 ? (
        <Banner tone="ok" title="Nothing needs attention" />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Alerts">
          {alerts.map((a) => (
            <li key={a.title}>
              <Banner tone={a.tone} title={a.title}>
                {a.detail}
              </Banner>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <EmptyState compact icon={<Server size={18} strokeWidth={1.7} />} title="Connect your node">
          Warm offers, coins ready per side and answered RFQs live in your Dealer Node. It has no status endpoint yet (an open decision), so this desk shows only what the chain knows.
        </EmptyState>
      </Card>
    </div>
  );
}
