import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Hash, LoadingRegion, Segmented, Skeleton, type Column } from '../../design/primitives';
import { useNow } from '../../design/clock';
import { cx } from '../../design/cx';
import { useData } from '../../data/DataProvider';
import { useEventFeed, useSnapshot } from '../../data/hooks';
import { activityMatches, protocolTotals, type ActivityFilter } from '../../data/selectors';
import type { ProtocolEvent } from '../../data/ports';
import { formatAgo, formatUtc } from '../../lib/time';
import { formatCount } from '../../lib/format';
import { EventChip, describeEvent, fmtBase } from '../shared/protocol';

const PAGE = 50;

const FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'trades', label: 'Trades' },
  { value: 'slashes', label: 'Slashes' },
  { value: 'releases', label: 'Releases' },
  { value: 'bonds', label: 'Bonds' },
];

export default function ActivityPage() {
  const { network } = useData();
  const feed = useEventFeed();
  const snap = useSnapshot(feed.events.length);
  const now = useNow(10_000);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';

  // What the reader is looking at is frozen: events that arrive after the first render wait behind a
  // pill and are merged only when asked, so rows never move under someone who is reading them.
  const [shownCount, setShownCount] = useState<number | undefined>(undefined);
  const initialised = useRef(false);
  useEffect(() => {
    if (!initialised.current && feed.status === 'ready' && feed.live) {
      initialised.current = true;
      setShownCount(feed.events.length);
    }
  }, [feed.status, feed.live, feed.events.length]);
  const visibleEvents = shownCount === undefined ? feed.events : feed.events.slice(0, shownCount);
  const pending = shownCount === undefined ? [] : feed.events.slice(shownCount);
  const pendingMatching = pending.filter((e) => activityMatches(e, filter)).length;

  const rows = useMemo(() => [...visibleEvents].reverse().filter((e) => activityMatches(e, filter)), [visibleEvents, filter]);
  const notes = snap.snapshot?.view.notes;
  const totals = snap.snapshot ? protocolTotals(snap.snapshot.view) : undefined;

  const columns: Column<ProtocolEvent>[] = [
    {
      key: 'when',
      header: 'When',
      cell: (e) => (
        <span className="text-mu whitespace-nowrap" title={formatUtc(e.timestamp)}>
          {formatAgo(e.timestamp, now)}
        </span>
      ),
    },
    { key: 'event', header: 'Event', cell: (e) => <EventChip e={e} now={now} symbol={symbol} /> },
    {
      key: 'dealer',
      header: 'Dealer',
      cell: (e) =>
        'dealerCmt' in e && e.dealerCmt ? (
          <Link to={`/dealers/${e.dealerCmt}`} className="font-mono text-12.5 hover:text-seal">
            {e.dealerCmt.slice(0, 4)}…{e.dealerCmt.slice(-2)}
          </Link>
        ) : (
          <span className="text-mu">—</span>
        ),
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      cell: (e) => {
        const size = describeEvent(e, now, symbol).size;
        return size === undefined ? <span className="text-mu">—</span> : <span className="whitespace-nowrap">{fmtBase(size)} <span className="text-mu">{symbol}</span></span>;
      },
    },
    {
      key: 'details',
      header: 'Details',
      cell: (e) => {
        const p = describeEvent(e, now, symbol);
        const note = e.kind === 'quote-settled' && notes?.has(e.quoteId);
        return (
          <span className={cx('text-13.5', e.kind === 'bond-slashed' ? 'text-tx' : 'text-mu')}>
            {p.detail}
            {note && ' · Disclosure note attached'}
          </span>
        );
      },
    },
    { key: 'tx', header: 'Tx', cell: (e) => <Hash value={e.txHash} label="transaction" /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display font-bold text-30">Activity</h1>
          <p className="text-mu">Read from the chain. No relay is trusted for anything on this page.</p>
        </div>
        <LiveIndicator status={feed.status} live={feed.live} height={feed.height} />
      </div>

      {snap.status === 'error' ? null : (
        <Card padded={false} className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Resolved quotes', value: totals && formatCount(totals.resolvedQuotes) },
            { label: 'Bonds slashed', value: totals && formatCount(totals.bondsSlashed) },
            { label: 'Burned forever', value: totals && `${fmtBase(totals.burned)} ${symbol}` },
            { label: 'Bonded now', value: totals && `${fmtBase(totals.totalBonded, 0)} ${symbol}` },
          ].map((t, i) => (
            <div key={t.label} className={cx('flex flex-col gap-1.5 px-5 py-4', i > 0 && 'md:border-l border-line2', i >= 2 && 'max-md:border-t border-line2')}>
              <span className="label">{t.label}</span>
              {t.value === undefined ? <Skeleton width="55%" height={20} /> : <span className="font-display font-semibold text-22 tabular-nums">{t.value}</span>}
            </div>
          ))}
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="overflow-x-auto">
          <Segmented<ActivityFilter>
            label="Show events"
            options={FILTERS}
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setLimit(PAGE);
            }}
          />
        </div>
        <span
          className="inline-flex items-center gap-2 h-control-sm px-3 border border-line rounded-btn-sm text-13.5 text-mu"
          title="The chain records quote sizes, not pairs. This network has one pair, so every event belongs to it."
        >
          Pair: <b className="font-medium text-tx">{network.pairs.map((p) => p.code).join(', ')}</b>
        </span>
      </div>

      {pendingMatching > 0 && (
        <div className="sticky top-[68px] z-30 flex justify-center">
          <button
            type="button"
            onClick={() => setShownCount(feed.events.length)}
            className="enter inline-flex items-center gap-2 h-control-sm px-4 rounded-full bg-tx text-bg text-13.5 font-medium shadow-lg"
          >
            <ArrowUp size={14} aria-hidden="true" />
            {pendingMatching} new {pendingMatching === 1 ? 'event' : 'events'} · Show
          </button>
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        {feed.status === 'error' ? (
          <ErrorState title="Can’t reach the chain — events paused" actions={<Button onClick={feed.retry}>Try again</Button>}>
            {feed.error}. This is an outage, not an empty history: nothing is listed until the indexer answers.
          </ErrorState>
        ) : feed.status === 'loading' && feed.events.length === 0 ? (
          <LoadingRegion label="Reading protocol events from the chain" className="p-5 flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={18} />
            ))}
          </LoadingRegion>
        ) : rows.length === 0 ? (
          <EmptyState compact title={filter === 'all' ? 'No protocol events yet' : 'No events of this kind yet'}>
            {filter === 'all' ? 'Nothing has happened on this contract since it was deployed.' : 'Try another filter.'}
          </EmptyState>
        ) : (
          <>
            <DataTable caption="Protocol events, newest first" columns={columns} rows={rows.slice(0, limit)} rowKey={(e) => e.id} rowProps={(e) => ({ className: e.kind === 'bond-slashed' ? 'bg-badbg' : undefined })} />
            {rows.length > limit && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line2">
                <span className="text-13.5 text-mu">
                  Showing {formatCount(limit)} of {formatCount(rows.length)}
                </span>
                <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                  Show {formatCount(Math.min(PAGE, rows.length - limit))} more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <p className="text-12.5 text-mu">
        Prices never appear here. The chain only knows that a quote was sealed, how big it was, and how it ended. “Recorded as settled” is the dealer’s own record; the bond is the guarantee.
      </p>
    </div>
  );
}

function LiveIndicator({ status, live, height }: { status: string; live: boolean; height: number }) {
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-2 h-control-sm px-3 border border-line rounded-btn-sm text-13.5 text-bad" role="status">
        <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full bg-bad" />
        Disconnected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 h-control-sm px-3 border border-line rounded-btn-sm text-13.5 text-mu" role="status">
      <span aria-hidden="true" className={cx('w-[7px] h-[7px] rounded-full', live ? 'bg-ok' : 'bg-seal')} />
      <b className="font-medium text-tx">{live ? 'Live' : 'Catching up'}</b>
      {height > 0 && <span className="tabular-nums">· block {formatCount(height)}</span>}
    </span>
  );
}
