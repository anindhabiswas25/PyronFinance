// Sample Offer Files, for demos and tests only.
//
// Built from throwaway signing keys and made-up UTXOs, then mock-proved: they deserialize, carry a
// real balance vector, are signed over their real intent data, and cost exactly what a real
// transaction of the same shape costs, so offerMatchesTerms and the time-to-dismiss check genuinely
// run on them. They spend coins that do not exist and could never settle on any chain.
//
// A real dealer half is built by the dealer's wallet (offers.ts buildAndProveOffer); a real
// settlement is balanced by the taker's wallet. Nothing here replaces either.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { base64ToBytes, bytesToBase64, bytesToHex, randomBytesU8 } from './aead.js';
import { inputsOf } from './offers.js';

export interface SampleLeg {
  /** RawTokenType hex. */
  token: string;
  amount: bigint;
}

function signedIntent(segment: number, gives: SampleLeg, wants: SampleLeg, inputCount: number, ttlSecs: number) {
  const sk = ledger.sampleSigningKey();
  const vk = ledger.signatureVerifyingKey(sk);
  const owner = ledger.addressFromKey(vk);
  const n = Math.max(1, Math.floor(inputCount));
  const each = gives.amount / BigInt(n);
  const inputs: ledger.UtxoSpend[] = Array.from({ length: n }, (_, i) => ({
    value: i === n - 1 ? gives.amount - each * BigInt(n - 1) : each,
    owner: vk,
    type: gives.token,
    intentHash: bytesToHex(randomBytesU8(32)),
    outputNo: 0,
  }));
  const intent = ledger.Intent.new(new Date(Date.now() + ttlSecs * 1000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [{ value: wants.amount, owner, type: wants.token }], []);
  const signature = ledger.signData(sk, intent.signatureData(segment));
  intent.guaranteedUnshieldedOffer = intent.guaranteedUnshieldedOffer.addSignatures(inputs.map(() => signature));
  return intent;
}

/** A dealer half at segment 1 that gives `gives` and wants `wants`. */
export function buildSampleOffer(o: { networkId: string; gives: SampleLeg; wants: SampleLeg; inputs?: number; ttlSecs?: number }): {
  offerFile: string;
  inputs: string[];
  expiresAt: number;
} {
  const ttlSecs = o.ttlSecs ?? 3600;
  const tx = ledger.Transaction.fromParts(o.networkId, undefined, undefined, signedIntent(1, o.gives, o.wants, o.inputs ?? 1, ttlSecs)).mockProve();
  return { offerFile: bytesToBase64(tx.serialize()), inputs: inputsOf(tx), expiresAt: Math.floor(Date.now() / 1000) + ttlSecs };
}

/** The dealer half merged with a taker balancing half at segment 2 that gives what the dealer wants
 *  and wants what the dealer gives, spending `inputs` coins. */
export function buildSampleSettlement(o: { networkId: string; offerFile: string; takerGives: SampleLeg; takerWants: SampleLeg; inputs?: number }): {
  txHex: string;
  identifiers: string[];
  hash: string;
} {
  const dealer = ledger.Transaction.deserialize('signature', 'proof', 'binding', base64ToBytes(o.offerFile));
  const intent = signedIntent(2, o.takerGives, o.takerWants, o.inputs ?? 1, 3600);
  const taker = ledger.Transaction.fromParts(o.networkId).addIntent({ tag: 'specific', value: 2 }, intent).mockProve();
  const merged = dealer.merge(taker);
  return { txHex: bytesToHex(merged.serialize()), identifiers: merged.identifiers().map(String), hash: String(merged.transactionHash()) };
}
