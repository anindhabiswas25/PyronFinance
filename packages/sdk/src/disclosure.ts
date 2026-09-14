// Programmable disclosure — the named-recipient shape (policy 0x0001), docs/DISCLOSURE.md, task 3.7.
//
// The contract stores (ciphertextHash, policyTag, recipientHint) per resolved quote and ascribes no
// meaning to any of it. Everything below is client convention, and this file is the reference encoding.
//
//   note   = canonicalJSON({ v, tradeId, pair, side, price, size, settledAt, dealerCmt, parties, salt })
//   (eskA, epkA) = fresh X25519 keypair per note                         never reused
//   key    = HKDF-SHA256(X25519(eskA, recipientPk), info = "otc:disclosure:v1" ‖ tradeId)
//   ct     = ChaCha20-Poly1305(key, nonce, note)
//   blob   = { v: 1, epk, nonce, ct }                                    OFF-CHAIN
//   ciphertextHash = blake2b256(canonicalJSON(blob))                      on-chain
//   recipientHint  = blake2b256("otc:recipient:v1" ‖ recipientPk)          on-chain, a hash — never the key
//
// Two choices the spec left open, made here and recorded in DISCLOSURE.md:
//   * `tradeId` is the settled quote's quoteId — it is the key of `quotes`, which is what
//     attachDisclosureNote checks, and it is publicly recomputable.
//   * HKDF info is the UTF-8 tag followed by the 32 raw tradeId bytes, and the AEAD additional data is
//     the tradeId too, so a blob for trade X fails authentication under trade Y twice over.
//
// BROWSER-SAFE (Phase 0 task 0.1): uses @noble/ciphers instead of node:crypto and Uint8Array
// instead of Buffer throughout. Output is byte-for-byte identical to the previous node:crypto
// implementation — see test/aead-parity.test.ts.

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { blake2b } from '@noble/hashes/blake2';
import { canonicalJSON } from '../../relay-node/src/schema.js';
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

export const POLICY_NAMED_RECIPIENT = 0x0001;
const INFO_TAG = utf8ToBytes('otc:disclosure:v1');
const HINT_TAG = utf8ToBytes('otc:recipient:v1');
const NONCE_LEN = 12;
const TAG_LEN = 16;

export interface DisclosureNote {
  v: 1;
  tradeId: string; // hex32
  pair: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  settledAt: number;
  dealerCmt: string; // hex32
  parties: Record<string, string>;
  salt: string; // hex32 — fresh; makes ciphertextHash uninformative about low-entropy contents
}

export interface DisclosureBlob {
  v: 1;
  epk: string; // hex32
  nonce: string; // hex12
  ct: string; // base64(ciphertext || tag)
}

export interface AttachArgs {
  tradeId: Uint8Array;
  ciphertextHash: Uint8Array;
  policyTag: number;
  recipientHint: Uint8Array;
}

export class DisclosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisclosureError';
  }
}

const hex = (b: Uint8Array) => bytesToHex(b);
const unhex = (s: string, len: number, what: string) => {
  if (!new RegExp(`^[0-9a-f]{${len * 2}}$`).test(s)) throw new DisclosureError(`${what} must be ${len}-byte hex`);
  return hexToBytes(s);
};

function blake2b256(bytes: Uint8Array): Uint8Array {
  return blake2b(bytes, { dkLen: 32 });
}

function deriveKey(shared: Uint8Array, tradeId: Uint8Array): Uint8Array {
  const info = concatBytes(INFO_TAG, tradeId);
  return hkdf(sha256, shared, undefined, info, 32);
}

export function recipientHintFor(recipientPk: Uint8Array): Uint8Array {
  return blake2b256(concatBytes(HINT_TAG, recipientPk));
}

export function ciphertextHashOf(blob: DisclosureBlob): Uint8Array {
  return blake2b256(utf8ToBytes(canonicalJSON(blob)));
}

/** Seals a note to one recipient. Returns the off-chain blob and the exact arguments for
 *  `attachDisclosureNote`. */
export function sealNote(
  note: Omit<DisclosureNote, 'v' | 'salt'> & { salt?: string },
  recipientPk: Uint8Array,
): { blob: DisclosureBlob; attach: AttachArgs; note: DisclosureNote } {
  const tradeId = unhex(note.tradeId, 32, 'tradeId');
  if (recipientPk.length !== 32) throw new DisclosureError('recipientPk must be a 32-byte X25519 key');
  const full: DisclosureNote = { v: 1, ...note, salt: note.salt ?? hex(randomBytesU8(32)) };

  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const key = deriveKey(x25519.getSharedSecret(esk, recipientPk), tradeId);
  const nonce = randomBytesU8(NONCE_LEN);
  const plaintext = utf8ToBytes(canonicalJSON(full));
  const sealed = aeadSeal(key, nonce, plaintext, tradeId); // ct || tag(16), AAD = tradeId

  const blob: DisclosureBlob = { v: 1, epk: hex(epk), nonce: hex(nonce), ct: bytesToBase64(sealed) };
  return {
    blob,
    note: full,
    attach: {
      tradeId,
      ciphertextHash: ciphertextHashOf(blob),
      policyTag: POLICY_NAMED_RECIPIENT,
      recipientHint: recipientHintFor(recipientPk),
    },
  };
}

/** Opens a blob as the recipient, for a specific trade. Throws `DisclosureError` on any AEAD failure —
 *  wrong recipient, wrong trade, or a tampered blob are indistinguishable by design. */
export function openNote(blob: DisclosureBlob, recipientSk: Uint8Array, tradeIdHex: string): DisclosureNote {
  const tradeId = unhex(tradeIdHex, 32, 'tradeId');
  if (blob.v !== 1) throw new DisclosureError(`unsupported blob version ${blob.v}`);
  const epk = unhex(blob.epk, 32, 'blob.epk');
  const nonce = unhex(blob.nonce, NONCE_LEN, 'blob.nonce');
  const sealed = base64ToBytes(blob.ct);
  if (sealed.length < TAG_LEN) throw new DisclosureError('ciphertext too short');
  const key = deriveKey(x25519.getSharedSecret(recipientSk, epk), tradeId);
  let plain: Uint8Array;
  try {
    plain = aeadOpen(key, nonce, sealed, tradeId);
  } catch (err) {
    if (err instanceof AeadError) {
      throw new DisclosureError('AEAD authentication failed — wrong recipient, wrong trade, or tampered blob');
    }
    throw err;
  }
  const note = JSON.parse(bytesToUtf8(plain)) as DisclosureNote;
  if (note.tradeId !== tradeIdHex) throw new DisclosureError('note names a different tradeId than it was opened for');
  return note;
}

/** What DISCLOSURE.md's step 2 reads from the chain. Narrow so the indexer or the simulator can supply it. */
export interface DisclosureChain {
  note(tradeId: Uint8Array): Promise<{ ciphertextHash: Uint8Array; policyTag: bigint | number; recipientHint: Uint8Array } | undefined>;
  quote(tradeId: Uint8Array): Promise<{ resolved: boolean } | undefined>;
}

export type NoteVerdict = { ok: true; note: DisclosureNote } | { ok: false; reason: string };

/** DISCLOSURE.md "Decrypt and verify": decrypt, then the five chain checks. A note that decrypts but
 *  fails these is a party's CLAIM about a trade, not evidence of one. */
export async function verifyNote(
  blob: DisclosureBlob,
  recipientSk: Uint8Array,
  tradeIdHex: string,
  chain: DisclosureChain,
): Promise<NoteVerdict> {
  let note: DisclosureNote;
  try {
    note = openNote(blob, recipientSk, tradeIdHex);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const tradeId = unhex(tradeIdHex, 32, 'tradeId');
  const onChain = await chain.note(tradeId); // a
  if (!onChain) return { ok: false, reason: 'no note attached on-chain for this trade' };
  if (hex(onChain.ciphertextHash) !== hex(ciphertextHashOf(blob))) return { ok: false, reason: 'blob does not match the on-chain ciphertextHash' }; // b
  if (Number(onChain.policyTag) !== POLICY_NAMED_RECIPIENT) return { ok: false, reason: `policyTag ${onChain.policyTag} is not named-recipient` }; // c
  if (note.tradeId !== tradeIdHex) return { ok: false, reason: 'note.tradeId differs' }; // d
  const q = await chain.quote(tradeId); // e
  if (!q?.resolved) return { ok: false, reason: 'trade is not resolved on-chain' };
  const recipientPk = x25519.getPublicKey(recipientSk);
  if (hex(onChain.recipientHint) !== hex(recipientHintFor(recipientPk))) {
    return { ok: false, reason: 'on-chain recipientHint names a different recipient' };
  }
  return { ok: true, note };
}
