// Off-chain mirrors of OTCProtocol.compact's domain-separated derivations. Must stay byte-for-byte
// identical to the in-circuit versions (contracts/src/OTCProtocol.compact) — quoteId is deterministic
// and publicly recomputable specifically so a taker can locate a dealer's commitment from a gossiped
// reference with no lookup service (docs/RELAY.md §3.2, docs/CONTRACTS.md §3).

import { persistentHash, CompactTypeBytes, CompactTypeVector } from '@midnight-ntwrk/compact-runtime';

function pad32(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) throw new Error(`domain separator too long: ${s}`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

const Bytes32 = new CompactTypeBytes(32);

function hash2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const vecType = new CompactTypeVector(2, Bytes32);
  return persistentHash(vecType, [a, b]);
}

function hash3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const vecType = new CompactTypeVector(3, Bytes32);
  return persistentHash(vecType, [a, b, c]);
}

function hash4(a: Uint8Array, b: Uint8Array, c: Uint8Array, d: Uint8Array): Uint8Array {
  const vecType = new CompactTypeVector(4, Bytes32);
  return persistentHash(vecType, [a, b, c, d]);
}

/** Mirrors `dealerCommitment` in OTCProtocol.compact. */
export function dealerCommitment(sk: Uint8Array): Uint8Array {
  return hash2(pad32('otc:dealer:v1'), sk);
}

/** Mirrors `deriveQuoteId` in OTCProtocol.compact. */
export function deriveQuoteId(dealerCmt: Uint8Array, rfqId: Uint8Array, commitment: Uint8Array): Uint8Array {
  return hash4(pad32('otc:quote:v1'), dealerCmt, rfqId, commitment);
}
