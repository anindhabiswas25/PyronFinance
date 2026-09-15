import { useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { formatClock, formatDurationWords } from '../../lib/time';

export interface CountdownProps {
  /** Unix seconds the countdown reaches zero at. */
  until: number;
  /** Current unix seconds, from `useNow()`, so a page runs on one clock. */
  now: number;
  /** Spoken after the duration: "2 minutes remaining". */
  suffix?: string;
  expiredText?: string;
  className?: string;
}

const ANNOUNCE_EVERY_MS = 10_000;

/** Visible m:ss that ticks every second, with a screen-reader announcement throttled to once every
 *  10 s (and once at zero), so assistive tech is not flooded. */
export function Countdown({ until, now, suffix = 'remaining', expiredText = 'Expired', className }: CountdownProps) {
  const remaining = Math.max(0, until - now);
  const spoken = remaining > 0 ? `${formatDurationWords(remaining)} ${suffix}` : expiredText;
  const [announced, setAnnounced] = useState(spoken);
  const lastAnnounce = useRef(0);

  useEffect(() => {
    const t = Date.now();
    if (remaining === 0 || t - lastAnnounce.current >= ANNOUNCE_EVERY_MS) {
      lastAnnounce.current = t;
      setAnnounced(spoken);
    }
  }, [spoken, remaining]);

  return (
    <span className={cx('tabular-nums', className)}>
      <span aria-hidden="true">{remaining > 0 ? formatClock(remaining) : expiredText}</span>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </span>
  );
}
