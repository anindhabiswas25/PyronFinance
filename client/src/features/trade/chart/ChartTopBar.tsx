import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Maximize, Minimize, RefreshCcw } from 'lucide-react';
import { cx } from '../../../design/cx';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '1w';
export type ChartType = 'candles' | 'bars' | 'line' | 'area';

export const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h'];
export const MORE_TIMEFRAMES: Timeframe[] = ['1m', '3m', '30m', '2h', '4h', '6h', '12h', '1d', '1w'];
export const CHART_TYPES: ChartType[] = ['candles', 'bars', 'line', 'area'];

/** TradingView's built-in studies the free embed accepts by id. */
export const INDICATORS = [
  { id: 'MASimple@tv-basicstudies', label: 'SMA' },
  { id: 'MAExp@tv-basicstudies', label: 'EMA' },
  { id: 'BB@tv-basicstudies', label: 'Bollinger Bands' },
  { id: 'RSI@tv-basicstudies', label: 'RSI' },
  { id: 'MACD@tv-basicstudies', label: 'MACD' },
  { id: 'VWAP@tv-basicstudies', label: 'VWAP' },
] as const;

const CHART_TYPE_LABEL: Record<ChartType, string> = { candles: 'Candles', bars: 'Bars', line: 'Line', area: 'Area' };

const CHART_TYPE_ICON: Record<ChartType, ReactNode> = {
  candles: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} width={15} height={15} aria-hidden="true">
      <rect x="5" y="5" width="3" height="8" />
      <path d="M6.5 3v2M6.5 13v2" />
      <rect x="10" y="3" width="3" height="8" />
      <path d="M11.5 1v2M11.5 11v2" />
    </svg>
  ),
  bars: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} width={15} height={15} aria-hidden="true">
      <path d="M5 3v12M5 6h-2M5 9h2M10 2v12M10 5h-2M10 10h2" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} width={15} height={15} aria-hidden="true">
      <path d="M2 13L6 8l4 3 4-8" />
    </svg>
  ),
  area: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} width={15} height={15} aria-hidden="true">
      <path d="M2 14L6 9l4 3 4-8L16 8v6z" fill="currentColor" fillOpacity={0.2} />
      <path d="M2 14L6 9l4 3 4-8L16 8" />
    </svg>
  ),
};

/** A small popover menu that closes on outside click and Escape. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const tfCls = (active: boolean) =>
  cx('px-[7px] py-1 rounded-chip text-12.5 font-medium transition-colors duration-hover', active ? 'text-tx' : 'text-mu hover:text-tx');
const iconCls = (active: boolean) =>
  cx('h-7 w-7 rounded-chip grid place-items-center transition-colors duration-hover', active ? 'text-tx bg-s2' : 'text-mu hover:text-tx hover:bg-s2');
const menuCls = 'absolute top-full left-0 mt-1 z-30 min-w-full rounded-btn-sm border border-line bg-s1 p-1 shadow-lg';
const itemCls = (active: boolean) =>
  cx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-12.5 rounded-chip transition-colors duration-hover', active ? 'text-tx bg-s2' : 'text-mu hover:text-tx hover:bg-s2');

export interface ChartTopBarProps {
  timeframe: Timeframe;
  chartType: ChartType;
  studies: string[];
  fullscreen: boolean;
  onTimeframeChange(tf: Timeframe): void;
  onChartTypeChange(type: ChartType): void;
  onToggleStudy(id: string): void;
  onReset(): void;
  onFullscreen(): void;
}

export function ChartTopBar({ timeframe, chartType, studies, fullscreen, onTimeframeChange, onChartTypeChange, onToggleStudy, onReset, onFullscreen }: ChartTopBarProps) {
  const more = useMenu();
  const indicators = useMenu();
  const moreActive = MORE_TIMEFRAMES.includes(timeframe);

  return (
    <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-line2 px-2 py-0.5 sm:px-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" className={tfCls(tf === timeframe)} aria-pressed={tf === timeframe} onClick={() => onTimeframeChange(tf)}>
              {tf}
            </button>
          ))}
          <div className="relative" ref={more.ref}>
            <button
              type="button"
              className={cx(tfCls(moreActive), 'flex items-center gap-1')}
              aria-haspopup="menu"
              aria-expanded={more.open}
              aria-label="More timeframes"
              onClick={() => more.setOpen((v) => !v)}
            >
              {moreActive ? timeframe : ''}
              <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {more.open && (
              <div className={menuCls} role="menu">
                {MORE_TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tf === timeframe}
                    className={cx(itemCls(tf === timeframe), 'font-mono')}
                    onClick={() => {
                      onTimeframeChange(tf);
                      more.setOpen(false);
                    }}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line2" />

        <div className="flex items-center gap-[3px]" role="group" aria-label="Chart type">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct}
              type="button"
              title={CHART_TYPE_LABEL[ct]}
              aria-label={CHART_TYPE_LABEL[ct]}
              aria-pressed={chartType === ct}
              onClick={() => onChartTypeChange(ct)}
              className={iconCls(chartType === ct)}
            >
              {CHART_TYPE_ICON[ct]}
            </button>
          ))}
        </div>

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line2" />

        <div className="relative" ref={indicators.ref}>
          <button
            type="button"
            className={cx('flex h-7 items-center gap-1 rounded-chip px-2 text-13.5 transition-colors duration-hover', studies.length ? 'text-tx' : 'text-mu hover:text-tx hover:bg-s2')}
            aria-haspopup="menu"
            aria-expanded={indicators.open}
            onClick={() => indicators.setOpen((v) => !v)}
          >
            Indicators
            {studies.length > 0 && <span className="font-mono text-10.5 text-mu">{studies.length}</span>}
          </button>
          {indicators.open && (
            <div className={cx(menuCls, 'w-48')} role="menu">
              {INDICATORS.map((ind) => {
                const on = studies.includes(ind.id);
                return (
                  <button key={ind.id} type="button" role="menuitemcheckbox" aria-checked={on} className={itemCls(on)} onClick={() => onToggleStudy(ind.id)}>
                    {ind.label}
                    {on && <Check size={14} strokeWidth={2} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" title="Reset chart" aria-label="Reset chart" className={iconCls(false)} onClick={onReset}>
          <RefreshCcw size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} className={iconCls(false)} onClick={onFullscreen}>
          {fullscreen ? <Minimize size={16} strokeWidth={1.8} aria-hidden="true" /> : <Maximize size={16} strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
