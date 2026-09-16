import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// One clock for the whole app. Live mode reads the wall clock; fixture mode provides a scenario clock
// (with a speed factor) through the same context, so countdowns and "expired" states follow it.

export interface Clock {
  /** Milliseconds since the epoch, on this clock. */
  nowMs(): number;
}

export const wallClock: Clock = { nowMs: () => Date.now() };

const ClockContext = createContext<Clock>(wallClock);

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): Clock {
  return useContext(ClockContext);
}

/** Unix seconds on the app clock, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const clock = useClock();
  const [now, setNow] = useState(() => Math.floor(clock.nowMs() / 1000));
  useEffect(() => {
    setNow(Math.floor(clock.nowMs() / 1000));
    const id = setInterval(() => setNow(Math.floor(clock.nowMs() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [clock, intervalMs]);
  return now;
}
