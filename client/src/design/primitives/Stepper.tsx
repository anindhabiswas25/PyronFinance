import { Check } from 'lucide-react';
import { cx } from '../cx';

export interface StepperProps {
  steps: readonly string[];
  /** Index of the current step. Steps before it are done. */
  current: number;
  label?: string;
  className?: string;
  /** Steps that can be opened; they render as buttons. The current step never does. */
  canSelect?(index: number): boolean;
  onSelect?(index: number): void;
}

export function Stepper({ steps, current, label = 'Progress', className, canSelect, onSelect }: StepperProps) {
  return (
    <ol aria-label={label} className={cx('flex items-center gap-2.5 flex-wrap', className)}>
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'on' : 'todo';
        const selectable = state !== 'on' && Boolean(onSelect && canSelect?.(i));
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cx(
                'w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] border',
                state === 'on' && 'bg-tx text-bg border-transparent',
                state === 'done' && 'bg-okbg text-ok border-transparent',
                state === 'todo' && 'border-line',
              )}
            >
              {state === 'done' ? <Check size={12} strokeWidth={2.2} /> : i + 1}
            </span>
            {step}
            <span className="sr-only">{state === 'done' ? ', done' : state === 'on' ? ', current step' : ', not started'}</span>
          </>
        );
        const itemClass = cx('flex items-center gap-2 text-13.5 font-medium whitespace-nowrap', state === 'on' ? 'text-tx' : 'text-mu');
        return (
          <li key={step} className="flex items-center gap-2.5" aria-current={state === 'on' ? 'step' : undefined}>
            {i > 0 && <span aria-hidden="true" className="w-4 sm:w-9 h-px bg-line" />}
            {selectable ? (
              <button type="button" onClick={() => onSelect!(i)} className={cx(itemClass, 'rounded-btn-sm hover:text-tx underline-offset-4 hover:underline')}>
                {content}
              </button>
            ) : (
              <span className={itemClass}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
