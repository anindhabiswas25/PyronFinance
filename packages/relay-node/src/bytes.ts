// Byte/hex/bigint plumbing shared across the relay-node modules. No chain dependency — pure
// encoding helpers.

import { blake2b } from '@noble/hashes/blake2b';

const HEX_RE = /^[0-9a-f]*$/i;

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new Error(`not a valid hex string: ${hex}`);
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function isHexOfLength(value: unknown, byteLength: number): value is string {
  return typeof value === 'string' && value.length === byteLength * 2 && HEX_RE.test(value);
}

export function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
  if (value < 0n) throw new Error('bigIntToBytesBE: negative value');
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error('bigIntToBytesBE: value does not fit in length');
  return out;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** `blake2b256` — RELAY.md's id hash. Node's OpenSSL build only exposes blake2b512/blake2s256
 *  (verified 2026-08-28: `crypto.getHashes()` has no `blake2b256`), so we use `@noble/hashes`
 *  (pure JS, audited, no native deps) for the real 256-bit-output BLAKE2b rather than truncating
 *  the 512-bit variant, which has a different internal IV and is not the same function. */
export function blake2b256(bytes: Uint8Array): Uint8Array {
  return blake2b(bytes, { dkLen: 32 });
}
