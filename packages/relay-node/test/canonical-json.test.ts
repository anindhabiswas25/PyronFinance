// canonicalJSON / computeId determinism — RELAY.md §2: two nodes must compute the same id
// independently or dedup silently fails and messages loop.

import { describe, expect, it } from 'vitest';
import { canonicalJSON, computeId, type RfqBody } from '../src/schema.js';

const baseBody: RfqBody = {
  rfqId: 'a'.repeat(64),
  pair: 'tNIGHT/USDM',
  side: 'buy',
  size: '1000.0',
  expiry: 1756300300,
  takerEncPk: 'b'.repeat(64),
  replyTo: ['wss://relay-a.example/gossip', 'wss://relay-b.example/gossip'],
};

describe('canonicalJSON', () => {
  it('sorts keys lexicographically regardless of input order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(canonicalJSON(a)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys too', () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces no insignificant whitespace', () => {
    expect(canonicalJSON({ a: 1, b: [1, 2] })).not.toMatch(/\s/);
  });

  it('round-trips through arbitrary key reordering for the same logical body', () => {
    const shuffled: RfqBody = {
      side: baseBody.side,
      takerEncPk: baseBody.takerEncPk,
      pair: baseBody.pair,
      expiry: baseBody.expiry,
      rfqId: baseBody.rfqId,
      replyTo: baseBody.replyTo,
      size: baseBody.size,
    };
    expect(canonicalJSON(baseBody)).toBe(canonicalJSON(shuffled));
  });

  it('handles unicode without corruption', () => {
    const withUnicode = { pair: '💱/USDM', note: '日本語 café' };
    const json = canonicalJSON(withUnicode);
    expect(JSON.parse(json)).toEqual(withUnicode);
  });

  it('omits undefined fields rather than serializing null', () => {
    const withUndefined = { a: 1, b: undefined };
    expect(canonicalJSON(withUndefined)).toBe('{"a":1}');
  });

  it('rejects non-integer numbers (amounts must be decimal strings, never floats)', () => {
    expect(() => canonicalJSON({ x: 1.5 })).toThrow();
  });

  it('never uses exponent notation for large-but-safe integers', () => {
    expect(canonicalJSON({ ts: 1756300000 })).toBe('{"ts":1756300000}');
  });
});

describe('computeId', () => {
  it('is deterministic', () => {
    expect(computeId(baseBody)).toBe(computeId(baseBody));
  });

  it('agrees across differently-ordered but logically identical bodies', () => {
    const reordered: RfqBody = { ...baseBody };
    const idA = computeId(baseBody);
    const idB = computeId(JSON.parse(JSON.stringify(reordered)));
    expect(idA).toBe(idB);
  });

  it('is sensitive to every field', () => {
    const base = computeId(baseBody);
    expect(computeId({ ...baseBody, size: '1000.1' })).not.toBe(base);
    expect(computeId({ ...baseBody, side: 'sell' })).not.toBe(base);
    expect(computeId({ ...baseBody, rfqId: 'c'.repeat(64) })).not.toBe(base);
  });

  it('produces a 32-byte hex id', () => {
    const id = computeId(baseBody);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
