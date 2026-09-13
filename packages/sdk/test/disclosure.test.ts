// B8 (task 3.9): the disclosure test plan, DISCLOSURE.md items 1–7, against the REAL compiled contract
// in the simulator. Items 4, 5 and 7 are the ones that prove the primitive; 6 and the unsettled-trade
// cases prove the contract ties a note to exactly one resolved trade.

import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import {
  OTCSim, bondDealer, dealer, taker, bytes32, T0, DEALER_SK, DEALER_CMT, TAKER_ADDR, NOTIONAL,
} from '../../../contracts/test/harness.js';
import { deriveQuoteId } from '../src/domain.js';
import {
  sealNote, openNote, verifyNote, ciphertextHashOf, recipientHintFor, DisclosureError,
  POLICY_NAMED_RECIPIENT, type DisclosureBlob, type DisclosureChain,
} from '../src/disclosure.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function keypair() {
  const sk = x25519.utils.randomSecretKey();
  return { sk, pk: x25519.getPublicKey(sk) };
}

function settledTrade(sim: OTCSim, rfqSeed: number) {
  // Bond once per simulator: a second postBond for the same dealer is (correctly) refused.
  const cmt = sim.ledger.bonds.member(DEALER_CMT) ? DEALER_CMT : bondDealer(sim);
  const rfq = bytes32(rfqSeed);
  const commitment = bytes32(rfqSeed + 1);
  sim.call(dealer(DEALER_SK), 'commitQuote', rfq, commitment, BigInt(T0 + 600), NOTIONAL);
  const tradeId = deriveQuoteId(cmt, rfq, commitment);
  sim.call(dealer(DEALER_SK), 'recordSettlement', tradeId);
  return { cmt, tradeId };
}

function chainOf(sim: OTCSim): DisclosureChain {
  return {
    async note(id) {
      return sim.ledger.notes.member(id) ? sim.ledger.notes.lookup(id) : undefined;
    },
    async quote(id) {
      return sim.ledger.quotes.member(id) ? sim.ledger.quotes.lookup(id) : undefined;
    },
  };
}

function noteFor(tradeId: Uint8Array, cmt: Uint8Array) {
  return {
    tradeId: hex(tradeId), pair: 'tNIGHT/USDM', side: 'sell' as const, price: '0.0412', size: '1000.0',
    settledAt: T0 + 60, dealerCmt: hex(cmt), parties: { desk: 'counterparty-agreed label' },
  };
}

function attach(sim: OTCSim, a: ReturnType<typeof sealNote>['attach']) {
  sim.call(taker(TAKER_ADDR), 'attachDisclosureNote', a.tradeId, a.ciphertextHash, BigInt(a.policyTag), a.recipientHint);
}

describe('disclosure — named recipient (0x0001)', () => {
  it('1–3: attach to a settled trade; the on-chain hash matches; R decrypts and all chain checks pass', async () => {
    const sim = new OTCSim();
    const { cmt, tradeId } = settledTrade(sim, 1);
    const R = keypair();
    const sealed = sealNote(noteFor(tradeId, cmt), R.pk);
    attach(sim, sealed.attach);

    const onChain = sim.ledger.notes.lookup(tradeId);
    expect(hex(onChain.ciphertextHash)).toBe(hex(ciphertextHashOf(sealed.blob)));
    expect(Number(onChain.policyTag)).toBe(POLICY_NAMED_RECIPIENT);
    expect(hex(onChain.recipientHint)).toBe(hex(recipientHintFor(R.pk)));

    const v = await verifyNote(sealed.blob, R.sk, hex(tradeId), chainOf(sim));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.note.price).toBe('0.0412');
  });

  it('4: a different party W, given the same blob, cannot decrypt', async () => {
    const sim = new OTCSim();
    const { cmt, tradeId } = settledTrade(sim, 3);
    const R = keypair();
    const W = keypair();
    const sealed = sealNote(noteFor(tradeId, cmt), R.pk);
    attach(sim, sealed.attach);
    expect(() => openNote(sealed.blob, W.sk, hex(tradeId))).toThrow(DisclosureError);
    const v = await verifyNote(sealed.blob, W.sk, hex(tradeId), chainOf(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/AEAD/) });
  });

  it('5: a tampered blob fails BOTH the AEAD check and the ciphertextHash comparison', async () => {
    const sim = new OTCSim();
    const { cmt, tradeId } = settledTrade(sim, 5);
    const R = keypair();
    const sealed = sealNote(noteFor(tradeId, cmt), R.pk);
    attach(sim, sealed.attach);

    const raw = Buffer.from(sealed.blob.ct, 'base64');
    raw[3] ^= 0x01;
    const tampered: DisclosureBlob = { ...sealed.blob, ct: raw.toString('base64') };
    expect(() => openNote(tampered, R.sk, hex(tradeId))).toThrow(/AEAD/);
    expect(hex(ciphertextHashOf(tampered))).not.toBe(hex(sim.ledger.notes.lookup(tradeId).ciphertextHash));

    // A blob that re-encrypts DIFFERENT contents to R authenticates, but is not the note on-chain.
    const substitute = sealNote({ ...noteFor(tradeId, cmt), price: '0.0999' }, R.pk);
    const v = await verifyNote(substitute.blob, R.sk, hex(tradeId), chainOf(sim));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/ciphertextHash/) });
  });

  it('6: a second attachDisclosureNote for the same trade is rejected by the contract', () => {
    const sim = new OTCSim();
    const { cmt, tradeId } = settledTrade(sim, 7);
    const R = keypair();
    attach(sim, sealNote(noteFor(tradeId, cmt), R.pk).attach);
    const second = sealNote({ ...noteFor(tradeId, cmt), price: '0.0001' }, R.pk).attach;
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote',
      second.tradeId, second.ciphertextHash, BigInt(second.policyTag), second.recipientHint);
    expect(msg).toMatch(/Note already attached/);
  });

  it('a note cannot attach to an unknown trade', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const a = sealNote(noteFor(bytes32(0x99), bytes32(1)), keypair().pk).attach;
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote', a.tradeId, a.ciphertextHash, BigInt(a.policyTag), a.recipientHint);
    expect(msg).toMatch(/Unknown trade/);
  });

  it('a note cannot attach to a committed but unsettled trade', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    const rfq = bytes32(11);
    const commitment = bytes32(12);
    sim.call(dealer(DEALER_SK), 'commitQuote', rfq, commitment, BigInt(T0 + 600), NOTIONAL);
    const tradeId = deriveQuoteId(cmt, rfq, commitment);
    const a = sealNote(noteFor(tradeId, cmt), keypair().pk).attach;
    const msg = sim.expectRevert(taker(TAKER_ADDR), 'attachDisclosureNote', a.tradeId, a.ciphertextHash, BigInt(a.policyTag), a.recipientHint);
    expect(msg).toMatch(/Trade not settled/);
  });

  it('7: R learns nothing about a second, unrelated trade — no linkage from the note or the chain', async () => {
    const sim = new OTCSim();
    const X = settledTrade(sim, 21);
    const Y = settledTrade(sim, 31);
    const R = keypair();
    const sx = sealNote(noteFor(X.tradeId, X.cmt), R.pk);
    const sy = sealNote(noteFor(Y.tradeId, Y.cmt), R.pk);
    attach(sim, sx.attach);
    attach(sim, sy.attach);

    // The blob for X neither opens nor verifies as trade Y: HKDF info and AEAD data bind the tradeId.
    expect(() => openNote(sx.blob, R.sk, hex(Y.tradeId))).toThrow(/AEAD/);
    expect((await verifyNote(sx.blob, R.sk, hex(Y.tradeId), chainOf(sim))).ok).toBe(false);
    // Opening X reveals nothing that names Y.
    const nx = openNote(sx.blob, R.sk, hex(X.tradeId));
    expect(JSON.stringify(nx)).not.toContain(hex(Y.tradeId));
    // Two notes to the same recipient share no ephemeral key and no ciphertext bytes, and the
    // on-chain hashes are unrelated. The recipientHint is shared by design (R recognises its own
    // notes), and it is a hash: the raw key never appears on-chain.
    expect(sx.blob.epk).not.toBe(sy.blob.epk);
    expect(sx.blob.ct).not.toBe(sy.blob.ct);
    expect(hex(sx.attach.ciphertextHash)).not.toBe(hex(sy.attach.ciphertextHash));
    expect(hex(sim.ledger.notes.lookup(X.tradeId).recipientHint)).not.toContain(hex(R.pk));
  });

  it('the salt makes the ciphertextHash uninformative: identical notes seal to different hashes', () => {
    const R = keypair();
    const n = noteFor(bytes32(41), bytes32(42));
    expect(hex(sealNote(n, R.pk).attach.ciphertextHash)).not.toBe(hex(sealNote(n, R.pk).attach.ciphertextHash));
  });
});
