// An encrypted record in IndexedDB. The key is derived from a passphrase with PBKDF2-SHA256 (600,000
// iterations) and never leaves memory; the record is AES-GCM with a fresh IV on every write, and its
// storage key is bound in as associated data so one record can't be swapped in for another.
//
// Used for trade history (/me) and dealer keys (/desk). Where the passphrase comes from is an open
// decision; the owner chose a passphrase for both (2026-09-15). Everything behind this module only
// sees a Vault, so a wallet-derived key would replace deriveVaultKey and nothing else.

import type { AsyncStore } from '../data/ports';
import { parse, stringify } from './bigint-json';
import { bytesToHex, hexToBytes } from './hex';

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

interface SealedRecord {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase doesn’t unlock this history');
    this.name = 'WrongPassphraseError';
  }
}

export interface UnlockedVault<T> {
  read(): T;
  write(value: T): Promise<void>;
}

export interface Vault<T> {
  exists(): Promise<boolean>;
  /** Refuses to overwrite an existing record: that would destroy what another passphrase protects. */
  create(passphrase: string, value: T): Promise<UnlockedVault<T>>;
  /** Throws WrongPassphraseError and changes nothing when the passphrase is wrong. */
  unlock(passphrase: string): Promise<UnlockedVault<T>>;
  destroy(): Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Web Crypto takes ArrayBuffer-backed views only; copy anything that might be shared. */
const ab = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser has no Web Crypto; encrypted storage needs a secure (https or localhost) page.');
  return s;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', ab(enc.encode(passphrase.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: ab(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function createVault<T>(store: AsyncStore, key: string, options: { iterations?: number } = {}): Vault<T> {
  const aad = ab(enc.encode(`pyron-vault:${key}`));
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;

  async function seal(cryptoKey: CryptoKey, salt: Uint8Array, iters: number, value: T): Promise<SealedRecord> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cryptoKey, ab(enc.encode(stringify(value)))));
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: iters, salt: bytesToHex(salt), iv: bytesToHex(iv), ct: toBase64(ct) };
  }

  function opened(cryptoKey: CryptoKey, salt: Uint8Array, iters: number, initial: T): UnlockedVault<T> {
    let current = initial;
    return {
      read: () => current,
      async write(value) {
        await store.set(key, await seal(cryptoKey, salt, iters, value));
        current = value;
      },
    };
  }

  return {
    async exists() {
      return (await store.get<SealedRecord>(key)) !== undefined;
    },
    async create(passphrase, value) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      if (await store.get(key)) throw new Error('An encrypted record already exists here. Unlock it, or delete it first.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const cryptoKey = await deriveVaultKey(passphrase, salt, iterations);
      await store.set(key, await seal(cryptoKey, salt, iterations, value));
      return opened(cryptoKey, salt, iterations, value);
    },
    async unlock(passphrase) {
      const record = await store.get<SealedRecord>(key);
      if (!record) throw new Error('Nothing is stored here yet.');
      const salt = hexToBytes(record.salt);
      const cryptoKey = await deriveVaultKey(passphrase, salt, record.iterations);
      let plain: ArrayBuffer;
      try {
        plain = await subtle().decrypt({ name: 'AES-GCM', iv: ab(hexToBytes(record.iv)), additionalData: aad }, cryptoKey, ab(fromBase64(record.ct)));
      } catch {
        throw new WrongPassphraseError();
      }
      return opened(cryptoKey, salt, record.iterations, parse<T>(dec.decode(plain)));
    },
    async destroy() {
      await store.remove(key);
    },
  };
}
