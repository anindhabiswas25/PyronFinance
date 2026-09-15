import type { DataPorts } from '../../src/data/ports';
import type { NetworkConfig } from '../../src/config/networks';
import { createStorage } from '../../src/data/storage';
import { buildDataset } from './dataset';
import { createFixtureChain, type FixtureChain } from './chain';
import { createFixtureRelays, type FixtureRelays } from './relays';
import { createFixtureWallet, type FixtureWallet } from './wallet';
import { scenarioClock, type ScenarioName } from './scenario';
import { startFixtureTrade } from './trade';

export interface FixturePorts extends DataPorts {
  chain: FixtureChain;
  relays: FixtureRelays;
  wallet: FixtureWallet;
  scenario: ScenarioName;
  speed: number;
}

export function createFixturePorts(network: NetworkConfig, scenario: ScenarioName, speed: number): FixturePorts {
  const clock = scenarioClock(speed);
  const dataset = buildDataset(Math.floor(clock.nowMs() / 1000));
  // A separate namespace: sample data never lands in the live keys.
  const storage = createStorage(`fixture:${network.id}`);
  const chain = createFixtureChain({ dataset, clock, scenario, speed });
  const ports: FixturePorts = {
    source: 'fixture',
    network,
    scenario,
    speed,
    clock,
    chain,
    relays: createFixtureRelays({ scenario, session: storage.session, speed }),
    wallet: createFixtureWallet({ network, scenario, speed }),
    storage,
    capabilities: { settleInBrowser: 'unverified', circuitsInBrowser: true, inputSpentLookup: true },
    pollMs: speed >= 5 ? 500 : 2000,
    startCounterparties: (rfq, { resume }) => startFixtureTrade(ports, rfq, { resume }),
    dispose: () => chain.dispose(),
  };
  return ports;
}
