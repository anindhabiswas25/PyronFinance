import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Text label used for the stacked (narrow) layout when `header` is not a plain string. */
  label?: string;
  cell(row: T, index: number): ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey(row: T): string;
  /** Always provide one; it names the table for assistive tech. */
  caption: string;
  showCaption?: boolean;
  rowProps?(row: T, index: number): HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;
  className?: string;
}

/** A plain data table that becomes stacked label/value rows below 768 px. */
export function DataTable<T>({ columns, rows, rowKey, caption, showCaption = false, rowProps, className }: DataTableProps<T>) {
  return (
    <table className={cx('stacked w-full border-collapse max-md:block', className)}>
      <caption className={showCaption ? 'text-left pb-2 text-13.5 text-mu' : 'sr-only'}>{caption}</caption>
      <thead className="max-md:sr-only">
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cx('label px-4 py-[11px] border-b border-line2 font-semibold', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-md:block">
        {rows.map((row, i) => {
          const extra = rowProps?.(row, i) ?? {};
          return (
            <tr key={rowKey(row)} {...extra} className={cx('max-md:block max-md:py-2 max-md:border-b max-md:border-line2 last:border-b-0', extra.className)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label ?? (typeof c.header === 'string' ? c.header : undefined)}
                  className={cx(
                    'px-4 py-[13px] border-b border-line2 align-middle tabular-nums',
                    'max-md:flex max-md:justify-between max-md:items-start max-md:gap-4 max-md:border-0 max-md:py-1.5',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    c.className,
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
