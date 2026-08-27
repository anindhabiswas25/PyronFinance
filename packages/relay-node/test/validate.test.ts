// Every rejection path from RELAY.md §5 — oversized frame, unknown major version, bad signature,
// absent signature on a type that requires one, clock skew beyond 120s, expired message, id
// mismatch. See CLAUDE.md's M2 testing expectations.

import { describe, expect, it } from 'vitest';
import { parseAndValidate } from '../src/validate.js';
import { MAX_MSG_BYTES } from '../src/schema.js';
import { makeRfqEnvelope, makeSignedQuoteRefEnvelope, makeSignedCancelEnvelope, nowSecs } from './helpers.js';

describe('parseAndValidate — happy paths', () => {
  it('accepts a well-formed rfq', () => {
    const env = makeRfqEnvelope();
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed, correctly signed quote_ref', () => {
    const env = makeSignedQuoteRefEnvelope();
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed, correctly signed cancel', () => {
    const env = makeSignedCancelEnvelope();
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });

  it('ignores unknown fields rather than erroring (extensibility)', () => {
    const env = { ...makeRfqEnvelope(), extraField: 'from the future' };
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });
});

describe('parseAndValidate — rejection paths', () => {
  it('rejects a frame larger than MAX_MSG_BYTES', () => {
    const env = makeRfqEnvelope({ pair: 'x'.repeat(MAX_MSG_BYTES) });
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penalize).toBe(true);
      expect(result.reason).toMatch(/MAX_MSG_BYTES/);
    }
  });

  it('ignores (does not penalize) an unimplemented major version', () => {
    const env = { ...makeRfqEnvelope(), v: 2 };
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penalize).toBe(false);
      expect(result.ignore).toBe(true);
    }
  });

  it('rejects malformed JSON', () => {
    const result = parseAndValidate('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.penalize).toBe(true);
  });

  it('rejects an unknown message type', () => {
    const env = { ...makeRfqEnvelope(), type: 'not_a_real_type' };
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
  });

  it('rejects a quote_ref with a missing signature', () => {
    const { sig, ...rest } = makeSignedQuoteRefEnvelope();
    void sig;
    const result = parseAndValidate(JSON.stringify(rest));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/sig/);
  });

  it('rejects a cancel with a malformed (wrong-length) signature', () => {
    const env = { ...makeSignedCancelEnvelope(), sig: 'deadbeef' };
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.penalize).toBe(true);
  });

  it('rejects a message whose ts is more than 120s in the future', () => {
    const env = makeRfqEnvelope({}, { ts: nowSecs() + 121 });
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/future/);
  });

  it('accepts a message exactly at the 120s skew boundary', () => {
    const env = makeRfqEnvelope({}, { ts: nowSecs() + 120 });
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });

  it('rejects an rfq already past its own expiry', () => {
    const env = makeRfqEnvelope({ expiry: nowSecs() - 10 });
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expiry/);
  });

  it('rejects a quote_ref already past validUntil', () => {
    const env = makeSignedQuoteRefEnvelope({ validUntil: nowSecs() - 10 });
    const result = parseAndValidate(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/validUntil/);
  });

  it('rejects on id/body mismatch (recomputed hash disagrees with claimed id)', () => {
    const env = makeRfqEnvelope();
    const tampered = { ...env, body: { ...env.body, size: '999999.0' } };
    const result = parseAndValidate(JSON.stringify(tampered));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.penalize).toBe(true);
      expect(result.reason).toMatch(/id does not match/);
    }
  });

  it('rejects rfq body missing required fields', () => {
    const env = makeRfqEnvelope();
    const bad = { ...env, body: { ...env.body, takerEncPk: undefined } };
    const result = parseAndValidate(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects a decimal amount encoded as a JSON number instead of a string', () => {
    const env = makeRfqEnvelope();
    const raw = JSON.stringify(env).replace('"1000.0"', '1000.0');
    const result = parseAndValidate(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects peer_announce with non-array pairs', () => {
    const body = { endpoint: 'wss://relay-c.example/gossip', pairs: 'tNIGHT/USDM' };
    const raw = JSON.stringify({ v: 1, type: 'peer_announce', id: 'a'.repeat(64), ts: nowSecs(), ttl: 3, body });
    const result = parseAndValidate(raw);
    expect(result.ok).toBe(false);
  });
});
