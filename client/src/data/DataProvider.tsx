import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ClockProvider } from '../design/clock';
import { networkConfig } from '../config/networks';
import { useDataSource } from '../app/dataSource';
import { useNetwork } from '../state/network';
import type { DataPorts } from './ports';
import { createFixturePorts, type FixturePorts } from './fixtures';
import { createLivePorts } from './live';
import { resolveScenario } from './fixtures/scenario';

const DataContext = createContext<DataPorts | null>(null);

/** Picks live or fixture adapters from VITE_DATA_SOURCE and ?data=, per network. Pages use `useData()`
 *  and never import an adapter. */
export function DataProvider({ children }: { children: ReactNode }) {
  const source = useDataSource();
  const networkId = useNetwork((s) => s.network);
  const { search } = useLocation();
  const { scenario, speed } = useMemo(() => resolveScenario(search), [search]);
  const fixtureKey = source === 'fixture' ? `${scenario}:${speed}` : '';

  const ports = useMemo<DataPorts>(() => {
    const network = networkConfig(networkId);
    return source === 'fixture' ? createFixturePorts(network, scenario, speed) : createLivePorts(network);
    // fixtureKey stands for scenario + speed, so a same-valued re-render keeps the same ports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, networkId, fixtureKey]);

  useEffect(
    () => () => {
      void ports.relays.close();
      if (ports.source === 'fixture') (ports as FixturePorts).chain.dispose();
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
