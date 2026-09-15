// Midnight bech32m strings (BIP-350) decoded without Node's Buffer, so a browser can turn wallet
// addresses and keys into the raw 32 bytes circuits and midnight-js take. wallet-sdk-address-format
// does the same with Buffer; test/browser-contract.test.ts checks this against it.
//
// Format: `mn_<type>_<network>1<data>`; mainnet omits `_<network>`. Types seen: addr, shield-cpk,
// shield-epk, shield-addr, dust.

import { bytesToHex } from './aead.js';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export class Bech32mError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Bech32mError';
  }
}

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function fromWords(words: number[]): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= 5 || acc !== 0) throw new Bech32mError('bech32m data has invalid padding');
  return Uint8Array.from(out);
}

function toWords(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/** `mn_<type>_<network>1…` (mainnet: `mn_<type>1…`), e.g. an unshielded address from its 32 bytes. */
export function encodeMidnightBech32m(type: string, network: string, bytes: Uint8Array): string {
  const hrp = network === 'mainnet' ? `mn_${type}` : `mn_${type}_${network}`;
  const words = toWords(bytes);
  const mod = (polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST) >>> 0;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((v) => CHARSET[v]).join('')}`;
}

export interface MidnightBech32m {
  /** e.g. "addr", "shield-cpk". */
  type: string;
  /** e.g. "preprod"; "mainnet" when the string carries no network. */
  network: string;
  bytes: Uint8Array;
}

export function decodeMidnightBech32m(value: string): MidnightBech32m {
  const str = value.trim();
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) throw new Bech32mError('bech32m string mixes upper and lower case');
  const s = str.toLowerCase();
  const sep = s.lastIndexOf('1');
  if (sep < 1 || s.length - sep - 1 < 6) throw new Bech32mError('not a bech32m string');
  const hrp = s.slice(0, sep);
  const data: number[] = [];
  for (const ch of s.slice(sep + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) throw new Bech32mError(`invalid bech32m character "${ch}"`);
    data.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== BECH32M_CONST) throw new Bech32mError('bech32m checksum does not match');
  const [prefix, type, network, ...rest] = hrp.split('_');
  if (prefix !== 'mn' || !type || rest.length) throw new Bech32mError(`"${hrp}" is not a Midnight bech32m prefix`);
  return { type, network: network ?? 'mainnet', bytes: fromWords(data.slice(0, -6)) };
}

/** A 32-byte Midnight key or address as lowercase hex. Accepts hex already, or bech32m of `type`. */
export function midnightKeyToHex(value: string, type: 'addr' | 'shield-cpk' | 'shield-epk'): string {
  const hex = value.trim().replace(/^0x/i, '');
  if (/^[0-9a-f]{64}$/i.test(hex)) return hex.toLowerCase();
  const decoded = decodeMidnightBech32m(value);
  if (decoded.type !== type) throw new Bech32mError(`expected a ${type} value, got ${decoded.type}`);
  if (decoded.bytes.length !== 32) throw new Bech32mError(`${type} must be 32 bytes, got ${decoded.bytes.length}`);
  return bytesToHex(decoded.bytes);
}
