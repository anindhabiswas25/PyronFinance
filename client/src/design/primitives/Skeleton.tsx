import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export function Skeleton({ width = '100%', height = 10, className }: { width?: CSSProperties['width']; height?: CSSProperties['height']; className?: string }) {
  return <span aria-hidden="true" className={cx('skeleton block rounded-[4px]', className)} style={{ width, height }} />;
}

/** A loading region: announces `label` once and hides its placeholder shapes from assistive tech. */
export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
