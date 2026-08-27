// Propagation, dedup seen-set, TTL, and retention — RELAY.md §5.
//
// Transport-agnostic: a peer is just an id plus a `send` function. server.ts wires this to real
// WebSocket connections; tests wire it to in-process functions so two `GossipNode`s can gossip to
// each other with no sockets at all.

import { EventEmitter } from 'node:events';
import { parseAndValidate } from './validate.js';
import { PeerTable, MISBEHAVIOR_WEIGHT } from './peers.js';
import {
  canonicalJSON,
  computeId,
  SEEN_SET_TTL_MS,
  type Envelope,
  type RfqBody,
  type QuoteRefBody,
} from './schema.js';

export interface PeerHandle {
  id: string;
  send(raw: string): void;
}

export type InboundOutcome =
  | { delivered: true; forwarded: boolean; envelope: Envelope }
  | { delivered: false; reason: string };

interface RetainedRfq {
  envelope: Envelope<RfqBody>;
  expiresAtSecs: number;
}

interface RetainedQuoteRef {
  envelope: Envelope<QuoteRefBody>;
  expiresAtSecs: number;
}

/** One gossiping relay node's in-memory state. Everything here is designed to be safely dropped
 *  on restart (RELAY.md §7: "a relay restart loses nothing that matters"). */
export class GossipNode extends EventEmitter {
  readonly peerTable = new PeerTable();
  private peers = new Map<string, PeerHandle>();
  private seen = new Map<string, number>(); // id -> addedAtMs
  private rfqs = new Map<string, RetainedRfq>();
  private quoteRefs = new Map<string, RetainedQuoteRef>();

  addPeer(handle: PeerHandle): void {
    this.peers.set(handle.id, handle);
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  /** Handles one inbound raw frame from `fromPeerId`. Implements RELAY.md §5 steps 1-7. */
  handleMessage(fromPeerId: string, raw: string, nowMs: number = Date.now()): InboundOutcome {
    if (this.peerTable.isBanned(fromPeerId, nowMs)) {
      return { delivered: false, reason: 'peer is banned' };
    }

    const nowSecs = Math.floor(nowMs / 1000);
    const result = parseAndValidate(raw, nowSecs);

    if (!result.ok) {
      if (result.ignore) {
        return { delivered: false, reason: result.reason };
      }
      if (result.penalize) {
        this.peerTable.penalize(fromPeerId, MISBEHAVIOR_WEIGHT.validationFailure, nowMs);
      }
      return { delivered: false, reason: result.reason };
    }

    const { envelope } = result;

    if (!this.peerTable.checkRateLimit(fromPeerId, envelope.type, nowMs)) {
      return { delivered: false, reason: `rate limit exceeded for ${envelope.type}` };
    }

    // Step 3: seen-set membership terminates propagation loops.
    if (this.seen.has(envelope.id)) {
      return { delivered: false, reason: 'already seen' };
    }

    // Step 6: add to seen-set, deliver to local subscribers.
    this.seen.set(envelope.id, nowMs);
    this.retain(envelope, nowSecs);
    this.emit('message', envelope, fromPeerId);

    // Step 7: forward with decremented ttl, never back to the sender.
    let forwarded = false;
    if (envelope.ttl > 0) {
      const forwardEnvelope: Envelope = { ...envelope, ttl: envelope.ttl - 1 };
      const raw2 = JSON.stringify(forwardEnvelope);
      for (const [peerId, peer] of this.peers) {
        if (peerId === fromPeerId) continue;
        peer.send(raw2);
        forwarded = true;
      }
    }

    return { delivered: true, forwarded, envelope };
  }

  /** Injects a locally-originated message (e.g. from an HTTP publish endpoint or a directly
   *  connected client) as if it had just passed validation, then propagates it exactly like an
   *  inbound gossip message. Caller is responsible for having validated/signed it already. */
  publishLocal(envelope: Envelope, nowMs: number = Date.now()): InboundOutcome {
    const expectedId = computeId(envelope.body);
    if (expectedId !== envelope.id) {
      return { delivered: false, reason: 'id does not match recomputed hash of body' };
    }
    if (this.seen.has(envelope.id)) {
      return { delivered: false, reason: 'already seen' };
    }
    const nowSecs = Math.floor(nowMs / 1000);
    this.seen.set(envelope.id, nowMs);
    this.retain(envelope, nowSecs);
    this.emit('message', envelope, null);

    let forwarded = false;
    if (envelope.ttl > 0) {
      const forwardEnvelope: Envelope = { ...envelope, ttl: envelope.ttl - 1 };
      const raw2 = JSON.stringify(forwardEnvelope);
      for (const peer of this.peers.values()) {
        peer.send(raw2);
        forwarded = true;
      }
    }
    return { delivered: true, forwarded, envelope };
  }

  private retain(envelope: Envelope, nowSecs: number): void {
    if (envelope.type === 'rfq') {
      const body = envelope.body as RfqBody;
      this.rfqs.set(envelope.id, { envelope: envelope as Envelope<RfqBody>, expiresAtSecs: body.expiry });
    } else if (envelope.type === 'quote_ref') {
      const body = envelope.body as QuoteRefBody;
      this.quoteRefs.set(envelope.id, {
        envelope: envelope as Envelope<QuoteRefBody>,
        expiresAtSecs: body.validUntil,
      });
    }
    void nowSecs;
  }

  /** RELAY.md §5: "nodes retain RFQs until expiry, and quote_refs until validUntil, then drop
   *  them." Also sweeps the seen-set past its 15-minute TTL. Call periodically (server.ts runs
   *  this on an interval); safe to call from tests with an explicit `nowMs`. */
  sweepExpired(nowMs: number = Date.now()): { rfqsDropped: number; quoteRefsDropped: number; seenDropped: number } {
    const nowSecs = Math.floor(nowMs / 1000);
    let rfqsDropped = 0;
    let quoteRefsDropped = 0;
    let seenDropped = 0;

    for (const [id, r] of this.rfqs) {
      if (nowSecs > r.expiresAtSecs) {
        this.rfqs.delete(id);
        rfqsDropped++;
      }
    }
    for (const [id, r] of this.quoteRefs) {
      if (nowSecs > r.expiresAtSecs) {
        this.quoteRefs.delete(id);
        quoteRefsDropped++;
      }
    }
    for (const [id, addedAtMs] of this.seen) {
      if (nowMs - addedAtMs > SEEN_SET_TTL_MS) {
        this.seen.delete(id);
        seenDropped++;
      }
    }
    return { rfqsDropped, quoteRefsDropped, seenDropped };
  }

  getRfqs(filter: { pair?: string; sinceSecs?: number } = {}): Envelope<RfqBody>[] {
    const out: Envelope<RfqBody>[] = [];
    for (const r of this.rfqs.values()) {
      if (filter.pair && r.envelope.body.pair !== filter.pair) continue;
      if (filter.sinceSecs !== undefined && r.envelope.ts < filter.sinceSecs) continue;
      out.push(r.envelope);
    }
    return out;
  }

  getQuoteRefs(filter: { rfqId?: string } = {}): Envelope<QuoteRefBody>[] {
    const out: Envelope<QuoteRefBody>[] = [];
    for (const r of this.quoteRefs.values()) {
      if (filter.rfqId && r.envelope.body.rfqId !== filter.rfqId) continue;
      out.push(r.envelope);
    }
    return out;
  }

  get seenCount(): number {
    return this.seen.size;
  }
}

export { canonicalJSON, computeId };
