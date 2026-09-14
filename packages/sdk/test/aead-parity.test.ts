// Byte-for-byte parity between the @noble/ciphers AEAD (aead.ts, browser-safe) and the
// node:crypto `chacha20-poly1305` implementation reveal-channel.ts and disclosure.ts used before
// the Phase 0 browser-safe SDK migration (docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §3, task
// 0.1). These vectors were captured from the pre-migration node:crypto code with a fixed
// key/nonce/plaintext, both with and without AAD (reveal-channel never uses AAD; disclosure.ts
// always does) — see the capture script referenced below. If this test ever fails, the AEAD
// construction has silently changed and every existing encrypted reveal/note would stop
// decrypting.

import { describe, expect, it } from 'vitest';
import { aeadSeal, aeadOpen, bytesToHex, utf8ToBytes } from '../src/aead.js';

const KEY = new Uint8Array(32).fill(0x11);
const NONCE = new Uint8Array(12).fill(0x22);
const AAD = new Uint8Array(32).fill(0x33);
const PLAINTEXT = utf8ToBytes(JSON.stringify({ hello: 'world', n: 1 }));

// Captured from node:crypto's createCipheriv('chacha20-poly1305', KEY, NONCE) with the same
// PLAINTEXT, once with no AAD (reveal-channel.ts's construction) and once with `cipher.setAAD(AAD,
// { plaintextLength: PLAINTEXT.length })` (disclosure.ts's construction).
const EXPECTED_NO_AAD = {
  ct: 'fe57bd7b51fcc255e7408693896eae4d0bdf2fba61e3af',
  tag: '66024cabff5ff40df3c4497df45c0d1a',
};
const EXPECTED_WITH_AAD = {
  ct: 'fe57bd7b51fcc255e7408693896eae4d0bdf2fba61e3af',
  tag: 'ec27100077208d4f1393b391479e1a13',
};

describe('aead.ts parity with the pre-migration node:crypto implementation', () => {
  it('matches node:crypto exactly with no AAD (reveal-channel.ts construction)', () => {
    const sealed = aeadSeal(KEY, NONCE, PLAINTEXT);
    const ct = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    expect(bytesToHex(ct)).toBe(EXPECTED_NO_AAD.ct);
    expect(bytesToHex(tag)).toBe(EXPECTED_NO_AAD.tag);
    expect(aeadOpen(KEY, NONCE, sealed)).toEqual(PLAINTEXT);
  });

  it('matches node:crypto exactly with AAD (disclosure.ts construction)', () => {
    const sealed = aeadSeal(KEY, NONCE, PLAINTEXT, AAD);
    const ct = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    expect(bytesToHex(ct)).toBe(EXPECTED_WITH_AAD.ct);
    expect(bytesToHex(tag)).toBe(EXPECTED_WITH_AAD.tag);
    expect(aeadOpen(KEY, NONCE, sealed, AAD)).toEqual(PLAINTEXT);
  });

  it('rejects a tampered tag', () => {
    const sealed = aeadSeal(KEY, NONCE, PLAINTEXT);
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => aeadOpen(KEY, NONCE, tampered)).toThrow();
  });

  it('rejects the wrong AAD', () => {
    const sealed = aeadSeal(KEY, NONCE, PLAINTEXT, AAD);
    const wrongAad = new Uint8Array(32).fill(0x44);
    expect(() => aeadOpen(KEY, NONCE, sealed, wrongAad)).toThrow();
  });
});
