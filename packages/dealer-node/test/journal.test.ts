// B2 (task 3.3): the crash-consistent quote journal.
//
// The requirement under test: NO crash point may leave the node unable to reveal a quote that is
// live on-chain. The three crash points the task names are modelled by stopping the protocol step
// sequence at each point and reopening the journal from disk, exactly as a restarted process would.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuoteJournal, recover, JournalError, PROOF_GRACE_PERIOD_SECS, type OfferStatus, type QuoteIntent, type RecoveryChain } from '../src/journal.js';

const hex32 = (b: number) => b.toString(16).padStart(2, '0').repeat(32);
const T = 1_800_000_000;

function intent(n: number, over: Partial<QuoteIntent> = {}): QuoteIntent {
  return {
    quoteId: hex32(n),
    rfqId: hex32(n + 100),
    pair: 'tNIGHT/TESTUSD',
    side: 'buy',
    price: '41.44',
    size: '0.001',
    nonce: hex32(n + 50),
    commitment: hex32(n + 60),
    validUntil: T + 300,
    notional: '1000',
    offerFile: 'b2ZmZXI=',
    offerExpiresAt: T + 3600,
    offerInputs: [`${hex32(n + 70)}:0`],
    takerEncPk: hex32(n + 80),
    revealVia: 'mailbox',
    dealerEndpoint: 'http://127.0.0.1:18787',
    ...over,
  };
}

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dn-journal-')), 'journal.log');
}

/** A chain the test controls: which quotes landed, what happened to each offer, what time it is. */
function fakeChain(
  opts: { onChain?: Record<string, { resolved: boolean }>; offers?: Record<string, OfferStatus>; now?: number } = {},
): RecoveryChain {
  return {
    async quote(id) {
      return opts.onChain?.[id];
    },
    async offerStatus(rec) {
      return opts.offers?.[rec.quoteId] ?? 'unspent';
    },
    nowSecs: () => opts.now ?? T + 10,
  };
}

/** Everything a node needs to reveal, read back from a reopened journal. */
function canReveal(file: string, quoteId: string): boolean {
  const j = QuoteJournal.open(file, { now: () => T });
  const r = j.get(quoteId);
  j.close();
  return !!r && /^[0-9a-f]{64}$/.test(r.nonce) && !!r.offerFile && !!r.price && !!r.size && !!r.takerEncPk;
}

describe('QuoteJournal — persistence', () => {
  it('replays intents and transitions after a reopen', () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(1));
    j.transition(hex32(1), 'submitted');
    j.transition(hex32(1), 'committed', { txHash: hex32(9) });
    j.close();

    const r = QuoteJournal.open(file).get(hex32(1))!;
    expect(r.state).toBe('committed');
    expect(r.txHash).toBe(hex32(9));
    expect(r.nonce).toBe(hex32(51));
    expect(r.history.map((h) => h.state)).toEqual(['intent', 'submitted', 'committed']);
  });

  it('writes the intent to disk before recordIntent returns — the pre-submit persistence rule', () => {
    const file = tmpFile();
    let onDisk = '';
    const j = QuoteJournal.open(file, { now: () => T, onAppend: () => (onDisk = fs.readFileSync(file, 'utf-8')) });
    j.recordIntent(intent(2));
    expect(onDisk).toContain(hex32(52)); // the nonce was durable at append time
    j.close();
  });

  it('creates the journal 0600', () => {
    const file = tmpFile();
    QuoteJournal.open(file).close();
    fs.appendFileSync(file, '');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('REJECTS an illegal transition (committed -> recorded skips settlement)', () => {
    const j = QuoteJournal.open(tmpFile(), { now: () => T });
    j.recordIntent(intent(3));
    j.transition(hex32(3), 'submitted');
    j.transition(hex32(3), 'committed');
    expect(() => j.transition(hex32(3), 'recorded')).toThrow(/illegal transition/);
  });

  it('REJECTS a duplicate intent — a second nonce must never shadow the first', () => {
    const j = QuoteJournal.open(tmpFile(), { now: () => T });
    j.recordIntent(intent(4));
    expect(() => j.recordIntent(intent(4, { nonce: hex32(99) }))).toThrow(/already journaled/);
  });

  it('REJECTS an intent without an offer file', () => {
    const j = QuoteJournal.open(tmpFile(), { now: () => T });
    expect(() => j.recordIntent(intent(5, { offerFile: '' }))).toThrow(/offerFile/);
  });

  it('tolerates a torn final line and truncates it away', () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(6));
    j.close();
    fs.appendFileSync(file, '{"kind":"transition","seq":2,"quoteId":"'); // crash mid-write
    const r = QuoteJournal.open(file);
    expect(r.get(hex32(6))!.state).toBe('intent');
    r.transition(hex32(6), 'submitted'); // appends cleanly after the truncated tail
    r.close();
    expect(QuoteJournal.open(file).get(hex32(6))!.state).toBe('submitted');
  });

  it('REFUSES a corrupt record in the middle — never silently skip what may hold a nonce', () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(7));
    j.transition(hex32(7), 'submitted');
    j.close();
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines[0] = lines[0].replace(hex32(57), hex32(58)); // flip the nonce; checksum no longer matches
    fs.writeFileSync(file, lines.join('\n'));
    expect(() => QuoteJournal.open(file)).toThrow(JournalError);
  });

  it('REFUSES a gap in the sequence', () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(8));
    j.recordIntent(intent(9));
    j.close();
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    fs.writeFileSync(file, [lines[1], ''].join('\n'));
    expect(() => QuoteJournal.open(file)).toThrow(/seq/);
  });
});

describe('crash points — the node must always be able to reveal a live quote', () => {
  it('crash between PERSIST and SUBMIT: nothing on-chain, nonce intact, commit may be resubmitted', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(10));
    j.close(); // crash: commitQuote never handed to the wallet

    const reopened = QuoteJournal.open(file, { now: () => T + 5 });
    const { actions, hostageInputs } = await recover(reopened, fakeChain());
    expect(actions).toEqual([expect.objectContaining({ quoteId: hex32(10), action: 'resubmit-commit' })]);
    expect(hostageInputs).toEqual([`${hex32(80)}:0`]);
    expect(canReveal(file, hex32(10))).toBe(true);
  });

  it('crash between SUBMIT and CONFIRM, commit LANDED: adopted as committed and revealed', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(11));
    j.transition(hex32(11), 'submitted');
    j.close();

    const reopened = QuoteJournal.open(file, { now: () => T + 30 });
    const { actions } = await recover(reopened, fakeChain({ onChain: { [hex32(11)]: { resolved: false } } }));
    expect(reopened.get(hex32(11))!.state).toBe('committed');
    expect(actions).toEqual([expect.objectContaining({ quoteId: hex32(11), action: 'reveal' })]);
    expect(canReveal(file, hex32(11))).toBe(true);
  });

  it('crash between SUBMIT and CONFIRM, commit NOT YET VISIBLE: waits, keeps everything', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(12));
    j.transition(hex32(12), 'submitted');
    j.close();

    const { actions, hostageInputs } = await recover(QuoteJournal.open(file, { now: () => T + 30 }), fakeChain());
    expect(actions).toEqual([expect.objectContaining({ action: 'await-commit' })]);
    expect(hostageInputs).toHaveLength(1);
    expect(canReveal(file, hex32(12))).toBe(true);
  });

  it('crash between SUBMIT and CONFIRM, the commit can no longer land: abandoned, nothing owed', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(13));
    j.transition(hex32(13), 'submitted');
    j.close();

    const reopened = QuoteJournal.open(file);
    const { actions } = await recover(reopened, fakeChain({ now: T + 301 }));
    expect(actions).toEqual([expect.objectContaining({ action: 'abandon' })]);
    expect(reopened.get(hex32(13))!.state).toBe('abandoned');
  });

  it('crash between CONFIRM and REVEAL: the reveal is re-sent from the journal', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(14));
    j.transition(hex32(14), 'submitted');
    j.transition(hex32(14), 'committed');
    j.transition(hex32(14), 'announced');
    j.close();

    const { actions } = await recover(QuoteJournal.open(file), fakeChain({ onChain: { [hex32(14)]: { resolved: false } } }));
    expect(actions).toEqual([expect.objectContaining({ quoteId: hex32(14), action: 'reveal' })]);
    expect(canReveal(file, hex32(14))).toBe(true);
  });

  it('a revealed quote whose settlement is on-chain is recorded as settled', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(15));
    for (const s of ['submitted', 'committed', 'announced', 'revealed'] as const) j.transition(hex32(15), s);
    j.close();

    const reopened = QuoteJournal.open(file);
    const { actions } = await recover(reopened, fakeChain({ onChain: { [hex32(15)]: { resolved: false } }, offers: { [hex32(15)]: 'settled' } }));
    expect(reopened.get(hex32(15))!.state).toBe('settled');
    expect(actions).toEqual([expect.objectContaining({ action: 'record-settlement' })]);
  });

  it('NEVER records a settlement when the offer inputs were spent by some other transaction', async () => {
    // recordSettlement is dealer-attested: recording one that did not happen falsifies the public
    // settled counter. Inputs spent elsewhere mean this node double-spent its own offer.
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(18));
    for (const s of ['submitted', 'committed', 'revealed'] as const) j.transition(hex32(18), s);
    j.close();

    const reopened = QuoteJournal.open(file);
    const { actions, hostageInputs } = await recover(
      reopened,
      fakeChain({ onChain: { [hex32(18)]: { resolved: false } }, offers: { [hex32(18)]: 'spent-elsewhere' } }),
    );
    expect(actions).toEqual([expect.objectContaining({ action: 'offer-invalidated' })]);
    expect(reopened.get(hex32(18))!.state).not.toBe('settled');
    expect(hostageInputs).toEqual([]);
  });

  it('spent-elsewhere AFTER the Offer File expired is inventory reuse, not an invalidation', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(20));
    for (const s of ['submitted', 'committed', 'revealed'] as const) j.transition(hex32(20), s);
    j.close();

    const { actions } = await recover(
      QuoteJournal.open(file),
      fakeChain({ onChain: { [hex32(20)]: { resolved: false } }, offers: { [hex32(20)]: 'spent-elsewhere' }, now: T + 3600 + 1 }),
    );
    expect(actions.map((a) => a.action)).not.toContain('offer-invalidated');
    expect(actions).toEqual([expect.objectContaining({ action: 'await-release' })]);
  });

  it('a quote resolved on-chain by someone else is closed, and flagged for a bond check', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(19));
    for (const s of ['submitted', 'committed', 'revealed'] as const) j.transition(hex32(19), s);
    j.close();

    const reopened = QuoteJournal.open(file);
    const { actions } = await recover(reopened, fakeChain({ onChain: { [hex32(19)]: { resolved: true } } }));
    expect(actions).toEqual([expect.objectContaining({ action: 'closed-externally' })]);
    expect(reopened.get(hex32(19))!.state).toBe('closed');
  });

  it('an expired unsettled quote waits out the grace period, then is released', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(16));
    for (const s of ['submitted', 'committed', 'revealed'] as const) j.transition(hex32(16), s);
    j.close();

    const early = await recover(QuoteJournal.open(file), fakeChain({ onChain: { [hex32(16)]: { resolved: false } }, now: T + 400 }));
    expect(early.actions).toEqual([expect.objectContaining({ action: 'await-release', releasableAt: T + 300 + PROOF_GRACE_PERIOD_SECS })]);

    const late = await recover(QuoteJournal.open(file), fakeChain({ onChain: { [hex32(16)]: { resolved: false } }, now: T + 300 + PROOF_GRACE_PERIOD_SECS }));
    expect(late.actions).toEqual([expect.objectContaining({ action: 'release' })]);
  });

  it('terminal quotes produce no actions and hold no inputs hostage', async () => {
    const file = tmpFile();
    const j = QuoteJournal.open(file, { now: () => T });
    j.recordIntent(intent(17));
    for (const s of ['submitted', 'committed', 'revealed', 'settled', 'recorded'] as const) j.transition(hex32(17), s);
    j.close();
    expect(await recover(QuoteJournal.open(file), fakeChain())).toEqual({ actions: [], hostageInputs: [] });
  });
});
