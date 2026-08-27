// JS-side counterpart to contracts/src/schnorr.compact. MUST stay byte-for-byte / value-for-value
// consistent with the in-circuit implementation — a dealer signs here, the contract verifies there.
//
// See .claude/skills/compact-contracts/SKILL.md §9 for how JUBJUB_R was determined (binary search
// against the running compiler/runtime) and why the two-limb range check exists.

import {
  ecAdd,
  ecMul,
  ecMulGenerator,
  jubjubPointX,
  jubjubPointY,
  transientHash,
  CompactTypeField,
  CompactTypeVector,
  maxField,
  constructJubjubPoint,
} from '@midnight-ntwrk/compact-runtime';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';

// Jubjub's own subgroup order — see compact-contracts SKILL.md §9.
export const JUBJUB_R =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const TWO248 = 2n ** 248n;
export const FIELD_MODULUS = maxField() + 1n;

export interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

/** Euclidean reduction of a Field challenge into a Jubjub-subgroup scalar. Mirrors the witness
 *  `getChallengeReduction` in schnorr.compact and the in-circuit range-checked reconstruction. */
export function reduceChallengeToScalar(challenge: bigint): {
  quotient: bigint;
  remHi: bigint;
  remLo: bigint;
  scalar: bigint;
} {
  const quotient = challenge / JUBJUB_R;
  const scalar = challenge % JUBJUB_R;
  const remHi = scalar / TWO248;
  const remLo = scalar % TWO248;
  return { quotient, remHi, remLo, scalar };
}

/** Mirrors `schnorrChallenge` in schnorr.compact exactly — same transientHash calls, same domain. */
export function schnorrChallenge(announcement: JubjubPoint, pk: JubjubPoint, msg: bigint[]): bigint {
  const fieldVec = (n: number) => new CompactTypeVector(n, CompactTypeField);
  const msgHash = transientHash(fieldVec(msg.length), msg);
  return transientHash(fieldVec(5), [
    jubjubPointX(announcement),
    jubjubPointY(announcement),
    jubjubPointX(pk),
    jubjubPointY(pk),
    msgHash,
  ]);
}

/** Derives the Jubjub public key for a secret scalar (ecMulGenerator(sk)). */
export function schnorrPublicKey(sk: bigint): JubjubPoint {
  return ecMulGenerator(sk);
}

/** Signs `msg` (a fixed-length Vector<n, Field>) with secret scalar `sk`.
 *  `k` is the per-signature nonce — MUST be fresh, uniformly random, and never reused across
 *  signatures under the same key (nonce reuse leaks the secret key, standard Schnorr caveat). */
export function schnorrSign(msg: bigint[], sk: bigint, k: bigint): SchnorrSignature {
  if (k <= 0n || k >= JUBJUB_R) throw new Error('nonce k must be in (0, JUBJUB_R)');
  const pk = schnorrPublicKey(sk);
  const announcement = ecMulGenerator(k);
  const challenge = schnorrChallenge(announcement, pk, msg);
  const { scalar: reducedChallenge } = reduceChallengeToScalar(challenge);
  // response must itself be a valid Jubjub scalar (< JUBJUB_R) — see compact-contracts SKILL.md §9.
  const response = (k + reducedChallenge * sk) % JUBJUB_R;
  return { announcement, response };
}

/** Off-chain verification, for the dealer/taker/watchdog to check a reveal before trusting it —
 *  mirrors `schnorrVerify` in schnorr.compact exactly. Does NOT touch the chain. */
export function schnorrVerify(msg: bigint[], signature: SchnorrSignature, pk: JubjubPoint): boolean {
  const challenge = schnorrChallenge(signature.announcement, pk, msg);
  const { scalar: reducedChallenge } = reduceChallengeToScalar(challenge);
  const lhs = ecMulGenerator(signature.response);
  const rhs = ecAdd(signature.announcement, ecMul(pk, reducedChallenge));
  return jubjubPointX(lhs) === jubjubPointX(rhs) && jubjubPointY(lhs) === jubjubPointY(rhs);
}

function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
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

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Wire encoding of a Schnorr signature used off-chain (docs/RELAY.md §2, §4): announcement.x
 *  (32B) || announcement.y (32B) || response (32B), hex-encoded — 96 bytes / 192 hex chars.
 *  Shared by packages/relay-node/src/schema.ts (quote_ref/cancel sigs) and
 *  packages/sdk/src/reveal-channel.ts (reveal sigs) so both encode/decode identically. */
export function encodeSchnorrSignature(sig: SchnorrSignature): string {
  const x = bigIntToBytesBE(jubjubPointX(sig.announcement), 32);
  const y = bigIntToBytesBE(jubjubPointY(sig.announcement), 32);
  const r = bigIntToBytesBE(sig.response, 32);
  return Buffer.from(Buffer.concat([x, y, r])).toString('hex');
}

export function decodeSchnorrSignature(hex: string): SchnorrSignature {
  if (hex.length !== 192 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('signature must be 96 bytes (192 hex chars)');
  }
  const bytes = Buffer.from(hex, 'hex');
  const x = bytesToBigIntBE(bytes.subarray(0, 32));
  const y = bytesToBigIntBE(bytes.subarray(32, 64));
  const response = bytesToBigIntBE(bytes.subarray(64, 96));
  return { announcement: constructJubjubPoint(x, y), response };
}

/** Cryptographically random nonce in (0, JUBJUB_R), suitable for schnorrSign's `k`. */
export function freshNonce(): bigint {
  // Node's webcrypto is available globally in Node 22.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  v = v % (JUBJUB_R - 1n);
  return v + 1n; // land in [1, JUBJUB_R - 1]
}
