// Store-and-forward mailbox — RELAY.md §4: "the relay holds an opaque ciphertext blob ... The
// relay still cannot read it." This file proves that property structurally: the mailbox never
// parses, inspects, or depends on the *contents* of `ciphertext`, only the outer shape.

import { describe, expect, it } from 'vitest';
import { Mailbox, MAILBOX_MAX_ENTRIES_PER_RECIPIENT } from '../src/mailbox.js';
import { hexOf } from './helpers.js';

function entry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    type: 'reveal',
    quoteId: hexOf(0x11),
    ciphertext: Buffer.from('totally opaque bytes, not json, not readable').toString('base64'),
    sig: 'aa'.repeat(96),
    ...overrides,
  });
}

describe('Mailbox', () => {
  it('stores and returns an entry addressed to a recipient', () => {
    const mb = new Mailbox();
    const to = hexOf(0x22);
    const err = mb.put(to, entry());
    expect(err).toBeNull();
    const got = mb.take(to);
    expect(got).toHaveLength(1);
    expect(got[0].quoteId).toBe(hexOf(0x11));
  });

  it('take() clears the mailbox (standard pickup semantics)', () => {
    const mb = new Mailbox();
    const to = hexOf(0x22);
    mb.put(to, entry());
    mb.take(to);
    expect(mb.take(to)).toHaveLength(0);
  });

  it('rejects a recipient key that is not 32-byte hex', () => {
    const mb = new Mailbox();
    expect(mb.put('not-hex', entry())).toMatch(/32-byte hex/);
  });

  it('rejects malformed JSON without inspecting it further', () => {
    const mb = new Mailbox();
    expect(mb.put(hexOf(0x22), '{not json')).toMatch(/malformed JSON/);
  });

  it('rejects an entry missing required outer fields', () => {
    const mb = new Mailbox();
    expect(mb.put(hexOf(0x22), JSON.stringify({ v: 1, type: 'reveal' }))).not.toBeNull();
  });

  it('never inspects or validates the ciphertext contents — garbage bytes are accepted verbatim', () => {
    const mb = new Mailbox();
    const to = hexOf(0x22);
    const err = mb.put(to, entry({ ciphertext: 'not-even-valid-base64!!!' }));
    expect(err).toBeNull();
    expect(mb.take(to)[0].ciphertext).toBe('not-even-valid-base64!!!');
  });

  it('caps entries per recipient', () => {
    const mb = new Mailbox();
    const to = hexOf(0x22);
    for (let i = 0; i < MAILBOX_MAX_ENTRIES_PER_RECIPIENT; i++) {
      expect(mb.put(to, entry({ quoteId: i.toString(16).padStart(64, '0') }))).toBeNull();
    }
    expect(mb.put(to, entry())).toMatch(/full/);
  });

  it('sweepExpired drops entries past MAILBOX_TTL_MS', () => {
    const mb = new Mailbox();
    const to = hexOf(0x22);
    const now = Date.now();
    mb.put(to, entry(), now);
    const dropped = mb.sweepExpired(now + 91 * 60 * 1000);
    expect(dropped).toBe(1);
    expect(mb.take(to)).toHaveLength(0);
  });

  it('keeps entries for different recipients isolated', () => {
    const mb = new Mailbox();
    const toA = hexOf(0x22);
    const toB = hexOf(0x33);
    mb.put(toA, entry());
    expect(mb.take(toB)).toHaveLength(0);
    expect(mb.take(toA)).toHaveLength(1);
  });
});
