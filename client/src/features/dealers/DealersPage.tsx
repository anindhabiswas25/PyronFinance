import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button, ButtonLink, Card, DataTable, EmptyState, ErrorState, LoadingRegion, Skeleton, Tabs, TabPanel, type Column } from '../../design/primitives';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useEventFeed, useSnapshot } from '../../data/hooks';
import { dealerRows, inTab, matchesKey, sortDealers, type DealerRow, type DealerSort, type DealerTab } from '../../data/selectors';
import { formatAgo } from '../../lib/time';
import { formatCount } from '../../lib/format';
import { DealerStatusChip, FailuresUnknown, fmtBase } from '../shared/protocol';

const TABS: DealerTab[] = ['all', 'active', 'withdrawing', 'slashed'];
const TAB_LABEL: Record<DealerTab, string> = { all: 'All', active: 'Active', withdrawing: 'Withdrawing', slashed: 'Slashed' };
const SORTS: Array<{ value: DealerSort; label: string }> = [
  { value: 'bond', label: 'Bond' },
  { value: 'settled', label: 'Settled' },
  { value: 'slashed', label: 'Slashed' },
  { value: 'failures', label: 'Failures' },
  { value: 'lastQuote', label: 'Last quote' },
];

export default function DealersPage() {
  const { network } = useData();
  const feed = useEventFeed();
  const snap = useSnapshot(feed.events.length);
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as DealerTab) : 'all';
  const sort = SORTS.some((s) => s.value === params.get('sort')) ? (params.get('sort') as DealerSort) : 'bond';
  const query = params.get('q') ?? '';
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';

  const update = (key: string, value: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const all = useMemo(() => (snap.snapshot ? dealerRows(snap.snapshot.view, feed.events) : []), [snap.snapshot, feed.events]);
  const searched = all.filter((r) => matchesKey(r, query));
  const counts = Object.fromEntries(TABS.map((t) => [t, searched.filter((r) => inTab(r, t)).length])) as Record<DealerTab, number>;
  const rows = sortDealers(
    searched.filter((r) => inTab(r, tab)),
    sort,
  );

  const columns: Column<DealerRow>[] = [
    {
      key: 'dealer',
      header: 'Dealer',
      cell: (r) => (
        <Link to={`/dealers/${r.dealerCmt}`} className="font-mono text-12.5 text-tx hover:text-seal" title={r.dealerCmt}>
          {r.dealerCmt.slice(0, 4)}…{r.dealerCmt.slice(-2)}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <DealerStatusChip status={r.status} /> },
    { key: 'bond', header: `Bond (${symbol})`, label: 'Bond', align: 'right', cell: (r) => <span className="font-semibold">{fmtBase(r.bond)}</span> },
    {
      key: 'largest',
      header: 'Largest quote (×20)',
      label: 'Largest quote',
      align: 'right',
      cell: (r) => (r.largestQuote === undefined ? <span className="text-mu" title="Only an active bond can back a quote">—</span> : <span className="text-mu">{fmtBase(r.largestQuote)}</span>),
    },
    {
      key: 'settled',
      header: 'Settled',
      align: 'right',
      cell: (r) => (r.settled === 0n ? <span className="text-mu">No record</span> : formatCount(r.settled)),
    },
    { key: 'slashed', header: 'Slashed', align: 'right', cell: (r) => <span className={r.slashed > 0n ? 'text-bad font-semibold' : 'text-mu'}>{formatCount(r.slashed)}</span> },
    { key: 'failures', header: 'Failures', align: 'right', cell: () => <FailuresUnknown /> },
    { key: 'last', header: 'Last quote', cell: (r) => <span className="text-mu whitespace-nowrap">{r.lastQuoteAt ? formatAgo(r.lastQuoteAt, now) : '—'}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display font-bold text-30">Dealers</h1>
          <p className="text-mu">Everyone who has posted a bond. Nobody approved them, so read the record.</p>
        </div>
        <ButtonLink to="/deal" size="sm">
          Become a dealer
        </ButtonLink>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <label className="flex items-center gap-2 h-control-sm px-3 border border-line rounded-btn-sm bg-s1 lg:w-[320px] focus-within:border-mu">
          <Search size={15} strokeWidth={1.7} className="text-mu shrink-0" aria-hidden="true" />
          <span className="sr-only">Search by dealer key prefix</span>
          <input
            value={query}
            onChange={(e) => update('q', e.target.value.trim() || undefined)}
            placeholder="Search by dealer key"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none font-mono text-12.5 placeholder:font-sans placeholder:text-13.5 placeholder:text-mu"
          />
        </label>
        <label className="flex items-center gap-2 text-13.5 text-mu">
          Sort by
          <select
            value={sort}
            onChange={(e) => update('sort', e.target.value === 'bond' ? undefined : e.target.value)}
            className="h-control-sm px-2.5 rounded-btn-sm border border-line bg-s1 text-tx text-13.5"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Tabs
        idPrefix="dealers"
        label="Dealer status"
        value={tab}
        onChange={(t) => update('tab', t === 'all' ? undefined : t)}
        tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], count: snap.snapshot ? counts[t] : undefined }))}
      />

      <TabPanel idPrefix="dealers" id={tab}>
        <Card padded={false} className="overflow-hidden">
          {snap.status === 'error' ? (
            <ErrorState title="Can’t read dealer bonds from the chain" actions={<Button onClick={snap.retry}>Try again</Button>}>
              {snap.error}. This is an outage, not an empty directory.
            </ErrorState>
          ) : !snap.snapshot ? (
            <LoadingRegion label="Reading dealer bonds from the chain" className="p-5 flex flex-col gap-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={18} />
              ))}
            </LoadingRegion>
          ) : rows.length === 0 ? (
            <EmptyState compact title={query ? 'No dealer key starts with that' : all.length === 0 ? 'No dealer has bonded yet' : 'No dealers in this group'} actions={all.length === 0 ? <ButtonLink to="/deal">Become the first dealer</ButtonLink> : undefined}>
              {query ? 'Check the prefix, or clear the search.' : all.length === 0 ? 'The directory fills as soon as someone posts a bond.' : 'Try another tab.'}
            </EmptyState>
          ) : (
            <DataTable caption={`Dealers, ${TAB_LABEL[tab].toLowerCase()}, sorted by ${SORTS.find((s) => s.value === sort)?.label.toLowerCase()}`} columns={columns} rows={rows} rowKey={(r) => r.dealerCmt} />
          )}
        </Card>
      </TabPanel>
      <p className="text-12.5 text-mu">
        Amounts in {symbol}. A dealer can quote up to 20× their bond, per quote. Settled counts are recorded by the dealer; the bond is the guarantee. Failures show — until published failure evidence has a public home.
      </p>
      {feed.status === 'error' && <p className="text-12.5 text-warn">Event history is unavailable ({feed.error}), so “Last quote” may be missing.</p>}
    </div>
  );
}
