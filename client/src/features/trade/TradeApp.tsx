import { Stepper, Chip } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { reachedViews, useRfq, type TradeView } from '../../state/rfq';
import { useTradeRuntime } from '../../state/trade-runtime';
import { VerifierSkeleton } from '../../app/PageSkeleton';
import { formatUnits, parseUnits } from '../../lib/format';
import { RequestScreen } from './RequestScreen';
import { SealedScreen } from './SealedScreen';
import { CompareScreen } from './CompareScreen';
import { SettleScreen } from './SettleScreen';

const STEPS = ['Request', 'Sealed', 'Compare', 'Settle'] as const;
const VIEWS: TradeView[] = ['request', 'sealed', 'compare', 'settle'];

// The screens only. The trade itself (its engine, loop and notifications) runs in the shell
// (app/TradeRuntime.tsx), so it keeps going when the user leaves this page.
export default function TradeApp() {
  const ports = useData();
  const state = useRfq((s) => s.state);
  const dispatch = useRfq((s) => s.dispatch);
  const engine = useTradeRuntime((s) => (s.ports === ports ? s.engine : undefined));

  if (!engine) return <VerifierSkeleton />;

  const pair = ports.network.pairs.find((p) => p.code === (state.rfq?.pair ?? state.form.pair)) ?? ports.network.pairs[0];
  const rfqChip = (() => {
    if (!state.rfq || !pair) return undefined;
    let size = state.rfq.size;
    try {
      size = formatUnits(parseUnits(state.rfq.size, pair.base.decimals), pair.base.decimals);
    } catch {
      // keep as sent
    }
    return `${state.rfq.side === 'sell' ? 'Sell' : 'Buy'} ${size} ${pair.base.symbol} ${state.rfq.side === 'sell' ? '→' : '←'} ${pair.counter.symbol}`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper
          steps={STEPS}
          current={VIEWS.indexOf(state.view)}
          label="Trade progress"
          canSelect={(i) => reachedViews(state.phase).includes(VIEWS[i])}
          onSelect={(i) => dispatch({ type: 'view', view: VIEWS[i] })}
        />
        {rfqChip && state.view !== 'request' && (
          <Chip className="font-mono" title="Your request, as the relays saw it. No price was sent.">
            {rfqChip}
          </Chip>
        )}
      </div>
      {state.view === 'request' && <RequestScreen engine={engine} />}
      {state.view === 'sealed' && <SealedScreen engine={engine} />}
      {state.view === 'compare' && <CompareScreen engine={engine} />}
      {state.view === 'settle' && <SettleScreen engine={engine} />}
    </div>
  );
}
