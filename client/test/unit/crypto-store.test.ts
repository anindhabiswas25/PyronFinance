// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createVault, WrongPassphraseError } from '../../src/lib/crypto-store';
import type { AsyncStore } from '../../src/data/ports';

function memoryStore(): AsyncStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: async <T>(k: string) => raw.get(k) as T | undefined,
    set: async (k, v) => void raw.set(k, v),
    remove: async (k) => void raw.delete(k),
    keys: async (p = '') => [...raw.keys()].filter((k) => k.startsWith(p)),
  };
}

const opts = { iterations: 2_000 };

describe('encrypted vault', () => {
  it('round-trips bigint values and stores only ciphertext', async () => {
    const store = memoryStore();
    const vault = createVault<{ amount: bigint; price: string }[]>(store, 'trade-history', opts);
    const open = await vault.create('correct horse battery', [{ amount: 41_316n, price: '41.315680' }]);
    await open.write([...open.read(), { amount: 2n ** 70n, price: '41.52' }]);
    const stored = JSON.stringify(store.raw.get('trade-history'));
    expect(stored).not.toContain('41.315680');
    expect(stored).not.toContain('41316');
    const again = await createVault<{ amount: bigint; price: string }[]>(store, 'trade-history', opts).unlock('correct horse battery');
    expect(again.read()).toEqual([
      { amount: 41_316n, price: '41.315680' },
      { amount: 2n ** 70n, price: '41.52' },
    ]);
  });

  it('refuses a wrong passphrase and changes nothing', async () => {
    const store = memoryStore();
    const vault = createVault<string[]>(store, 'trade-history', opts);
    await vault.create('correct horse battery', ['a']);
    const before = JSON.stringify(store.raw.get('trade-history'));
    await expect(vault.unlock('wrong horse battery')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(vault.unlock('wrong horse battery')).rejects.toThrow('That passphrase doesn’t unlock this history');
    expect(JSON.stringify(store.raw.get('trade-history'))).toBe(before);
    expect((await vault.unlock('correct horse battery')).read()).toEqual(['a']);
  });

  it('binds the record to its key: a record copied under another key does not open', async () => {
    const store = memoryStore();
    await createVault<string[]>(store, 'trade-history', opts).create('correct horse battery', ['a']);
    store.raw.set('dealer-key', store.raw.get('trade-history'));
    await expect(createVault<string[]>(store, 'dealer-key', opts).unlock('correct horse battery')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('refuses short passphrases and never overwrites an existing record', async () => {
    const store = memoryStore();
    const vault = createVault<string[]>(store, 'trade-history', opts);
    await expect(vault.create('short', [])).rejects.toThrow(/at least 10/);
    await vault.create('correct horse battery', ['a']);
    await expect(vault.create('another passphrase', [])).rejects.toThrow(/already exists/);
  });

  it('uses 600,000 PBKDF2 iterations by default', async () => {
    const store = memoryStore();
    await createVault<string[]>(store, 'k').create('correct horse battery', []);
    expect((store.raw.get('k') as { iterations: number }).iterations).toBe(600_000);
  });
});
