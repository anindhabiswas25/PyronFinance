import { cx } from '../cx';
import { formatUnits, type FormatUnitsOptions } from '../../lib/format';

export interface AmountProps extends FormatUnitsOptions {
  /** Base units. */
  value: bigint;
  decimals: number;
  symbol?: string;
  className?: string;
}

export function Amount({ value, decimals, symbol, className, ...format }: AmountProps) {
  return (
    <span className={cx('tabular-nums whitespace-nowrap', className)}>
      {formatUnits(value, decimals, format)}
      {symbol && <span className="text-mu"> {symbol}</span>}
    </span>
  );
}
