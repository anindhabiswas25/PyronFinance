// Crash-consistent quote journal — DEALER-NODE.md §3.1, task 3.3.
//
// THE RULE: the nonce, terms and Offer File are on disk, fsync'd, BEFORE the commit transaction is
// submitted. A node that commits and then loses its nonce cannot open its own commitment: it holds a
// live on-chain obligation it can never reveal, and its quote is indistinguishable from fraud.
//
// Format: one JSON record per line, append-only, fsync after every append.
//   { "seq": n, "ts": unix, "quoteId": hex, "kind": ..., ...fields, "sum": first-16-hex-of-sha256 }
// `sum` covers the record without `sum`. On replay:
//   * a torn FINAL line (crash mid-write) is ignored and truncated away — that append never completed,
//     so no transition it described can have been acted on (every action happens after its append);
//   * a bad checksum or broken sequence ANYWHERE ELSE is refused. Silently skipping a middle record
//     could drop the one that holds a nonce.
//
// States (per quote) and the only transitions allowed:
//
//   intent ──> submitted ──> committed ──> announced ──> revealed ──> settled ──> recorded
//     │            │             │             │             │
//     └─> abandoned└─> abandoned └──────────────┴─────────────┴──> expired ──> released
//
//   intent     terms, nonce, rfqId, validUntil, notional, quoteId, offer file + inputs persisted
//   submitted  commitQuote handed to the wallet (may or may not land)
//   committed  seen on-chain
//   announced  quote_ref gossiped
//   revealed   encrypted reveal delivered (direct or mailbox)
//   settled    the offer's settlement observed on-chain
//   recorded   recordSettlement landed
//   expired    validUntil passed unsettled
//   released   releaseExpiredQuote landed (after PROOF_GRACE_PERIOD)
//   closed     resolved on-chain by someone else (a permissionless release, or a Class A slash) —
//              the node must check its bond: a slash with halt_on_slash stops all quoting
//   abandoned  the commit never landed and can no longer land (validUntil passed) — nothing is owed
//
// Any committed-or-later state may also go to `closed`; it is drawn separately to keep the diagram legible.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type QuoteState =
  | 'intent'
  | 'submitted'
  | 'committed'
  | 'announced'
  | 'revealed'
  | 'settled'
  | 'recorded'
  | 'expired'
  | 'released'
  | 'closed'
  | 'abandoned';

const TRANSITIONS: Record<QuoteState, QuoteState[]> = {
  intent: ['submitted', 'abandoned'],
  // `committed` may be learned directly from the chain on recovery, hence intent -> committed below.
  submitted: ['committed', 'abandoned'],
  committed: ['announced', 'revealed', 'settled', 'expired', 'closed'],
  announced: ['revealed', 'settled', 'expired', 'closed'],
  revealed: ['settled', 'expired', 'closed'],
  settled: ['recorded', 'closed'],
  recorded: [],
  expired: ['released', 'settled', 'closed'],
  released: [],
  closed: [],
  abandoned: [],
};
// Recovery can find a commit on-chain whose `submitted` record was lost to the crash.
TRANSITIONS.intent.push('committed');

export const TERMINAL: ReadonlySet<QuoteState> = new Set(['recorded', 'released', 'closed', 'abandoned']);

export interface QuoteIntent {
  quoteId: string;
  rfqId: string;
  pair: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  /** Commitment-opening nonce, hex32. THE field this journal exists to keep. */
  nonce: string;
  commitment: string;
  validUntil: number;
  notional: string;
  offerFile: string;
  offerExpiresAt: number;
  /** Unshielded inputs the offer spends ("intentHash:outputNo"). Kept so recovery can report them.
   *  ~~After a restart the wallet's coin booking is gone~~ — corrected 2026-09-14: the wallet snapshot
   *  KEEPS bookings across restarts (pendingUtxos is serialised; nothing expires it). The real hazard is
   *  the reverse: a dead offer's coins stay booked forever unless reverted — see bin.ts unbookDeadOffers. */
  offerInputs: string[];
  takerEncPk: string;
  revealVia: 'direct' | 'mailbox';
  dealerEndpoint: string;
}

export interface QuoteRecord extends QuoteIntent {
  state: QuoteState;
  history: Array<{ state: QuoteState; ts: number; note?: string }>;
  txHash?: string;
  settlementTx?: string;
}

type Line =
  | ({ kind: 'intent'; seq: number; ts: number } & QuoteIntent)
  | { kind: 'transition'; seq: number; ts: number; quoteId: string; to: QuoteState; note?: string; txHash?: string; settlementTx?: string };

export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

function checksum(body: object): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
}

export interface JournalOptions {
  /** Test hook: called after the bytes are written and before fsync returns control — lets tests
   *  model a crash at the exact point a real one would matter. */
  onAppend?: (line: string) => void;
  now?: () => number;
}

export class QuoteJournal {
  private fd: number;
  private seq = 0;
  private readonly quotes = new Map<string, QuoteRecord>();
  private readonly now: () => number;

  private constructor(readonly file: string, private readonly options: JournalOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.replay();
    this.fd = fs.openSync(file, 'a', 0o600);
  }

  static open(file: string, options: JournalOptions = {}): QuoteJournal {
    return new QuoteJournal(file, options);
  }

  close(): void {
    fs.closeSync(this.fd);
  }

  get(quoteId: string): QuoteRecord | undefined {
    return this.quotes.get(quoteId);
  }

  all(): QuoteRecord[] {
    return [...this.quotes.values()];
  }

  live(): QuoteRecord[] {
    return this.all().filter((q) => !TERMINAL.has(q.state));
  }

  /** Persist a quote BEFORE its commit is submitted. Refuses a duplicate quoteId: re-journaling would
   *  let a second nonce shadow the first. */
  recordIntent(intent: QuoteIntent): QuoteRecord {
    for (const [k, v] of Object.entries({ quoteId: intent.quoteId, rfqId: intent.rfqId, nonce: intent.nonce, commitment: intent.commitment })) {
      if (!/^[0-9a-f]{64}$/.test(v)) throw new JournalError(`intent.${k} must be hex32`);
    }
    if (!intent.offerFile) throw new JournalError('intent.offerFile is required — without it a restarted node cannot reveal');
    if (this.quotes.has(intent.quoteId)) throw new JournalError(`quote ${intent.quoteId} already journaled`);
    const ts = this.now();
    this.append({ kind: 'intent', seq: this.seq + 1, ts, ...intent });
    const rec: QuoteRecord = { ...intent, state: 'intent', history: [{ state: 'intent', ts }] };
    this.quotes.set(intent.quoteId, rec);
    return rec;
  }

  transition(quoteId: string, to: QuoteState, extra: { note?: string; txHash?: string; settlementTx?: string } = {}): QuoteRecord {
    const rec = this.quotes.get(quoteId);
    if (!rec) throw new JournalError(`unknown quote ${quoteId}`);
    if (!TRANSITIONS[rec.state].includes(to)) throw new JournalError(`illegal transition ${rec.state} -> ${to} for ${quoteId}`);
    const ts = this.now();
    this.append({ kind: 'transition', seq: this.seq + 1, ts, quoteId, to, ...extra });
    apply(rec, to, ts, extra);
    return rec;
  }

  private append(line: Line): void {
    const text = JSON.stringify({ ...line, sum: checksum(line) }) + '\n';
    fs.writeSync(this.fd, text);
    fs.fsyncSync(this.fd);
    this.seq = line.seq;
    this.options.onAppend?.(text);
  }

  private replay(): void {
    if (!fs.existsSync(this.file)) return;
    const raw = fs.readFileSync(this.file, 'utf-8');
    const lines = raw.split('\n');
    const endsClean = raw.endsWith('\n') || raw.length === 0;
    let validBytes = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const isLast = i === lines.length - 1;
      if (text === '') {
        if (!isLast) throw new JournalError(`${this.file}: empty line ${i + 1} in the middle of the journal`);
        continue;
      }
      let parsed: (Line & { sum?: string }) | undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const torn = isLast && !endsClean;
      if (!parsed) {
        if (torn) break; // crash mid-append: the record never completed
        throw new JournalError(`${this.file}: line ${i + 1} is not valid JSON — refusing to guess`);
      }
      const { sum, ...body } = parsed;
      if (sum !== checksum(body)) {
        if (torn) break;
        throw new JournalError(`${this.file}: line ${i + 1} fails its checksum — refusing to replay a corrupt journal`);
      }
      if (body.seq !== this.seq + 1) throw new JournalError(`${this.file}: line ${i + 1} has seq ${body.seq}, expected ${this.seq + 1}`);
      this.seq = body.seq;
      if (body.kind === 'intent') {
        const { kind: _k, seq: _s, ts, ...intent } = body;
        this.quotes.set(intent.quoteId, { ...intent, state: 'intent', history: [{ state: 'intent', ts }] });
      } else {
        const rec = this.quotes.get(body.quoteId);
        if (!rec) throw new JournalError(`${this.file}: line ${i + 1} transitions unknown quote ${body.quoteId}`);
        if (!TRANSITIONS[rec.state].includes(body.to)) {
          throw new JournalError(`${this.file}: line ${i + 1} records illegal ${rec.state} -> ${body.to}`);
        }
        apply(rec, body.to, body.ts, body);
      }
      validBytes += Buffer.byteLength(text, 'utf-8') + 1;
    }
    if (validBytes < Buffer.byteLength(raw, 'utf-8')) {
      // Drop the torn tail so the next append starts on a clean line.
      fs.truncateSync(this.file, validBytes);
    }
  }
}

function apply(rec: QuoteRecord, to: QuoteState, ts: number, extra: { note?: string; txHash?: string; settlementTx?: string }): void {
  rec.state = to;
  rec.history.push({ state: to, ts, note: extra.note });
  if (extra.txHash) rec.txHash = extra.txHash;
  if (extra.settlementTx) rec.settlementTx = extra.settlementTx;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Recovery: what a restarted node must do for each non-terminal quote
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type OfferStatus = 'unspent' | 'settled' | 'spent-elsewhere';

export interface RecoveryChain {
  /** Does the chain hold this quote, and is it resolved? */
  quote(quoteId: string): Promise<{ resolved: boolean } | undefined>;
  /** What happened to the offer's inputs. `settled` means they were consumed by a transaction that
   *  contains this offer — the taker's settlement. `spent-elsewhere` means some OTHER transaction
   *  consumed them, which can only be this node's own wallet spending booked coins it had forgotten
   *  about: a double-spend of its own quote. The distinction matters because recordSettlement is
   *  dealer-attested — recording a settlement that never happened would falsify the public counter. */
  offerStatus(record: QuoteRecord): Promise<OfferStatus>;
  nowSecs(): number;
}

export type RecoveryAction =
  | { quoteId: string; action: 'reveal'; record: QuoteRecord }
  | { quoteId: string; action: 'await-commit'; record: QuoteRecord }
  | { quoteId: string; action: 'resubmit-commit'; record: QuoteRecord }
  | { quoteId: string; action: 'abandon'; record: QuoteRecord }
  | { quoteId: string; action: 'record-settlement'; record: QuoteRecord }
  | { quoteId: string; action: 'await-release'; record: QuoteRecord; releasableAt: number }
  | { quoteId: string; action: 'release'; record: QuoteRecord }
  | { quoteId: string; action: 'closed-externally'; record: QuoteRecord }
  | { quoteId: string; action: 'offer-invalidated'; record: QuoteRecord };

/** Mirrors the contract's PROOF_GRACE_PERIOD. */
export const PROOF_GRACE_PERIOD_SECS = 3600;

/** Decides, from journal + chain, what each live quote needs. Never discards a nonce: every action
 *  that leaves a quote live keeps its full record. Also returns every input a live offer may still
 *  spend, so the node keeps those coins out of new transactions until the quotes are terminal —
 *  after a restart the wallet's own booking of them is gone. */
export async function recover(
  journal: QuoteJournal,
  chain: RecoveryChain,
): Promise<{ actions: RecoveryAction[]; hostageInputs: string[] }> {
  const actions: RecoveryAction[] = [];
  const hostage = new Set<string>();
  const now = chain.nowSecs();
  const hold = (rec: QuoteRecord) => rec.offerInputs.forEach((i) => hostage.add(i));

  for (const rec of journal.live()) {
    const id = rec.quoteId;
    const onChain = await chain.quote(id);

    if (rec.state === 'intent' || rec.state === 'submitted') {
      if (!onChain) {
        if (now >= rec.validUntil) {
          journal.transition(id, 'abandoned', { note: 'recovered: commit never landed and can no longer land' });
          actions.push({ quoteId: id, action: 'abandon', record: rec });
        } else if (rec.state === 'intent') {
          // Crash between persist and submit. Nothing is owed yet; the nonce is intact either way.
          actions.push({ quoteId: id, action: 'resubmit-commit', record: rec });
          hold(rec);
        } else {
          // Submitted but not yet visible: it may still land. Wait, keeping everything.
          actions.push({ quoteId: id, action: 'await-commit', record: rec });
          hold(rec);
        }
        continue;
      }
      // The commit landed and the crash hid it. Adopt it; it is owed a reveal while live.
      journal.transition(id, 'committed', { note: 'recovered: found on-chain' });
    }

    const status = await chain.offerStatus(rec);

    if (rec.state === 'settled') {
      actions.push({ quoteId: id, action: 'record-settlement', record: rec });
      continue;
    }
    if (status === 'settled') {
      journal.transition(id, 'settled', { note: 'recovered: settlement containing this offer found on-chain' });
      actions.push({ quoteId: id, action: 'record-settlement', record: rec });
      continue;
    }
    if (onChain?.resolved) {
      journal.transition(id, 'closed', { note: 'recovered: resolved on-chain by another party (release or slash)' });
      actions.push({ quoteId: id, action: 'closed-externally', record: rec });
      continue;
    }
    if (status === 'spent-elsewhere') {
      // Never record this as a settlement. The quote can no longer be honoured; surface it loudly.
      actions.push({ quoteId: id, action: 'offer-invalidated', record: rec });
      if (rec.state !== 'expired' && now >= rec.validUntil) journal.transition(id, 'expired', { note: 'recovered: offer invalidated' });
      continue;
    }
    // Offer still unspent.
    if (now < rec.validUntil) {
      if (rec.state !== 'revealed') actions.push({ quoteId: id, action: 'reveal', record: rec });
      hold(rec);
      continue;
    }
    if (rec.state !== 'expired') journal.transition(id, 'expired', { note: 'recovered: past validUntil' });
    // The taker may still settle a live offer file after validUntil (it expires at offerExpiresAt),
    // so its inputs stay reserved until then.
    if (now < rec.offerExpiresAt) hold(rec);
    const releasableAt = rec.validUntil + PROOF_GRACE_PERIOD_SECS;
    actions.push(
      now >= releasableAt
        ? { quoteId: id, action: 'release', record: rec }
        : { quoteId: id, action: 'await-release', record: rec, releasableAt },
    );
  }
  return { actions, hostageInputs: [...hostage] };
}
