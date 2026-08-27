// attachDisclosureNote — the programmable disclosure primitive (docs/DISCLOSURE.md).
//
// The contract deliberately knows nothing about auditors, recipients, or policy meaning. It
// enforces exactly one property, and that property is the entire value of the primitive:
//
//   "A disclosure note is provably tied to one specific settled trade, and to no other activity."
//
// If a note can be attached to a trade that never settled, that sentence is false and the
// guarantee DISCLOSURE.md advertises does not exist.

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, taker, bytes32, T0, DEALER_SK, TAKER_ADDR,
} from './harness.js';
import { deriveQuoteId } from '../../packages/sdk/src/domain.js';

const RFQ = bytes32(1);
const COMMITMENT = bytes32(2);
const CIPHERTEXT_HASH = bytes32(0xc1);
const RECIPIENT_HINT = bytes32(0xe1);
const POLICY_NAMED_RECIPIENT = 1n; // 0x0001 — the only shape in scope for M3

/** Bond, quote, and settle — producing a genuinely settled trade to attach a note to. */
function settledTrade() {
  const sim = new OTCSim();
  const cmt = bondDealer(sim);
  sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, COMMITMENT, BigInt(T0 + 600));
  const quoteId = deriveQuoteId(cmt, RFQ, COMMITMENT);
  sim.call(dealer(DEALER_SK), 'recordSettlement', quoteId, { is_some: false, value: bytes32(0) }, bytes32(0xab));
  return { sim, cmt, quoteId };
}

describe('attachDisclosureNote', () => {
  it('attaches a note to a settled trade', () => {
    const { sim, quoteId } = settledTrade();

    sim.call(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, CIPHERTEXT_HASH, POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);

    const note = sim.ledger.notes.lookup(quoteId);
    expect(Buffer.from(note.ciphertextHash)).toEqual(Buffer.from(CIPHERTEXT_HASH));
    expect(note.policyTag).toBe(POLICY_NAMED_RECIPIENT);
    expect(Buffer.from(note.recipientHint)).toEqual(Buffer.from(RECIPIENT_HINT));
  });

  it('stores only a hash — the note contents never reach the chain', () => {
    const { sim, quoteId } = settledTrade();
    sim.call(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, CIPHERTEXT_HASH, POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);

    const note = sim.ledger.notes.lookup(quoteId);
    // The ledger type has exactly three fields; there is nowhere for plaintext to hide.
    expect(Object.keys(note).sort()).toEqual(['ciphertextHash', 'policyTag', 'recipientHint']);
  });

  it('rejects a second note for the same trade — no substitution after the fact', () => {
    const { sim, quoteId } = settledTrade();
    sim.call(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, CIPHERTEXT_HASH, POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);

    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, bytes32(0xc2), POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);
    expect(msg).toMatch(/already attached/i);
  });

  // ── D5: the guarantee DISCLOSURE.md advertises ──────────────────────────
  it('rejects a note for a trade that does not exist', () => {
    const sim = new OTCSim();
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote',
      bytes32(0xdead), CIPHERTEXT_HASH, POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);
    expect(msg).toMatch(/unknown|not settled|no such/i);
  });

  it('rejects a note for a quote that has not settled', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', RFQ, COMMITMENT, BigInt(T0 + 600));
    const quoteId = deriveQuoteId(cmt, RFQ, COMMITMENT);

    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, CIPHERTEXT_HASH, POLICY_NAMED_RECIPIENT, RECIPIENT_HINT);
    expect(msg).toMatch(/not settled/i);
  });

  it('accepts any policyTag — the contract ascribes no meaning to it', () => {
    // Deferred shapes (time-delayed 0x0002, threshold 0x0003) must need no contract change.
    const { sim, quoteId } = settledTrade();
    sim.call(taker(TAKER_ADDR), 'attachDisclosureNote',
      quoteId, CIPHERTEXT_HASH, 0x0003n, RECIPIENT_HINT);
    expect(sim.ledger.notes.lookup(quoteId).policyTag).toBe(3n);
  });
});
