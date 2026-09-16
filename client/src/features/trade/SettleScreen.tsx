import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Clock, FileText, Minus, TriangleAlert, X } from 'lucide-react';
import { Banner, Button, ButtonLink, Card, Chip, Hash } from '../../design/primitives';
import { cx } from '../../design/cx';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useRfq, type SettleStageId } from '../../state/rfq';
import { bestQuote, isValidAt } from '../../lib/compare';
import { counterLabel, takerReceivesCounter } from '../../lib/side';
import { formatUnits, truncateHash } from '../../lib/format';
import { formatDuration } from '../../lib/time';
import { nodeErrorMeaning } from '../../lib/node-errors';
import { toast } from '../../design/primitives';
import { useCompareQuotes } from './useCompare';
import type { TradeEngine } from './engine';

const STAGES: Array<{ id: SettleStageId; label: string; hint?: string }> = [
  { id: 'inputs', label: 'Offer coins still unspent' },
  { id: 'balance', label: 'Wallet balances the offer' },
  { id: 'check', label: 'Passes the network’s validation limit' },
  { id: 'submit', label: 'Submitting', hint: 'usually 17–24 s' },
  { id: 'confirm', label: 'Confirmed on-chain' },
];

function StageIcon({ status }: { status: string }) {
  if (status === 'done')
    return (
      <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-okbg text-ok">
        <Check size={14} aria-hidden="true" />
      </span>
    );
  if (status === 'failed')
    return (
      <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-badbg text-bad">
        <X size={14} aria-hidden="true" />
      </span>
    );
  if (status === 'skipped')
    return (
      <span className="grid place-items-center w-[26px] h-[26px] rounded-full border border-line text-mu">
        <Minus size={13} aria-hidden="true" />
      </span>
    );
  if (status === 'active')
    return (
      <span className="grid place-items-center w-[26px] h-[26px] rounded-full border-2 border-seal">
        <span className="w-2 h-2 rounded-full bg-seal motion-safe:animate-pulse" />
      </span>
    );
  return <span className="block w-[26px] h-[26px] rounded-full border border-line" />;
}

export function SettleScreen({ engine }: { engine: TradeEngine }) {
  const ports = useData();
  const { network } = ports;
  const state = useRfq((s) => s.state);
  const dispatch = useRfq((s) => s.dispatch);
  const navigate = useNavigate();
  const now = useNow(1000);
  const rfq = state.rfq;
  const settlement = state.settlement;
  const quoteId = settlement?.quoteId ?? state.failure?.quoteId ?? state.selected;
  const q = quoteId ? state.quotes[quoteId] : undefined;
  const compare = useCompareQuotes(state, now);

  useEffect(() => {
    if (state.phase === 'settled' && quoteId) {
      const id = setTimeout(() => navigate(`/trade/${quoteId}`), 1500);
      return () => clearTimeout(id);
    }
  }, [state.phase, quoteId, navigate]);

  if (!rfq || !q) return null;
  const pair = network.pairs.find((p) => p.code === rfq.pair) ?? network.pairs[0];
  const side = rfq.side;
  const elapsed = settlement ? Math.max(0, now - settlement.startedAt) : 0;
  const nextBest = bestQuote(
    compare.filter((c) => c.quoteId !== q.quoteId),
    side,
    now,
  );

  const saveEvidence = () => {
    if (engine.saveEvidence()) toast({ tone: 'ok', title: 'Evidence saved', body: 'The file holds the signed reveal and the Offer File. Anyone can check it on Verify.' });
  };

  const takeNext = () => {
    if (!nextBest) return;
    dispatch({ type: 'retry-with', quoteId: nextBest.quoteId, at: now });
    void engine.settle(nextBest.quoteId);
  };

  const amt = (v: bigint | undefined) => (v === undefined ? '—' : formatUnits(v, pair.counter.decimals, { minFraction: 2 }));
  const failure = state.failure;

  return (
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display font-semibold text-22">
            {state.phase === 'settled' ? 'Settled with' : state.phase === 'failed' ? 'Couldn’t settle with' : 'Settling with'} {truncateHash(q.dealerCmt)}
          </h1>
          {state.phase === 'settling' && (
            <Chip tone="seal" icon={<Clock size={12} aria-hidden="true" />}>
              {formatDuration(elapsed)}
            </Chip>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2 rounded-card bg-bg px-4 sm:px-5 py-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="label">{takerReceivesCounter(side) ? 'You send' : 'You receive'}</span>
            <span className="font-display font-semibold text-22 sm:text-26 tabular-nums truncate" style={{ fontStretch: '100%' }}>
              {formatUnits(q.notional ?? 0n, pair.base.decimals, { minFraction: 2 })}
            </span>
            <span className="text-mu">{pair.base.symbol}</span>
          </div>
          <ArrowRight size={20} className="text-mu" aria-hidden="true" />
          <div className="flex flex-col gap-0.5 items-end min-w-0">
            <span className="label">{counterLabel(side)}</span>
            <span className="font-display font-semibold text-22 sm:text-26 tabular-nums truncate" style={{ fontStretch: '100%' }}>
              {amt(q.amount)}
            </span>
            <span className="text-mu">{pair.counter.symbol}</span>
          </div>
        </div>

        {settlement && (
          <ol className="flex flex-col" aria-label="Settlement stages" aria-live="polite">
            {STAGES.map((st) => {
              const s = settlement.stages[st.id];
              const detail =
                st.id === 'balance' && s.status === 'done' ? `${ports.source === 'fixture' ? 'Sample wallet' : 'Wallet'}${s.ms !== undefined ? ` · ${(s.ms / 1000).toFixed(1)} s` : ''}` : (s.detail ?? (s.status === 'active' ? st.hint : undefined));
              return (
                <li key={st.id} className="flex items-center gap-3.5 py-2.5">
                  <StageIcon status={s.status} />
                  <span className={cx('flex-1 text-14', s.status === 'pending' && 'text-mu', s.status === 'active' && 'font-semibold')}>
                    {st.label}
                    <span className="sr-only">: {s.status}</span>
                  </span>
                  {detail && <span className="font-mono text-12.5 text-mu text-right">{detail}</span>}
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-13.5 text-mu">Nothing moves until the whole swap lands. If it doesn’t, both sides keep their coins. You can leave this page; the tray keeps tracking it.</p>
        {state.phase === 'settled' && settlement?.txHash && (
          <Banner tone="ok" title="Settled on-chain">
            Transaction <Hash value={settlement.txHash} label="settlement transaction" />
            {settlement.blockHeight !== undefined ? ` in block ${settlement.blockHeight}` : ''}. Opening the receipt…
          </Banner>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        {!failure && state.phase !== 'settled' && (
          <p className="label">If it can’t settle, this is where you’ll see why and what to do next.</p>
        )}

        {failure?.reason === 'inputs-spent' && (
          <Card className="flex flex-col gap-3" role="alert">
            <h2 className="flex items-center gap-2.5 font-display font-semibold text-15">
              <TriangleAlert size={18} className="text-bad" aria-hidden="true" />
              This quote can’t settle
            </h2>
            <p className="text-13.5 text-mu">
              The coins behind {truncateHash(q.dealerCmt)}’s offer were spent{failure.spentBy ? <> in <Hash value={failure.spentBy} label="spending transaction" /></> : ''}, before the quote expired. You lost nothing.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button size="sm" onClick={saveEvidence}>
                <FileText size={14} aria-hidden="true" />
                Save evidence
              </Button>
              {nextBest && isValidAt(nextBest, now) && (
                <Button size="sm" variant="primary" onClick={takeNext}>
                  Take {amt(nextBest.amount)} from {truncateHash(nextBest.dealerCmt)}
                </Button>
              )}
            </div>
            <p className="text-12.5 text-mu">Evidence is a file for now: publishing it to a dealer’s public record has no destination yet. Anyone can check the file on Verify.</p>
          </Card>
        )}

        {failure?.reason === 'wallet-shape' && (
          <Card className="flex flex-col gap-3" role="alert">
            <h2 className="flex items-center gap-2.5 font-display font-semibold text-15">
              <TriangleAlert size={18} className="text-warn" aria-hidden="true" />
              Your wallet needs one prep step
            </h2>
            <p className="text-13.5 text-mu">{failure.detail}</p>
            <p className="text-13.5 text-mu">
              Merge your {takerReceivesCounter(side) ? pair.base.symbol : pair.counter.symbol} into fewer coins: in your wallet, send your whole balance of it to your own address, wait for it to confirm, then settle again. Whether this always fixes it is not yet
              measured from a browser wallet, so the app doesn’t do it for you.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {isValidAt({ ...compare.find((c) => c.quoteId === q.quoteId)!, state: 'valid' }, now) && (
                <Button size="sm" variant="primary" onClick={() => { dispatch({ type: 'retry-with', quoteId: q.quoteId, at: now }); }}>
                  Back to this quote
                </Button>
              )}
            </div>
          </Card>
        )}

        {failure?.reason === 'rejected' && (
          <Card className="flex flex-col gap-3" role="alert">
            <h2 className="flex items-center gap-2.5 font-display font-semibold text-15">
              <X size={18} className="text-bad" aria-hidden="true" />
              The network rejected the settlement{failure.code !== undefined ? ` (code ${failure.code})` : ''}
            </h2>
            <p className="text-13.5 text-mu">{failure.code !== undefined ? nodeErrorMeaning(failure.code) : failure.detail}</p>
            <div className="flex flex-wrap gap-2.5">
              {nextBest && isValidAt(nextBest, now) && (
                <Button size="sm" onClick={() => dispatch({ type: 'retry-with', quoteId: nextBest.quoteId, at: now })}>
                  Pick another quote
                </Button>
              )}
            </div>
          </Card>
        )}

        {failure?.reason === 'expired' && (
          <Card className="flex flex-col gap-3" role="alert">
            <h2 className="flex items-center gap-2.5 font-display font-semibold text-15">
              <Clock size={18} className="text-mu" aria-hidden="true" />
              This quote expired
            </h2>
            <p className="text-13.5 text-mu">{failure.detail}</p>
            {nextBest && isValidAt(nextBest, now) ? (
              <Button size="sm" onClick={() => dispatch({ type: 'retry-with', quoteId: nextBest.quoteId, at: now })}>
                Pick another quote
              </Button>
            ) : (
              <p className="text-13.5 text-mu">No other quote is still valid.</p>
            )}
          </Card>
        )}

        {(state.phase === 'failed' || state.phase === 'settled') && (
          <div className="flex flex-wrap gap-2.5">
            <Button onClick={() => dispatch({ type: 'reset', pair: rfq.pair })}>New request</Button>
            {state.phase === 'settled' && quoteId && (
              <ButtonLink variant="primary" to={`/trade/${quoteId}`}>
                Open receipt
              </ButtonLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
