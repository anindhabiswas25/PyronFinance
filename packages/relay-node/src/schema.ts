// Wire schema for the relay gossip protocol — docs/RELAY.md is normative; this file is the
// reference encoding of it. Shared with @otc/sdk (packages/sdk imports this module directly, see
// docs/RELAY.md §7) so client and node can never disagree about the wire format.
//
// Everything here is pure data shape + encoding. No I/O, no sockets — see server.ts/gossip.ts for
// the runtime.

import {
  schnorrSign,
  schnorrVerify,
  freshNonce,
  FIELD_MODULUS,
  encodeSchnorrSignature,
  decodeSchnorrSignature,
  type SchnorrSignature,
} from '../../sdk/src/schnorr.js';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { blake2b256, bytesToBigIntBE, toHex, fromHex, isHexOfLength } from './bytes.js';

export const WIRE_VERSION = 1;
export const MAX_MSG_BYTES = 64 * 1024;

/** RELAY.md §5: messages more than this many seconds ahead of the receiver's clock are dropped. */
export const MAX_CLOCK_SKEW_SECS = 120;

/** RELAY.md §5: seen-set retention window for loop termination. */
export const SEEN_SET_TTL_MS = 15 * 60 * 1000;

export type MessageType = 'rfq' | 'quote_ref' | 'cancel' | 'peer_announce';

/** Types that MUST carry a valid `sig` per RELAY.md §2. */
export const SIGNED_TYPES: ReadonlySet<MessageType> = new Set(['quote_ref', 'cancel']);

export interface RfqBody {
  rfqId: string; // hex32
  pair: string;
  side: 'buy' | 'sell';
  size: string; // decimal string
  expiry: number; // unix secs
  takerEncPk: string; // hex32
  replyTo: string[];
  minBond?: string; // decimal string
}

export interface QuoteRefBody {
  rfqId: string; // hex32
  dealerCmt: string; // hex32
  quoteId: string; // hex32
  validUntil: number; // unix secs
  txHash: string; // hex32
  revealVia: 'direct' | 'mailbox';
  dealerEndpoint: string;
  dealerEncPk: string; // hex32
}

export interface CancelBody {
  quoteId: string; // hex32
  dealerCmt: string; // hex32
}

export interface PeerAnnounceBody {
  endpoint: string;
  pairs: string[];
}

export type MessageBody = RfqBody | QuoteRefBody | CancelBody | PeerAnnounceBody;

export interface Envelope<B extends MessageBody = MessageBody> {
  v: number;
  type: MessageType;
  id: string; // hex32, content-addressed
  ts: number; // unix secs
  ttl: number;
  body: B;
  sig?: string; // hex, present iff SIGNED_TYPES.has(type)
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/** RELAY.md §2: "canonicalJSON means keys sorted lexicographically, no insignificant whitespace,
 *  integers without exponents." Recursively rebuilds objects with sorted keys before stringifying
 *  so two independent implementations of this function produce byte-identical output for the same
 *  logical value — this is what makes content-addressed `id`s agree across nodes. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('canonicalJSON: non-finite number');
      if (!Number.isInteger(value)) throw new Error('canonicalJSON: non-integer number');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue; // undefined fields are omitted, never serialized as null
    out[k] = canonicalize(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content-addressed id
// ---------------------------------------------------------------------------

/** `id = blake2b256(canonicalJSON(body))`, hex-encoded (32 bytes -> 64 hex chars). */
export function computeId(body: MessageBody): string {
  const bytes = new TextEncoder().encode(canonicalJSON(body));
  return toHex(blake2b256(bytes));
}

// ---------------------------------------------------------------------------
// Signing — quote_ref and cancel are signed with the dealer's on-chain quote key
// (RELAY.md §2, §3.2, §3.3). The relay-layer signature never touches the chain and is not the
// signature verified by any circuit; it exists so relays/takers can attribute a message to a
// dealer key without a chain read. To reuse the already chain-cross-verified schnorrSign/Verify
// (which operate on Vector<Field> messages, see packages/sdk/src/schnorr.ts), the signable
// message is derived by reducing blake2b256(canonicalJSON(body)) into a single field element.
// This is a relay-protocol-only convention, NOT the same hash/message the contract ever sees.
// ---------------------------------------------------------------------------

function bodyToFieldMessage(body: MessageBody): bigint[] {
  const digest = blake2b256(new TextEncoder().encode(canonicalJSON(body)));
  return [bytesToBigIntBE(digest) % FIELD_MODULUS];
}

/** Signs `body` with the dealer's quote-signing scalar. `k` must be fresh per signature — see
 *  schnorr.ts's `freshNonce`. */
export function signBody(body: MessageBody, sk: bigint, k: bigint = freshNonce()): SchnorrSignature {
  return schnorrSign(bodyToFieldMessage(body), sk, k);
}

export function verifyBodySignature(body: MessageBody, sig: SchnorrSignature, pk: JubjubPoint): boolean {
  return schnorrVerify(bodyToFieldMessage(body), sig, pk);
}

// RELAY.md's envelope diagram labels the sig field `<hex64>` as shorthand for "a hex-encoded
// signature blob"; the exact 96-byte (announcement.x || announcement.y || response) framing a
// Jubjub Schnorr signature actually needs is specified in packages/sdk/src/schnorr.ts
// (`encodeSchnorrSignature`/`decodeSchnorrSignature`) and re-exported here — see the corresponding
// note added to RELAY.md §2.
export const encodeSignature = encodeSchnorrSignature;
export const decodeSignature = decodeSchnorrSignature;

export { toHex, fromHex, isHexOfLength, blake2b256 };
