import { create } from 'zustand';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { toneDot, type Tone } from '../tone';

// Small confirmations only ("Copied", "Evidence saved"). Anything the user must act on — too few
// relays, a failed settlement — is shown inline where it happened, never only as a toast.

export interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push(toast: Omit<ToastItem, 'id'>, durationMs?: number): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(toast, durationMs = 4000) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    if (durationMs > 0) setTimeout(() => get().dismiss(id), durationMs);
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function toast(item: Omit<ToastItem, 'id'>, durationMs?: number): number {
  return useToasts.getState().push(item, durationMs);
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" aria-atomic="false" className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 sm:w-[360px] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="enter pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-s1 px-4 py-3 shadow-xl">
          <span aria-hidden="true" className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', toneDot[t.tone])} />
          <div className="flex-1 min-w-0">
            <p className="text-13.5 font-medium">{t.title}</p>
            {t.body && <p className="text-12.5 text-mu mt-0.5">{t.body}</p>}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-mu hover:text-tx">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
