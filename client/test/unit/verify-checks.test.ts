import { afterEach, describe, expect, it } from 'vitest';
import * as sdk from '@otc/sdk/browser';
import { NETWORKS } from '../../src/config/networks';
import { TradeEngine } from '../../src/features/trade/engine';
import { checkNote, checkReveal } from '../../src/features/verify/checks';
import { parseNoteInput, parseRevealInput } from '../../src/lib/verify-input';
import type { ChainPort, NoteView, QuoteView } from '../../src/data/ports';
import { useRfq } from '../../src/state/rfq';
import { createFixturePorts, type FixturePorts } from '../fixtures';
import { FIXTURE_WALLET_RDNS } from '../fixtures/wallet';

const network = NETWORKS.preprod;
let engine: TradeEngine | undefined;
let ports: FixturePorts | undefined;
afterEach(() => {
  engine?.dispose();
  ports?.chain.dispose();
});

async function revealsFromScenario() {
  sessionStorage.clear();
  ports = createFixturePorts(network, 'happy', 20);
  const pair = network.pairs[0].code;
  useRfq.getState().attach(ports.storage.session, pair);
  useRfq.getState().dispatch({ type: 'reset', pair });
  engine = new TradeEngine(ports, () => network.defaultRelays);
  await ports.wallet.connect(FIXTURE_WALLET_RDNS, network.walletNetworkId);
  await engine.request({ pair, side: 'sell', size: '1000', windowSecs: 120 });
  const deadline = Date.now() + 15_000;
  for (;;) {
    await engine.tick();
    const qs = Object.values(useRfq.getState().state.quotes);
    const fraud = qs.find((q) => q.reveal === 'seal-mismatch');
    const honest = qs.find((q) => q.reveal === 'revealed');
    if (fraud && honest) return { fraud, honest };
    if (Date.now() > deadline) throw new Error('scenario did not reveal');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const asInput = (q: { quoteId: string; dealerCmt: string; terms?: unknown; nonce?: string; signature?: string; message?: { sig: string } }) =>
  JSON.stringify({ quoteId: q.quoteId, dealerCmt: q.dealerCmt, terms: q.terms, nonce: q.nonce, signature: q.signature ?? q.message?.sig });

describe('parseRevealInput', () => {
  it('names every missing field', () => {
    const r = parseRevealInput('{"quoteId":"ab"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quoteId .* dealerCmt .* nonce .* signature .* terms/);
    expect(parseRevealInput('not json')).toEqual({ ok: false, error: 'That isn’t valid JSON.' });
  });

  it('reads failure evidence, taking the signature from the reveal message', () => {
    const e = {
      kind: 'pyron-failure-evidence',
      quoteId: 'a'.repeat(64),
      dealerCmt: 'b'.repeat(64),
      nonce: 'c'.repeat(64),
      revealMessage: { sig: 'd'.repeat(192) },
      terms: { pair: 'tNIGHT/TESTUSD', side: 'buy', price: '41.3', size: '0.001' },
      offerInputs: ['e'.repeat(64) + ':1'],
      failure: { reason: 'inputs-spent', detail: 'spent', spentBy: 'f'.repeat(64) },
    };
    const r = parseRevealInput(JSON.stringify(e));
    expect(r).toMatchObject({ ok: true, value: { kind: 'evidence', reveal: { signature: 'd'.repeat(192) }, offerInputs: [e.offerInputs[0]] } });
  });
});

describe('checkReveal', () => {
  it('finds provable fraud in the mismatched reveal, and an honest one in the rest', async () => {
    const { fraud, honest } = await revealsFromScenario();
    const now = Math.floor(ports!.clock.nowMs() / 1000);

    const f = parseRevealInput(asInput(fraud));
    if (!f.ok) throw new Error(f.error);
    const fr = await checkReveal(ports!.chain, f.value, now);
    expect(fr.verdict.kind).toBe('fraud');
    expect(Object.fromEntries(fr.rows.map((r) => [r.id, r.state]))).toMatchObject({ exists: 'pass', dealer: 'pass', signature: 'pass', seal: 'fail', unresolved: 'pass', window: 'pass' });

    const h = parseRevealInput(asInput(honest));
    if (!h.ok) throw new Error(h.error);
    const hr = await checkReveal(ports!.chain, h.value, now);
    expect(hr.verdict.kind).toBe('honest');
    expect(hr.rows.find((r) => r.id === 'seal')?.state).toBe('pass');

    // A tampered price is no longer signed by the dealer.
    const tampered = parseRevealInput(asInput({ ...honest, terms: { ...honest.terms!, price: '99.000000' } }));
    if (!tampered.ok) throw new Error(tampered.error);
    const tr = await checkReveal(ports!.chain, tampered.value, now);
    expect(tr.verdict.kind).toBe('not-signed');
    expect(tr.rows.find((r) => r.id === 'seal')?.state).toBe('unknown');
  }, 30_000);

  it('lets a chain failure throw instead of reporting a failed check', async () => {
    const chain = { quote: async () => Promise.reject(new Error('indexer down')), dealer: async () => Promise.reject(new Error('x')) } as unknown as ChainPort;
    const input = parseRevealInput(asInput({ quoteId: 'a'.repeat(64), dealerCmt: 'b'.repeat(64), terms: { pair: 'tNIGHT/TESTUSD', side: 'buy', price: '1', size: '1' }, nonce: 'c'.repeat(64), signature: 'd'.repeat(192) }));
    if (!input.ok) throw new Error(input.error);
    await expect(checkReveal(chain, input.value, 0)).rejects.toThrow('indexer down');
  });
});

describe('checkNote', () => {
  const tradeId = '7e'.repeat(32);
  const recipient = sdk.generateEncKeypair();
  const sealed = sdk.sealNote({ tradeId, pair: 'tNIGHT/TESTUSD', side: 'buy', price: '41.315680', size: '0.001', settledAt: 1_789_400_000, dealerCmt: '4f'.repeat(32), parties: {} }, recipient.pk);
  const onChain: NoteView = {
    tradeId,
    ciphertextHash: sdk.bytesToHex(sealed.attach.ciphertextHash),
    policyTag: 1,
    recipientHint: sdk.bytesToHex(sealed.attach.recipientHint),
  };
  const chainWith = (note: NoteView | undefined, quote: Partial<QuoteView> | undefined) =>
    ({
      snapshot: async () => ({ height: 1, view: { notes: new Map(note ? [[tradeId, note]] : []) } }),
      quote: async () => quote,
    }) as unknown as ChainPort;

  it('passes all checks for the intended recipient', async () => {
    const r = await checkNote(chainWith(onChain, { resolved: true }), sealed.blob, tradeId, recipient.sk);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual(['decrypt', 'attached', 'hash', 'policy', 'trade', 'resolved', 'hint']);
    expect(r.note?.price).toBe('41.315680');
  });

  it('tells a stranger the note isn’t addressed to their key', async () => {
    const r = await checkNote(chainWith(onChain, { resolved: true }), sealed.blob, tradeId, sdk.generateEncKeypair().sk);
    expect(r.ok).toBe(false);
    expect(r.rows[0]).toMatchObject({ state: 'fail', detail: 'This note isn’t addressed to this key.' });
    expect(r.rows.find((x) => x.id === 'hint')?.state).toBe('fail');
  });

  it('fails both the AEAD and the hash check for a tampered blob', async () => {
    const ct = sealed.blob.ct;
    const flipped = (ct[5] === 'A' ? 'B' : 'A');
    const tampered = { ...sealed.blob, ct: ct.slice(0, 5) + flipped + ct.slice(6) };
    const r = await checkNote(chainWith(onChain, { resolved: true }), tampered, tradeId, recipient.sk);
    expect(r.rows.find((x) => x.id === 'decrypt')?.state).toBe('fail');
    expect(r.rows.find((x) => x.id === 'hash')?.state).toBe('fail');
  });

  it('does not treat a decrypting note as evidence when nothing is attached on-chain', async () => {
    const r = await checkNote(chainWith(undefined, { resolved: false }), sealed.blob, tradeId, recipient.sk);
    expect(r.ok).toBe(false);
    expect(r.rows.find((x) => x.id === 'decrypt')?.state).toBe('pass');
    expect(r.rows.find((x) => x.id === 'attached')?.state).toBe('fail');
    expect(r.rows.find((x) => x.id === 'resolved')?.state).toBe('fail');
  });

  it('parses note files saved by this app', () => {
    const r = parseNoteInput(JSON.stringify({ kind: 'pyron-disclosure-note', v: 1, tradeId, blob: sealed.blob }));
    expect(r).toMatchObject({ ok: true, value: { tradeId, blob: sealed.blob } });
    expect(parseNoteInput('{"v":2}').ok).toBe(false);
  });
});
