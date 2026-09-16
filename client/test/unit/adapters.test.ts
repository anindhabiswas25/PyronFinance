import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createLiveWallet, describeWallet, injectedWallets, txOf } from '../../src/data/live/wallet';
import { fetchRelayHealth, httpBaseOf, mailboxUrl, persistReveals, relayUrlProblem } from '../../src/data/relay-util';
import { createLiveRelays } from '../../src/data/live/relays';
import { NATIVE_TOKEN_RAW, NETWORKS } from '../../src/config/networks';
import { createStorage } from '../../src/data/storage';
import type { ChainPort } from '../../src/data/ports';

function fakeInitial(over: Partial<InitialAPI> & { networkId?: string; methods?: Record<string, unknown> } = {}): InitialAPI {
  const { networkId = 'preprod', methods = {}, ...rest } = over;
  return {
    rdns: 'com.example.wallet',
    name: 'Example',
    icon: '',
    apiVersion: '4.0.1',
    connect: vi.fn(async () => ({
      getConfiguration: async () => ({ networkId, indexerUri: 'https://i', indexerWsUri: 'wss://i', substrateNodeUri: '' }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_preprod1abc' }),
      getUnshieldedBalances: async () => ({ [NATIVE_TOKEN_RAW]: 5n }),
      getDustBalance: async () => ({ cap: 10n, balance: 3n }),
      hintUsage: async () => undefined,
      getConnectionStatus: async () => ({ status: 'connected', networkId }),
      ...methods,
    })),
    ...rest,
  } as unknown as InitialAPI;
}

describe('live wallet adapter', () => {
  it('discovers v4 wallets, labels others unsupported, ignores junk', () => {
    const win = { midnight: { a: fakeInitial(), b: fakeInitial({ rdns: 'old.wallet', name: 'Old', apiVersion: '3.1.0' }), junk: { name: 1 }, nope: null } };
    const found = injectedWallets(win).map(describeWallet);
    expect(found.map((w) => [w.name, w.supported])).toEqual([
      ['Example', true],
      ['Old', false],
    ]);
    expect(found[1].unsupportedReason).toMatch(/version 4/);
  });

  it('refuses a wallet on another network', async () => {
    const port = createLiveWallet({ midnight: { a: fakeInitial({ networkId: 'preview' }) } });
    await expect(port.connect('com.example.wallet', 'preprod')).rejects.toMatchObject({ reason: 'network' });
    expect(port.connected()).toBe(false);
  });

  it('connects, converts amounts to bigint, and reports wrong shapes by name', async () => {
    const port = createLiveWallet({
      midnight: { a: fakeInitial({ methods: { balanceSealedTransaction: async () => ({ transaction: 'abc' }), getUnshieldedBalances: async () => ({ [NATIVE_TOKEN_RAW]: '42' }) } }) },
    });
    await port.connect('com.example.wallet', 'preprod');
    expect(await port.balances()).toEqual({ [NATIVE_TOKEN_RAW]: 42n });
    expect(await port.dust()).toEqual({ cap: 10n, balance: 3n });
    await expect(port.balanceSealed('00')).rejects.toThrow(/returned an object with transaction/);
  });

  it('accepts a bare string or { tx } from balancing', () => {
    expect(txOf('beef', 'x')).toBe('beef');
    expect(txOf({ tx: 'beef' }, 'x')).toBe('beef');
    expect(() => txOf(undefined, 'makeTransfer')).toThrow(/returned nothing/);
  });
});

describe('relay helpers', () => {
  it('maps gossip URLs to HTTP bases and mailbox URLs', () => {
    expect(httpBaseOf('ws://127.0.0.1:18787/gossip')).toBe('http://127.0.0.1:18787');
    expect(httpBaseOf('wss://relay.example/gossip')).toBe('https://relay.example');
    expect(mailboxUrl('http://127.0.0.1:18787', 'ab')).toBe('http://127.0.0.1:18787/mailbox/ab');
    expect(mailboxUrl('ws://127.0.0.1:18787/gossip', 'ab')).toBe('http://127.0.0.1:18787/mailbox/ab');
  });

  it('explains unusable relay URLs', () => {
    expect(relayUrlProblem('relay.example')).toMatch(/full address/);
    expect(relayUrlProblem('https://relay.example/gossip')).toMatch(/WebSocket/);
    expect(relayUrlProblem('wss://relay.example/')).toMatch(/\/gossip/);
    expect(relayUrlProblem('wss://relay.example/gossip', ['wss://relay.example/gossip'])).toMatch(/already/);
    expect(relayUrlProblem('wss://relay.example/gossip')).toBeUndefined();
  });

  it('reads /health with latency, and turns failures into a reason', async () => {
    const ok = await fetchRelayHealth('ws://r/gossip', 1000, (async () => new Response(JSON.stringify({ ok: true, peers: 2, version: 1 }))) as typeof fetch);
    expect(ok).toMatchObject({ ok: true, peers: 2, version: '1' });
    const down = await fetchRelayHealth('ws://r/gossip', 1000, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    expect(down).toMatchObject({ ok: false, error: expect.stringMatching(/Unreachable/) });
  });

  it('persists mailbox messages before handing them out, without duplicates', async () => {
    const storage = createStorage('adapters-test');
    const msg = { v: 1 as const, type: 'reveal' as const, quoteId: 'a'.repeat(64), ciphertext: 'Y2lwaGVy', sig: 'b'.repeat(192) };
    persistReveals(storage.session, 'pk', 'http://r', [msg]);
    persistReveals(storage.session, 'pk', 'http://r', [msg]);
    expect(storage.session.get<unknown[]>('reveals:pk')).toHaveLength(1);

    const relays = createLiveRelays({ chain: {} as ChainPort, session: storage.session });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      // The relay deletes on read: the adapter must already have stored what it returns.
      return new Response(JSON.stringify([{ ...msg, quoteId: 'c'.repeat(64) }, { junk: true }]));
    });
    const got = await relays.fetchMailbox('http://r', 'pk2');
    expect(got).toHaveLength(1);
    expect(storage.session.get<Array<{ msg: { quoteId: string } }>>('reveals:pk2')?.[0].msg.quoteId).toBe('c'.repeat(64));
    fetchSpy.mockRestore();
  });

  it('refuses to publish below two connected relays', () => {
    const relays = createLiveRelays({ chain: {} as ChainPort, session: createStorage('adapters-test2').session });
    expect(() => relays.publishRfq({} as never)).toThrow(/at least 2/);
  });
});

describe('network config matches the SDK and deployments', () => {
  it('native token and counter tokens', async () => {
    const sdk = await import('@otc/sdk/browser');
    expect(NATIVE_TOKEN_RAW).toBe(sdk.nativeTokenRaw());
    const { usdmFor } = await import('../../../packages/sdk/src/assets');
    expect(NETWORKS.preview.pairs[0].counter.tokenType).toBe(usdmFor('preview')!.tokenType);
    expect(NETWORKS.mainnet.pairs[0].counter.tokenType).toBe(usdmFor('mainnet')!.tokenType);
    const root = resolve(__dirname, '../../../deployments');
    expect(NETWORKS.preprod.pairs[0].counter.tokenType).toBe(JSON.parse(readFileSync(`${root}/preprod-test-token.json`, 'utf8')).tokenType);
    expect(NETWORKS.preprod.contractAddress).toBe(JSON.parse(readFileSync(`${root}/preprod.json`, 'utf8')).address);
    expect(NETWORKS.preview.contractAddress).toBe(JSON.parse(readFileSync(`${root}/preview.json`, 'utf8')).address);
    for (const n of Object.values(NETWORKS)) for (const p of n.pairs) expect(sdk.PAIR_CODES[p.code]).toBeDefined();
  });
});
