import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { useModal } from './useModal';

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  side?: 'left' | 'right';
  width?: number;
  footer?: ReactNode;
}

export function Drawer({ open, onClose, title, children, side = 'right', width = 420, footer }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, ref, onClose);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-scrim" style={{ animation: 'fade 220ms ease-out both' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100vw)`, animation: 'fade 220ms ease-out both' }}
        className={cx('absolute top-0 bottom-0 flex flex-col bg-s1 border-line2 shadow-2xl', side === 'right' ? 'right-0 border-l' : 'left-0 border-r')}
      >
        <div className="flex items-center justify-between gap-4 px-5 h-[60px] border-b border-line2 shrink-0">
          <h2 id={titleId} className="font-display font-semibold text-15">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-control-sm h-control-sm -mr-2 rounded-btn-sm text-mu hover:text-tx hover:bg-s2 transition-colors duration-hover"
          >
            <X size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="border-t border-line2 p-4 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
