// @vitest-environment node
// The browser derives a dealer's identity exactly as the Dealer Node does, so one key works in both.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deriveIdentity } from '../../../packages/dealer-node/src/identity';
import { deriveDealerIdentity, parseDealerKeyInput } from '../../src/features/desk/identity';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('dealer identity', () => {
  it('matches the Dealer Node for random keys', async () => {
    for (let i = 0; i < 5; i++) {
      const secret = new Uint8Array(randomBytes(32));
      const node = deriveIdentity(secret);
      const browser = await deriveDealerIdentity(secret);
      expect(browser.dealerCmt).toBe(hex(node.dealerCmt));
      expect(browser.quoteSk).toBe(node.quoteSk);
      expect(browser.quotePk).toEqual(node.quotePk);
      expect(hex(browser.revealPk)).toBe(hex(node.reveal.pk));
      expect(hex(browser.revealSk)).toBe(hex(node.reveal.sk));
    }
  });

  it('reads a Dealer Node key file and this app’s backup, and refuses anything else', () => {
    const secret = 'ab'.repeat(32);
    expect(parseDealerKeyInput(`${secret}\n`)).toMatchObject({ ok: true });
    expect(parseDealerKeyInput(JSON.stringify({ kind: 'pyron-dealer-key', secret }))).toMatchObject({ ok: true });
    expect(parseDealerKeyInput('abc')).toMatchObject({ ok: false });
    expect(parseDealerKeyInput('{"kind":"other"}')).toMatchObject({ ok: false, error: 'This JSON isn’t a dealer key backup.' });
  });
});
