// Point-to-point encrypted reveal channel — docs/RELAY.md §4. This is the boundary the whole
// protocol depends on: a priced reveal must NEVER enter the gossip layer (not encrypted-and-
// broadcast, not encrypted-in-gossip — it does not enter it at all). This module only ever
// produces a message meant to be sent directly to one taker (or dropped in a relay's opaque
// mailbox, packages/relay-node/src/mailbox.ts, which cannot read it either).
//
// Crypto: X25519 ECDH -> HKDF-SHA256 -> ChaCha20-Poly1305, per CLAUDE.md's M2.3 scope line.
// The Schnorr signature over the plaintext terms (`QuoteReveal.signature`, built by
// `buildReveal` in quotes.ts) travels alongside the ciphertext unencrypted — RELAY.md §4: "The
// signature is over the plaintext terms," and it must stay independently checkable so a mismatch
// is non-repudiable fraud evidence even without decrypting anything.
//
// BROWSER-SAFE (Phase 0 task 0.1): uses @noble/ciphers instead of node:crypto and Uint8Array
// instead of Buffer throughout, so this module is importable from client/ via browser.ts. Output
// is byte-for-byte identical to the previous node:crypto implementation — see
// test/aead-parity.test.ts.

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import {
  aeadSeal,
  aeadOpen,
  AeadError,
  randomBytesU8,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
} from './aead.js';
import { encodeSchnorrSignature, decodeSchnorrSignature } from './schnorr.js';
import type { QuoteReveal } from './quotes.js';
import type { QuoteTerms } from './terms.js';

const HKDF_INFO = utf8ToBytes('otc:reveal-channel:v1');
const NONCE_LEN = 12;
const TAG_LEN = 16;

export interface EncKeypair {
  sk: Uint8Array; // 32 bytes, X25519 scalar
  pk: Uint8Array; // 32 bytes, X25519 point
}

/** Generates a fresh X25519 keypair. Per RELAY.md, `takerEncPk` (the RFQ side) MUST be ephemeral
 *  per RFQ — callers on the taker side must call this once per RFQ, never reuse across RFQs. The
 *  dealer side (`dealerEncPk` in `quote_ref`) may be a longer-lived key since it identifies the
 *  dealer's reveal endpoint, not a taker who needs unlinkability. */
export function generateEncKeypair(): EncKeypair {
  const sk = x25519.utils.randomSecretKey();
  const pk = x25519.getPublicKey(sk);
  return { sk, pk };
}

/** A keypair from a fixed 32-byte secret — for a dealer's LONG-LIVED reveal key (`dealerEncPk`),
 *  which the Dealer Node derives from its identity secret so a restart keeps the same key and
 *  in-flight takers can still decrypt. Never use this for a taker's per-RFQ key. */
export function encKeypairFromSecret(sk: Uint8Array): EncKeypair {
  if (sk.length !== 32) throw new Error('X25519 secret must be 32 bytes');
  return { sk, pk: x25519.getPublicKey(sk) };
}

function deriveSymmetricKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

/** Wire message for `type: "reveal"` per RELAY.md §4. Sent point-to-point or dropped in a
 *  mailbox — NEVER gossiped. */
export interface RevealMessage {
  v: 1;
  type: 'reveal';
  quoteId: string; // hex32
  ciphertext: string; // base64(nonce(12) || AEAD-ciphertext || tag(16)) — see decryptReveal
  sig: string; // hex-encoded Schnorr signature over the plaintext terms (schnorr.ts encoding)
}

/** The plaintext sealed inside `ciphertext`, per RELAY.md §4. */
export interface RevealPlaintext {
  pair: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  nonce: string; // hex32 — the commitment-opening nonce
  offerFile: string; // base64 Zswap Offer File
  expiresAt: number;
}

function revealToPlaintext(reveal: QuoteReveal): RevealPlaintext {
  return {
    pair: reveal.terms.pair,
    side: reveal.terms.side,
    price: reveal.terms.price,
    size: reveal.terms.size,
    nonce: bytesToHex(reveal.nonce),
    offerFile: reveal.offerFile,
    expiresAt: reveal.expiresAt,
  };
}

/** Encrypts a dealer's `QuoteReveal` to a specific taker's X25519 pubkey (`takerEncPk`, from the
 *  RFQ's `takerEncPk` field). `dealerEncSk` is the dealer's X25519 secret matching the
 *  `dealerEncPk` it advertised in its `quote_ref`. */
export function encryptReveal(
  quoteId: Uint8Array,
  reveal: QuoteReveal,
  dealerEncSk: Uint8Array,
  takerEncPk: Uint8Array,
): RevealMessage {
  const shared = x25519.getSharedSecret(dealerEncSk, takerEncPk);
  const key = deriveSymmetricKey(shared);
  const nonce = randomBytesU8(NONCE_LEN);
  const plaintext = utf8ToBytes(JSON.stringify(revealToPlaintext(reveal)));

  const sealed = aeadSeal(key, nonce, plaintext); // ct || tag(16)

  return {
    v: 1,
    type: 'reveal',
    quoteId: bytesToHex(quoteId),
    ciphertext: bytesToBase64(concatBytes(nonce, sealed)),
    sig: encodeSchnorrSignature(reveal.signature),
  };
}

export class RevealDecryptError extends Error {}

/** Decrypts a `RevealMessage` addressed to the taker holding `takerEncSk`. Throws
 *  `RevealDecryptError` if the AEAD tag doesn't verify — which happens both for a genuinely
 *  tampered ciphertext and for a message decrypted with the wrong keypair (a different party's
 *  `takerEncSk`), since ChaCha20-Poly1305 gives no way to distinguish the two. Does NOT verify
 *  the Schnorr signature or the on-chain commitment — see `verifyReveal` in quotes.ts for that,
 *  which callers MUST still run before trusting the terms. */
export function decryptReveal(
  msg: RevealMessage,
  takerEncSk: Uint8Array,
  dealerEncPk: Uint8Array,
): { plaintext: RevealPlaintext; encodedTermsSignature: ReturnType<typeof decodeSchnorrSignature> } {
  const blob = base64ToBytes(msg.ciphertext);
  if (blob.length < NONCE_LEN + TAG_LEN) {
    throw new RevealDecryptError('ciphertext too short');
  }
  const nonce = blob.subarray(0, NONCE_LEN);
  const sealed = blob.subarray(NONCE_LEN); // ct || tag(16), what aeadOpen expects

  const shared = x25519.getSharedSecret(takerEncSk, dealerEncPk);
  const key = deriveSymmetricKey(shared);

  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = aeadOpen(key, nonce, sealed);
  } catch (err) {
    if (err instanceof AeadError) {
      throw new RevealDecryptError('AEAD authentication failed — tampered ciphertext or wrong key');
    }
    throw err;
  }

  let plaintext: RevealPlaintext;
  try {
    plaintext = JSON.parse(bytesToUtf8(plaintextBytes)) as RevealPlaintext;
  } catch {
    throw new RevealDecryptError('decrypted payload is not valid JSON');
  }

  return { plaintext, encodedTermsSignature: decodeSchnorrSignature(msg.sig) };
}

/** Rebuilds the `Vector<4, Field>` terms encoding from a decrypted plaintext, for feeding into
 *  `schnorrVerify`/`verifyReveal` (quotes.ts) or a Class-A fraud proof. Kept separate from
 *  `decryptReveal` so callers can encode terms with the exact same `encodeTerms` the dealer used,
 *  after independently deciding they trust `plaintext.pair` etc. */
export function plaintextToTerms(plaintext: RevealPlaintext): QuoteTerms {
  return { pair: plaintext.pair, side: plaintext.side, price: plaintext.price, size: plaintext.size };
}

// Re-exported so hexToBytes is still usable via reveal-channel.ts without importing Node's Buffer.
export { hexToBytes };
