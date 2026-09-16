// The one trade engine the shell runs (features/trade/TradeRuntime.tsx). A store, so /trade and the
// notification centre drive the same engine. Type-only imports keep the SDK out of the shell chunk.

import { create } from 'zustand';
import type { TradeEngine } from '../features/trade/engine';
import type { DataPorts } from '../data/ports';

interface TradeRuntimeState {
  engine?: TradeEngine;
  /** The ports the engine was built on; an engine for another network is never used. */
  ports?: DataPorts;
}

export const useTradeRuntime = create<TradeRuntimeState>(() => ({}));

/** The engine for these ports, if the shell has loaded it. */
export function engineFor(ports: DataPorts): TradeEngine | undefined {
  const { engine, ports: built } = useTradeRuntime.getState();
  return built === ports ? engine : undefined;
}
