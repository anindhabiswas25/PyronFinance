import { create } from 'zustand';

export type OverlayName = 'connect' | 'readiness' | 'tray' | 'relays';

export interface ReadinessParams {
  /** The taker's side of the base asset. */
  side?: 'buy' | 'sell';
  /** Size in base units. */
  size?: bigint;
}

interface OverlayState {
  open?: OverlayName;
  readiness: ReadinessParams;
  show(name: OverlayName, readiness?: ReadinessParams): void;
  close(): void;
}

export const useOverlays = create<OverlayState>((set) => ({
  readiness: {},
  show: (open, readiness) => set((s) => ({ open, readiness: readiness ?? s.readiness })),
  close: () => set({ open: undefined }),
}));
