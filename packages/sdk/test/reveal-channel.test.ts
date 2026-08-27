// Point-to-point encrypted reveal channel (docs/RELAY.md §4). CLAUDE.md's M2 testing expectations
// call these out specifically: "the intended taker decrypts; a different party fails; a tampered
// ciphertext fails the AEAD check. A mailbox relay must be shown to hold only an opaque blob it
// cannot read."

import { describe, expect, it } from 'vitest';
import { sealQuote, buildReveal } from '../src/quotes.js';
import type { QuoteTerms } from '../src/terms.js';
import {
  generateEncKeypair,
  encryptReveal,
  decryptReveal,
  plaintextToTerms,
  RevealDecryptError,
} from '../src/reveal-channel.js';

const TERMS: QuoteTerms = { pair: 'tNIGHT/USDM', side: 'sell', price: '0.0412', size: '1000.0' };
const RFQ = new Uint8Array(32).fill(9);
const DEALER_SK = 0x5eed_1234_5678_9abcn;
const QUOTE_ID = new Uint8Array(32).fill(7);
const FUTURE = Math.floor(Date.now() / 1000) + 600;

function buildFixture() {
  const sealed = sealQuote(TERMS, RFQ, 1n);
  const reveal = buildReveal(sealed, DEALER_SK, 'zswap-offer-file-b64', FUTURE);
  const dealerEnc = generateEncKeypair();
  const takerEnc = generateEncKeypair();
  const msg = encryptReveal(QUOTE_ID, reveal, dealerEnc.sk, takerEnc.pk);
  return { sealed, reveal, dealerEnc, takerEnc, msg };
}

describe('encryptReveal / decryptReveal', () => {
  it('the intended taker decrypts and recovers the exact plaintext terms', () => {
    const { reveal, dealerEnc, takerEnc, msg } = buildFixture();
    const { plaintext } = decryptReveal(msg, takerEnc.sk, dealerEnc.pk);
    expect(plaintext.pair).toBe(TERMS.pair);
    expect(plaintext.side).toBe(TERMS.side);
    expect(plaintext.price).toBe(TERMS.price);
    expect(plaintext.size).toBe(TERMS.size);
    expect(plaintext.nonce).toBe(Buffer.from(reveal.nonce).toString('hex'));
    expect(plaintext.offerFile).toBe('zswap-offer-file-b64');
    expect(plaintextToTerms(plaintext)).toEqual(TERMS);
  });

  it('a different party (wrong taker key) fails to decrypt', () => {
    const { dealerEnc, msg } = buildFixture();
    const impostor = generateEncKeypair();
    expect(() => decryptReveal(msg, impostor.sk, dealerEnc.pk)).toThrow(RevealDecryptError);
  });

  it('a different party (correct taker key, wrong claimed dealer key) fails to decrypt', () => {
    const { takerEnc, msg } = buildFixture();
    const impostorDealer = generateEncKeypair();
    expect(() => decryptReveal(msg, takerEnc.sk, impostorDealer.pk)).toThrow(RevealDecryptError);
  });

  it('a tampered ciphertext fails the AEAD check', () => {
    const { dealerEnc, takerEnc, msg } = buildFixture();
    const blob = Buffer.from(msg.ciphertext, 'base64');
    blob[blob.length - 1] ^= 0xff; // flip a bit inside the auth tag
    const tampered = { ...msg, ciphertext: blob.toString('base64') };
    expect(() => decryptReveal(tampered, takerEnc.sk, dealerEnc.pk)).toThrow(RevealDecryptError);
  });

  it('a tampered ciphertext body (not just the tag) also fails the AEAD check', () => {
    const { dealerEnc, takerEnc, msg } = buildFixture();
    const blob = Buffer.from(msg.ciphertext, 'base64');
    blob[15] ^= 0xff; // flip a bit inside the actual ciphertext, well before the tag
    const tampered = { ...msg, ciphertext: blob.toString('base64') };
    expect(() => decryptReveal(tampered, takerEnc.sk, dealerEnc.pk)).toThrow(RevealDecryptError);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (fresh nonce)', () => {
    const sealed = sealQuote(TERMS, RFQ, 1n);
    const reveal = buildReveal(sealed, DEALER_SK, 'offer-b64', FUTURE);
    const dealerEnc = generateEncKeypair();
    const takerEnc = generateEncKeypair();
    const a = encryptReveal(QUOTE_ID, reveal, dealerEnc.sk, takerEnc.pk);
    const b = encryptReveal(QUOTE_ID, reveal, dealerEnc.sk, takerEnc.pk);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('carries the dealer signature over the plaintext terms alongside the ciphertext, unencrypted', () => {
    const { reveal, msg } = buildFixture();
    // The signature must be independently checkable without decrypting anything — it's what
    // makes a mismatching reveal non-repudiable Class-A fraud evidence (RELAY.md §4).
    expect(msg.sig).toHaveLength(192);
    expect(msg.sig).toMatch(/^[0-9a-f]+$/);
    void reveal;
  });
});

describe('mailbox relay holds only an opaque blob it cannot read', () => {
  it('the raw wire message reveals nothing about price/size without the taker key', () => {
    const { msg } = buildFixture();
    const raw = JSON.stringify(msg);
    expect(raw).not.toContain(TERMS.price);
    expect(raw).not.toContain(TERMS.size);
    expect(raw).not.toContain(TERMS.pair);
  });

  it('a relay operator with only the stored ciphertext and no taker key cannot decrypt it', () => {
    const { msg } = buildFixture();
    // The relay never holds takerEncSk — it only ever sees the public takerEncPk from the RFQ.
    // Simulate a relay operator attempting decryption with an unrelated keypair.
    const relayAttemptKey = generateEncKeypair();
    const someUnrelatedDealerPk = generateEncKeypair().pk;
    expect(() => decryptReveal(msg, relayAttemptKey.sk, someUnrelatedDealerPk)).toThrow(RevealDecryptError);
  });
});
