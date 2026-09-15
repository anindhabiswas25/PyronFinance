import { ArrowRight, Check, Clock, Lock, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Banner, Button, ButtonLink, Card, Chip, Countdown, EmptyState, Skeleton } from '../../design/primitives';
import { cx } from '../../design/cx';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useRelays } from '../../data/useRelays';
import { useRfq, type QuoteRecord } from '../../state/rfq';
import { formatClock } from '../../lib/time';
import { formatCount, truncateHash } from '../../lib/format';
import { fmtBase } from '../shared/protocol';
import type { TradeEngine } from './engine';

function Ring({ remaining, total }: { remaining: number; total: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <svg width={88} height={88} viewBox="0 0 88 88" aria-hidden="true" className="shrink-0">
      <circle cx={44} cy={44} r={r} fill="none" style={{ stroke: 'var(--s2)' }} strokeWidth={7} />
      <circle
        cx={44}
        cy={44}
        r={r}
        fill="none"
        style={{ stroke: 'var(--seal)', transition: 'stroke-dashoffset 260ms ease-out' }}
        strokeWidth={7}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 44 44)"
        strokeLinecap="round"
      />
      <text x={44} y={46} textAnchor="middle" className="font-display" style={{ fill: 'var(--tx)', fontWeight: 650, fontSize: 19 }}>
        {formatClock(remaining)}
      </text>
      <text x={44} y={61} textAnchor="middle" style={{ fill: 'var(--mu)', fontSize: 11 }}>
        left
      </text>
    </svg>
  );
}

function StateChip({ q }: { q: QuoteRecord }) {
  if (q.reveal === 'seal-mismatch') return <Chip tone="bad" icon={<ShieldAlert size={12} aria-hidden="true" />}>Seal mismatch</Chip>;
  if (q.reveal === 'offer-mismatch' || q.reveal === 'reveal-invalid') return <Chip tone="bad">Reveal rejected</Chip>;
  if (q.reveal === 'revealed') return <Chip tone="ok" icon={<Check size={12} aria-hidden="true" />}>Price received</Chip>;
  if (q.verification === 'on-chain') return <Chip tone="ok" icon={<Check size={12} aria-hidden="true" />}>On-chain</Chip>;
  if (q.verification === 'rejected') return <Chip tone="bad">Dropped</Chip>;
  if (q.verification === 'unverifiable') return <Chip tone="warn" icon={<TriangleAlert size={12} aria-hidden="true" />}>Couldn’t check</Chip>;
  return <Chip icon={<Clock size={12} aria-hidden="true" />}>Checking chain</Chip>;
}

export function SealedScreen({ engine }: { engine: TradeEngine }) {
  const { network } = useData();
  const state = useRfq((s) => s.state);
  const dispatch = useRfq((s) => s.dispatch);
  const relays = useRelays();
  const now = useNow(1000);
  const rfq = state.rfq;
  if (!rfq) return null;

  const pair = network.pairs.find((p) => p.code === rfq.pair) ?? network.pairs[0];
  const quotes = state.order.map((id) => state.quotes[id]).filter(Boolean);
  const bound = quotes.filter((q) => q.verification === 'on-chain');
  const revealed = quotes.filter((q) => q.reveal === 'revealed');
  const remaining = Math.max(0, rfq.expiry - now);
  const total = rfq.expiry - (state.publishedAt ?? rfq.expiry - 120);
  const closed = remaining === 0;
  const start = state.publishedAt ?? now;

  if (closed && quotes.length === 0) {
    return (
      <Card>
        <EmptyState
          title={`No dealer answered in ${formatClock(total)}`}
          actions={
            <>
              <Button variant="primary" onClick={() => dispatch({ type: 'cancel', at: now })}>
                Ask again
              </Button>
              <ButtonLink to="/deal">Become a dealer</ButtonLink>
            </>
          }
        >
          Early on, an unanswered request is normal: there may be no dealer online for this pair and size. The person seeing this screen is exactly who could quote it.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-5 sm:p-6 border-b border-line2">
          <Ring remaining={remaining} total={total} />
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display font-semibold text-22">
              {bound.length === 0 ? 'Waiting for dealers to seal' : `${bound.length} dealer${bound.length === 1 ? ' is' : 's are'} bound to a price`}
            </h1>
            <p className="text-mu max-w-[520px]">
              Nobody can see those prices yet, including this app. Each one opens for you once its seal is confirmed on-chain. The window doesn’t extend for latecomers.
            </p>
            <span className="sr-only">
              Window: <Countdown until={rfq.expiry} now={now} expiredText="closed" />
            </span>
          </div>
        </div>

        {state.chainError && (
          <div className="px-5 pt-4">
            <Banner tone="bad" title="Can’t reach the chain — quotes paused" urgent>
              {state.chainError}. Quotes are not rejected; they’re checked again as soon as the indexer answers.
            </Banner>
          </div>
        )}

        {quotes.length === 0 ? (
          <p className="px-6 py-8 text-13.5 text-mu" role="status">
            Request sent. Seals usually take 20–45 s to confirm on {network.label}.
          </p>
        ) : (
          <ul aria-label="Dealers answering this request" aria-live="polite">
            {quotes.map((q) => {
              const verified = q.verification === 'on-chain';
              const dropped = q.verification === 'rejected';
              return (
                <li key={q.quoteId} className={cx('enter flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-line2 min-h-[68px]', dropped && 'opacity-60')}>
                  <span aria-hidden="true" className={cx('grid place-items-center w-9 h-9 rounded-btn shrink-0', verified ? 'bg-sealbg text-seal' : 'bg-s2 text-mu')}>
                    <Lock size={17} strokeWidth={1.7} />
                  </span>
                  <div className="flex-1 min-w-[140px]">
                    {q.dealerCmt ? (
                      <Link to={`/dealers/${q.dealerCmt}`} className="font-mono text-13.5 hover:text-seal">
                        dealer {truncateHash(q.dealerCmt)}
                      </Link>
                    ) : (
                      <span className="font-mono text-13.5">quote {truncateHash(q.quoteId)}</span>
                    )}
                    {verified ? (
                      <p className="text-12.5 text-mu tabular-nums">
                        {formatCount(q.settled ?? 0n)} settled · {formatCount(q.slashed ?? 0n)} slashed
                      </p>
                    ) : dropped || q.verification === 'unverifiable' ? (
                      <p className="text-12.5 text-mu">{q.reason}</p>
                    ) : (
                      <Skeleton width={180} className="mt-1.5" />
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 w-[140px]">
                    <span className="label">Bond</span>
                    {verified ? <span className="font-semibold tabular-nums">{fmtBase(q.bond ?? 0n)} {pair?.base.symbol}</span> : <Skeleton width={80} />}
                  </div>
                  <div className="flex justify-end w-[150px]">
                    <StateChip q={q} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-bg">
          <span className="text-13.5 text-mu">
            <b className="text-tx font-semibold">
              {revealed.length} price{revealed.length === 1 ? '' : 's'} opened.
            </b>{' '}
            {closed ? 'The window has closed.' : 'You can compare now or wait for the window to close.'}
          </span>
          <div className="flex gap-2.5">
            <Button size="sm" variant="ghost" onClick={() => engine.cancel()}>
              Cancel request
            </Button>
            <Button size="sm" variant="primary" disabled={revealed.length === 0} onClick={() => dispatch({ type: 'to-compare', at: now })}>
              Compare {revealed.length} now
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-15">Relays</h2>
            <Chip tone={relays.connected >= 2 ? 'ok' : relays.connected === 1 ? 'warn' : 'bad'}>
              {relays.connected} of {relays.urls.length}
            </Chip>
          </div>
          <ul className="flex flex-col gap-2">
            {relays.states.map((r) => (
              <li key={r.url} className="flex items-center justify-between gap-3 text-13.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className={cx('w-[7px] h-[7px] rounded-full shrink-0', r.connected ? 'bg-ok' : 'bg-bad')} />
                  <span className="font-mono text-12.5 truncate">{r.url.replace(/^wss?:\/\//, '')}</span>
                  <span className="sr-only">{r.connected ? 'connected' : 'not connected'}</span>
                </span>
                <span className="text-mu tabular-nums whitespace-nowrap">heard {quotes.filter((q) => q.relays.includes(r.url)).length}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-2.5">
          <h2 className="font-display font-semibold text-15">Log</h2>
          <ol className="flex flex-col gap-2 max-h-[340px] overflow-auto" aria-label="Request log">
            {state.log.map((l, i) => (
              <li key={i} className="flex gap-3 text-12.5">
                <span className="font-mono text-mu w-11 shrink-0">{formatClock(Math.max(0, l.at - start))}</span>
                <span className={cx(l.tone === 'ok' ? 'text-ok' : l.tone === 'bad' ? 'text-bad' : l.tone === 'seal' ? 'text-seal' : 'text-mu')}>{l.text}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
