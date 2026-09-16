// Shared ChaCha20-Poly1305 AEAD wrapper on @noble/ciphers (pure JS, audited, no native deps) —
// used by both reveal-channel.ts (docs/RELAY.md §4) and disclosure.ts (docs/DISCLOSURE.md), so
// client/ can import either without pulling in node:crypto.
//
// PARITY: verified byte-for-byte identical to node:crypto's `chacha20-poly1305` cipher for a fixed
// key/nonce/plaintext, with and without AAD — see test/aead-parity.test.ts. Both implement RFC 8439;
// this file is the only place that construction is chosen, so a future swap only touches here.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';

export const AEAD_NONCE_LEN = 12;
export const AEAD_TAG_LEN = 16;

export class AeadError extends Error {}

/** Encrypts `plaintext`, returning `ciphertext || tag(16)` — the same layout
 *  `cipher.update()+cipher.final()+cipher.getAuthTag()` concatenation the Node implementation used,
 *  so callers that frame `nonce || sealed` need no changes. */
export function aeadSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

/** Decrypts `sealed` (`ciphertext || tag(16)`). Throws `AeadError` on any authentication failure —
 *  a tampered ciphertext/tag and a wrong key/nonce/aad are indistinguishable by design. */
export function aeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  try {
    return chacha20poly1305(key, nonce, aad).decrypt(sealed);
  } catch (err) {
    throw new AeadError((err as Error).message ?? 'AEAD authentication failed');
  }
}

// ---------------------------------------------------------------------------------------------
// Byte/hex/base64 helpers usable in a browser (Buffer is Node/polyfill-only in Vite by default).
// ---------------------------------------------------------------------------------------------

export function randomBytesU8(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len));
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64_ENC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(b: Uint8Array): string {
  // atob/btoa operate on binary strings, not bytes directly; this avoids both Buffer and the
  // string round-trip so it's identical in Node and the browser.
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += B64_ENC[(n >> 18) & 63] + B64_ENC[(n >> 12) & 63] + B64_ENC[(n >> 6) & 63] + B64_ENC[n & 63];
  }
  const rem = b.length - i;
  if (rem === 1) {
    const n = b[i] << 16;
    out += B64_ENC[(n >> 18) & 63] + B64_ENC[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8);
    out += B64_ENC[(n >> 18) & 63] + B64_ENC[(n >> 12) & 63] + B64_ENC[(n >> 6) & 63] + '=';
  }
  return out;
}

const B64_DEC = (() => {
  const map = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ENC.length; i++) map[B64_ENC.charCodeAt(i)] = i;
  return map;
})();

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_DEC[clean.charCodeAt(i)] ?? 0;
    const c1 = B64_DEC[clean.charCodeAt(i + 1)] ?? 0;
    const c2 = i + 2 < clean.length ? B64_DEC[clean.charCodeAt(i + 2)] : -1;
    const c3 = i + 3 < clean.length ? B64_DEC[clean.charCodeAt(i + 3)] : -1;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[o++] = ((c1 & 0xf) << 4) | (c2 >> 2);
    if (c3 >= 0) out[o++] = ((c2 & 0x3) << 6) | c3;
  }
  return out.subarray(0, o);
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
