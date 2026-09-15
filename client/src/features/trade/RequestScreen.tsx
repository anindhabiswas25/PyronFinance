import { useEffect, useMemo, useRef } from 'react';
import { ArrowUpDown, ChevronRight, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Banner, Button, Card, Kbd, Segmented, Skeleton } from '../../design/primitives';
import { cx } from '../../design/cx';
import { useData } from '../../data/DataProvider';
import { useReadiness } from '../../data/useReadiness';
import { useSnapshot } from '../../data/hooks';
import { useRelays } from '../../data/useRelays';
import { useOverlays } from '../../state/overlays';
import { useRfq, type RequestForm } from '../../state/rfq';
import { useWalletStore } from '../../state/wallet';
import { isAmountInput, parseUnits, formatUnits, formatCount } from '../../lib/format';
import { tokenTypeOf } from '../../config/networks';
import { counterLabel } from '../../lib/side';
import { NOTIONAL_CAP_K } from '../../lib/bond';
import { isTypingTarget } from '../../overlays/Overlays';
import { anyModalOpen } from '../../design/primitives';
import { ReadinessRows } from '../../overlays/WalletReadiness';
import { SCENARIOS, SCENARIO_LABEL } from '../../data/fixtures/scenario';
import type { FixturePorts } from '../../data/fixtures';
import type { TradeEngine } from './engine';

const WINDOWS = [
  { value: '60', label: '1 min' },
  { value: '120', label: '2 min' },
  { value: '300', label: '5 min' },
];

export function RequestScreen({ engine }: { engine: TradeEngine }) {
  const ports = useData();
  const { network } = ports;
  const state = useRfq((s) => s.state);
  const dispatch = useRfq((s) => s.dispatch);
  const form = state.form;
  const pair = network.pairs.find((p) => p.code === form.pair) ?? network.pairs[0];
  const walletStatus = useWalletStore((s) => s.status);
  const relays = useRelays();
  const show = useOverlays((s) => s.show);
  const pairRef = useRef<HTMLSelectElement>(null);
  const snap = useSnapshot();

  // A finished or cancelled trade starts a fresh request on this screen.
  useEffect(() => {
    if (state.phase === 'cancelled' || state.phase === 'settled' || state.phase === 'failed') dispatch({ type: 'reset', pair: pair?.code ?? form.pair });
  }, [state.phase, dispatch, pair, form.pair]);

  let sizeUnits: bigint | undefined;
  try {
    sizeUnits = form.size ? parseUnits(form.size, pair?.base.decimals ?? 6) : undefined;
  } catch {
    sizeUnits = undefined;
  }
  const readiness = useReadiness({ side: form.side, size: sizeUnits });
  const set = (patch: Partial<RequestForm>) => dispatch({ type: 'form', patch });

  // "/" jumps to the pair picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTypingTarget(e.target) || anyModalOpen()) return;
      e.preventDefault();
      pairRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stats = useMemo(() => {
    const view = snap.snapshot?.view;
    if (!view) return undefined;
    const active = [...view.bonds.values()].filter((b) => b.active && b.amount > 0n);
    const amounts = active.map((b) => b.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const median = amounts.length ? (amounts.length % 2 ? amounts[(amounts.length - 1) / 2] : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2n) : undefined;
    const largest = amounts.length ? amounts[amounts.length - 1] * NOTIONAL_CAP_K : undefined;
    const qualifying = sizeUnits ? active.filter((b) => b.amount * NOTIONAL_CAP_K >= sizeUnits!).length : undefined;
    return { dealers: active.length, median, largest, qualifying };
  }, [snap.snapshot, sizeUnits]);

  const balanceCheck = readiness.checks.find((c) => c.id === 'balance');
  const blockedByBalance = walletStatus === 'connected' && balanceCheck?.state === 'bad';
  const tooFewRelays = relays.count < 2;
  const requesting = state.phase === 'requesting';
  const canSubmit = Boolean(pair && sizeUnits && sizeUnits > 0n) && !tooFewRelays && !blockedByBalance && !requesting;
  const baseBalance = readiness.balances && pair ? readiness.balances[tokenTypeOf(pair.base)] : undefined;
  const counterBalance = readiness.balances && pair ? readiness.balances[tokenTypeOf(pair.counter)] : undefined;

  const submit = () => {
    if (!canSubmit) return;
    void engine.request(form);
  };

  if (!pair) return <Banner tone="bad" title="No pair on this network">{network.label} has no configured pair.</Banner>;

  return (
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] items-start">
      <Card
        as="section"
        aria-labelledby="request-title"
        className="flex flex-col gap-3.5"
      >
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 id="request-title" className="font-display font-semibold text-19">
              Request quotes
            </h1>
            <Segmented label="Side" value={form.side} onChange={(side) => set({ side })} options={[{ value: 'sell', label: 'Sell' }, { value: 'buy', label: 'Buy' }]} />
          </div>

          <div className="flex flex-col gap-2 rounded-input border border-line bg-bg px-4 py-3.5 focus-within:border-mu">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="rfq-size" className="label">
                {form.side === 'sell' ? 'You sell' : 'You buy'}
              </label>
              {baseBalance !== undefined && (
                <span className="text-12.5 text-mu tabular-nums">
                  Balance {formatUnits(baseBalance, pair.base.decimals, { maxFraction: 2 })}
                  {form.side === 'sell' && baseBalance > 0n && (
                    <>
                      {' · '}
                      <button type="button" className="text-seal hover:underline" onClick={() => set({ size: formatUnits(baseBalance, pair.base.decimals, { group: false }) })}>
                        Max
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <input
                id="rfq-size"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={form.size}
                onChange={(e) => {
                  if (isAmountInput(e.target.value, pair.base.decimals)) set({ size: e.target.value });
                }}
                className="w-full min-w-0 bg-transparent outline-none font-display font-semibold text-30 tabular-nums placeholder:text-mu"
                aria-describedby="size-help"
              />
              <label className="sr-only" htmlFor="rfq-pair">
                Pair
              </label>
              <select
                id="rfq-pair"
                ref={pairRef}
                value={form.pair}
                onChange={(e) => set({ pair: e.target.value })}
                className="h-[38px] rounded-btn-sm border border-line bg-s1 px-2.5 font-medium text-tx"
                title="Press / to focus"
              >
                {network.pairs.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </select>
            </div>
            <span id="size-help" className="sr-only">
              Amount of {pair.base.symbol}, up to {pair.base.decimals} decimal places
            </span>
          </div>

          <div className="flex justify-center -my-2" aria-hidden="true">
            <span className="grid place-items-center w-9 h-9 rounded-btn bg-s2 border border-line text-mu">
              <ArrowUpDown size={16} strokeWidth={1.7} />
            </span>
          </div>

          <div className="flex flex-col gap-2 rounded-input border border-line bg-bg px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="label">{counterLabel(form.side)}</span>
              {counterBalance !== undefined && <span className="text-12.5 text-mu tabular-nums">Balance {formatUnits(counterBalance, pair.counter.decimals, { maxFraction: 2 })}</span>}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5 text-seal">
                <Lock size={20} strokeWidth={1.7} aria-hidden="true" />
                <span className="text-15 font-medium">Price revealed after dealers seal</span>
              </span>
              <span className="font-medium">{pair.counter.symbol}</span>
            </div>
          </div>
          {pair.note && <p className="text-12.5 text-mu">{pair.note}</p>}

          <details className="group">
            <summary className="flex items-center gap-1.5 text-13.5 text-mu cursor-pointer select-none hover:text-tx w-fit">
              <ChevronRight size={14} className="transition-transform duration-hover group-open:rotate-90" aria-hidden="true" />
              Advanced
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-13.5">Quote window</span>
                <Segmented label="Quote window" value={String(form.windowSecs)} onChange={(v) => set({ windowSecs: Number(v) })} options={WINDOWS} />
              </div>
              <p className="text-12.5 text-mu -mt-1.5">Seals take 20–45 s on {network.label}. The window never extends for late dealers.</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-13.5">Minimum dealer bond</span>
                <Segmented
                  label="Minimum dealer bond"
                  value={form.minBond ?? 'any'}
                  onChange={(v) => set({ minBond: v === 'any' ? undefined : v })}
                  options={[
                    { value: 'any', label: 'Any' },
                    { value: '1000', label: `1,000 ${pair.base.symbol}` },
                    { value: '10000', label: `10,000` },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-13.5">Disclosure note</span>
                <span className="text-13.5 text-mu">Off · attach one from the receipt after settling</span>
              </div>
            </div>
          </details>

          <div className="rounded-btn border border-line2 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-13.5 font-medium">Before you request</span>
              <button type="button" className="text-12.5 text-mu hover:text-tx underline underline-offset-2" onClick={() => show(walletStatus === 'connected' ? 'readiness' : 'connect', { side: form.side, size: sizeUnits })}>
                {walletStatus === 'connected' ? 'Wallet readiness' : 'Connect a wallet'}
              </button>
            </div>
            <ReadinessRows checks={readiness.checks} compact />
            {walletStatus !== 'connected' && <p className="text-12.5 text-mu">You can request and compare without a wallet; settling needs one.</p>}
          </div>

          {state.error && (
            <Banner tone="bad" title="Request not sent" urgent>
              {state.error}
            </Banner>
          )}
          {tooFewRelays && (
            <p className="text-13.5 text-bad" role="status">
              {relays.count === 0 ? 'No relay is reachable.' : 'Only one relay is reachable.'} Requests need at least 2.{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => show('relays')}>
                Manage relays
              </button>
            </p>
          )}

          <Button type="submit" variant="primary" wide className="h-[50px] text-15" disabled={!canSubmit} busy={requesting}>
            {requesting ? 'Connecting to relays…' : 'Request quotes'}
            {!requesting && <Kbd className="border-btntx/25 text-btntx">↵</Kbd>}
          </Button>
          <p className="text-12.5 text-mu text-center">
            Sent to {relays.urls.length} relay{relays.urls.length === 1 ? '' : 's'}. They see the pair and size, never a price.
          </p>
        </form>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3.5">
          <h2 className="font-display font-semibold text-15">{pair.code} right now</h2>
          {snap.status === 'error' ? (
            <p className="text-13.5 text-bad">Can’t read dealer bonds: {snap.error}</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Dealers bonded', value: stats && formatCount(stats.dealers) },
                { label: 'Largest quotable', value: stats && (stats.largest === undefined ? '—' : `${formatUnits(stats.largest, pair.base.decimals, { maxFraction: 0 })} ${pair.base.symbol}`) },
                { label: 'Median bond', value: stats && (stats.median === undefined ? '—' : formatUnits(stats.median, pair.base.decimals, { maxFraction: 0 })) },
              ].map((t) => (
                <div key={t.label} className="flex flex-col gap-1 min-w-0">
                  <span className="label">{t.label}</span>
                  {t.value === undefined ? <Skeleton height={20} width="70%" /> : <span className="font-display font-semibold text-19 tabular-nums break-words">{t.value}</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-12.5 text-mu">
            A dealer can quote at most 20× their bond.
            {stats?.qualifying !== undefined && sizeUnits ? ` At this size, ${stats.qualifying} of ${stats.dealers} active dealers can quote.` : ''}
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="font-display font-semibold text-15">What happens next</h2>
          {[
            ['Sealed', 'Dealers lock prices on-chain', '20–45 s'],
            ['Compare', 'Prices open for you only', 'as each seals'],
            ['Settle', 'One atomic swap', '17–24 s'],
          ].map(([title, body, time]) => (
            <div key={title} className="flex flex-wrap items-center justify-between gap-2 text-13.5">
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-line" />
                <b className="font-semibold w-[70px]">{title}</b>
                <span className="text-mu">{body}</span>
              </span>
              <span className="font-mono text-12.5 text-mu">{time}</span>
            </div>
          ))}
          <p className="text-12.5 text-mu">Measured on Preprod. No dealer answering is normal early on — <Link to="/deal" className="underline underline-offset-2 hover:text-tx">become one</Link>.</p>
        </Card>
        {ports.source === 'fixture' && (
          <Card dashed className="flex flex-col gap-2">
            <h2 className="font-display font-semibold text-15">Sample scenario</h2>
            <p className="text-12.5 text-mu">Pick the outcome the sample trade plays. Add &speed=10 to the address to run it faster.</p>
            <ul className="flex flex-wrap gap-2">
              {SCENARIOS.map((sc) => (
                <li key={sc}>
                  <Link
                    to={`?scenario=${sc}`}
                    className={cx('inline-flex h-control-sm items-center rounded-btn-sm border px-3 text-13.5', (ports as FixturePorts).scenario === sc ? 'border-tx text-tx' : 'border-line text-mu hover:text-tx')}
                    aria-current={(ports as FixturePorts).scenario === sc ? 'true' : undefined}
                  >
                    {SCENARIO_LABEL[sc]}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
