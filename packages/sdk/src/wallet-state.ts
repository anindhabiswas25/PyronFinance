// On-disk wallet sync snapshots.
//
// Why this exists: a fresh wallet replays the chain's entire event history from genesis before it
// reports isSynced. Measured on Preprod (2026-09-12): ~1.5M events, ~20 minutes, every single time
// any script starts. Without snapshots that cost is paid again by deploy, init, e2e-fraud, and
// every dealer-node restart. The sub-wallets each expose serializeState()/restore(), and their sync
// services resume from the restored state's progress.appliedIndex rather than from 0 — so
// persisting one snapshot turns subsequent startups into an incremental catch-up.
//
// SENSITIVE: a serialized snapshot contains the wallet's coin/UTXO view (not its secret keys —
// those are supplied separately at start()). Treat it like private state: 0600, git-ignored, never
// committed, never shared between wallets.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { NetworkId } from './config.js';

/** Bump when the snapshot envelope's own shape changes, to invalidate older files. */
const SNAPSHOT_FORMAT_VERSION = 1;

export interface WalletSnapshotPayload {
  shielded: string;
  unshielded: string;
  dust: string;
}

interface WalletSnapshotFile extends WalletSnapshotPayload {
  formatVersion: number;
  network: NetworkId;
  address: string;
  sdkVersions: Record<string, string>;
  savedAt: string;
}

const VERSIONED_PACKAGES = [
  '@midnight-ntwrk/wallet-sdk-shielded',
  '@midnight-ntwrk/wallet-sdk-unshielded-wallet',
  '@midnight-ntwrk/wallet-sdk-dust-wallet',
] as const;

/** Reads a dependency's version straight out of its node_modules manifest.
 *
 *  Deliberately not using the module resolver. Two separate things defeat it here:
 *  `require('<pkg>/package.json')` throws because these packages' `exports` maps don't expose
 *  './package.json', and `require.resolve('<pkg>')` throws too (ERR_PACKAGE_PATH_NOT_EXPORTED)
 *  because they are ESM-only — their `exports` declares an "import" condition with no "require".
 *  Both failures were being swallowed into 'unknown' for every package, which made the version
 *  guard below compare 'unknown' to 'unknown' and silently never reject a stale snapshot.
 *
 *  Walking up for node_modules/<pkg>/package.json is resolver-condition independent and works
 *  under pnpm's layout whether the dependency is hoisted to the workspace root or local to the
 *  package. */
function packageVersion(pkg: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth++) {
    const manifest = path.join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    try {
      if (fs.existsSync(manifest)) {
        const json = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name?: string; version?: string };
        if (json.version) return json.version;
      }
    } catch {
      // unreadable/malformed manifest — keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
}

/** The serialized formats belong to the wallet SDK, not to us — a version change can silently
 *  alter them. Recording the versions lets a snapshot be rejected instead of fed to a restore()
 *  that might accept it and produce a subtly wrong state. */
export function installedSdkVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of VERSIONED_PACKAGES) out[p] = packageVersion(p);
  return out;
}

/** `<workspace root>/.wallet-state`, whatever directory a command runs from. Found 2026-09-14 timing the
 *  operator README on a brand-new wallet: `pnpm run fund` (repo root) saved the snapshot to
 *  `./.wallet-state`, then `pnpm bond` (packages/dealer-node) looked in `packages/dealer-node/.wallet-state`,
 *  found nothing and re-synced from genesis — a second ~28-minute sync the README said would take seconds.
 *  The workspace root is the nearest ancestor holding pnpm-workspace.yaml; outside a workspace, the cwd. */
export function walletStateDir(): string {
  if (process.env.MN_WALLET_STATE_DIR) return process.env.MN_WALLET_STATE_DIR;
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, '.wallet-state');
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(process.cwd(), '.wallet-state');
    dir = parent;
  }
}

/** Keyed by network AND address: restoring one wallet's state into another would produce a wallet
 *  that believes it owns coins it cannot spend. The address is hashed for a short filename and
 *  also stored in full inside the file so a collision or a stale file is caught on load. */
function snapshotPath(network: NetworkId, address: string): string {
  const digest = crypto.createHash('sha256').update(address).digest('hex').slice(0, 16);
  return path.join(walletStateDir(), `${network}-${digest}.json`);
}

/** Returns the snapshot only if it is present, parseable, and matches this network, address,
 *  envelope version and SDK version set. Any mismatch or corruption returns undefined so the
 *  caller falls back to a full sync — a slow start is always preferable to a wrong wallet state. */
export function loadWalletSnapshot(
  network: NetworkId,
  address: string,
): WalletSnapshotPayload | undefined {
  const file = snapshotPath(network, address);
  let parsed: WalletSnapshotFile;
  try {
    if (!fs.existsSync(file)) return undefined;
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WalletSnapshotFile;
  } catch (err) {
    console.warn(`[wallet-state] ignoring unreadable snapshot ${file}: ${(err as Error).message}`);
    return undefined;
  }

  const reject = (why: string): undefined => {
    console.warn(`[wallet-state] ignoring snapshot ${file} (${why}); falling back to a full sync`);
    return undefined;
  };

  if (parsed.formatVersion !== SNAPSHOT_FORMAT_VERSION) return reject('format version changed');
  if (parsed.network !== network) return reject('different network');
  if (parsed.address !== address) return reject('different wallet address');
  if (typeof parsed.shielded !== 'string' || typeof parsed.unshielded !== 'string' || typeof parsed.dust !== 'string') {
    return reject('missing sub-wallet state');
  }

  const current = installedSdkVersions();
  for (const [pkg, version] of Object.entries(current)) {
    if (parsed.sdkVersions?.[pkg] !== version) {
      return reject(`${pkg} changed ${parsed.sdkVersions?.[pkg] ?? 'unknown'} -> ${version}`);
    }
  }

  return { shielded: parsed.shielded, unshielded: parsed.unshielded, dust: parsed.dust };
}

/** Written atomically (tmp file + rename) so an interrupted or concurrent run can never leave a
 *  half-written snapshot that a later run would try to restore. */
export function saveWalletSnapshot(
  network: NetworkId,
  address: string,
  payload: WalletSnapshotPayload,
): void {
  const file = snapshotPath(network, address);
  const body: WalletSnapshotFile = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    network,
    address,
    sdkVersions: installedSdkVersions(),
    savedAt: new Date().toISOString(),
    ...payload,
  };

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
