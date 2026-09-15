// Simulated contract circuits for tests: every stage reports in order, and a test can make one fail.

import type { CircuitPort, CircuitStageId } from '../../src/data/ports';
import { CircuitError } from '../../src/lib/errors';

export interface FixtureCircuits extends CircuitPort {
  /** The next run fails at `stage` (with the node's `code`), then the failure clears. */
  failNext(failure: { stage: CircuitStageId; code?: number; message?: string }): void;
  readonly calls: Array<{ circuit: string; args: unknown[] }>;
}

const STAGES: CircuitStageId[] = ['prepare', 'prove', 'balance', 'submit', 'confirm'];

export function createFixtureCircuits(o: { speed?: number } = {}): FixtureCircuits {
  let failure: { stage: CircuitStageId; code?: number; message?: string } | undefined;
  const calls: Array<{ circuit: string; args: unknown[] }> = [];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms / Math.max(1, o.speed ?? 1)));
  return {
    calls,
    failNext(f) {
      failure = f;
    },
    async run(call, onStage) {
      calls.push({ circuit: call.circuit, args: [...call.args] });
      const f = failure;
      failure = undefined;
      for (const stage of STAGES) {
        onStage(stage, 'active');
        await wait(300);
        if (f?.stage === stage) {
          const message = f.message ?? `Sample ${stage} failure`;
          onStage(stage, 'failed', message);
          throw new CircuitError(message, stage, f.code);
        }
        onStage(stage, 'done');
      }
      return { txHash: 'ab'.repeat(32), blockHeight: 2_550_000, identifier: 'cd'.repeat(33) };
    },
  };
}
