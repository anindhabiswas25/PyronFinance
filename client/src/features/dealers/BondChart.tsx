import { useEffect, useRef, useState } from 'react';
import type { BondPoint } from '../../data/selectors';
import { formatCompactUnits } from '../../lib/format';
import { formatUtc } from '../../lib/time';
import { fmtBase } from '../shared/protocol';

// Bond-over-time as a step chart: one series, so no legend (the title names it); a 2 px line, a
// recessive grid, an endpoint marker, a hover/focus tooltip, and a table alternative beside it.

const UNIT = 1_000_000n;
const H = 200;
const PAD = { l: 52, r: 18, t: 14, b: 30 };

const KIND_LABEL: Record<BondPoint['kind'], string> = {
  posted: 'Bond posted',
  'topped-up': 'Topped up',
  'withdrawal-requested': 'Withdrawal requested',
  withdrawn: 'Withdrawn',
  slashed: 'Slashed',
};

/** Smallest of 1, 2, 2.5, 5 × 10^k whole units that is ≥ max. */
export function niceCeiling(max: bigint): bigint {
  const whole = max <= 0n ? 1n : (max + UNIT - 1n) / UNIT;
  let p = 1n;
  while (p * 10n <= whole) p *= 10n;
  for (const m of [10n, 20n, 25n, 50n, 100n]) {
    const c = (m * p) / 10n;
    if (c >= whole) return (c === 0n ? 1n : c) * UNIT;
  }
  return 10n * p * UNIT;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const shortDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function BondChart({ points, now, symbol, dealerLabel }: { points: BondPoint[]; now: number; symbol: string; dealerLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const [hover, setHover] = useState<number | undefined>(undefined);
  if (points.length === 0) return null;

  const start = points[0].t;
  const end = Math.max(now, points[points.length - 1].t + 1);
  const max = niceCeiling(points.reduce((m, p) => (p.amount > m ? p.amount : m), 0n));
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - start) / (end - start)) * plotW;
  // Pixel positions only; the amounts themselves stay bigint.
  const y = (a: bigint) => PAD.t + plotH - (Number((a * 10_000n) / max) / 10_000) * plotH;

  let line = `M${x(points[0].t)} ${y(points[0].amount)}`;
  for (let i = 1; i < points.length; i++) line += ` H${x(points[i].t)} V${y(points[i].amount)}`;
  line += ` H${x(end)}`;
  const area = `${line} V${PAD.t + plotH} H${x(start)} Z`;
  const ticks = [0n, 1n, 2n, 3n, 4n].map((i) => (max * i) / 4n);
  const last = points[points.length - 1];

  const description = `Bond over time for dealer ${dealerLabel}, in ${symbol}: ${points
    .map((p) => `${KIND_LABEL[p.kind].toLowerCase()} ${fmtBase(p.amount)} on ${formatUtc(p.t)}`)
    .join('; ')}; ${fmtBase(last.amount)} now.`;

  const hovered = hover === undefined ? undefined : points[hover];

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={H} role="img" aria-label={description} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t.toString()}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--line2)' }} strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" style={{ fill: 'var(--mu)' }} fontFamily="IBM Plex Mono, monospace" fontSize={10.5}>
              {formatCompactUnits(t, 6)}
            </text>
          </g>
        ))}
        <path d={area} style={{ fill: 'var(--sealbg)' }} />
        <path d={line} fill="none" style={{ stroke: 'var(--seal)' }} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={`${p.t}-${i}`} cx={x(p.t)} cy={y(p.amount)} r={i === hover ? 5 : 3.5} style={{ fill: 'var(--seal)', stroke: 'var(--s1)' }} strokeWidth={2} />
        ))}
        <circle cx={x(end)} cy={y(last.amount)} r={5} style={{ fill: 'var(--seal)', stroke: 'var(--s1)' }} strokeWidth={2} />
        <text x={PAD.l} y={H - 8} style={{ fill: 'var(--mu)' }} fontFamily="IBM Plex Mono, monospace" fontSize={10.5}>
          {shortDate(start)}
        </text>
        <text x={width - PAD.r} y={H - 8} textAnchor="end" style={{ fill: 'var(--mu)' }} fontFamily="IBM Plex Mono, monospace" fontSize={10.5}>
          now
        </text>
        {/* Hit targets: the whole span of each step, wider than the mark. */}
        {points.map((p, i) => {
          const x0 = x(p.t);
          const x1 = i + 1 < points.length ? x(points[i + 1].t) : x(end);
          return (
            <rect
              key={`hit-${i}`}
              x={x0 - 6}
              y={PAD.t}
              width={Math.max(12, x1 - x0 + 6)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(undefined)}
            />
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 rounded-btn-sm border border-line bg-s1 px-3 py-2 text-12.5 shadow-lg"
          style={{ left: Math.min(Math.max(8, x(hovered.t) - 80), width - 180), top: Math.max(0, y(hovered.amount) - 64) }}
        >
          <p className="font-medium">{KIND_LABEL[hovered.kind]}</p>
          <p className="tabular-nums">
            {fmtBase(hovered.amount)} <span className="text-mu">{symbol}</span>
          </p>
          <p className="text-mu">{formatUtc(hovered.t)}</p>
        </div>
      )}
    </div>
  );
}

export { KIND_LABEL as BOND_KIND_LABEL };
