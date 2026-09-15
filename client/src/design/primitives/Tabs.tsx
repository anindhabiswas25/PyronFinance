import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx';

export interface TabItem<V extends string> {
  id: V;
  label: ReactNode;
  count?: number | string;
}

export interface TabsProps<V extends string> {
  tabs: ReadonlyArray<TabItem<V>>;
  value: V;
  onChange(value: V): void;
  label: string;
  /** Prefix for tab/panel ids; the panel for tab `x` must have id `${idPrefix}-panel-${x}`. */
  idPrefix: string;
  className?: string;
}

export function Tabs<V extends string>({ tabs, value, onChange, label, idPrefix, className }: TabsProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, tabs.findIndex((t) => t.id === value));

  function onKeyDown(e: KeyboardEvent) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 border-b border-line2 overflow-x-auto', className)}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idPrefix}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
            className={cx(
              'inline-flex items-center gap-2 px-3 h-10 -mb-px border-b-2 text-13.5 font-medium whitespace-nowrap transition-colors duration-hover',
              on ? 'border-tx text-tx' : 'border-transparent text-mu hover:text-tx',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-chip bg-s2 px-1.5 text-12.5 text-mu tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children, className }: { idPrefix: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
