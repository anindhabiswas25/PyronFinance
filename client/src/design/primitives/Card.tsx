import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside';
  padded?: boolean;
  dashed?: boolean;
  children: ReactNode;
}

export function Card({ as: Tag = 'div', padded = true, dashed, className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        'rounded-card border',
        dashed ? 'bg-transparent border-dashed border-line' : 'bg-s1 border-line2',
        padded && 'p-5 sm:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={cx('font-display font-semibold text-15', className)}>
      {children}
    </h2>
  );
}
