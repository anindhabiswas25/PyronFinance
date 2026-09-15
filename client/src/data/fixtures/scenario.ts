// The /trade fixture scenario: which outcome to play, and how fast. Chosen with ?scenario= and
// ?speed=, remembered for the tab so navigating away and back keeps the same story.

import type { Clock } from '../../design/clock';

export const SCENARIOS = ['happy', 'inputs-spent', 'wallet-shape', 'rejected', 'no-quotes', 'indexer-down', 'one-relay'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<ScenarioName, string> = {
  happy: 'Settles',
  'inputs-spent': "Dealer's coins already spent",
  'wallet-shape': 'Wallet needs a prep step',
  rejected: 'Node rejects the settlement',
  'no-quotes': 'No dealer answers',
  'indexer-down': 'Indexer unreachable',
  'one-relay': 'Only one relay connected',
};

/** Scenario timing, in scenario seconds from the RFQ being published. */
export const SCENARIO_TIMELINE = {
  relaysConnectMs: 600,
  /** Seal confirmations: dealer A, then B, then the fraud dealer, who reveals a mismatching price. */
  commits: [
    { role: 'a', confirmAfterSecs: 22, validitySecs: 300 },
    { role: 'b', confirmAfterSecs: 45, validitySecs: 95 },
    { role: 'fraud', confirmAfterSecs: 47, validitySecs: 300 },
  ],
  /** Reveal lands in the mailbox this long after its seal confirms. */
  revealAfterSecs: 2,
  /** Dealer B's quote expires while the taker compares (95 s validity). */
  settleSecs: 20,
} as const;

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

function session(): SessionLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

export function resolveScenario(search: string, store: SessionLike | undefined = session()): { scenario: ScenarioName; speed: number } {
  const params = new URLSearchParams(search);
  const read = (k: string) => {
    try {
      return store?.getItem(`pyron:fixture:${k}`) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string) => {
    try {
      store?.setItem(`pyron:fixture:${k}`, v);
    } catch {
      // ignore
    }
  };
  let scenario = params.get('scenario');
  if (scenario && (SCENARIOS as readonly string[]).includes(scenario)) write('scenario', scenario);
  else scenario = read('scenario');
  let speedText = params.get('speed');
  if (speedText && Number(speedText) > 0) write('speed', speedText);
  else speedText = read('speed');
  const speed = Math.min(60, Math.max(1, Number(speedText) || 1));
  return { scenario: (SCENARIOS as readonly string[]).includes(scenario ?? '') ? (scenario as ScenarioName) : 'happy', speed };
}

/** A clock that runs `speed` times faster than the wall clock from the moment it is created. */
export function scenarioClock(speed: number, base: () => number = () => Date.now()): Clock {
  const start = base();
  return { nowMs: () => start + (base() - start) * speed };
}
