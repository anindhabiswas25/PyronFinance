import type { DataPorts } from '../ports';
import type { NetworkConfig } from '../../config/networks';
import { createStorage } from '../storage';
import { buildDataset } from './dataset';
import { createFixtureChain, type FixtureChain } from './chain';
import { createFixtureRelays, type FixtureRelays } from './relays';
import { createFixtureWallet, type FixtureWallet } from './wallet';
import { scenarioClock, type ScenarioName } from './scenario';

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
  return {
    source: 'fixture',
    network,
    scenario,
    speed,
    clock,
    chain: createFixtureChain({ dataset, clock, scenario, speed }),
    relays: createFixtureRelays({ scenario, session: storage.session, speed }),
    wallet: createFixtureWallet({ network, scenario, speed }),
    storage,
    capabilities: { settleInBrowser: 'unverified', circuitsInBrowser: true, inputSpentLookup: true },
  };
}
