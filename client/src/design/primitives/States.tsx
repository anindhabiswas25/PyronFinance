import type { ReactNode } from 'react';
import { CircleAlert, Inbox } from 'lucide-react';
import { cx } from '../cx';
import { toneSoft, type Tone } from '../tone';

export interface StateProps {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}

/** Nothing to show, and that is an expected state (no dealers yet, no trades on this device). */
export function EmptyState({ title, children, actions, icon, className, compact }: StateProps) {
  return (
    <div className={cx('flex flex-col items-center text-center gap-3', compact ? 'py-6 px-4' : 'py-12 px-6', className)}>
      <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-full bg-s2 text-mu">
        {icon ?? <Inbox size={18} strokeWidth={1.7} />}
      </span>
      <h2 className="font-display font-semibold text-15">{title}</h2>
      {children && <div className="text-13.5 text-mu max-w-[46ch]">{children}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2 mt-1">{actions}</div>}
    </div>
  );
}

/** Something failed. Says what happened and offers the next step. Never used for "no results". */
export function ErrorState({ title, children, actions, icon, className, compact }: StateProps) {
  return (
    <div role="alert" className={cx('flex flex-col items-center text-center gap-3', compact ? 'py-6 px-4' : 'py-12 px-6', className)}>
      <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-full bg-badbg text-bad">
        {icon ?? <CircleAlert size={18} strokeWidth={1.7} />}
      </span>
      <h2 className="font-display font-semibold text-15">{title}</h2>
      {children && <div className="text-13.5 text-mu max-w-[52ch]">{children}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2 mt-1">{actions}</div>}
    </div>
  );
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, sub, className }: StatTileProps) {
  return (
    <div className={cx('flex flex-col gap-1 min-w-0', className)}>
      <span className="label">{label}</span>
      <span className="font-display font-semibold text-19 tabular-nums break-words">{value}</span>
      {sub && <span className="text-12.5 text-mu">{sub}</span>}
    </div>
  );
}

export interface BannerProps {
  tone?: Tone;
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Announce assertively (fraud, failures). Default: polite status. */
  urgent?: boolean;
}

export function Banner({ tone = 'neutral', icon, title, children, actions, className, urgent }: BannerProps) {
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cx('flex flex-col sm:flex-row sm:items-center gap-3 rounded-btn px-4 py-3', toneSoft[tone], className)}
    >
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {icon && (
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-13.5 font-semibold">{title}</p>
          {children && <div className="text-13.5 text-tx/90 mt-0.5">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
