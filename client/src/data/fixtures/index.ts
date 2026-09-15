import type { DataPorts } from '../ports';
import type { NetworkConfig } from '../../config/networks';
import { createStorage } from '../storage';
import { pendingRelays, pendingWallet } from '../pending';
import { buildDataset } from './dataset';
import { createFixtureChain, type FixtureChain } from './chain';
import { scenarioClock, type ScenarioName } from './scenario';

export interface FixturePorts extends DataPorts {
  chain: FixtureChain;
  scenario: ScenarioName;
  speed: number;
}

export function createFixturePorts(network: NetworkConfig, scenario: ScenarioName, speed: number): FixturePorts {
  const clock = scenarioClock(speed);
  const dataset = buildDataset(Math.floor(clock.nowMs() / 1000));
  return {
    source: 'fixture',
    network,
    scenario,
    speed,
    clock,
    chain: createFixtureChain({ dataset, clock, scenario, speed }),
    relays: pendingRelays(),
    wallet: pendingWallet('fixture'),
    // A separate namespace: sample data never lands in the live keys.
    storage: createStorage(`fixture:${network.id}`),
    capabilities: { settleInBrowser: 'unverified', circuitsInBrowser: true, inputSpentLookup: true },
  };
}
