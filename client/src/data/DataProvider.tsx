import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ClockProvider } from '../design/clock';
import { networkConfig, type NetworkConfig } from '../config/networks';
import { useNetwork } from '../state/network';
import type { DataPorts } from './ports';
import { createLivePorts } from './live';

export type PortsFactory = (network: NetworkConfig) => DataPorts;

/** The app always reads the real chain, relays and wallet. Tests provide a fixture factory here. */
export const PortsFactoryContext = createContext<PortsFactory>(createLivePorts);

const DataContext = createContext<DataPorts | null>(null);

/** Builds the data adapters for the selected network. Pages use `useData()` and never import an adapter. */
export function DataProvider({ children }: { children: ReactNode }) {
  const factory = useContext(PortsFactoryContext);
  const networkId = useNetwork((s) => s.network);
  const ports = useMemo(() => factory(networkConfig(networkId)), [factory, networkId]);

  useEffect(
    () => () => {
      void ports.relays.close();
      ports.dispose?.();
    },
    [ports],
  );

  return (
    <DataContext.Provider value={ports}>
      <ClockProvider clock={ports.clock}>{children}</ClockProvider>
    </DataContext.Provider>
  );
}

export function useData(): DataPorts {
  const ports = useContext(DataContext);
  if (!ports) throw new Error('useData() needs a <DataProvider> above it');
  return ports;
}
