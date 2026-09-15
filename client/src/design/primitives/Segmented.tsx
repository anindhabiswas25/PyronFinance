import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange(value: V): void;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

/** A radio group drawn as a segmented control. Arrow keys move and select, like native radios. */
export function Segmented<V extends string>({ options, value, onChange, label, className }: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.findIndex((o) => o.value === value);

  function move(delta: number) {
    const n = options.length;
    let i = current < 0 ? 0 : current;
    for (let k = 0; k < n; k++) {
      i = (i + delta + n) % n;
      if (!options[i].disabled) break;
    }
    onChange(options[i].value);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex p-[3px] bg-bg border border-line2 rounded-btn gap-0.5', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cx(
              'px-[13px] py-1.5 rounded-[6px] text-13.5 font-medium whitespace-nowrap transition-colors duration-hover',
              on ? 'bg-s2 text-tx' : 'text-mu hover:text-tx',
              o.disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
