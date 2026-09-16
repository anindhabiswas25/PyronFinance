import { useEffect, useRef, type RefObject } from 'react';

// Shared by Dialog and Drawer: focus moves inside on open, Tab is trapped, Esc closes, and focus
// returns to whatever opened it. Only the top-most open modal reacts to keys.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: symbol[] = [];

export function useModal(
  open: boolean,
  containerRef: RefObject<HTMLElement>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    stack.push(token);
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;

    const focusables = (): HTMLElement[] =>
      // Not a layout check (offsetParent): jsdom has no layout, and a layout-based filter silently
      // shrinks the trap to one element there. Hidden subtrees are excluded by attribute instead.
      container
        ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden], [aria-hidden="true"], [inert]'))
        : [];

    const first = initialFocusRef?.current ?? focusables()[0] ?? container;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token || !container) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const head = els[0];
      const tail = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === head || !container.contains(active))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (active === tail || !container.contains(active))) {
        e.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const at = stack.indexOf(token);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) document.body.style.overflow = overflow;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
    // The modal's identity is its open state; re-running on every render would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** True while any modal is open — global shortcuts (T, 1–9, /) stay quiet then. */
export function anyModalOpen(): boolean {
  return stack.length > 0;
}
