// @vitest-environment node
// Reaches the public Preprod indexer. Run with: PYRON_LIVE=1 pnpm --filter @otc/client test chain.live
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createLiveChain } from '../../src/data/live/chain';
import { NETWORKS } from '../../src/config/networks';
import { createStorage } from '../../src/data/storage';
import { tallyEvents } from '../../src/data/derive-events';
import type { ProtocolEvent } from '../../src/data/ports';

it('replays Preprod contract events and agrees with the ledger', async () => {
  const n = NETWORKS.preprod;
  const chain = createLiveChain({ networkId: 'preprod', indexerHttp: n.indexerHttp, indexerWs: n.indexerWs, contractAddress: n.contractAddress, deployHeight: n.deployHeight, store: createStorage('live-test').idb });
  const t0 = Date.now();
  const snap = await chain.snapshot();
  console.log(`snapshot at ${snap.height} in ${Date.now() - t0} ms: ${snap.view.bonds.size} bonds, ${snap.view.quotes.size} quotes, ${snap.view.notes.size} notes, burned ${snap.view.burnedTotal}`);
  const all: ProtocolEvent[] = [];
  const ctrl = new AbortController();
  const t1 = Date.now();
  for await (const u of chain.events({ signal: ctrl.signal })) {
    all.push(...u.events);
    if (u.live) break;
  }
  ctrl.abort();
  const kinds = new Map<string, number>();
  for (const e of all) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  console.log(`replayed ${all.length} events in ${Date.now() - t1} ms:`, Object.fromEntries(kinds));
  for (const e of all.filter((x) => x.kind === 'unrecognized').slice(0, 5)) console.log('unrecognized', e.entryPoint, (e as { detail: string }).detail);
  const tally = tallyEvents(all);
  const view = (await chain.snapshot()).view;
  let mismatches = 0;
  for (const [cmt, settled] of view.settled) if ((tally.settled.get(cmt) ?? 0n) !== settled) mismatches++;
  console.log(`settled counter mismatches: ${mismatches} of ${view.settled.size}; burned events ${tally.burned} vs ledger ${view.burnedTotal}`);
  if (process.env.PYRON_LIVE_OUT) {
    writeFileSync(
      process.env.PYRON_LIVE_OUT,
      JSON.stringify({ snapshotHeight: snap.height, bonds: snap.view.bonds.size, quotes: snap.view.quotes.size, notes: snap.view.notes.size, burnedTotal: String(view.burnedTotal), events: all.length, kinds: Object.fromEntries(kinds), settledMismatches: mismatches, burnedFromEvents: String(tally.burned), replayMs: Date.now() - t1 }, null, 2),
    );
  }
  expect(all.length).toBeGreaterThan(0);
  expect(kinds.get('unrecognized') ?? 0).toBe(0);
  expect(mismatches).toBe(0);
  expect(tally.burned).toBe(view.burnedTotal);
}, 240_000);
