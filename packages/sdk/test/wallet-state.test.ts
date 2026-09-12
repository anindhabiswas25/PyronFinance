// Wallet snapshot persistence. Pure filesystem — no wallet, network, or proof server needed.
//
// The failure modes here are the point: a snapshot restored into the WRONG wallet would produce a
// wallet that believes it owns coins it cannot spend, and a corrupt one must never abort startup.
// Every rejection path below degrades to "undefined" so the caller resyncs from genesis.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installedSdkVersions,
  loadWalletSnapshot,
  saveWalletSnapshot,
  walletStateDir,
} from '../src/wallet-state.js';
const ADDR = 'mn_addr_preprod1u726z5d6q7x37lhsk64t0f5zcxut4f7kk3q0lfrqyhuz4uxlmqdqnkn23g';
const OTHER_ADDR = 'mn_addr_preprod1st37jt9a6l3d65mc449lfmp92acs7h94ae3e8t4sq9687uzjhhyqd2u5uv';
const PAYLOAD = { shielded: 'shielded-blob', unshielded: 'unshielded-blob', dust: 'dust-blob' };

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otc-wallet-state-'));
  process.env.MN_WALLET_STATE_DIR = dir;
});

afterEach(() => {
  delete process.env.MN_WALLET_STATE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** The only file in the state dir — snapshot filenames are a hash, so tests shouldn't hardcode one. */
function theSnapshotFile(): string {
  const files = fs.readdirSync(dir);
  expect(files).toHaveLength(1);
  return path.join(dir, files[0]!);
}

function readFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(theSnapshotFile(), 'utf-8'));
}

function writeFile(body: unknown): void {
  fs.writeFileSync(theSnapshotFile(), JSON.stringify(body));
}

describe('wallet snapshot round-trip', () => {
  it('loads back exactly what was saved', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    expect(loadWalletSnapshot('preprod', ADDR)).toEqual(PAYLOAD);
  });

  it('returns undefined when no snapshot exists', () => {
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it('overwrites in place rather than accumulating files', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    saveWalletSnapshot('preprod', ADDR, { ...PAYLOAD, dust: 'newer-dust' });
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(loadWalletSnapshot('preprod', ADDR)?.dust).toBe('newer-dust');
  });

  it('keeps separate snapshots per wallet and per network', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    saveWalletSnapshot('preprod', OTHER_ADDR, { ...PAYLOAD, dust: 'other-wallet' });
    saveWalletSnapshot('preview', ADDR, { ...PAYLOAD, dust: 'other-network' });

    expect(fs.readdirSync(dir)).toHaveLength(3);
    expect(loadWalletSnapshot('preprod', ADDR)?.dust).toBe('dust-blob');
    expect(loadWalletSnapshot('preprod', OTHER_ADDR)?.dust).toBe('other-wallet');
    expect(loadWalletSnapshot('preview', ADDR)?.dust).toBe('other-network');
  });

  it('leaves no temp file behind (atomic write)', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('writes the snapshot 0600 — it contains the wallet coin view', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    expect(fs.statSync(theSnapshotFile()).mode & 0o777).toBe(0o600);
  });
});

describe('wallet snapshot rejection paths', () => {
  beforeEach(() => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rejects a snapshot whose stored address differs from the requested wallet', () => {
    // The dangerous case: right filename, wrong wallet inside.
    writeFile({ ...readFile(), address: OTHER_ADDR });
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it('rejects a snapshot from a different network', () => {
    writeFile({ ...readFile(), network: 'mainnet' });
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it('rejects a snapshot written by a different envelope version', () => {
    writeFile({ ...readFile(), formatVersion: 999 });
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it('rejects a snapshot written against different wallet-SDK versions', () => {
    const body = readFile() as { sdkVersions: Record<string, string> };
    const pkg = '@midnight-ntwrk/wallet-sdk-dust-wallet';
    writeFile({ ...body, sdkVersions: { ...body.sdkVersions, [pkg]: '0.0.0-stale' } });
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it.each([
    ['truncated json', '{"formatVersion":1,'],
    ['empty file', ''],
    ['json that is not an object', '"just a string"'],
  ])('rejects %s without throwing', (_label, contents) => {
    fs.writeFileSync(theSnapshotFile(), contents);
    expect(() => loadWalletSnapshot('preprod', ADDR)).not.toThrow();
    expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
  });

  it.each(['shielded', 'unshielded', 'dust'])(
    'rejects a snapshot missing its %s sub-wallet state',
    (key) => {
      const body = readFile();
      delete body[key];
      writeFile(body);
      expect(loadWalletSnapshot('preprod', ADDR)).toBeUndefined();
    },
  );
});

describe('installedSdkVersions', () => {
  // Regression: these packages' `exports` maps do not expose './package.json', so the original
  // require('<pkg>/package.json') threw and was caught into 'unknown' for every package — which
  // made the version guard compare 'unknown' to 'unknown' and never reject a stale snapshot.
  // If this ever returns 'unknown' again, the guard is silently doing nothing.
  it('resolves a real version for every tracked wallet-SDK package', () => {
    const versions = installedSdkVersions();
    expect(Object.keys(versions)).toHaveLength(3);
    for (const [pkg, version] of Object.entries(versions)) {
      expect(version, `${pkg} version should resolve`).not.toBe('unknown');
      expect(version, `${pkg} should look like a semver`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('is recorded into the snapshot it writes', () => {
    saveWalletSnapshot('preprod', ADDR, PAYLOAD);
    expect(readFile().sdkVersions).toEqual(installedSdkVersions());
  });
});

describe('walletStateDir', () => {
  it('honours MN_WALLET_STATE_DIR', () => {
    expect(walletStateDir()).toBe(dir);
  });

  it('defaults to .wallet-state under the cwd when unset', () => {
    delete process.env.MN_WALLET_STATE_DIR;
    expect(walletStateDir()).toBe(path.resolve(process.cwd(), '.wallet-state'));
  });
});
