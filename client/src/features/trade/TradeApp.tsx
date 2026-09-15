import { useEffect, useMemo, useRef, useState } from 'react';
import { Stepper, Chip } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useRelays } from '../../data/useRelays';
import { useRfq, type TradeView } from '../../state/rfq';
import { formatUnits, parseUnits } from '../../lib/format';
import { TradeEngine } from './engine';
import { RequestScreen } from './RequestScreen';
import { SealedScreen } from './SealedScreen';
import { CompareScreen } from './CompareScreen';
import { SettleScreen } from './SettleScreen';

const STEPS = ['Request', 'Sealed', 'Compare', 'Settle'] as const;
const STEP_OF: Record<TradeView, number> = { request: 0, sealed: 1, compare: 2, settle: 3 };

export default function TradeApp() {
  const ports = useData();
  const relays = useRelays();
  const state = useRfq((s) => s.state);
  const [attached, setAttached] = useState<unknown>(undefined);
  const urlsRef = useRef(relays.urls);
  urlsRef.current = relays.urls;

  useEffect(() => {
    useRfq.getState().attach(ports.storage.session, ports.network.pairs[0]?.code ?? '');
    setAttached(ports);
  }, [ports]);
  const ready = attached === ports;

  const engine = useMemo(() => new TradeEngine(ports, () => urlsRef.current), [ports]);

  // After a reload mid-trade: reconnect relays and restart any scripted counterparties (tests).
  useEffect(() => {
    if (!ready) return;
    const s = useRfq.getState().state;
    if ((s.phase === 'sealed' || s.phase === 'revealed') && !ports.relays.status().some((r) => r.connected)) {
      void ports.relays.connect(urlsRef.current).catch(() => undefined);
    }
    engine.resumeScenario();
    return () => engine.dispose();
  }, [engine, ready, ports]);

  useEffect(() => {
    if (!ready) return;
    void engine.tick();
    const id = setInterval(() => void engine.tick(), ports.pollMs ?? 2000);
    return () => clearInterval(id);
  }, [engine, ready, ports]);

  if (!ready) return null;

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
        <Stepper steps={STEPS} current={STEP_OF[state.view]} label="Trade progress" />
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
