import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from '../../../state/prefs';
import { resolveTheme, watchSystemTheme } from '../../../design/theme';
import { cx } from '../../../design/cx';
import { ChartTopBar, CHART_TYPES, INDICATORS, MORE_TIMEFRAMES, TIMEFRAMES, type ChartType, type Timeframe } from './ChartTopBar';
import { TradingViewWidget } from './TradingViewWidget';

// An external market's public chart, shown beside the swap card for context. It is not a protocol
// price: nothing here comes from a dealer, a relay or the chain, and nothing typed into the swap card
// reaches it. Dealer prices stay sealed until each reveal, in the taker's browser only (FRONTEND.md).

/** The reference market for the tNIGHT pairs: mainnet NIGHT on MEXC. */
export const REFERENCE_MARKET = { symbol: 'MEXC:NIGHTUSDC', label: 'NIGHT/USDC', venue: 'MEXC' } as const;

const TV_INTERVAL: Record<Timeframe, string> = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W',
};
const TV_STYLE: Record<ChartType, string> = { candles: '1', bars: '0', line: '2', area: '3' };

interface ChartView {
  timeframe: Timeframe;
  chartType: ChartType;
  studies: string[];
}

const DEFAULT_VIEW: ChartView = { timeframe: '1h', chartType: 'candles', studies: [] };
const KEY = 'pyron:chart';

function readView(): ChartView {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ChartView> | null;
    if (!v) return DEFAULT_VIEW;
    const known = new Set<string>(INDICATORS.map((i) => i.id));
    return {
      timeframe: [...TIMEFRAMES, ...MORE_TIMEFRAMES].includes(v.timeframe as Timeframe) ? (v.timeframe as Timeframe) : DEFAULT_VIEW.timeframe,
      chartType: CHART_TYPES.includes(v.chartType as ChartType) ? (v.chartType as ChartType) : DEFAULT_VIEW.chartType,
      studies: Array.isArray(v.studies) ? v.studies.filter((s) => known.has(s)) : [],
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeView(view: ChartView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Not persisted; the view still applies for this page.
  }
}

function utcNow(): string {
  return new Date().toISOString().slice(11, 19) + ' UTC';
}

export function PriceChart({ className }: { className?: string }) {
  const [view, setView] = useState(readView);
  const [resetKey, setResetKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(utcNow);
  const shellRef = useRef<HTMLDivElement>(null);

  const themePref = usePrefs((s) => s.theme);
  const [theme, setTheme] = useState(() => resolveTheme(themePref));
  useEffect(() => {
    setTheme(resolveTheme(themePref));
    return themePref === 'system' ? watchSystemTheme(() => setTheme(resolveTheme('system'))) : undefined;
  }, [themePref]);

  const update = useCallback((patch: Partial<ChartView>) => {
    setView((v) => {
      const next = { ...v, ...patch };
      writeView(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(utcNow()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void shellRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <section
      ref={shellRef}
      aria-labelledby="chart-title"
      className={cx('flex flex-col overflow-hidden bg-s1', fullscreen ? 'h-screen' : 'rounded-card border border-line2', className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line2 px-3 py-2.5 sm:px-4">
        <div className="flex items-baseline gap-2">
          <h2 id="chart-title" className="font-display font-semibold text-15">
            {REFERENCE_MARKET.label}
          </h2>
          <span className="text-12.5 text-mu">{REFERENCE_MARKET.venue} · reference market</span>
        </div>
        <span className="text-12.5 text-mu">Not a quote. Dealer prices stay sealed until they reveal.</span>
      </header>

      <ChartTopBar
        timeframe={view.timeframe}
        chartType={view.chartType}
        studies={view.studies}
        fullscreen={fullscreen}
        onTimeframeChange={(timeframe) => update({ timeframe })}
        onChartTypeChange={(chartType) => update({ chartType })}
        onToggleStudy={(id) => update({ studies: view.studies.includes(id) ? view.studies.filter((s) => s !== id) : [...view.studies, id] })}
        onReset={() => {
          update(DEFAULT_VIEW);
          setResetKey((k) => k + 1);
        }}
        onFullscreen={toggleFullscreen}
      />

      <div className="relative min-h-0 flex-1">
        <TradingViewWidget
          symbol={REFERENCE_MARKET.symbol}
          interval={TV_INTERVAL[view.timeframe]}
          chartStyle={TV_STYLE[view.chartType]}
          studies={view.studies}
          theme={theme}
          resetKey={resetKey}
        />
      </div>

      <div className="flex shrink-0 items-center justify-end border-t border-line2 px-4 py-1.5">
        <span className="font-mono text-10.5 text-dim tabular-nums">{clock}</span>
      </div>
    </section>
  );
}
