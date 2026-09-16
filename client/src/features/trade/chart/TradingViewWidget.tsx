import { memo, useEffect, useId, useRef, useState } from 'react';

// TradingView's Advanced Chart, loaded from tv.js. Candles, drawing tools and studies are all
// TradingView's own; this component only forwards interval, style and studies, and paints the widget in
// the app's tokens. The free embed has no drawing API, so nothing of ours is ever drawn onto it.

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown };
  }
}

const SCRIPT_SRC = 'https://s3.tradingview.com/tv.js';
let scriptLoad: Promise<void> | undefined;

function loadTvJs(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      // Allow a retry to insert a fresh script instead of awaiting the failed one forever.
      scriptLoad = undefined;
      s.remove();
      reject(new Error('The TradingView script could not be loaded.'));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/** A token from tokens.css as a literal colour: the widget lives in an iframe and can't read variables. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

export interface TradingViewWidgetProps {
  /** TradingView symbol, e.g. "MEXC:NIGHTUSDC". */
  symbol: string;
  /** TradingView interval: "1", "60", "D", … */
  interval: string;
  /** TradingView bar style: "0" bars, "1" candles, "2" line, "3" area. */
  chartStyle: string;
  studies: string[];
  theme: 'dark' | 'light';
  /** Bumped to rebuild the widget from scratch (drops drawings). */
  resetKey?: number;
}

export const TradingViewWidget = memo(function TradingViewWidget({ symbol, interval, chartStyle, studies, theme, resetKey = 0 }: TradingViewWidgetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountId = `tv_${useId().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const studyKey = studies.join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    host.innerHTML = '';
    const inner = document.createElement('div');
    inner.id = mountId;
    inner.style.width = '100%';
    // Push TradingView's bottom branding strip just out of view.
    inner.style.height = 'calc(100% + 32px)';
    host.appendChild(inner);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const done = (ms: number) => timers.push(setTimeout(() => !cancelled && setLoading(false), ms));
    done(6000);

    loadTvJs()
      .then(() => {
        if (cancelled || !window.TradingView) return;
        const bg = token('s1');
        const grid = token('line2');
        const up = token('ok');
        const down = token('bad');
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: 'Etc/UTC',
          theme,
          style: chartStyle,
          locale: 'en',
          backgroundColor: bg,
          gridColor: grid,
          toolbar_bg: bg,
          enable_publishing: false,
          allow_symbol_change: false,
          hide_top_toolbar: true,
          hide_side_toolbar: false,
          hide_legend: false,
          save_image: false,
          withdateranges: false,
          details: false,
          calendar: false,
          studies: studyKey ? studyKey.split('|') : [],
          container_id: mountId,
          loading_screen: { backgroundColor: bg, foregroundColor: token('mu') },
          disabled_features: ['timeframes_toolbar', 'header_symbol_search', 'header_compare', 'use_localstorage_for_settings'],
          overrides: {
            'paneProperties.background': bg,
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': grid,
            'paneProperties.horzGridProperties.color': grid,
            'scalesProperties.backgroundColor': bg,
            'scalesProperties.lineColor': token('line'),
            'scalesProperties.textColor': token('mu'),
            'mainSeriesProperties.candleStyle.upColor': up,
            'mainSeriesProperties.candleStyle.downColor': down,
            'mainSeriesProperties.candleStyle.borderUpColor': up,
            'mainSeriesProperties.candleStyle.borderDownColor': down,
            'mainSeriesProperties.candleStyle.wickUpColor': up,
            'mainSeriesProperties.candleStyle.wickDownColor': down,
          },
        });
        // tv.js has no reliable ready callback; its iframe paints its own loader meanwhile.
        done(1200);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The chart failed to load.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      host.innerHTML = '';
    };
  }, [symbol, interval, chartStyle, studyKey, theme, mountId, retry, resetKey]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="h-full w-full" />
      {(loading || error) && (
        <div className="absolute inset-0 grid place-items-center bg-s1" role={error ? 'alert' : 'status'}>
          {error ? (
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <span className="text-13.5 text-tx">Chart unavailable</span>
              <span className="max-w-[280px] text-12.5 text-mu">{error}</span>
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="rounded-btn-sm border border-line bg-s2 px-3 py-1.5 text-12.5 font-medium text-tx hover:border-mu transition-colors duration-hover"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 pointer-events-none">
              <span aria-hidden="true" className="w-5 h-5 border-2 border-line border-t-mu rounded-full animate-spin" />
              <span className="font-mono text-12.5 text-mu">Loading chart…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
