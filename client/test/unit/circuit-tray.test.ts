import { describe, expect, it, vi } from 'vitest';
import { NETWORKS } from '../../src/config/networks';
import { runCircuit } from '../../src/data/useCircuit';
import { useTray } from '../../src/state/tray';
import { createFixturePorts } from '../fixtures';

const ports = () => createFixturePorts(NETWORKS.preprod, 'happy', 50);
const release = { circuit: 'releaseExpiredQuote' as const, args: [new Uint8Array(32)] as [Uint8Array] };
const entry = (id: string) => useTray.getState().entries.find((e) => e.id === id)!;

describe('runCircuit', () => {
  it('mirrors every stage into the tray and finishes with the transaction', async () => {
    const p = ports();
    const out = await runCircuit(p, release, { title: 'Release quote', kind: 'release' });
    expect(out.ok).toBe(true);
    const e = entry(out.trayId);
    expect(e.status).toBe('done');
    expect(e.txHash).toBe('ab'.repeat(32));
    expect(e.stages.map((s) => [s.id, s.status])).toEqual([
      ['prepare', 'done'],
      ['prove', 'done'],
      ['balance', 'done'],
      ['submit', 'done'],
      ['confirm', 'done'],
    ]);
    expect(p.circuits.calls).toEqual([{ circuit: 'releaseExpiredQuote', args: [new Uint8Array(32)] }]);
  });

  it('reads the chain after a submit error and reports a landed action as done', async () => {
    const p = ports();
    p.circuits.failNext({ stage: 'submit', code: 104 });
    const landed = vi.fn(async () => true);
    const out = await runCircuit(p, release, { title: 'Release quote', kind: 'release', landed });
    expect(landed).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true, note: expect.stringContaining('node code 104') });
    const e = entry(out.trayId);
    expect(e.status).toBe('done');
    expect(e.stages.find((s) => s.id === 'confirm')).toMatchObject({ status: 'done', detail: 'Read back from the chain' });
  });

  it('never asks the chain when nothing was submitted', async () => {
    const p = ports();
    p.circuits.failNext({ stage: 'prove', message: 'User rejected' });
    const landed = vi.fn(async () => true);
    const out = await runCircuit(p, release, { title: 'Release quote', kind: 'release', landed });
    expect(landed).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, stage: 'prove', error: 'User rejected' });
    expect(entry(out.trayId).status).toBe('failed');
  });

  it('reports a rejection with its code and plain meaning when the action did not land', async () => {
    const p = ports();
    p.circuits.failNext({ stage: 'submit', code: 168, message: 'Transaction submission error' });
    const out = await runCircuit(p, release, { title: 'Release quote', kind: 'release', landed: async () => false });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(168);
      expect(out.error).toMatch(/node code 168: The transaction is too expensive to validate/);
    }
  });
});
