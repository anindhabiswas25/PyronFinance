// B1 (task 3.1): config validation and key management. The negative cases are the point — a node
// must refuse at startup anything that would make it quote too much, leak a secret, or lose a key.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, loadConfig, ConfigError } from '../src/config.js';
import { deriveIdentity, generateSecretFile, loadSecretFile, IdentityError } from '../src/identity.js';
import { dealerCommitment } from '../../sdk/src/domain.js';
import { schnorrSign, schnorrVerify, freshNonce } from '../../sdk/src/schnorr.js';

const EXAMPLE = path.resolve(import.meta.dirname, '../dealer.example.toml');

function withExample(mutate: (text: string) => string): string {
  return mutate(fs.readFileSync(EXAMPLE, 'utf-8'));
}

describe('config', () => {
  it('accepts the shipped example', () => {
    const cfg = loadConfig(EXAMPLE);
    expect(cfg.policies[0].pair).toBe('tNIGHT/TESTUSD');
    expect(cfg.policies[0].maxSize).toBe(2000n);
    expect(cfg.relays.endpoints.length).toBeGreaterThanOrEqual(2);
    expect(cfg.risk.haltOnSlash).toBe(true);
    expect(cfg.reserve.minUtxos).toBeGreaterThanOrEqual(1);
  });

  it('REJECTS the removed Class B challenge setting', () => {
    const text = withExample((t) => t.replace('[risk]', '[risk]\nchallenge_response_secs = 120'));
    expect(() => parseConfig(text)).toThrow(/Class B/);
  });

  it('REJECTS an amount written as a TOML number — amounts are never floats', () => {
    const text = withExample((t) => t.replace('max_size        = "0.002"', 'max_size        = 0.002'));
    expect(() => parseConfig(text)).toThrow(/decimal STRING/);
  });

  it('REJECTS a secret written into the config', () => {
    const text = withExample((t) => t.replace('[identity]', '[identity]\nwallet_seed = "deadbeef"'));
    expect(() => parseConfig(text)).toThrow(/secrets must never/);
  });

  it('REJECTS a single relay', () => {
    const text = withExample((t) => t.replace(/endpoints = \[[^\]]*\]/s, 'endpoints = ["ws://127.0.0.1:18787/gossip"]'));
    expect(() => parseConfig(text)).toThrow(/at least 2 relays/);
  });

  it('REJECTS a validity window above the contract maximum', () => {
    const text = withExample((t) => t.replace('validity_secs   = 300', 'validity_secs   = 901'));
    expect(() => parseConfig(text)).toThrow(/validity_secs/);
  });

  it('REJECTS an expiry margin that would keep offers unable to back a quote', () => {
    const text = withExample((t) => t.replace('expiry_margin_secs = 900', 'expiry_margin_secs = 500'));
    expect(() => parseConfig(text)).toThrow(/expiry_margin_secs/);
  });

  it('REJECTS a refresh cadence that lets offers age past the margin between ticks', () => {
    const text = withExample((t) => t.replace('refresh_secs    = 1800', 'refresh_secs    = 3000'));
    expect(() => parseConfig(text)).toThrow(/refresh_secs/);
  });

  it('REJECTS the testnet stand-in pair on mainnet', () => {
    const text = withExample((t) => t.replace('network       = "preprod"', 'network       = "mainnet"'));
    expect(() => parseConfig(text)).toThrow(/testnet scaffolding/);
  });

  it('REJECTS a per-quote size above the total notional cap', () => {
    const text = withExample((t) => t.replace('max_total_notional = "0.02"', 'max_total_notional = "0.001"'));
    expect(() => parseConfig(text)).toThrow(/max_total_notional/);
  });

  it('REJECTS a manual mid with no price', () => {
    const text = withExample((t) => t.replace(/mid_price\s*=\s*"[^"]*"\n/, ''));
    expect(() => parseConfig(text)).toThrow(/mid_price/);
  });

  it('REJECTS malformed TOML with a ConfigError', () => {
    expect(() => parseConfig('[identity\n')).toThrow(ConfigError);
  });
});

describe('identity', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dn-id-'));

  it('derives a stable identity: same secret, same commitment and keys', () => {
    const s = new Uint8Array(32).fill(7);
    const a = deriveIdentity(s);
    const b = deriveIdentity(s);
    expect(Buffer.from(a.dealerCmt)).toEqual(Buffer.from(dealerCommitment(s)));
    expect(a.quoteSk).toBe(b.quoteSk);
    expect(Buffer.from(a.reveal.pk)).toEqual(Buffer.from(b.reveal.pk));
  });

  it('derives distinct role keys — the quote key and reveal key are not the dealer secret', () => {
    const s = new Uint8Array(32).fill(9);
    const id = deriveIdentity(s);
    expect(Buffer.from(id.reveal.sk)).not.toEqual(Buffer.from(s));
    expect(id.quoteSk.toString(16)).not.toBe(Buffer.from(s).toString('hex'));
    expect(Buffer.from(deriveIdentity(new Uint8Array(32).fill(10)).reveal.pk)).not.toEqual(Buffer.from(id.reveal.pk));
  });

  it('the derived quote key signs reveals that verify under its public key', () => {
    const id = deriveIdentity(new Uint8Array(32).fill(3));
    const msg = [1n, 1n, 41_440_000n, 1000n];
    expect(schnorrVerify(msg, schnorrSign(msg, id.quoteSk, freshNonce()), id.quotePk)).toBe(true);
  });

  it('generates a 0600 key file and reloads the same identity', () => {
    const file = path.join(tmp(), 'secrets', 'dealer.key');
    const created = generateSecretFile(file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(Buffer.from(loadSecretFile(file).dealerCmt)).toEqual(Buffer.from(created.dealerCmt));
  });

  it('REFUSES to overwrite an existing key — that would orphan a bond', () => {
    const file = path.join(tmp(), 'dealer.key');
    generateSecretFile(file);
    expect(() => generateSecretFile(file)).toThrow(/refusing to overwrite/);
  });

  it('REFUSES a key file readable by others', () => {
    const file = path.join(tmp(), 'dealer.key');
    generateSecretFile(file);
    fs.chmodSync(file, 0o644);
    expect(() => loadSecretFile(file)).toThrow(IdentityError);
  });

  it('REFUSES a malformed key file', () => {
    const file = path.join(tmp(), 'dealer.key');
    fs.writeFileSync(file, 'not-hex\n', { mode: 0o600 });
    expect(() => loadSecretFile(file)).toThrow(/64 hex/);
  });
});
