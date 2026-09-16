import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', wide = false, disabled = false): string {
  return cx(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold select-none transition-colors duration-hover',
    size === 'md' ? 'h-control px-5 text-14 rounded-btn' : 'h-control-sm px-[13px] text-13.5 rounded-btn-sm',
    wide && 'w-full',
    disabled
      ? 'bg-s2 text-dim border-transparent cursor-not-allowed'
      : variant === 'primary'
        ? 'bg-btn text-btntx border-transparent hover:opacity-90'
        : variant === 'secondary'
          ? 'bg-s2 text-tx border-line hover:border-mu'
          : variant === 'ghost'
            ? 'bg-transparent text-mu border-line hover:text-tx hover:border-mu'
            : 'bg-badbg text-bad border-transparent hover:border-bad',
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  wide?: boolean;
  /** Marks the button busy for assistive tech and blocks clicks. The label should name the stage. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', wide, busy, disabled, className, type = 'button', ...rest },
  ref,
) {
  const off = Boolean(disabled || busy);
  return (
    <button
      ref={ref}
      type={type}
      disabled={off}
      aria-busy={busy || undefined}
      className={cx(buttonClass(variant, size, wide, Boolean(disabled)), busy && 'cursor-progress', className)}
      {...rest}
    />
  );
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  wide?: boolean;
}

export function ButtonLink({ variant = 'secondary', size = 'md', wide, className, ...rest }: ButtonLinkProps) {
  return <Link className={cx(buttonClass(variant, size, wide), className)} {...rest} />;
}
