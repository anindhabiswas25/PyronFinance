import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { Chip, Hash } from '../design/primitives';
import { cx } from '../design/cx';
import { useTray, type TrayEntry } from '../state/tray';
import { formatDuration } from '../lib/time';

// One on-chain action with its real stages. Listed in the notification centre, which replaced the
// separate transaction tray drawer (2026-09-16).

function elapsed(entry: TrayEntry, nowMs: number) {
  return formatDuration(Math.max(0, Math.round(((entry.endedAt ?? nowMs) - entry.startedAt) / 1000)));
}

export function TrayEntryCard({ entry, nowMs, onNavigate }: { entry: TrayEntry; nowMs: number; onNavigate(): void }) {
  const { dismiss } = useTray();
  const active = entry.stages.find((s) => s.status === 'active' || s.status === 'failed');
  return (
    <li className="flex flex-col gap-2 rounded-input bg-bg border border-line2 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{entry.title}</p>
          {entry.source === 'fixture' && <p className="text-12.5 text-warn">Sample data · simulated</p>}
        </div>
        {entry.status === 'running' ? (
          <span className="font-mono text-12.5 text-seal tabular-nums">{elapsed(entry, nowMs)}</span>
        ) : entry.status === 'done' ? (
          <Chip tone="ok" icon={<Check size={12} aria-hidden="true" />}>
            Done
          </Chip>
        ) : (
          <Chip tone="bad">Failed</Chip>
        )}
      </div>
      <ol className="flex gap-1" aria-label={`${entry.title} stages`}>
        {entry.stages.map((s) => (
          <li key={s.id} className="flex-1" title={`${s.label}: ${s.status}`}>
            <span
              aria-hidden="true"
              className={cx(
                'block h-1 rounded-full',
                s.status === 'done' && 'bg-ok',
                s.status === 'active' && 'bg-seal',
                s.status === 'failed' && 'bg-bad',
                (s.status === 'pending' || s.status === 'skipped') && 'bg-s2',
              )}
            />
            <span className="sr-only">
              {s.label}: {s.status}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-12.5 text-mu" aria-live="polite">
        {entry.status === 'failed' ? entry.error : entry.status === 'done' ? `Finished in ${elapsed(entry, nowMs)}` : active ? `${active.label}${active.detail ? ` · ${active.detail}` : ''}` : 'Starting'}
      </p>
      {entry.interrupted && entry.status === 'running' && (
        <p className="text-12.5 text-warn">The page reloaded while this was running. The last known stage is shown; check the transaction before trying again.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-12.5">
        {entry.txHash && (
          <span className="text-mu">
            tx <Hash value={entry.txHash} label="transaction" />
          </span>
        )}
        {entry.href && (
          <Link to={entry.href} onClick={onNavigate} className="text-tx underline underline-offset-2 hover:text-seal">
            Open
          </Link>
        )}
        {entry.status !== 'running' && (
          <button type="button" onClick={() => dismiss(entry.id)} className="ml-auto inline-flex items-center gap-1 text-mu hover:text-tx">
            <X size={13} aria-hidden="true" />
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}
