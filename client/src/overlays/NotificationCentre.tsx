import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { Button, Chip, Drawer, EmptyState, Kbd } from '../design/primitives';
import { cx } from '../design/cx';
import { toneDot } from '../design/tone';
import { useClock, useNow } from '../design/clock';
import { needsYou, useNotifications, type Notice } from '../state/notifications';
import { useTray } from '../state/tray';
import { formatAgo } from '../lib/time';
import { useNoticeActions } from './notice-actions';
import { TrayEntryCard } from './TransactionTray';

function NoticeCard({ notice, now }: { notice: Notice; now: number }) {
  const dismiss = useNotifications((s) => s.dismiss);
  const run = useNoticeActions();
  const showActions = notice.actions.length > 0 && !(notice.kind === 'action' && notice.resolved);
  return (
    <li className={cx('flex flex-col gap-2 rounded-input bg-bg border px-3.5 py-3', notice.read ? 'border-line2' : 'border-line')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span aria-hidden="true" className={cx('mt-[7px] w-2 h-2 rounded-full shrink-0', toneDot[notice.tone])} />
          <div className="min-w-0">
            <p className={cx('font-semibold', notice.resolved && 'text-mu')}>{notice.title}</p>
            {notice.body && <p className="text-12.5 text-mu mt-0.5">{notice.body}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!notice.read && <Chip tone="seal">New</Chip>}
          {notice.kind === 'action' && notice.resolved && <Chip>No longer needed</Chip>}
          <span className="text-12.5 text-mu tabular-nums whitespace-nowrap">{formatAgo(Math.floor(notice.updatedAt / 1000), now)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showActions &&
          notice.actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.primary ? 'primary' : 'secondary'} onClick={() => run(a.action)}>
              {a.label}
            </Button>
          ))}
        <button type="button" onClick={() => dismiss(notice.key)} className="ml-auto inline-flex items-center gap-1 text-12.5 text-mu hover:text-tx" aria-label={`Dismiss: ${notice.title}`}>
          <X size={13} aria-hidden="true" />
          Dismiss
        </button>
      </div>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h3 id={id} className="label">
        {title} · {count}
      </h3>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

/** The notification centre: what needs the user, on-chain actions with their stages, and updates.
 *  Follows the user across pages and reloads. */
export function NotificationCentreDrawer({ open, onClose }: { open: boolean; onClose(): void }) {
  const { entries, markAllRead, clearHistory } = useNotifications();
  const tray = useTray((s) => s.entries);
  const clearFinished = useTray((s) => s.clearFinished);
  const clock = useClock();
  useNow(1000);
  const nowMs = clock.nowMs();
  const now = Math.floor(nowMs / 1000);

  // Entries are marked read when the drawer closes, so "New" stays visible while it is open.
  useEffect(() => {
    if (!open) return;
    return () => markAllRead();
  }, [open, markAllRead]);

  const pending = needsYou(entries);
  const history = entries.filter((e) => !pending.includes(e));
  const hasFinished = tray.some((e) => e.status !== 'running') || history.length > 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notifications"
      width={440}
      footer={
        <div className="flex items-center justify-between gap-3 text-12.5 text-mu">
          <span>
            Press <Kbd>N</Kbd> anywhere to open
          </span>
          {hasFinished && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearFinished();
                clearHistory();
              }}
            >
              Clear finished
            </Button>
          )}
        </div>
      }
    >
      {entries.length === 0 && tray.length === 0 ? (
        <EmptyState compact title="Nothing yet">
          A running trade reports here: seals, prices ready, wallet approvals, settlements and failures, each with what you can do next. Settlements, fraud proofs, notes and bond actions show their real stages. Everything stays here if you change pages or reload.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {pending.length > 0 && (
            <Section title="Needs you" count={pending.length}>
              {pending.map((n) => (
                <NoticeCard key={n.key} notice={n} now={now} />
              ))}
            </Section>
          )}
          {tray.length > 0 && (
            <Section title="Transactions" count={tray.length}>
              {tray.map((e) => (
                <TrayEntryCard key={e.id} entry={e} nowMs={e.source === 'live' ? Date.now() : nowMs} onNavigate={onClose} />
              ))}
            </Section>
          )}
          {history.length > 0 && (
            <Section title="Updates" count={history.length}>
              {history.map((n) => (
                <NoticeCard key={n.key} notice={n} now={now} />
              ))}
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}
