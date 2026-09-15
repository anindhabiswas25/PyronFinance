import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { useModal } from './useModal';

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  initialFocusRef?: RefObject<HTMLElement>;
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocusRef }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModal(open, ref, onClose, initialFocusRef);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-scrim" style={{ animation: 'fade 220ms ease-out both' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'enter relative w-full max-h-[92vh] overflow-auto bg-s1 border border-line2 rounded-t-card sm:rounded-card shadow-2xl',
          size === 'sm' ? 'sm:max-w-[420px]' : size === 'lg' ? 'sm:max-w-[760px]' : 'sm:max-w-[560px]',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display font-semibold text-19">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-mu text-13.5 mt-1">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 grid place-items-center w-control-sm h-control-sm -mr-2 rounded-btn-sm text-mu hover:text-tx hover:bg-s2 transition-colors duration-hover"
          >
            <X size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 sm:px-6 pb-5">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 border-t border-line2 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
