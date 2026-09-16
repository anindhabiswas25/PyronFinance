import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FetchZkConfigProvider } from '../src/browser-contract.js';

const root = path.resolve(import.meta.dirname, '../../../contracts/managed/otc-protocol');

function fileFetch(log: string[]) {
  return async (url: string) => {
    log.push(url);
    const rel = url.replace('https://app.test/zk/otc-protocol/', '');
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
    return new Response(fs.readFileSync(file));
  };
}

describe('FetchZkConfigProvider', () => {
  it('reads verifier keys and ZKIR from the served compiler output, once each', async () => {
    const log: string[] = [];
    const zk = new FetchZkConfigProvider('https://app.test/zk/otc-protocol/', fileFetch(log));
    const vk = await zk.getVerifierKey('releaseExpiredQuote');
    expect(Buffer.from(vk).equals(fs.readFileSync(path.join(root, 'keys/releaseExpiredQuote.verifier')))).toBe(true);
    const ir = await zk.getZKIR('releaseExpiredQuote');
    expect(Buffer.from(ir).equals(fs.readFileSync(path.join(root, 'zkir/releaseExpiredQuote.bzkir')))).toBe(true);
    await zk.getVerifierKey('releaseExpiredQuote');
    expect(log).toEqual([
      'https://app.test/zk/otc-protocol/keys/releaseExpiredQuote.verifier',
      'https://app.test/zk/otc-protocol/zkir/releaseExpiredQuote.bzkir',
    ]);
  });

  it('resolves a key location by its last segment, and refuses anything that is not a circuit name', async () => {
    const log: string[] = [];
    const zk = new FetchZkConfigProvider('https://app.test/zk/otc-protocol', fileFetch(log));
    await zk.asKeyMaterialProvider().getVerifierKey('otc-protocol/attachDisclosureNote');
    expect(log).toEqual(['https://app.test/zk/otc-protocol/keys/attachDisclosureNote.verifier']);
    await expect(zk.getZKIR('otc-protocol/..' as never)).rejects.toThrow(/not a circuit key location/);
    await expect(zk.getProverKey('post bond' as never)).rejects.toThrow(/not a circuit key location/);
    expect(log).toHaveLength(1);
  });

  it('does not cache a failed load', async () => {
    let calls = 0;
    const zk = new FetchZkConfigProvider('https://app.test/zk', async () => {
      calls++;
      return calls === 1 ? new Response('down', { status: 503 }) : new Response(new Uint8Array([1, 2, 3]));
    });
    await expect(zk.getVerifierKey('postBond')).rejects.toThrow(/HTTP 503/);
    expect(Array.from(await zk.getVerifierKey('postBond'))).toEqual([1, 2, 3]);
    expect(calls).toBe(2);
  });
});
