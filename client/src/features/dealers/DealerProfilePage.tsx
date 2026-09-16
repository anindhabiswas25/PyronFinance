import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { Button, ButtonLink, Card, DataTable, EmptyState, ErrorState, Hash, LoadingRegion, Segmented, Skeleton, StatTile, type Column } from '../../design/primitives';
import { Countdown } from '../../design/primitives';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useEventFeed, useSnapshot } from '../../data/hooks';
import { bondHistory, dealerQuotes, dealerRows, type DealerQuote } from '../../data/selectors';
import { isHex32, normalizeHex } from '../../lib/hex';
import { formatDuration, formatUtc } from '../../lib/time';
import { formatCount, truncateHash } from '../../lib/format';
import { DealerStatusChip, FailuresUnknown, OutcomeChip, fmtBase } from '../shared/protocol';
import { BOND_KIND_LABEL, BondChart } from './BondChart';

type QuoteFilter = 'all' | 'settled' | 'released';

export default function DealerProfilePage() {
  const { dealerCmt: raw = '' } = useParams();
  const dealerCmt = normalizeHex(raw);
  const valid = isHex32(dealerCmt);
  const { network } = useData();
  const feed = useEventFeed();
  const snap = useSnapshot(feed.events.length);
  const now = useNow(1000);
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';

  const row = useMemo(() => (snap.snapshot && valid ? dealerRows(snap.snapshot.view, feed.events).find((r) => r.dealerCmt === dealerCmt) : undefined), [snap.snapshot, feed.events, dealerCmt, valid]);
  const history = useMemo(() => bondHistory(feed.events, dealerCmt), [feed.events, dealerCmt]);
  const quotes = useMemo(() => (snap.snapshot ? dealerQuotes(snap.snapshot.view, feed.events, dealerCmt, now) : []), [snap.snapshot, feed.events, dealerCmt, now]);
  const shownQuotes = quotes.filter((q) => filter === 'all' || q.outcome === filter).slice(0, 25);
  const label = valid ? truncateHash(dealerCmt) : raw;

  const back = (
    <Link to="/dealers" className="inline-flex items-center gap-1 text-13.5 text-mu hover:text-tx self-start">
      <ChevronLeft size={15} aria-hidden="true" />
      Dealers
    </Link>
  );

  if (!valid) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <h1 className="font-display font-bold text-26">Dealer</h1>
        <Card>
          <EmptyState title="No dealer with this key has bonded" actions={<ButtonLink to="/dealers">Browse dealers</ButtonLink>}>
            <span className="font-mono text-12.5 break-all">{raw}</span> is not a dealer key. A dealer key is 64 hex characters.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const columns: Column<DealerQuote>[] = [
    { key: 'quote', header: 'Quote', cell: (q) => <Hash value={q.quoteId} label="quote" /> },
    { key: 'size', header: `Size (${symbol})`, label: 'Size', align: 'right', cell: (q) => fmtBase(q.notional) },
    { key: 'valid', header: 'Valid until', cell: (q) => <span className="text-mu whitespace-nowrap">{formatUtc(Number(q.validUntil)).slice(11)}</span> },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (q) =>
        q.outcome === 'live' ? (
          <OutcomeChip
            outcome="live"
            suffix={
              <>
                {' · '}
                <Countdown until={Number(q.validUntil)} now={now} />
              </>
            }
          />
        ) : (
          <OutcomeChip outcome={q.outcome} />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono font-medium text-26">Dealer {label}</h1>
            {row && <DealerStatusChip status={row.status} />}
          </div>
          <Hash value={dealerCmt} label="dealer key" full className="text-mu" />
        </div>
        {row?.bondedAt && (
          <span className="text-13.5 text-mu">
            Bonded since block {formatCount(row.bondedHeight ?? 0)} · {formatDuration(now - row.bondedAt)} ago
          </span>
        )}
      </div>

      {snap.status === 'error' ? (
        <Card>
          <ErrorState title="Can’t read this dealer from the chain" actions={<Button onClick={snap.retry}>Try again</Button>}>
            {snap.error}. Nothing is shown until the indexer answers.
          </ErrorState>
        </Card>
      ) : !snap.snapshot ? (
        <LoadingRegion label="Reading this dealer from the chain" className="flex flex-col gap-4">
          <Skeleton height={92} className="rounded-card" />
          <Skeleton height={260} className="rounded-card" />
        </LoadingRegion>
      ) : !row ? (
        <Card>
          <EmptyState title="No dealer with this key has bonded" actions={<ButtonLink to="/dealers">Browse dealers</ButtonLink>}>
            The chain has no bond and no record for this key on {network.label}. Check the key, or the network.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card padded={false} className="grid grid-cols-2 md:grid-cols-5">
            {[
              { label: 'Bond', value: `${fmtBase(row.bond)} ${symbol}` },
              { label: 'Largest quote', value: row.largestQuote === undefined ? '—' : `${fmtBase(row.largestQuote)} ${symbol}` },
              { label: 'Settled', value: row.settled === 0n ? 'No record' : formatCount(row.settled) },
              { label: 'Slashed', value: formatCount(row.slashed) },
              { label: 'Failures', value: <FailuresUnknown /> },
            ].map((t, i) => (
              <StatTile key={t.label} label={t.label} value={t.value} className={`px-5 py-4 ${i > 0 ? 'md:border-l border-line2' : ''} ${i >= 2 ? 'max-md:border-t border-line2' : ''}`} />
            ))}
          </Card>
          {row.status === 'withdrawing' && row.withdrawableAt !== undefined && (
            <p className="text-13.5 text-warn">
              Withdrawal requested. This dealer no longer quotes; the bond is withdrawable {Number(row.withdrawableAt) > now ? `in ${formatDuration(Number(row.withdrawableAt) - now)}` : 'now'} if no quotes are live.
            </p>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
            <Card className="flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-15">Bond over time</h2>
                <span className="text-12.5 text-mu">{symbol}</span>
              </div>
              {feed.status === 'error' ? (
                <ErrorState compact title="History unavailable" actions={<Button size="sm" onClick={feed.retry}>Try again</Button>}>
                  {feed.error}
                </ErrorState>
              ) : history.length === 0 ? (
                feed.status === 'loading' ? <Skeleton height={200} /> : <p className="text-13.5 text-mu">No bond events found for this key.</p>
              ) : (
                <>
                  <BondChart points={history} now={now} symbol={symbol} dealerLabel={label} />
                  <details className="text-13.5">
                    <summary className="cursor-pointer text-mu hover:text-tx">Show as a table</summary>
                    <table className="w-full mt-2 border-collapse">
                      <caption className="sr-only">Bond changes for dealer {label}</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="label text-left py-1.5">When</th>
                          <th scope="col" className="label text-left py-1.5">Change</th>
                          <th scope="col" className="label text-right py-1.5">Bond after</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((p, i) => (
                          <tr key={i} className="border-t border-line2">
                            <td className="py-1.5 text-mu">{formatUtc(p.t)}</td>
                            <td className="py-1.5">{BOND_KIND_LABEL[p.kind]}</td>
                            <td className="py-1.5 text-right tabular-nums">{fmtBase(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              )}
            </Card>

            <Card padded={false} className="overflow-hidden min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-2">
                <h2 className="font-display font-semibold text-15">Recent quotes</h2>
                <Segmented<QuoteFilter>
                  label="Filter quotes"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'settled', label: 'Settled' },
                    { value: 'released', label: 'Released' },
                  ]}
                />
              </div>
              {shownQuotes.length === 0 ? (
                <EmptyState compact title={quotes.length === 0 ? 'No quotes sealed yet' : 'No quotes with this outcome'} />
              ) : (
                <DataTable caption={`Recent quotes by dealer ${label}`} columns={columns} rows={shownQuotes} rowKey={(q) => q.quoteId} />
              )}
            </Card>
          </div>

          <Card className="flex flex-col sm:flex-row sm:items-center gap-4 !py-4">
            <ShieldCheck size={18} strokeWidth={1.7} className="text-mu shrink-0" aria-hidden="true" />
            <p className="text-13.5 flex-1">
              <b className="font-semibold">Published failure evidence: none available.</b>{' '}
              <span className="text-mu">
                A taker whose settlement failed because this dealer’s offer coins were already spent can save signed evidence. It has no public home yet, so nothing is counted here. A file you were given can be checked on Verify.
              </span>
            </p>
            <ButtonLink to="/verify" size="sm" variant="ghost">
              Check evidence
            </ButtonLink>
          </Card>
          <p className="text-12.5 text-mu">The settled count is recorded by the dealer and not proven on-chain. The bond is the guarantee.</p>
        </>
      )}
    </div>
  );
}
