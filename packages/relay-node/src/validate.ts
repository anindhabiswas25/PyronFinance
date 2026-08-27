// Envelope + per-type validation — RELAY.md §5, steps 1, 2, 4 (signature), 5 (clock skew/expiry),
// and the body shape checks implied by §3. Step 3 (seen-set membership) and step 7 (propagation)
// are stateful and live in gossip.ts; this module is pure.
//
// A relay is untrusted infrastructure (docs/ARCHITECTURE.md Pillar 3): it must not verify anything
// against the chain. For `quote_ref`/`cancel`, RELAY.md §2 requires a signature "under the dealer's
// quote key" — but that key is never present on the wire (only `dealerCmt`, a one-way hash of it,
// per docs/CONTRACTS.md), and a relay has no chain access to resolve `dealerCmt -> quotePk`. So a
// relay CANNOT cryptographically verify these signatures; it can only check that one is present and
// correctly shaped. Real verification against the on-chain `quotePk` is the client's job
// (RELAY.md §3.2 step 3). This file is the resolution of that gap — see the corresponding note
// added to RELAY.md §5.

import {
  WIRE_VERSION,
  MAX_MSG_BYTES,
  MAX_CLOCK_SKEW_SECS,
  SIGNED_TYPES,
  computeId,
  isHexOfLength,
  type Envelope,
  type MessageBody,
  type MessageType,
  type RfqBody,
  type QuoteRefBody,
  type CancelBody,
  type PeerAnnounceBody,
} from './schema.js';

export type ValidationResult =
  | { ok: true; envelope: Envelope }
  /** `ignore: true` messages (unknown major version) are dropped silently, not penalized —
   *  RELAY.md §1: "Nodes MUST ignore messages whose major version they do not implement." */
  | { ok: false; reason: string; penalize: boolean; ignore?: boolean };

const DECIMAL_STRING_RE = /^-?\d+(\.\d+)?$/;

function isDecimalString(v: unknown): v is string {
  return typeof v === 'string' && DECIMAL_STRING_RE.test(v);
}

function isUnixSecs(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Parses and validates a raw frame (already known to be <= MAX_MSG_BYTES, checked by the caller
 *  from the transport layer since only the transport knows the wire byte length before JSON.parse
 *  — see server.ts). */
export function parseAndValidate(raw: string, nowSecs: number = Math.floor(Date.now() / 1000)): ValidationResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MSG_BYTES) {
    return { ok: false, reason: 'frame exceeds MAX_MSG_BYTES', penalize: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed JSON', penalize: true };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'envelope must be a JSON object', penalize: true };
  }
  const env = parsed as Record<string, unknown>;

  if (typeof env.v !== 'number') {
    return { ok: false, reason: 'missing/invalid v', penalize: true };
  }
  // Major-version mismatch: ignore, do not penalize — this is the extensibility escape hatch.
  if (Math.trunc(env.v) !== WIRE_VERSION) {
    return { ok: false, reason: `unimplemented major version ${env.v}`, penalize: false, ignore: true };
  }

  const type = env.type;
  if (type !== 'rfq' && type !== 'quote_ref' && type !== 'cancel' && type !== 'peer_announce') {
    return { ok: false, reason: `unknown type ${String(type)}`, penalize: true };
  }

  if (!isHexOfLength(env.id, 32)) {
    return { ok: false, reason: 'id must be 32-byte hex', penalize: true };
  }
  if (!isUnixSecs(env.ts)) {
    return { ok: false, reason: 'ts must be a non-negative integer unix-seconds value', penalize: true };
  }
  if (typeof env.ttl !== 'number' || !Number.isInteger(env.ttl) || env.ttl < 0) {
    return { ok: false, reason: 'ttl must be a non-negative integer', penalize: true };
  }
  if (typeof env.body !== 'object' || env.body === null) {
    return { ok: false, reason: 'body must be an object', penalize: true };
  }

  const bodyResult = validateBody(type, env.body as Record<string, unknown>);
  if (!bodyResult.ok) {
    return { ok: false, reason: `body: ${bodyResult.reason}`, penalize: true };
  }
  const body = bodyResult.body;

  // RELAY.md §5 step 2: recompute id from body; mismatch -> drop + penalize. This is what stops
  // one message from occupying several dedup slots.
  const recomputed = computeId(body);
  if (recomputed !== (env.id as string).toLowerCase()) {
    return { ok: false, reason: 'id does not match recomputed hash of body', penalize: true };
  }

  // RELAY.md §5 step 4: signature required for quote_ref/cancel.
  if (SIGNED_TYPES.has(type)) {
    if (!isHexOfLength(env.sig, 96)) {
      return { ok: false, reason: `${type} requires a well-formed sig`, penalize: true };
    }
  } else if (env.sig !== undefined && !isHexOfLength(env.sig, 96)) {
    return { ok: false, reason: 'sig present but malformed', penalize: true };
  }

  // RELAY.md §5 step 5: clock skew and expiry.
  if (env.ts - nowSecs > MAX_CLOCK_SKEW_SECS) {
    return { ok: false, reason: 'ts is too far in the future', penalize: true };
  }
  const expiryCheck = checkNotExpired(type, body, nowSecs);
  if (!expiryCheck.ok) {
    return { ok: false, reason: expiryCheck.reason, penalize: false };
  }

  const envelope: Envelope = {
    v: WIRE_VERSION,
    type,
    id: (env.id as string).toLowerCase(),
    ts: env.ts as number,
    ttl: env.ttl as number,
    body,
    sig: typeof env.sig === 'string' ? (env.sig as string).toLowerCase() : undefined,
  };
  return { ok: true, envelope };
}

function checkNotExpired(
  type: MessageType,
  body: MessageBody,
  nowSecs: number,
): { ok: true } | { ok: false; reason: string } {
  if (type === 'rfq') {
    const b = body as RfqBody;
    if (nowSecs > b.expiry) return { ok: false, reason: 'rfq already past its own expiry' };
  } else if (type === 'quote_ref') {
    const b = body as QuoteRefBody;
    if (nowSecs > b.validUntil) return { ok: false, reason: 'quote_ref already past validUntil' };
  }
  return { ok: true };
}

type BodyValidation = { ok: true; body: MessageBody } | { ok: false; reason: string };

function validateBody(type: MessageType, body: Record<string, unknown>): BodyValidation {
  switch (type) {
    case 'rfq':
      return validateRfqBody(body);
    case 'quote_ref':
      return validateQuoteRefBody(body);
    case 'cancel':
      return validateCancelBody(body);
    case 'peer_announce':
      return validatePeerAnnounceBody(body);
  }
}

function validateRfqBody(b: Record<string, unknown>): BodyValidation {
  if (!isHexOfLength(b.rfqId, 32)) return { ok: false, reason: 'rfqId must be 32-byte hex' };
  if (typeof b.pair !== 'string' || b.pair.length === 0) return { ok: false, reason: 'pair required' };
  if (b.side !== 'buy' && b.side !== 'sell') return { ok: false, reason: 'side must be buy|sell' };
  if (!isDecimalString(b.size)) return { ok: false, reason: 'size must be a decimal string' };
  if (!isUnixSecs(b.expiry)) return { ok: false, reason: 'expiry must be unix seconds' };
  if (!isHexOfLength(b.takerEncPk, 32)) return { ok: false, reason: 'takerEncPk must be 32-byte hex' };
  if (!isStringArray(b.replyTo)) return { ok: false, reason: 'replyTo must be a string array' };
  if (b.minBond !== undefined && !isDecimalString(b.minBond)) {
    return { ok: false, reason: 'minBond must be a decimal string' };
  }
  const out: RfqBody = {
    rfqId: b.rfqId as string,
    pair: b.pair,
    side: b.side,
    size: b.size as string,
    expiry: b.expiry as number,
    takerEncPk: b.takerEncPk as string,
    replyTo: b.replyTo as string[],
    ...(b.minBond !== undefined ? { minBond: b.minBond as string } : {}),
  };
  return { ok: true, body: out };
}

function validateQuoteRefBody(b: Record<string, unknown>): BodyValidation {
  if (!isHexOfLength(b.rfqId, 32)) return { ok: false, reason: 'rfqId must be 32-byte hex' };
  if (!isHexOfLength(b.dealerCmt, 32)) return { ok: false, reason: 'dealerCmt must be 32-byte hex' };
  if (!isHexOfLength(b.quoteId, 32)) return { ok: false, reason: 'quoteId must be 32-byte hex' };
  if (!isUnixSecs(b.validUntil)) return { ok: false, reason: 'validUntil must be unix seconds' };
  if (!isHexOfLength(b.txHash, 32)) return { ok: false, reason: 'txHash must be 32-byte hex' };
  if (b.revealVia !== 'direct' && b.revealVia !== 'mailbox') {
    return { ok: false, reason: 'revealVia must be direct|mailbox' };
  }
  if (!isNonEmptyString(b.dealerEndpoint)) return { ok: false, reason: 'dealerEndpoint required' };
  if (!isHexOfLength(b.dealerEncPk, 32)) return { ok: false, reason: 'dealerEncPk must be 32-byte hex' };
  const out: QuoteRefBody = {
    rfqId: b.rfqId as string,
    dealerCmt: b.dealerCmt as string,
    quoteId: b.quoteId as string,
    validUntil: b.validUntil as number,
    txHash: b.txHash as string,
    revealVia: b.revealVia,
    dealerEndpoint: b.dealerEndpoint as string,
    dealerEncPk: b.dealerEncPk as string,
  };
  return { ok: true, body: out };
}

function validateCancelBody(b: Record<string, unknown>): BodyValidation {
  if (!isHexOfLength(b.quoteId, 32)) return { ok: false, reason: 'quoteId must be 32-byte hex' };
  if (!isHexOfLength(b.dealerCmt, 32)) return { ok: false, reason: 'dealerCmt must be 32-byte hex' };
  const out: CancelBody = { quoteId: b.quoteId as string, dealerCmt: b.dealerCmt as string };
  return { ok: true, body: out };
}

function validatePeerAnnounceBody(b: Record<string, unknown>): BodyValidation {
  if (!isNonEmptyString(b.endpoint)) return { ok: false, reason: 'endpoint required' };
  if (!isStringArray(b.pairs)) return { ok: false, reason: 'pairs must be a string array' };
  const out: PeerAnnounceBody = { endpoint: b.endpoint as string, pairs: b.pairs as string[] };
  return { ok: true, body: out };
}
