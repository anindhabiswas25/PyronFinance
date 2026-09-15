// Browsers have no `Buffer` global. Node and jsdom do, which is how signature encoding, content ids
// and frame validation shipped using it: every test passed while the browser taker path threw
// "Buffer is not defined" (found 2026-09-15 by calling these helpers in Chromium). This suite runs
// the browser-reachable helpers with `Buffer` removed.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex } from '@noble/hashes/utils';

describe('browser-reachable helpers work without a Buffer global', () => {
  beforeAll(() => {
    vi.stubGlobal('Buffer', undefined);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('encodes and decodes Schnorr signatures', async () => {
    expect(typeof (globalThis as { Buffer?: unknown }).Buffer).toBe('undefined');
    const { schnorrSign, schnorrPublicKey, schnorrVerify, encodeSchnorrSignature, decodeSchnorrSignature } = await import('../src/schnorr.js');
    const sk = 123456789n;
    const msg = [1n, 2n, 3n, 4n];
    const sig = schnorrSign(msg, sk, 777n);
    const hex = encodeSchnorrSignature(sig);
    expect(hex).toMatch(/^[0-9a-f]{192}$/);
    const back = decodeSchnorrSignature(hex);
    expect(back.response).toBe(sig.response);
    expect(schnorrVerify(msg, back, schnorrPublicKey(sk))).toBe(true);
    expect(encodeSchnorrSignature(back)).toBe(hex);
  });

  it('computes content-addressed ids identical to blake2b256(canonicalJSON)', async () => {
    const { computeId, canonicalJSON, signBody, verifyBodySignature, decodeSignature, encodeSignature } = await import('../../relay-node/src/schema.js');
    const { schnorrPublicKey } = await import('../src/schnorr.js');
    const body = { endpoint: 'ws://relay.example/gossip', pairs: ['tNIGHT/TESTUSD'] };
    expect(computeId(body)).toBe(bytesToHex(blake2b(new TextEncoder().encode(canonicalJSON(body)), { dkLen: 32 })));
    const sig = encodeSignature(signBody(body, 42n));
    expect(verifyBodySignature(body, decodeSignature(sig), schnorrPublicKey(42n))).toBe(true);
  });

  it('validates incoming frames, including the size limit', async () => {
    const { computeId, WIRE_VERSION, MAX_MSG_BYTES } = await import('../../relay-node/src/schema.js');
    const { parseAndValidate } = await import('../../relay-node/src/validate.js');
    const body = { endpoint: 'ws://relay.example/gossip', pairs: [] };
    const env = { v: WIRE_VERSION, type: 'peer_announce', id: computeId(body), ts: Math.floor(Date.now() / 1000), ttl: 3, body };
    expect(parseAndValidate(JSON.stringify(env)).ok).toBe(true);
    // Multi-byte characters count as bytes, not string length.
    expect(parseAndValidate('é'.repeat(MAX_MSG_BYTES / 2 + 1))).toMatchObject({ ok: false, reason: 'frame exceeds MAX_MSG_BYTES' });
  });

  it('seals, encrypts, decrypts and verifies a reveal', async () => {
    const { sealQuote, buildReveal, verifyReveal } = await import('../src/quotes.js');
    const { encryptReveal, decryptReveal, generateEncKeypair, plaintextToTerms } = await import('../src/reveal-channel.js');
    const { schnorrPublicKey } = await import('../src/schnorr.js');
    const { encodeTerms } = await import('../src/terms.js');
    const terms = { pair: 'tNIGHT/TESTUSD', side: 'buy' as const, price: '41.44', size: '1000' };
    const sealed = sealQuote(terms, new Uint8Array(32).fill(7), BigInt(Math.floor(Date.now() / 1000) + 300));
    const reveal = buildReveal(sealed, 99n, 'b2ZmZXI=', Math.floor(Date.now() / 1000) + 600);
    const dealer = generateEncKeypair();
    const taker = generateEncKeypair();
    const msg = encryptReveal(new Uint8Array(32).fill(1), reveal, dealer.sk, taker.pk);
    const { plaintext, encodedTermsSignature } = decryptReveal(msg, taker.sk, dealer.pk);
    const t = plaintextToTerms(plaintext);
    const verdict = verifyReveal(
      { terms: t, encodedTerms: encodeTerms(t), nonce: Uint8Array.from((plaintext.nonce.match(/../g) ?? []).map((h) => parseInt(h, 16))), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
      sealed.commitment,
      schnorrPublicKey(99n),
      sealed.notional,
    );
    expect(verdict).toEqual({ valid: true });
  });
});
