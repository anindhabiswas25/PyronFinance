import { create } from 'zustand';

export type OverlayName = 'connect' | 'readiness' | 'tray' | 'relays' | 'fraud-proof' | 'disclosure';

export interface ReadinessParams {
  /** The taker's side of the base asset. */
  side?: 'buy' | 'sell';
  /** Size in base units. */
  size?: bigint;
}

/** What the fraud-proof and disclosure overlays act on. */
export interface OverlayTarget {
  quoteId: string;
}

interface OverlayState {
  open?: OverlayName;
  readiness: ReadinessParams;
  target?: OverlayTarget;
  show(name: OverlayName, readiness?: ReadinessParams): void;
  showFor(name: 'fraud-proof' | 'disclosure', target: OverlayTarget): void;
  close(): void;
}

export const useOverlays = create<OverlayState>((set) => ({
  readiness: {},
  show: (open, readiness) => set((s) => ({ open, readiness: readiness ?? s.readiness })),
  showFor: (open, target) => set({ open, target }),
  close: () => set({ open: undefined }),
}));
