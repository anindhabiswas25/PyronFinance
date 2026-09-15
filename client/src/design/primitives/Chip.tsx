import type { ReactNode } from 'react';
import { cx } from '../cx';
import { toneSoft, type Tone } from '../tone';

export interface ChipProps {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Chip({ tone = 'neutral', icon, children, className, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-[5px] h-[22px] px-2 rounded-chip text-12.5 font-medium whitespace-nowrap',
        toneSoft[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
