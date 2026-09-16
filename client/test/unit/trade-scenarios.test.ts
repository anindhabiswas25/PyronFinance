// The sample trade, end to end through the real engine: real sealing, quote_ref signatures, reveal
// encryption, verifyReveal, offer checks and time-to-dismiss on mock-proved transactions. Only the
// chain, relays and wallet are the fixture adapters. Runs at speed 20 on real timers.

import { afterEach, describe, expect, it } from 'vitest';
import { NETWORKS } from '../../src/config/networks';
import { createFixturePorts, type FixturePorts } from '../fixtures';
import { FIXTURE_WALLET_RDNS } from '../fixtures/wallet';
import type { ScenarioName } from '../fixtures/scenario';
import { TradeEngine, receiptKey, type LocalReceipt } from '../../src/features/trade/engine';
import { useRfq, type QuoteRecord } from '../../src/state/rfq';

const SPEED = 20;
const network = NETWORKS.preprod;
const relays = network.defaultRelays;

let engine: TradeEngine | undefined;
let ports: FixturePorts | undefined;
afterEach(() => {
  engine?.dispose();
  ports?.chain.dispose();
  engine = undefined;
  ports = undefined;
});

const state = () => useRfq.getState().state;
const quotes = () => Object.values(state().quotes);

async function until<T>(what: string, fn: () => T | undefined | false, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await engine?.tick();
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; phase ${state().phase}, quotes ${JSON.stringify(quotes().map((q) => [q.verification, q.reveal, q.reason]))}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function start(scenario: ScenarioName, windowSecs = 120) {
  sessionStorage.clear();
  ports = createFixturePorts(network, scenario, SPEED);
  const pair = network.pairs[0].code;
  useRfq.getState().attach(ports.storage.session, pair);
  useRfq.getState().dispatch({ type: 'reset', pair });
  engine = new TradeEngine(ports, () => relays);
  await ports.wallet.connect(FIXTURE_WALLET_RDNS, network.walletNetworkId);
  await engine.request({ pair, side: 'sell', size: '1000', windowSecs });
  return ports;
}

/** The revealed quote paying the most (the taker sells), still valid. */
function bestRevealed(p: FixturePorts): QuoteRecord | undefined {
  const now = Math.floor(p.clock.nowMs() / 1000);
  return quotes()
    .filter((q) => q.reveal === 'revealed' && (q.validUntil ?? 0) > now)
    .sort((a, b) => (a.amount! > b.amount! ? -1 : 1))[0];
}

describe('sample trade scenarios', () => {
  it('happy: three seals, one fraudulent reveal caught, settles and saves a receipt', async () => {
    const p = await start('happy');
    expect(state().phase).toBe('sealed');
    await until('two reveals and a seal mismatch', () => quotes().filter((q) => q.reveal === 'revealed').length === 2 && quotes().some((q) => q.reveal === 'seal-mismatch'));

    const fraud = quotes().find((q) => q.reveal === 'seal-mismatch')!;
    expect(fraud.verification).toBe('on-chain');
    for (const q of quotes().filter((x) => x.reveal === 'revealed')) {
      expect(typeof q.amount).toBe('bigint');
      expect(q.offer?.fits).toBe(true);
    }

    const best = bestRevealed(p)!;
    await engine!.settle(best.quoteId);
    expect(state().failure).toBeUndefined();
    expect(state().phase).toBe('settled');
    const receipt = p.storage.session.get<LocalReceipt>(receiptKey(best.quoteId));
    expect(receipt?.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt?.amount).toBe(best.amount);
  }, 30_000);

  it('inputs-spent: the pre-check catches spent offer coins before the wallet is asked', async () => {
    const p = await start('inputs-spent');
    const target = await until('the second dealer’s reveal', () => quotes().find((q) => q.reveal === 'revealed' && q.terms?.price === '41.520000'));
    await engine!.settle(target.quoteId);
    expect(state().phase).toBe('failed');
    expect(state().failure?.reason).toBe('inputs-spent');
    expect(state().settlement?.stages.balance.status).toBe('pending');
    void p;
  }, 30_000);

  it('wallet-shape: an 8-coin wallet side fails time-to-dismiss and nothing is submitted', async () => {
    const p = await start('wallet-shape');
    await until('a reveal', () => bestRevealed(p));
    await engine!.settle(bestRevealed(p)!.quoteId);
    expect(state().failure?.reason).toBe('wallet-shape');
    expect(state().failure?.code).toBe(168);
    expect(state().settlement?.stages.submit.status).toBe('pending');
  }, 30_000);

  it('rejected: the node’s error code is kept', async () => {
    const p = await start('rejected');
    await until('a reveal', () => bestRevealed(p));
    await engine!.settle(bestRevealed(p)!.quoteId);
    expect(state().failure?.reason).toBe('rejected');
    expect(state().failure?.code).toBe(138);
  }, 30_000);

  it('no-quotes: the window closes with nothing to compare', async () => {
    await start('no-quotes', 60);
    await until('the window to close', () => state().view === 'compare' || state().phase === 'revealed');
    expect(quotes()).toHaveLength(0);
  }, 30_000);

  it('one-relay: the request is refused below two relays', async () => {
    await start('one-relay');
    expect(state().phase).not.toBe('sealed');
    expect(state().error).toMatch(/relay/i);
  });

  it('indexer-down: quotes pause as "can’t reach the chain", none are rejected', async () => {
    await start('indexer-down');
    await until('a chain error', () => state().chainError);
    await new Promise((r) => setTimeout(r, 2500));
    await engine!.tick();
    expect(quotes().filter((q) => q.verification === 'rejected')).toHaveLength(0);
    expect(state().chainError).toBeTruthy();
  }, 30_000);
});
