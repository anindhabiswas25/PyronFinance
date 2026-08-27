// Optional store-and-forward mailbox for reveal ciphertexts — RELAY.md §4:
// "If a dealer cannot accept inbound connections ... a relay MAY offer a store-and-forward
// mailbox: the relay holds an opaque ciphertext blob addressed to `takerEncPk` and delivers it.
// The relay still cannot read it."
//
// This is deliberately NOT part of the gossip layer: reveal messages must never enter gossip
// (RELAY.md §4), so the mailbox is addressed by HTTP, not broadcast, dedup'd, or TTL-forwarded
// like rfq/quote_ref/cancel/peer_announce. See server.ts for the `POST/GET /mailbox/:takerEncPk`
// endpoints this backs, and RELAY.md §4's addition documenting the wire shape.
//
// The relay's only obligations are: store the blob verbatim, never inspect its contents beyond
// the outer envelope needed for size/shape limits, and expire it. It holds ciphertext it cannot
// decrypt — see test/mailbox.test.ts for the property this is meant to guarantee (a relay with
// only the mailbox contents cannot recover the plaintext reveal).

import { MAX_MSG_BYTES } from './schema.js';
import { isHexOfLength } from './bytes.js';

/** The opaque envelope a relay accepts into a mailbox. Structurally this mirrors the `reveal`
 *  message shape from RELAY.md §4 (`quoteId`, `ciphertext`, `sig`), but the relay treats
 *  `ciphertext` as an opaque base64 blob — it never attempts to decrypt it. */
export interface MailboxEntry {
  v: number;
  type: 'reveal';
  quoteId: string; // hex32 — used only for the recipient's own bookkeeping
  ciphertext: string; // base64, opaque to the relay
  sig: string; // hex, opaque to the relay (verified by the recipient, not the relay)
}

/** How long an undelivered mailbox entry is retained. Chosen to span one Offer File refresh
 *  cycle (~1h, docs/DEALER-NODE.md §5) plus slack — a placeholder like M1's `TIME_SLACK`, not
 *  tuned against real traffic. */
export const MAILBOX_TTL_MS = 90 * 60 * 1000;

/** Per-recipient cap so one abusive sender can't exhaust relay memory on behalf of a target
 *  pubkey it doesn't control. */
export const MAILBOX_MAX_ENTRIES_PER_RECIPIENT = 256;

function isValidMailboxEntry(v: unknown): v is MailboxEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    e.type === 'reveal' &&
    typeof e.v === 'number' &&
    isHexOfLength(e.quoteId, 32) &&
    typeof e.ciphertext === 'string' &&
    e.ciphertext.length > 0 &&
    typeof e.sig === 'string' &&
    e.sig.length > 0
  );
}

interface StoredEntry {
  entry: MailboxEntry;
  receivedAtMs: number;
}

export class Mailbox {
  private byRecipient = new Map<string, StoredEntry[]>();

  /** Stores a blob addressed to `takerEncPk` (hex32). Returns an error string on rejection,
   *  or null on success. Rejects on shape/size grounds only — never on content, since the relay
   *  cannot and must not interpret `ciphertext`. */
  put(takerEncPk: string, raw: string, nowMs: number = Date.now()): string | null {
    if (!isHexOfLength(takerEncPk, 32)) return 'recipient must be 32-byte hex';
    if (Buffer.byteLength(raw, 'utf8') > MAX_MSG_BYTES) return 'entry exceeds MAX_MSG_BYTES';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'malformed JSON';
    }
    if (!isValidMailboxEntry(parsed)) return 'malformed mailbox entry';

    const list = this.byRecipient.get(takerEncPk) ?? [];
    if (list.length >= MAILBOX_MAX_ENTRIES_PER_RECIPIENT) return 'recipient mailbox full';
    list.push({ entry: parsed, receivedAtMs: nowMs });
    this.byRecipient.set(takerEncPk, list);
    return null;
  }

  /** Fetches and clears all pending entries for a recipient (standard mailbox semantics: a
   *  delivered message is removed). */
  take(takerEncPk: string, nowMs: number = Date.now()): MailboxEntry[] {
    this.sweepOne(takerEncPk, nowMs);
    const list = this.byRecipient.get(takerEncPk) ?? [];
    this.byRecipient.delete(takerEncPk);
    return list.map((s) => s.entry);
  }

  private sweepOne(takerEncPk: string, nowMs: number): void {
    const list = this.byRecipient.get(takerEncPk);
    if (!list) return;
    const fresh = list.filter((s) => nowMs - s.receivedAtMs <= MAILBOX_TTL_MS);
    if (fresh.length === 0) this.byRecipient.delete(takerEncPk);
    else this.byRecipient.set(takerEncPk, fresh);
  }

  /** Expires stale entries across all recipients. Call periodically. */
  sweepExpired(nowMs: number = Date.now()): number {
    let dropped = 0;
    for (const [pk, list] of this.byRecipient) {
      const fresh = list.filter((s) => nowMs - s.receivedAtMs <= MAILBOX_TTL_MS);
      dropped += list.length - fresh.length;
      if (fresh.length === 0) this.byRecipient.delete(pk);
      else this.byRecipient.set(pk, fresh);
    }
    return dropped;
  }

  get recipientCount(): number {
    return this.byRecipient.size;
  }
}
