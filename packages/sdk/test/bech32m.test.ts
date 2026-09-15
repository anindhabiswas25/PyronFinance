// The browser bech32m decoder against Midnight's own codec (wallet-sdk-address-format, which needs
// Node's Buffer and so cannot run in a browser).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { Bech32mError, decodeMidnightBech32m, midnightKeyToHex } from '../src/bech32m.js';

const cases = [
  ['addr', (b: Buffer) => UnshieldedAddress.codec.encode, (b: Buffer) => new UnshieldedAddress(b)],
  ['shield-cpk', () => ShieldedCoinPublicKey.codec.encode, (b: Buffer) => new ShieldedCoinPublicKey(b)],
  ['shield-epk', () => ShieldedEncryptionPublicKey.codec.encode, (b: Buffer) => new ShieldedEncryptionPublicKey(b)],
] as const;

function encode(type: (typeof cases)[number][0], network: string, bytes: Buffer): string {
  switch (type) {
    case 'addr':
      return UnshieldedAddress.codec.encode(network as never, new UnshieldedAddress(bytes)).asString();
    case 'shield-cpk':
      return ShieldedCoinPublicKey.codec.encode(network as never, new ShieldedCoinPublicKey(bytes)).asString();
    case 'shield-epk':
      return ShieldedEncryptionPublicKey.codec.encode(network as never, new ShieldedEncryptionPublicKey(bytes)).asString();
  }
}

describe('Midnight bech32m decoding', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const [type] of cases) {
    for (const network of ['preprod', 'preview', 'mainnet']) {
      it(`matches wallet-sdk-address-format for ${type} on ${network}, without Buffer`, () => {
        for (let i = 0; i < 20; i++) {
          const bytes = randomBytes(32);
          const str = encode(type, network, bytes);
          vi.stubGlobal('Buffer', undefined);
          const decoded = decodeMidnightBech32m(str);
          const hex = midnightKeyToHex(str, type);
          vi.unstubAllGlobals();
          expect(decoded.type).toBe(type);
          expect(decoded.network).toBe(network);
          expect(hex).toBe(bytes.toString('hex'));
        }
      });
    }
  }

  it('passes hex through and refuses the wrong type, a bad checksum and mixed case', () => {
    const bytes = randomBytes(32);
    expect(midnightKeyToHex(`0x${bytes.toString('hex').toUpperCase()}`, 'addr')).toBe(bytes.toString('hex'));
    const addr = encode('addr', 'preprod', bytes);
    expect(() => midnightKeyToHex(addr, 'shield-cpk')).toThrow(/expected a shield-cpk value, got addr/);
    const last = addr.at(-1) === 'q' ? 'p' : 'q';
    expect(() => decodeMidnightBech32m(addr.slice(0, -1) + last)).toThrow(Bech32mError);
    expect(() => decodeMidnightBech32m(addr.slice(0, 10).toUpperCase() + addr.slice(10))).toThrow(/mixes upper and lower case/);
    expect(() => decodeMidnightBech32m('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toThrow(Bech32mError);
  });
});
