import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '../cx';
import { truncateHash } from '../../lib/format';

export interface HashProps {
  value: string;
  /** What the value is, for the copy button's accessible name: "dealer", "quote", "transaction". */
  label?: string;
  /** Show the whole value (wrapping) instead of abcd…ef. */
  full?: boolean;
  className?: string;
}

/** A hex identifier, truncated abcd…ef, copied in full on click. */
export function Hash({ value, label = 'hash', full = false, className }: HashProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context or permission): the full value is still in `title`.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={`Copy ${label} ${value}`}
      className={cx(
        'inline-flex items-center gap-1 font-mono text-12.5 text-tx rounded-chip transition-colors duration-hover hover:text-seal text-left',
        className,
      )}
    >
      <span className={full ? 'break-all' : undefined}>{full ? value : truncateHash(value)}</span>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" className="text-mu shrink-0" />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
