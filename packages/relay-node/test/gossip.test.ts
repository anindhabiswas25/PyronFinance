// Propagation, dedup, TTL, retention, rate limits — RELAY.md §5. Includes the "two in-process
// nodes gossiping to each other" convergence test CLAUDE.md's M2 testing expectations call for.

import { describe, expect, it, vi } from 'vitest';
import { GossipNode, type PeerHandle } from '../src/gossip.js';
import { RATE_LIMITS, MISBEHAVIOR_BAN_THRESHOLD } from '../src/peers.js';
import { makeRfqEnvelope, makeSignedQuoteRefEnvelope } from './helpers.js';

function fakePeer(id: string, onSend: (raw: string) => void): PeerHandle {
  return { id, send: onSend };
}

describe('GossipNode.handleMessage — single node', () => {
  it('delivers a fresh valid message and adds it to the seen-set', () => {
    const node = new GossipNode();
    const env = makeRfqEnvelope();
    const result = node.handleMessage('peer1', JSON.stringify(env));
    expect(result.delivered).toBe(true);
    expect(node.seenCount).toBe(1);
  });

  it('drops a duplicate silently (terminates propagation loops)', () => {
    const node = new GossipNode();
    const env = makeRfqEnvelope();
    node.handleMessage('peer1', JSON.stringify(env));
    const result = node.handleMessage('peer2', JSON.stringify(env));
    expect(result.delivered).toBe(false);
    if (!result.delivered) expect(result.reason).toMatch(/already seen/);
    expect(node.seenCount).toBe(1);
  });

  it('decrements ttl on forward', () => {
    const node = new GossipNode();
    let forwarded: string | null = null;
    node.addPeer(fakePeer('downstream', (raw) => (forwarded = raw)));
    const env = makeRfqEnvelope({}, { ttl: 3 });
    node.handleMessage('upstream', JSON.stringify(env));
    expect(forwarded).not.toBeNull();
    expect(JSON.parse(forwarded as unknown as string).ttl).toBe(2);
  });

  it('does not forward once ttl reaches 0', () => {
    const node = new GossipNode();
    let sent = 0;
    node.addPeer(fakePeer('downstream', () => sent++));
    const env = makeRfqEnvelope({}, { ttl: 0 });
    const result = node.handleMessage('upstream', JSON.stringify(env));
    expect(result.delivered).toBe(true);
    if (result.delivered) expect(result.forwarded).toBe(false);
    expect(sent).toBe(0);
  });

  it('never forwards a message back to the peer it arrived from', () => {
    const node = new GossipNode();
    let sentToSender = 0;
    let sentToOther = 0;
    node.addPeer(fakePeer('sender', () => sentToSender++));
    node.addPeer(fakePeer('other', () => sentToOther++));
    const env = makeRfqEnvelope();
    node.handleMessage('sender', JSON.stringify(env));
    expect(sentToSender).toBe(0);
    expect(sentToOther).toBe(1);
  });

  it('drops and does not deliver an invalid message', () => {
    const node = new GossipNode();
    const result = node.handleMessage('peer1', '{not json');
    expect(result.delivered).toBe(false);
  });
});

describe('GossipNode — retention', () => {
  it('retains rfqs and exposes them via getRfqs', () => {
    const node = new GossipNode();
    const env = makeRfqEnvelope({ pair: 'tNIGHT/USDM' });
    node.handleMessage('peer1', JSON.stringify(env));
    const rfqs = node.getRfqs({ pair: 'tNIGHT/USDM' });
    expect(rfqs).toHaveLength(1);
    expect(rfqs[0].id).toBe(env.id);
  });

  it('getRfqs filters by pair', () => {
    const node = new GossipNode();
    node.handleMessage('p', JSON.stringify(makeRfqEnvelope({ rfqId: 'a'.repeat(64), pair: 'tNIGHT/USDM' })));
    node.handleMessage('p', JSON.stringify(makeRfqEnvelope({ rfqId: 'b'.repeat(64), pair: 'tNIGHT/OTHER' })));
    expect(node.getRfqs({ pair: 'tNIGHT/USDM' })).toHaveLength(1);
    expect(node.getRfqs()).toHaveLength(2);
  });

  it('sweepExpired drops rfqs past their expiry and quote_refs past validUntil', () => {
    const node = new GossipNode();
    const now = Date.now();
    const nowSecs = Math.floor(now / 1000);
    node.handleMessage(
      'p',
      JSON.stringify(makeRfqEnvelope({ expiry: nowSecs + 5 })),
      now,
    );
    node.handleMessage(
      'p',
      JSON.stringify(makeSignedQuoteRefEnvelope({ validUntil: nowSecs + 5 })),
      now,
    );
    expect(node.getRfqs()).toHaveLength(1);
    expect(node.getQuoteRefs()).toHaveLength(1);

    const later = now + 6_000;
    const swept = node.sweepExpired(later);
    expect(swept.rfqsDropped).toBe(1);
    expect(swept.quoteRefsDropped).toBe(1);
    expect(node.getRfqs()).toHaveLength(0);
    expect(node.getQuoteRefs()).toHaveLength(0);
  });

  it('sweepExpired evicts seen-set entries past the 15 minute TTL', () => {
    const node = new GossipNode();
    const now = Date.now();
    node.handleMessage('p', JSON.stringify(makeRfqEnvelope()), now);
    expect(node.seenCount).toBe(1);
    const swept = node.sweepExpired(now + 15 * 60 * 1000 + 1);
    expect(swept.seenDropped).toBe(1);
    expect(node.seenCount).toBe(0);
  });
});

describe('GossipNode — rate limits and misbehavior', () => {
  it('throttles a peer that exceeds the rfq rate limit', () => {
    const node = new GossipNode();
    const limit = RATE_LIMITS.rfq;
    let lastResult;
    for (let i = 0; i < limit + 1; i++) {
      const env = makeRfqEnvelope({ rfqId: i.toString(16).padStart(64, '0') });
      lastResult = node.handleMessage('flooder', JSON.stringify(env));
    }
    expect(lastResult?.delivered).toBe(false);
    if (lastResult && !lastResult.delivered) expect(lastResult.reason).toMatch(/rate limit/);
  });

  it('does not rate-limit a well-behaved peer under the limit', () => {
    const node = new GossipNode();
    for (let i = 0; i < RATE_LIMITS.rfq - 1; i++) {
      const env = makeRfqEnvelope({ rfqId: i.toString(16).padStart(64, '0') });
      const result = node.handleMessage('good', JSON.stringify(env));
      expect(result.delivered).toBe(true);
    }
  });

  it('bans a peer whose misbehavior score crosses the threshold, and further messages are dropped', () => {
    const node = new GossipNode();
    const violationsNeeded = Math.ceil(MISBEHAVIOR_BAN_THRESHOLD / 10);
    for (let i = 0; i < violationsNeeded; i++) {
      node.handleMessage('attacker', '{not json' + i);
    }
    expect(node.peerTable.isBanned('attacker')).toBe(true);
    const result = node.handleMessage('attacker', JSON.stringify(makeRfqEnvelope()));
    expect(result.delivered).toBe(false);
    if (!result.delivered) expect(result.reason).toMatch(/banned/);
  });
});

describe('two in-process nodes gossiping', () => {
  it('propagates a message from node A to node B and converges (both see it exactly once)', () => {
    const nodeA = new GossipNode();
    const nodeB = new GossipNode();

    nodeA.addPeer({ id: 'B', send: (raw) => nodeB.handleMessage('A', raw) });
    nodeB.addPeer({ id: 'A', send: (raw) => nodeA.handleMessage('B', raw) });

    const receivedByB = vi.fn();
    nodeB.on('message', receivedByB);

    const env = makeRfqEnvelope();
    const result = nodeA.handleMessage('external-client', JSON.stringify(env));

    expect(result.delivered).toBe(true);
    expect(receivedByB).toHaveBeenCalledTimes(1);
    expect(nodeA.seenCount).toBe(1);
    expect(nodeB.seenCount).toBe(1);
    // Convergence: neither node re-forwards it again (B does not bounce it back to A causing a loop).
    expect(nodeA.getRfqs()).toHaveLength(1);
    expect(nodeB.getRfqs()).toHaveLength(1);
  });

  it('converges across a 3-node line without infinite forwarding', () => {
    const nodeA = new GossipNode();
    const nodeB = new GossipNode();
    const nodeC = new GossipNode();

    nodeA.addPeer({ id: 'B', send: (raw) => nodeB.handleMessage('A', raw) });
    nodeB.addPeer({ id: 'A', send: (raw) => nodeA.handleMessage('B', raw) });
    nodeB.addPeer({ id: 'C', send: (raw) => nodeC.handleMessage('B', raw) });
    nodeC.addPeer({ id: 'B', send: (raw) => nodeB.handleMessage('C', raw) });

    const env = makeRfqEnvelope({}, { ttl: 4 });
    nodeA.handleMessage('external-client', JSON.stringify(env));

    expect(nodeA.seenCount).toBe(1);
    expect(nodeB.seenCount).toBe(1);
    expect(nodeC.seenCount).toBe(1);
  });
});
