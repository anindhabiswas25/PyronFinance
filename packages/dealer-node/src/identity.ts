// Dealer key management — DEALER-NODE.md §2 [identity], CONTRACTS.md §3.
//
// ONE secret file, 32 random bytes, mode 0600, never in the repo. Everything the dealer signs or
// decrypts with is derived from it under distinct domain tags, so a restart on the same file
// reproduces the same on-chain identity, quote key and reveal key:
//
//   dealerSk   = the 32 bytes themselves      -> dealerCommitment(dealerSk), witnessed by circuits
//   quoteSk    = H("otc:dn:quote-key:v1"  ‖ s) mod Jubjub order  -> registered in postBond, signs reveals
//   revealSk   = H("otc:dn:reveal-key:v1" ‖ s)                   -> X25519 key behind dealerEncPk
//
// Distinct tags matter for the same reason CONTRACTS.md's derivations use them: a value valid in one
// role must never be replayable in another. The dealer commitment is a persistentHash under
// "otc:dealer:v1", which no tag here collides with.
//
// The WALLET seed is a separate secret with a separate threat model (it moves funds; this file only
// identifies and signs), so it is read from MN_WALLET_SEED or its own file, never from here or TOML.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { dealerCommitment } from '../../sdk/src/domain.js';
import { schnorrPublicKey } from '../../sdk/src/schnorr.js';
import { encKeypairFromSecret, type EncKeypair } from '../../sdk/src/reveal-channel.js';

/** Jubjub scalar field order (the Schnorr key space) — same constant the e2e scripts reduce by. */
export const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

export interface DealerIdentity {
  dealerSk: Uint8Array;
  dealerCmt: Uint8Array;
  quoteSk: bigint;
  quotePk: JubjubPoint;
  reveal: EncKeypair;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

function tagged(tag: string, secret: Uint8Array): Buffer {
  return createHash('sha256').update(tag).update(secret).digest();
}

export function deriveIdentity(secret: Uint8Array): DealerIdentity {
  if (secret.length !== 32) throw new IdentityError(`dealer secret must be 32 bytes, got ${secret.length}`);
  // Reduce a 256-bit digest into the scalar field. Bias is ~2^-3 relative for a 253-bit order, which
  // is irrelevant for a key that is never used as a nonce; retry on zero only.
  let quoteSk = BigInt('0x' + tagged('otc:dn:quote-key:v1', secret).toString('hex')) % JUBJUB_ORDER;
  if (quoteSk === 0n) quoteSk = 1n;
  const reveal = encKeypairFromSecret(new Uint8Array(tagged('otc:dn:reveal-key:v1', secret)));
  return {
    dealerSk: new Uint8Array(secret),
    dealerCmt: dealerCommitment(secret),
    quoteSk,
    quotePk: schnorrPublicKey(quoteSk),
    reveal,
  };
}

/** Writes a fresh secret. Refuses to overwrite: overwriting a bonded dealer's key file orphans the
 *  bond (withdrawal needs the key) and every live quote (reveal needs the quote key). */
export function generateSecretFile(file: string): DealerIdentity {
  if (fs.existsSync(file)) throw new IdentityError(`${file} already exists — refusing to overwrite a dealer key`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, secret.toString('hex') + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return deriveIdentity(secret);
}

/** Loads the secret, refusing a file other users can read — a readable dealer key lets anyone
 *  sign reveals as this dealer, which is exactly what Class A slashes. */
export function loadSecretFile(file: string): DealerIdentity {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new IdentityError(`dealer key ${file} not found — run \`gen-key\` first`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new IdentityError(
      `dealer key ${file} has mode ${(stat.mode & 0o777).toString(8)}; it must not be group/world accessible (chmod 600)`,
    );
  }
  const hex = fs.readFileSync(file, 'utf-8').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new IdentityError(`dealer key ${file} is not 64 hex characters`);
  return deriveIdentity(new Uint8Array(Buffer.from(hex, 'hex')));
}

/** The wallet seed: MN_WALLET_SEED, else the file named by [identity].wallet_seed_path. */
export function loadWalletSeed(seedPath: string | undefined): string {
  const env = process.env.MN_WALLET_SEED;
  if (env) return env;
  if (!seedPath) throw new IdentityError('no wallet seed: set MN_WALLET_SEED or [identity].wallet_seed_path');
  const stat = fs.statSync(seedPath);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new IdentityError(`wallet seed ${seedPath} must be chmod 600`);
  }
  return fs.readFileSync(seedPath, 'utf-8').trim();
}
