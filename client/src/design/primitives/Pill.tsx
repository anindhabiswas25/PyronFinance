import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';

const base =
  'inline-flex items-center gap-[7px] h-control-sm px-3 border border-line rounded-btn-sm text-13.5 text-mu bg-s1 whitespace-nowrap';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/** A top-bar pill. Interactive pills are buttons; use `StaticPill` for display-only ones. */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill({ className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx(base, 'transition-colors duration-hover hover:border-mu hover:text-tx', className)} {...rest}>
      {children}
    </button>
  );
});

export function StaticPill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx(base, className)}>{children}</span>;
}
