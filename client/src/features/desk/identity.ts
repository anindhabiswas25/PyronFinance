// A dealer's identity in the browser, derived exactly as the Dealer Node derives it
// (packages/dealer-node/src/identity.ts), so one key works in both and a key file moves between them:
//
//   dealerSk = the 32 bytes                          -> dealerCommitment(dealerSk), the circuits' witness
//   quoteSk  = SHA-256("otc:dn:quote-key:v1" ‖ s) mod the Jubjub order  -> registered by postBond
//   revealSk = SHA-256("otc:dn:reveal-key:v1" ‖ s)                      -> the X25519 key behind dealerEncPk

import * as sdk from '@otc/sdk/browser';

export const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

export interface DealerIdentity {
  secret: Uint8Array;
  dealerCmt: string;
  quoteSk: bigint;
  quotePk: ReturnType<typeof sdk.schnorrPublicKey>;
  revealSk: Uint8Array;
  revealPk: Uint8Array;
}

async function tagged(tag: string, secret: Uint8Array): Promise<Uint8Array> {
  const t = new TextEncoder().encode(tag);
  const data = new Uint8Array(t.length + secret.length);
  data.set(t);
  data.set(secret, t.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export async function deriveDealerIdentity(secret: Uint8Array): Promise<DealerIdentity> {
  if (secret.length !== 32) throw new Error('A dealer key is 32 bytes (64 hex characters).');
  let quoteSk = BigInt('0x' + sdk.bytesToHex(await tagged('otc:dn:quote-key:v1', secret))) % JUBJUB_ORDER;
  if (quoteSk === 0n) quoteSk = 1n;
  const reveal = sdk.encKeypairFromSecret(await tagged('otc:dn:reveal-key:v1', secret));
  return {
    secret: new Uint8Array(secret),
    dealerCmt: sdk.bytesToHex(sdk.dealerCommitment(secret)),
    quoteSk,
    quotePk: sdk.schnorrPublicKey(quoteSk),
    revealSk: reveal.sk,
    revealPk: reveal.pk,
  };
}

/** A Dealer Node key file (64 hex characters) or a backup file saved by this app. */
export function parseDealerKeyInput(text: string): { ok: true; secret: Uint8Array } | { ok: false; error: string } {
  const trimmed = text.trim();
  let hex = trimmed;
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as { kind?: unknown; secret?: unknown };
      if (o.kind !== 'pyron-dealer-key' || typeof o.secret !== 'string') return { ok: false, error: 'This JSON isn’t a dealer key backup.' };
      hex = o.secret;
    } catch {
      return { ok: false, error: 'That isn’t valid JSON.' };
    }
  }
  hex = hex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { ok: false, error: 'A dealer key is 64 hex characters, as in the Dealer Node’s key file.' };
  return { ok: true, secret: sdk.hexToBytes(hex.toLowerCase()) };
}
