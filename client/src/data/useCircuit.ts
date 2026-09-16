// Runs a contract circuit and mirrors every stage into the transaction tray. After a failure it asks
// the chain whether the action landed anyway before reporting it: live releases were reported as node
// code 104 by the wallet while landing (docs/ROADMAP.md, M3 run #3).

import type { CircuitCall, CircuitName, CircuitResult, CircuitStageId, DataPorts } from './ports';
import { useTray, type TrayKind } from '../state/tray';
import { CircuitError, WalletError, messageOf } from '../lib/errors';
import { nodeErrorMeaning } from '../lib/node-errors';

export const CIRCUIT_STAGES: Array<{ id: CircuitStageId; label: string }> = [
  { id: 'prepare', label: 'Runs on this device' },
  { id: 'prove', label: 'Wallet proves it' },
  { id: 'balance', label: 'Wallet adds the fee' },
  { id: 'submit', label: 'Submitting' },
  { id: 'confirm', label: 'Confirmed on-chain' },
];

export type CircuitOutcome =
  | { ok: true; result?: CircuitResult; trayId: string; note?: string }
  | { ok: false; trayId: string; error: string; stage?: CircuitStageId; code?: number };

export async function runCircuit<K extends CircuitName>(
  ports: Pick<DataPorts, 'circuits' | 'source'>,
  call: CircuitCall<K>,
  o: { title: string; kind: TrayKind; href?: string; ref?: string; landed?: () => Promise<boolean> },
): Promise<CircuitOutcome> {
  const tray = useTray.getState();
  const trayId = tray.start({
    kind: o.kind,
    title: o.title,
    source: ports.source,
    href: o.href,
    ref: o.ref,
    stages: CIRCUIT_STAGES.map((s) => ({ ...s, status: 'pending' as const })),
  });
  try {
    const result = await ports.circuits.run(call, (stage, status, detail) => useTray.getState().stage(trayId, stage, { status, detail }));
    useTray.getState().finish(trayId, { txHash: result.txHash });
    return { ok: true, result, trayId };
  } catch (err) {
    const stage = err instanceof CircuitError ? err.stage : undefined;
    const code = err instanceof CircuitError ? err.code : undefined;
    // Only a submitted transaction can have landed.
    if (o.landed && (stage === 'submit' || stage === 'confirm')) {
      try {
        if (await o.landed()) {
          const note = `Landed on-chain; the wallet still reported an error${code !== undefined ? ` (node code ${code})` : ''}.`;
          useTray.getState().stage(trayId, 'confirm', { status: 'done', detail: 'Read back from the chain' });
          useTray.getState().finish(trayId, { error: undefined });
          return { ok: true, trayId, note };
        }
      } catch {
        // The chain can't be read either: report the original failure.
      }
    }
    const meaning = code !== undefined ? nodeErrorMeaning(code) : undefined;
    const error =
      err instanceof WalletError
        ? err.message
        : `${messageOf(err)}${code !== undefined ? ` (node code ${code}${meaning ? `: ${meaning}` : ''})` : ''}`;
    useTray.getState().fail(trayId, error);
    return { ok: false, trayId, error, stage, code };
  }
}
