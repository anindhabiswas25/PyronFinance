// The checks /verify runs, each reported on its own so a user sees exactly which one failed. Nothing
// here sends anything anywhere: the chain is read through the indexer and everything else is local.
// Loaded only by /verify (it imports the SDK).

import * as sdk from '@otc/sdk/browser';
import type { ChainPort } from '../../data/ports';
import type { RevealInput } from '../../lib/verify-input';
import { hexToBytes } from '../../lib/hex';
import { PROOF_GRACE_PERIOD_SECS } from '../../lib/bond';
import { formatUtc } from '../../lib/time';
import { messageOf } from '../../lib/errors';

export type RowState = 'pass' | 'fail' | 'unknown';

export interface CheckRow {
  id: string;
  label: string;
  state: RowState;
  detail?: string;
}

export type RevealVerdict =
  | { kind: 'unknown-quote' }
  | { kind: 'not-signed' }
  | { kind: 'fraud'; bond: bigint }
  | { kind: 'fraud-resolved' }
  | { kind: 'honest' }
  | { kind: 'undetermined' };

export interface RevealReport {
  rows: CheckRow[];
  verdict: RevealVerdict;
}

const NOT_OPEN = 'reveal does not open the on-chain commitment';

/** Throws when the chain can't be read: that is "couldn't check", never a failed check. */
export async function checkReveal(chain: Pick<ChainPort, 'quote' | 'dealer' | 'inputSpent'>, input: RevealInput, nowSecs: number): Promise<RevealReport> {
  const { reveal, quoteId } = input;
  const rows: CheckRow[] = [];
  const quote = await chain.quote(quoteId);
  if (!quote) {
    rows.push({ id: 'exists', label: 'Quote exists on-chain', state: 'fail', detail: 'No quote with this id on this network. It may be on another network.' });
    return { rows, verdict: { kind: 'unknown-quote' } };
  }
  rows.push({ id: 'exists', label: 'Quote exists on-chain', state: 'pass' });

  const sameDealer = quote.dealerCmt === reveal.dealerCmt;
  rows.push({ id: 'dealer', label: 'Names the dealer who sealed the quote', state: sameDealer ? 'pass' : 'fail', detail: sameDealer ? undefined : 'The reveal names a different dealer than the chain.' });

  const dealer = await chain.dealer(quote.dealerCmt);
  let encoded: bigint[] | undefined;
  let signature: ReturnType<typeof sdk.decodeSchnorrSignature> | undefined;
  let decodeError: string | undefined;
  try {
    encoded = sdk.encodeTerms(reveal.terms);
    signature = sdk.decodeSchnorrSignature(reveal.signature);
  } catch (err) {
    decodeError = messageOf(err);
  }

  let signed = false;
  if (!dealer.bond) {
    rows.push({ id: 'signature', label: 'Signed by the dealer’s on-chain quote key', state: 'unknown', detail: 'The dealer has no bond on-chain, so there is no key to check against.' });
  } else if (decodeError || !encoded || !signature) {
    rows.push({ id: 'signature', label: 'Signed by the dealer’s on-chain quote key', state: 'fail', detail: `Can’t read the terms or signature: ${decodeError}` });
  } else {
    try {
      signed = sdk.schnorrVerify(encoded, signature, dealer.bond.quotePk);
    } catch {
      signed = false;
    }
    rows.push({ id: 'signature', label: 'Signed by the dealer’s on-chain quote key', state: signed ? 'pass' : 'fail', detail: signed ? undefined : 'The signature does not verify. This file is not evidence of anything the dealer said.' });
  }

  let opens: boolean | undefined;
  if (signed && encoded && signature) {
    const v = sdk.verifyReveal(
      { terms: reveal.terms, encodedTerms: encoded, nonce: hexToBytes(reveal.nonce), signature, offerFile: '', expiresAt: Number.MAX_SAFE_INTEGER },
      hexToBytes(quote.commitment),
      dealer.bond!.quotePk,
    );
    opens = v.valid ? true : v.reason === NOT_OPEN ? false : undefined;
  }
  rows.push({
    id: 'seal',
    label: 'The signed price opens the on-chain seal',
    state: opens === undefined ? 'unknown' : opens ? 'pass' : 'fail',
    detail: opens === false ? 'The dealer signed a price that differs from the one they sealed. This is provable fraud.' : opens === undefined ? 'Checked only once the signature verifies.' : undefined,
  });

  if (encoded) {
    const sizeOk = encoded[3] === quote.notional;
    rows.push({ id: 'size', label: 'Size matches the size sealed on-chain', state: sizeOk ? 'pass' : 'fail', detail: sizeOk ? undefined : `Revealed ${encoded[3]} base units, sealed ${quote.notional}.` });
  }

  rows.push({
    id: 'unresolved',
    label: 'Quote still unresolved',
    state: quote.resolved ? 'fail' : 'pass',
    detail: quote.resolved ? 'Resolved on-chain: settled, released or already slashed. A fraud proof is no longer accepted.' : undefined,
  });

  const validUntil = Number(quote.validUntil);
  const inWindow = nowSecs < validUntil;
  rows.push({
    id: 'window',
    label: 'Inside its validity window',
    state: inWindow ? 'pass' : 'fail',
    detail: inWindow
      ? `Valid until ${formatUtc(validUntil)}.`
      : `Expired ${formatUtc(validUntil)}. The dealer can release it after ${formatUtc(validUntil + PROOF_GRACE_PERIOD_SECS)}; until then a proof is still accepted.`,
  });

  if (input.offerInputs.length) {
    const results = await Promise.all(
      input.offerInputs.map(async (ref) => {
        const [intentHash, out] = ref.split(':');
        return chain.inputSpent ? chain.inputSpent(intentHash, Number(out)) : ('unsupported' as const);
      }),
    );
    if (results.some((r) => r === 'unsupported')) {
      rows.push({
        id: 'inputs',
        label: 'The offer’s coins were spent elsewhere',
        state: 'unknown',
        detail: `This indexer has no lookup by coin. Check these on an explorer: ${input.offerInputs.join(', ')}${input.failure?.spentBy ? `; the taker reported tx ${input.failure.spentBy}` : ''}.`,
      });
    } else {
      const spent = results.filter((r) => r !== 'unsupported' && r.spent);
      rows.push({ id: 'inputs', label: 'The offer’s coins were spent elsewhere', state: spent.length ? 'pass' : 'fail', detail: spent.length ? undefined : 'Every coin behind the offer is still unspent.' });
    }
  }

  let verdict: RevealVerdict;
  if (!signed) verdict = dealer.bond && !decodeError ? { kind: 'not-signed' } : { kind: 'undetermined' };
  else if (opens === false && sameDealer) verdict = quote.resolved ? { kind: 'fraud-resolved' } : { kind: 'fraud', bond: dealer.bond!.amount };
  else if (opens === true) verdict = { kind: 'honest' };
  else verdict = { kind: 'undetermined' };
  return { rows, verdict };
}

export interface NoteReport {
  rows: CheckRow[];
  ok: boolean;
  note?: sdk.DisclosureNote;
}

/** DISCLOSURE.md "Decrypt and verify", every step reported. Throws only when the chain can't be read. */
export async function checkNote(
  chain: Pick<ChainPort, 'snapshot' | 'quote'>,
  blob: sdk.DisclosureBlob,
  tradeId: string,
  recipientSk: Uint8Array,
): Promise<NoteReport> {
  const rows: CheckRow[] = [];
  let note: sdk.DisclosureNote | undefined;
  try {
    note = sdk.openNote(blob, recipientSk, tradeId);
    rows.push({ id: 'decrypt', label: 'Decrypts with your key', state: 'pass' });
  } catch (err) {
    const aead = err instanceof sdk.DisclosureError && /AEAD/.test(err.message);
    rows.push({ id: 'decrypt', label: 'Decrypts with your key', state: 'fail', detail: aead ? 'This note isn’t addressed to this key.' : messageOf(err) });
  }

  const [snap, quote] = await Promise.all([chain.snapshot(), chain.quote(tradeId)]);
  const onChain = snap.view.notes.get(tradeId);
  rows.push({ id: 'attached', label: 'A note is attached to this trade on-chain', state: onChain ? 'pass' : 'fail', detail: onChain ? undefined : 'Nothing attached on-chain for this trade id.' });
  const hashOk = Boolean(onChain) && onChain!.ciphertextHash === sdk.bytesToHex(sdk.ciphertextHashOf(blob));
  rows.push({ id: 'hash', label: 'This file is the note attached on-chain', state: onChain ? (hashOk ? 'pass' : 'fail') : 'unknown', detail: onChain && !hashOk ? 'The on-chain hash differs: this file was changed or is a different note.' : undefined });
  const policyOk = onChain?.policyTag === sdk.POLICY_NAMED_RECIPIENT;
  rows.push({ id: 'policy', label: 'Policy is named recipient', state: onChain ? (policyOk ? 'pass' : 'fail') : 'unknown', detail: onChain && !policyOk ? `Policy ${onChain.policyTag} is not supported here.` : undefined });
  rows.push({
    id: 'trade',
    label: 'The note names this trade',
    state: note ? (note.tradeId === tradeId ? 'pass' : 'fail') : 'unknown',
    detail: note ? undefined : 'Checked once the note decrypts.',
  });
  rows.push({
    id: 'resolved',
    label: 'The trade is resolved on-chain',
    state: quote ? (quote.resolved ? 'pass' : 'fail') : 'fail',
    detail: quote?.resolved ? 'The chain can’t tell a settled trade from one released unsettled.' : quote ? 'The quote is still open.' : 'No quote with this id on this network.',
  });
  let hintOk = false;
  if (onChain) {
    try {
      hintOk = onChain.recipientHint === sdk.bytesToHex(sdk.recipientHintFor(sdk.encKeypairFromSecret(recipientSk).pk));
    } catch {
      hintOk = false;
    }
  }
  rows.push({ id: 'hint', label: 'Addressed to your key on-chain', state: onChain ? (hintOk ? 'pass' : 'fail') : 'unknown', detail: onChain && !hintOk ? 'The on-chain recipient hint names a different key.' : undefined });

  return { rows, ok: rows.every((r) => r.state === 'pass'), note };
}
