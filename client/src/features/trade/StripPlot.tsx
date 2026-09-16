import { useEffect, useRef, useState } from 'react';
import type { CompareQuote } from '../../lib/compare';
import { isValidAt } from '../../lib/compare';
import { formatUnits, truncateHash } from '../../lib/format';

// "Where the quotes land": one axis in the counter asset, a dot per quote labelled with its dealer,
// the median as a dashed line. Best is filled ok, the selection filled tx, expired hollow. Seal
// mismatches are not plotted. Labels never overlap: close ones are staggered onto a second row.

const H = 118;
const PAD_X = 48;
const AXIS_Y = 80;
const MIN_LABEL_GAP = 90;

function niceStep(range: bigint): bigint {
  // A step of 1, 2 or 5 × 10^k (base units) giving about five ticks.
  const target = range / 5n || 1n;
  let p = 1n;
  while (p * 10n <= target) p *= 10n;
  for (const m of [1n, 2n, 5n, 10n]) if (m * p >= target) return m * p;
  return 10n * p;
}

export function StripPlot({
  quotes,
  bestId,
  selectedId,
  median,
  now,
  decimals,
  symbol,
  sizeLabel,
}: {
  quotes: CompareQuote[];
  bestId?: string;
  selectedId?: string;
  median?: bigint;
  now: number;
  decimals: number;
  symbol: string;
  sizeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotted = quotes.filter((q) => q.state === 'valid' || q.state === 'expired');
  if (plotted.length === 0) return null;

  let lo = plotted[0].amount;
  let hi = plotted[0].amount;
  for (const q of plotted) {
    if (q.amount < lo) lo = q.amount;
    if (q.amount > hi) hi = q.amount;
  }
  const range = hi - lo;
  const pad = range === 0n ? (hi / 100n > 0n ? hi / 100n : 1n) : range / 10n || 1n;
  const step = niceStep(range + pad * 2n);
  const min = ((lo - pad) / step) * step;
  const max = ((hi + pad + step - 1n) / step) * step;
  const span = max - min || 1n;
  const x = (v: bigint) => PAD_X + (Number(((v - min) * 10_000n) / span) / 10_000) * (width - PAD_X * 2);
  const ticks: bigint[] = [];
  for (let t = min; t <= max && ticks.length < 12; t += step) ticks.push(t);

  const fmt = (v: bigint) => formatUnits(v, decimals, { maxFraction: 2 });
  const sorted = [...plotted].sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
  let lastX = -Infinity;
  let row = 0;
  const labels = sorted.map((q) => {
    const px = x(q.amount);
    row = px - lastX < MIN_LABEL_GAP ? (row + 1) % 2 : 0;
    lastX = px;
    return { q, px, row };
  });

  const description = `Where the quotes land, ${symbol} ${sizeLabel}: ${sorted
    .map((q) => `${truncateHash(q.dealerCmt)} ${fmt(q.amount)}${q.quoteId === bestId ? ' (best)' : ''}${q.quoteId === selectedId ? ' (selected)' : ''}${isValidAt(q, now) ? '' : ' (expired)'}`)
    .join('; ')}${median !== undefined ? `; median ${fmt(median)}` : ''}.`;

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={H} role="img" aria-label={description} className="block">
        <line x1={PAD_X} x2={width - PAD_X} y1={AXIS_Y} y2={AXIS_Y} style={{ stroke: 'var(--line)' }} strokeWidth={1} />
        {ticks.map((t) => (
          <g key={t.toString()}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_Y - 4} y2={AXIS_Y + 4} style={{ stroke: 'var(--line)' }} />
            <text x={x(t)} y={AXIS_Y + 20} textAnchor="middle" style={{ fill: 'var(--mu)' }} fontFamily="IBM Plex Mono, monospace" fontSize={11}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {median !== undefined && (
          <g>
            <line x1={x(median)} x2={x(median)} y1={10} y2={AXIS_Y} style={{ stroke: 'var(--mu)' }} strokeWidth={1} strokeDasharray="3 4" />
            <text x={x(median) + 6} y={16} style={{ fill: 'var(--mu)' }} fontSize={11.5}>
              median
            </text>
          </g>
        )}
        {labels.map(({ q, px, row: r }) => {
          const expired = !isValidAt(q, now);
          const best = q.quoteId === bestId;
          const selected = q.quoteId === selectedId;
          const color = expired ? 'var(--mu)' : best ? 'var(--ok)' : selected ? 'var(--tx)' : 'var(--mu)';
          return (
            <g key={q.quoteId}>
              <circle
                cx={px}
                cy={AXIS_Y}
                r={best || selected ? 8 : 7}
                style={expired ? { fill: 'none', stroke: 'var(--mu)' } : { fill: color, stroke: 'var(--s1)' }}
                strokeWidth={expired ? 1.5 : 2}
              />
              <text x={px} y={AXIS_Y - 22 - r * 16} textAnchor="middle" style={{ fill: color }} fontFamily="IBM Plex Mono, monospace" fontSize={11.5}>
                {truncateHash(q.dealerCmt)}
                {best ? ' · best' : selected ? ' · selected' : expired ? ' · expired' : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
