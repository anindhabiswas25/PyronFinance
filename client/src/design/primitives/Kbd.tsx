import type { ReactNode } from 'react';
import { cx } from '../cx';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-grid place-items-center min-w-[20px] h-5 px-[5px] border border-line border-b-2 rounded-[4px] font-mono text-[11px] text-mu',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
