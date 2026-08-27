// Peer table: per-peer rate limiting and misbehavior scoring — RELAY.md §5.
//
// "Peers exceeding limits are throttled, then disconnected. Nodes SHOULD keep a simple
// misbehavior score and refuse reconnection from persistent offenders."
//
// Stateless w.r.t. transport — a `PeerId` is just a string key chosen by the caller (server.ts
// uses the remote socket's address; tests use arbitrary labels). Every method takes an optional
// `nowMs` so tests can drive the clock deterministically instead of sleeping in wall time.

import type { MessageType } from './schema.js';

/** RELAY.md §5 rate-limit table, messages per 60s window, per peer. */
export const RATE_LIMITS: Record<MessageType, number> = {
  rfq: 10,
  quote_ref: 60,
  cancel: 60,
  peer_announce: 2,
};

const WINDOW_MS = 60_000;

/** Misbehavior score weights. A single bad-signature/bad-id message is worse than one rate-limit
 *  trip; both accumulate toward the ban threshold. Placeholder values — not tuned against real
 *  traffic (same status as the M1 `TIME_SLACK` placeholder; revisit post-M2 with real data). */
export const MISBEHAVIOR_WEIGHT = {
  validationFailure: 10,
  rateLimitExceeded: 5,
} as const;

export const MISBEHAVIOR_BAN_THRESHOLD = 100;
/** How long a banned peer is refused reconnection before its score is forgiven. */
export const MISBEHAVIOR_BAN_MS = 30 * 60 * 1000;

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

interface PeerRecord {
  buckets: Map<MessageType, TokenBucket>;
  score: number;
  bannedUntilMs: number | null;
  throttledTypes: Set<MessageType>;
}

export class PeerTable {
  private peers = new Map<string, PeerRecord>();

  private record(peerId: string): PeerRecord {
    let r = this.peers.get(peerId);
    if (!r) {
      r = { buckets: new Map(), score: 0, bannedUntilMs: null, throttledTypes: new Set() };
      this.peers.set(peerId, r);
    }
    return r;
  }

  isBanned(peerId: string, nowMs: number = Date.now()): boolean {
    const r = this.peers.get(peerId);
    if (!r || r.bannedUntilMs === null) return false;
    if (nowMs >= r.bannedUntilMs) {
      r.bannedUntilMs = null;
      r.score = 0;
      return false;
    }
    return true;
  }

  /** Consumes one token for `type`. Returns false (and records a strike) if the peer is over the
   *  RELAY.md rate limit for that message type. */
  checkRateLimit(peerId: string, type: MessageType, nowMs: number = Date.now()): boolean {
    const r = this.record(peerId);
    const limit = RATE_LIMITS[type];
    let bucket = r.buckets.get(type);
    if (!bucket) {
      bucket = { tokens: limit, lastRefillMs: nowMs };
      r.buckets.set(type, bucket);
    }
    const elapsed = nowMs - bucket.lastRefillMs;
    if (elapsed > 0) {
      const refill = (elapsed / WINDOW_MS) * limit;
      bucket.tokens = Math.min(limit, bucket.tokens + refill);
      bucket.lastRefillMs = nowMs;
    }
    if (bucket.tokens < 1) {
      r.throttledTypes.add(type);
      this.penalize(peerId, MISBEHAVIOR_WEIGHT.rateLimitExceeded, nowMs);
      return false;
    }
    bucket.tokens -= 1;
    r.throttledTypes.delete(type);
    return true;
  }

  /** Records a validation failure (bad id, bad signature, oversized frame, ...) against a peer. */
  penalize(peerId: string, weight: number = MISBEHAVIOR_WEIGHT.validationFailure, nowMs: number = Date.now()): void {
    const r = this.record(peerId);
    r.score += weight;
    if (r.score >= MISBEHAVIOR_BAN_THRESHOLD) {
      r.bannedUntilMs = nowMs + MISBEHAVIOR_BAN_MS;
    }
  }

  score(peerId: string): number {
    return this.peers.get(peerId)?.score ?? 0;
  }

  isThrottled(peerId: string, type: MessageType): boolean {
    return this.peers.get(peerId)?.throttledTypes.has(type) ?? false;
  }

  forget(peerId: string): void {
    this.peers.delete(peerId);
  }
}
