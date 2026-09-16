import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Check, Clock, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Banner, Button, Card, Chip, Countdown, Kbd, Segmented } from '../../design/primitives';
import { cx } from '../../design/cx';
import { useNow } from '../../design/clock';
import { anyModalOpen } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useRfq } from '../../state/rfq';
import { useOverlays } from '../../state/overlays';
import { useWalletStore } from '../../state/wallet';
import {
  bondPercentTenths,
  bondTone,
  cautionsFor,
  formatPercentTenths,
  formatRate,
  isValidAt,
  pairwiseSentence,
  ratioTenths,
  sortForTable,
  summarize,
  validityPermille,
  vsBest,
  type CompareQuote,
  type CompareSort,
} from '../../lib/compare';
import { counterLabel, takerReceivesCounter } from '../../lib/side';
import { formatBpsAsPercent, formatCount, formatUnits, truncateHash } from '../../lib/format';
import { formatClock } from '../../lib/time';
import { splitSlash } from '../../lib/slash';
import { isTypingTarget } from '../../overlays/Overlays';
import { fmtBase } from '../shared/protocol';
import { StripPlot } from './StripPlot';
import { useCompareQuotes } from './useCompare';
import type { TradeEngine } from './engine';

function OfferChip({ q }: { q: CompareQuote }) {
  if (!q.offer) return <span className="text-mu">—</span>;
  const coins = `${q.offer.inputs} coin${q.offer.inputs === 1 ? '' : 's'}`;
  return q.offer.fits ? (
    <Chip tone="ok" icon={<Check size={11} aria-hidden="true" />} title="The dealer’s half passes the network’s validation limit on its own. Your wallet’s side is checked when you settle.">
      {coins} · fits
    </Chip>
  ) : (
    <Chip tone="bad" title={q.offer.reason}>
      {q.offer.inputs > 0 ? `${coins} · too heavy` : 'couldn’t check'}
    </Chip>
  );
}

export function CompareScreen({ engine }: { engine: TradeEngine }) {
  const { network, capabilities } = useData();
  const state = useRfq((s) => s.state);
  const dispatch = useRfq((s) => s.dispatch);
  const showFor = useOverlays((s) => s.showFor);
  const show = useOverlays((s) => s.show);
  const walletReady = useWalletStore((s) => s.status === 'connected');
  const now = useNow(1000);
  const rfq = state.rfq!;
  const pair = network.pairs.find((p) => p.code === rfq.pair) ?? network.pairs[0];
  const side = rfq.side;
  const quotes = useCompareQuotes(state, now);
  const [sort, setSort] = useState<CompareSort>('amount');
  const summary = summarize(quotes, side, now, state.order.length);
  const mismatches = quotes.filter((q) => q.state === 'seal-mismatch');

  // Never reorder under the pointer or while a row is selected: the order is frozen, and new rows
  // wait behind a "Re-sort" pill.
  const [hovering, setHovering] = useState(false);
  const sorted = sortForTable(quotes, sort, side, now);
  const [frozen, setFrozen] = useState<string[]>(() => sorted.map((q) => q.quoteId));
  const freeze = hovering || Boolean(state.selected);
  const liveOrder = sorted.map((q) => q.quoteId);
  useEffect(() => {
    if (!freeze) setFrozen(liveOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze, liveOrder.join(',')]);
  const byId = new Map(quotes.map((q) => [q.quoteId, q]));
  // New quotes append below the frozen rows, so nothing already on screen moves.
  const appended = liveOrder.filter((id) => !frozen.includes(id));
  const rows = [...frozen, ...appended].map((id) => byId.get(id)).filter((q): q is CompareQuote => Boolean(q));
  const newRows = appended.length;
  const reordered = !newRows && liveOrder.join(',') !== frozen.join(',');

  const selected = state.selected ? byId.get(state.selected) : undefined;
  const best = summary.best;
  const other = state.pinned ? byId.get(state.pinned) : best && selected && best.quoteId !== selected.quoteId ? best : undefined;
  const valid = rows.filter((q) => isValidAt(q, now));

  const amt = (v: bigint) => formatUnits(v, pair.counter.decimals, { minFraction: 2 });
  const base = (v: bigint) => formatUnits(v, pair.base.decimals, { minFraction: 2 });

  const select = (q: CompareQuote) => {
    if (isValidAt(q, now)) dispatch({ type: 'select', quoteId: q.quoteId });
  };
  const onRowClick = (e: MouseEvent, q: CompareQuote) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    if (e.shiftKey) dispatch({ type: 'pin', quoteId: q.quoteId });
    else select(q);
  };

  // Settling needs a wallet: without one, connect first rather than fail inside the wallet stage.
  const settle = (quoteId: string) => {
    if (walletReady) void engine.settle(quoteId);
    else show('connect');
  };

  // Keyboard: 1–9 select the n-th valid row, Enter settles the selection.
  const validIds = valid.map((q) => q.quoteId).join(',');
  const settleRef = useRef<() => void>(() => undefined);
  settleRef.current = () => {
    if (selected && isValidAt(selected, now)) settle(selected.quoteId);
  };
  useEffect(() => {
    const ids = validIds ? validIds.split(',') : [];
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const id = ids[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          dispatch({ type: 'select', quoteId: id });
        }
      } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        settleRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [validIds, dispatch]);

  const windowOpen = rfq.expiry > now;
  const countLine = [
    `${summary.opened - summary.mismatches} price${summary.opened - summary.mismatches === 1 ? '' : 's'} opened`,
    `${summary.valid} still valid`,
    summary.mismatches ? `${summary.mismatches} failed ${summary.mismatches === 1 ? 'its' : 'their'} seal` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display font-bold text-26">Compare quotes</h1>
            <Chip icon={<Clock size={12} aria-hidden="true" />}>{windowOpen ? <>Window open · <Countdown until={rfq.expiry} now={now} /></> : 'Window closed'}</Chip>
          </div>
          <p className="text-13.5 text-mu">{countLine}. Prices are visible only on this device.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'view', view: 'sealed' })}>
            Back to seals
          </Button>
          <Segmented<CompareSort>
            label="Sort quotes"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'amount', label: takerReceivesCounter(side) ? 'Most received' : 'Least paid' },
              { value: 'bond', label: 'Largest bond' },
              { value: 'validity', label: 'Longest validity' },
            ]}
          />
        </div>
      </div>

      <Card padded={false} className="grid grid-cols-2 md:grid-cols-5">
        {[
          { label: takerReceivesCounter(side) ? 'Best received' : 'Best price to pay', value: best ? amt(best.amount) : '—', sub: best ? `${pair.counter.symbol} · ${truncateHash(best.dealerCmt)}` : 'no valid quote' },
          { label: 'Median of valid quotes', value: summary.median !== undefined ? amt(summary.median) : '—', sub: pair.counter.symbol },
          { label: 'Spread between quotes', value: summary.spread ? `${formatCount(summary.spread.bps)} bps` : '—', sub: summary.spread ? `${amt(summary.spread.abs)} ${pair.counter.symbol} best to worst` : '' },
          { label: 'First to expire', value: summary.firstToExpire ? formatClock(summary.firstToExpire.validUntil - now) : '—', sub: summary.firstToExpire ? truncateHash(summary.firstToExpire.dealerCmt) : '' },
          { label: 'Checked on-chain', value: `${summary.checkedOnChain} of ${summary.announced}`, sub: summary.mismatches ? `${summary.mismatches} seal mismatch` : 'every price verified' },
        ].map((t, i) => (
          <div key={t.label} className={cx('flex flex-col gap-1 px-4 py-3.5 md:px-5 md:py-4 min-w-0', i > 0 && 'md:border-l border-line2', i >= 2 && 'max-md:border-t border-line2', i === 4 && 'col-span-2 md:col-span-1')}>
            <span className="label">{t.label}</span>
            <span className="font-display font-semibold text-19 md:text-[21px] tabular-nums">{t.value}</span>
            <span className="text-12.5 text-mu truncate">{t.sub}</span>
          </div>
        ))}
      </Card>

      {state.chainError && (
        <Banner tone="bad" title="Can’t reach the chain — new quotes paused" urgent>
          {state.chainError}. The quotes below were verified before the outage.
        </Banner>
      )}

      {mismatches.map((q) => {
        const payout = splitSlash(q.bond).selfProving;
        return (
          <Banner
            key={q.quoteId}
            tone="bad"
            urgent
            icon={<ShieldAlert size={17} aria-hidden="true" />}
            title={`${truncateHash(q.dealerCmt)} sent a price that doesn’t open its seal.`}
            actions={
              <Button size="sm" variant="danger" onClick={() => showFor('fraud-proof', { quoteId: q.quoteId })}>
                Submit proof · receive {fmtBase(payout)} {pair.base.symbol}
              </Button>
            }
          >
            It is excluded from every figure on this page, and you hold the signed proof. Proving it slashes their {fmtBase(q.bond)} {pair.base.symbol} bond: 70 % to you as the wronged taker who proves it, 30 % burned.
          </Banner>
        );
      })}

      <Card className="!pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display font-semibold text-15">Where the quotes land</h2>
          <span className="text-12.5 text-mu">
            {pair.counter.symbol} {takerReceivesCounter(side) ? 'received' : 'paid'} for {base(quotes[0]?.notional ?? 0n)} {pair.base.symbol}
          </span>
        </div>
        <StripPlot
          quotes={quotes}
          bestId={best?.quoteId}
          selectedId={state.selected}
          median={summary.median}
          now={now}
          decimals={pair.counter.decimals}
          symbol={pair.counter.symbol}
          sizeLabel={`${takerReceivesCounter(side) ? 'received' : 'paid'}`}
        />
      </Card>

      {(newRows > 0 || (reordered && freeze)) && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setFrozen(liveOrder)} className="enter inline-flex items-center gap-2 h-control-sm px-4 rounded-full bg-tx text-bg text-13.5 font-medium">
            <ArrowUp size={14} aria-hidden="true" />
            {newRows > 0 ? `${newRows} new quote${newRows === 1 ? '' : 's'} · Re-sort` : 'Order changed · Re-sort'}
          </button>
        </div>
      )}

      <Card padded={false} className="overflow-x-auto" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        {rows.length === 0 ? (
          <p className="p-6 text-13.5 text-mu">No valid price to compare. {mismatches.length ? 'The only reveal failed its seal.' : ''}</p>
        ) : (
          <table className="stacked w-full border-collapse max-lg:block">
            <caption className="sr-only">Revealed quotes. Press 1 to 9 to select a valid quote, Shift-click a row to compare it with your selection, Enter to settle.</caption>
            <thead className="max-lg:sr-only">
              <tr>
                {['', 'Dealer', counterLabel(side), 'vs best', 'Rate', 'Bond · % of trade', 'Settled · slashed · failed', 'Offer check', 'Valid for', ''].map((h, i) => (
                  <th key={i} scope="col" className={cx('label px-2.5 py-[11px] border-b border-line2 font-semibold', [2, 3, 4].includes(i) ? 'text-right' : 'text-left')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-lg:block">
              {rows.map((q) => {
                const isValid = isValidAt(q, now);
                const isBest = best?.quoteId === q.quoteId;
                const isSelected = state.selected === q.quoteId;
                const isPinned = state.pinned === q.quoteId;
                const rank = valid.findIndex((v) => v.quoteId === q.quoteId);
                const vb = best && isValid ? vsBest(q.amount, best.amount, side) : undefined;
                const tenths = bondPercentTenths(q.bond, q.notional);
                const caution = cautionsFor(q, quotes, side, now);
                const permille = validityPermille(q, now);
                return (
                  <tr
                    key={q.quoteId}
                    onClick={(e) => onRowClick(e, q)}
                    aria-selected={isSelected}
                    className={cx(
                      'enter max-lg:block max-lg:border-b max-lg:border-line2 max-lg:py-2 cursor-pointer',
                      isSelected && 'bg-s2 shadow-[inset_0_0_0_1px_var(--line)]',
                      isPinned && 'shadow-[inset_0_0_0_1px_var(--mu)]',
                      !isValid && 'opacity-50',
                    )}
                  >
                    <td className="px-2.5 py-3 border-b border-line2 max-lg:hidden w-11">{rank >= 0 && rank < 9 ? <Kbd>{rank + 1}</Kbd> : null}</td>
                    <td data-label="Dealer" className="px-2.5 py-3 border-b border-line2 max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <div className="flex flex-col items-start gap-1">
                        <Link to={`/dealers/${q.dealerCmt}`} className="font-mono text-13.5 hover:text-seal">
                          {truncateHash(q.dealerCmt)}
                        </Link>
                        <span className="flex flex-wrap gap-1">
                          {caution.slashes ? (
                            <Chip tone="warn" icon={<TriangleAlert size={11} aria-hidden="true" />}>
                              {caution.slashes.toString()} slash{caution.slashes === 1n ? '' : 'es'}
                            </Chip>
                          ) : q.settled === 0n ? (
                            <Chip>No record</Chip>
                          ) : null}
                          {caution.smallBond && <Chip tone="warn">Small bond</Chip>}
                          {isPinned && <Chip>Pinned</Chip>}
                        </span>
                        {caution.bestButWeakest && <span className="text-12.5 text-warn">Best price, but the weakest record here. Check the bond and slashes before choosing.</span>}
                      </div>
                    </td>
                    <td data-label={counterLabel(side)} className="px-2.5 py-3 border-b border-line2 text-right max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <span className="flex flex-col items-end">
                        <span className="font-display font-semibold text-[17px] tabular-nums" style={{ fontStretch: '100%' }}>
                          {amt(q.amount)}
                        </span>
                        <span className="text-12.5 text-mu">{pair.counter.symbol}</span>
                      </span>
                    </td>
                    <td data-label="vs best" className="px-2.5 py-3 border-b border-line2 text-right max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      {!isValid ? (
                        <span className="text-mu">—</span>
                      ) : isBest ? (
                        <Chip tone="ok">Best</Chip>
                      ) : vb ? (
                        <span className="flex flex-col items-end tabular-nums">
                          <span>{vb.diff < 0n ? '−' : '+'}{amt(vb.diff < 0n ? -vb.diff : vb.diff)}</span>
                          <span className="text-12.5 text-mu">{vb.bps < 0n ? '−' : vb.bps > 0n ? '+' : ''}{formatCount(vb.bps < 0n ? -vb.bps : vb.bps)} bps</span>
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Rate" className="px-2.5 py-3 border-b border-line2 text-right font-mono text-12.5 max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      {formatRate(q.price)}
                    </td>
                    <td data-label="Bond · % of trade" className="px-2.5 py-3 border-b border-line2 w-[150px] max-lg:w-auto max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <div className="flex flex-col gap-1.5 min-w-[120px]">
                        <div className="flex justify-between gap-3 text-13.5 tabular-nums">
                          <span>{fmtBase(q.bond, 0)}</span>
                          <span className="text-mu">{tenths !== undefined ? formatPercentTenths(tenths) : '—'}</span>
                        </div>
                        <div className="h-1 rounded-full bg-s2" aria-hidden="true">
                          <div className={cx('h-1 rounded-full', tenths !== undefined && bondTone(tenths) === 'ok' ? 'bg-ok' : tenths !== undefined && bondTone(tenths) === 'warn' ? 'bg-warn' : 'bg-mu')} style={{ width: `${tenths === undefined ? 0 : Math.min(100, Number(tenths) / 10)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td data-label="Settled · slashed · failed" className="px-2.5 py-3 border-b border-line2 tabular-nums whitespace-nowrap max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <span>
                        {formatCount(q.settled)}
                        <span className="text-mu"> · </span>
                        <span className={q.slashed > 0n ? 'text-bad font-semibold' : 'text-mu'}>{formatCount(q.slashed)}</span>
                        <span className="text-mu"> · </span>
                        <span className="text-mu" title="Published failure evidence has no public source yet, so this is unknown — not zero.">
                          —
                        </span>
                      </span>
                    </td>
                    <td data-label="Offer check" className="px-2.5 py-3 border-b border-line2 max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <OfferChip q={q} />
                    </td>
                    <td data-label="Valid for" className="px-2.5 py-3 border-b border-line2 w-[92px] max-lg:w-auto max-lg:flex max-lg:justify-between max-lg:border-0 max-lg:py-1.5">
                      <div className="flex flex-col gap-1.5 min-w-[70px]">
                        <span className={cx('text-13.5 tabular-nums', !isValid && 'text-mu')}>{isValid ? <Countdown until={q.validUntil} now={now} /> : 'Expired'}</span>
                        <div className="h-[3px] rounded-full bg-s2" aria-hidden="true">
                          <div className="h-[3px] rounded-full bg-seal" style={{ width: `${permille / 10}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-3 border-b border-line2 text-right max-lg:flex max-lg:justify-end max-lg:border-0 max-lg:py-1.5">
                      {!isValid ? (
                        <Button size="sm" disabled>
                          Expired
                        </Button>
                      ) : isSelected ? (
                        <Button size="sm" variant="primary" aria-pressed="true" onClick={() => select(q)}>
                          Selected
                        </Button>
                      ) : (
                        <Button size="sm" aria-pressed="false" onClick={() => select(q)}>
                          Select
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
            <h2 className="font-display font-semibold text-15">{state.pinned ? 'Your pick vs the pinned quote' : 'Your pick vs the best price'}</h2>
            <span className="text-12.5 text-mu">Shift-click any row to compare it</span>
          </div>
          {!selected ? (
            <p className="text-13.5 text-mu py-3">Select a quote (press 1–{Math.min(9, valid.length) || 1}) to compare it here.</p>
          ) : !other ? (
            <p className="text-13.5 text-mu py-3">{best?.quoteId === selected.quoteId ? 'Your pick is the best price. Shift-click another row to compare against it.' : 'No other valid quote to compare.'}</p>
          ) : (
            <Pairwise a={selected} b={other} side={side} amt={amt} symbol={pair.counter.symbol} baseSymbol={pair.base.symbol} now={now} labelB={state.pinned ? 'pinned' : 'best'} />
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          {!selected ? (
            <>
              <h2 className="font-display font-semibold text-15">Settle</h2>
              <p className="text-13.5 text-mu">Select a valid quote to settle it.</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-semibold text-15">Settle with {truncateHash(selected.dealerCmt)}</h2>
                <Chip tone={isValidAt(selected, now) ? 'seal' : 'neutral'} icon={<Clock size={11} aria-hidden="true" />}>
                  {isValidAt(selected, now) ? formatClock(selected.validUntil - now) : 'Expired'}
                </Chip>
              </div>
              <dl className="flex flex-col gap-1 rounded-input bg-bg px-3.5 py-3 text-13.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-mu">{takerReceivesCounter(side) ? 'You send' : 'You receive'}</dt>
                  <dd className="tabular-nums">
                    {base(selected.notional)} {pair.base.symbol}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mu">{counterLabel(side)}</dt>
                  <dd className="tabular-nums font-semibold">
                    {amt(selected.amount)} {pair.counter.symbol}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mu">Network fee</dt>
                  <dd>paid in DUST</dd>
                </div>
              </dl>
              <ul className="flex flex-col gap-1.5 text-13.5" aria-label="Checks passed">
                {[
                  'Signed by the key this dealer bonded',
                  'Price opens their on-chain seal',
                  `Seal is for exactly ${base(selected.notional)} ${pair.base.symbol}`,
                  `Offer pays exactly ${amt(selected.amount)} ${pair.counter.symbol}`,
                ].map((c) => (
                  <li key={c} className="flex gap-2.5">
                    <Check size={14} className="text-ok shrink-0 mt-0.5" aria-hidden="true" />
                    {c}
                  </li>
                ))}
              </ul>
              {capabilities.settleInBrowser === 'unverified' && <p className="text-12.5 text-warn">Browser settlement is still being verified on Preprod.</p>}
              <Button variant="primary" wide disabled={!isValidAt(selected, now)} onClick={() => settle(selected.quoteId)}>
                {walletReady ? 'Settle · about 20 s' : 'Connect a wallet to settle'} <Kbd className="border-btntx/25 text-btntx">↵</Kbd>
              </Button>
              {best && best.quoteId !== selected.quoteId && (
                <Button size="sm" variant="ghost" wide onClick={() => dispatch({ type: 'select', quoteId: best.quoteId })}>
                  Take best price instead
                </Button>
              )}
            </>
          )}
        </Card>
      </div>

      <p className="text-12.5 text-mu">
        Offer check runs the network’s validation limit on the dealer’s half alone and counts its coins; your wallet’s side is checked when you settle. Bond % compares the dealer’s bond to your trade size. “Failed” stays — until published failure evidence has a public source.
      </p>
    </div>
  );
}

function Pairwise({ a, b, side, amt, symbol, baseSymbol, now, labelB }: { a: CompareQuote; b: CompareQuote; side: 'buy' | 'sell'; amt(v: bigint): string; symbol: string; baseSymbol: string; now: number; labelB: string }) {
  const vb = vsBest(a.amount, b.amount, side);
  const ratio = ratioTenths(a.bond, b.bond);
  const ta = bondPercentTenths(a.bond, a.notional);
  const tb = bondPercentTenths(b.bond, b.notional);
  const va = Math.max(0, a.validUntil - now);
  const vbSecs = Math.max(0, b.validUntil - now);
  const rowsData: Array<[string, string, string, string, string?]> = [
    [
      counterLabel(side),
      `${amt(a.amount)} ${symbol}`,
      `${amt(b.amount)} ${symbol}`,
      vb.diff === 0n ? 'same' : `${vb.diff < 0n ? '−' : '+'}${amt(vb.diff < 0n ? -vb.diff : vb.diff)} · ${formatBpsAsPercent(vb.bps, { signed: true })}`,
      vb.diff < 0n ? 'text-warn' : vb.diff > 0n ? 'text-ok' : 'text-mu',
    ],
    [
      'Bond',
      `${fmtBase(a.bond, 0)}${ta !== undefined ? ` · ${formatPercentTenths(ta)}` : ''}`,
      `${fmtBase(b.bond, 0)}${tb !== undefined ? ` · ${formatPercentTenths(tb)}` : ''}`,
      ratio === undefined ? '—' : ratio === 10n ? 'same' : ratio > 10n ? `${formatUnits(ratio, 1, { minFraction: 1 })}× larger` : `${formatUnits(ratioTenths(b.bond, a.bond) ?? 0n, 1, { minFraction: 1 })}× smaller`,
      ratio !== undefined && ratio > 10n ? 'text-ok' : 'text-mu',
    ],
    ['Record', `${a.settled} settled · ${a.slashed} slashed`, `${b.settled} settled · ${b.slashed} slashed`, a.slashed === b.slashed ? (a.slashed === 0n ? 'no slashes' : 'same') : a.slashed < b.slashed ? 'fewer slashes' : 'more slashes', a.slashed < b.slashed ? 'text-ok' : a.slashed > b.slashed ? 'text-warn' : 'text-mu'],
    ['Valid for', formatClock(va), formatClock(vbSecs), va === vbSecs ? 'same' : `${formatClock(Math.abs(va - vbSecs))} ${va > vbSecs ? 'more' : 'less'}`, 'text-mu'],
    ['Offer check', a.offer ? `${a.offer.inputs} coin · ${a.offer.fits ? 'fits limit' : 'too heavy'}` : '—', b.offer ? `${b.offer.inputs} coin · ${b.offer.fits ? 'fits limit' : 'too heavy'}` : '—', a.offer?.fits === b.offer?.fits && a.offer?.inputs === b.offer?.inputs ? 'same' : 'differs', 'text-mu'],
  ];
  return (
    <div className="flex flex-col">
      <table className="w-full border-collapse text-13.5">
        <caption className="sr-only">
          Selected quote compared with the {labelB} quote
        </caption>
        <thead>
          <tr className="border-b border-line2">
            <td />
            <th scope="col" className="py-2 text-left font-mono font-normal text-tx">
              {truncateHash(a.dealerCmt)} · selected
            </th>
            <th scope="col" className={cx('py-2 text-left font-mono font-normal', labelB === 'best' ? 'text-ok' : 'text-mu')}>
              {truncateHash(b.dealerCmt)} · {labelB}
            </th>
            <th scope="col" className="label py-2 text-right">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {rowsData.map(([label, va2, vb2, diff, tone]) => (
            <tr key={label} className="border-b border-line2">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal text-mu">
                {label}
              </th>
              <td className="py-2.5 pr-3 tabular-nums font-medium">{va2}</td>
              <td className="py-2.5 pr-3 tabular-nums text-mu">{vb2}</td>
              <td className={cx('py-2.5 text-right tabular-nums', tone)}>{diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-13.5 mt-3">{pairwiseSentence(a, b, side, { amount: amt, symbol, dealer: truncateHash })}</p>
      <span className="sr-only">{baseSymbol}</span>
    </div>
  );
}
