// Attach a named-recipient disclosure note to a settled trade (docs/DISCLOSURE.md). The note is sealed
// here to one recipient's X25519 key; only its hash, the policy tag and a recipient hint go on-chain.
// The sealed note is saved as a file before the transaction is sent: a note attached on-chain whose
// blob was lost could never be opened by anyone.

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Banner, Button, Dialog, Hash } from '../design/primitives';
import { useData } from '../data/DataProvider';
import { runCircuit, type CircuitOutcome } from '../data/useCircuit';
import { useWalletStore } from '../state/wallet';
import { useOverlays } from '../state/overlays';
import { hexToBytes, isHex32, normalizeHex } from '../lib/hex';
import { downloadJson } from '../lib/evidence';
import { messageOf } from '../lib/errors';
import { oppositeSide } from '../lib/side';
import { formatUtc } from '../lib/time';
import type { DisclosureBlob } from '@otc/sdk/browser';
import type { LocalReceipt } from '../features/trade/engine';

const receiptKey = (quoteId: string) => `receipt:${quoteId}`;
export const noteKey = (quoteId: string) => `note:${quoteId}`;

export interface SavedNote {
  kind: 'pyron-disclosure-note';
  v: 1;
  network: string;
  contract: string;
  tradeId: string;
  recipientPk: string;
  blob: DisclosureBlob;
  savedAt: number;
}

export function noteFileName(tradeId: string): string {
  return `pyron-note-${tradeId.slice(0, 12)}.json`;
}

export function AttachDisclosureNoteDialog({ open, onClose, quoteId }: { open: boolean; onClose(): void; quoteId?: string }) {
  const ports = useData();
  const walletStatus = useWalletStore((s) => s.status);
  const show = useOverlays((s) => s.show);
  const [recipient, setRecipient] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<CircuitOutcome>();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setOutcome(undefined);
    setBusy(false);
  }, [open, quoteId]);

  const local = quoteId ? ports.storage.session.get<LocalReceipt>(receiptKey(quoteId)) : undefined;
  const saved = quoteId ? ports.storage.session.get<SavedNote>(noteKey(quoteId)) : undefined;
  const recipientHex = normalizeHex(recipient.trim());
  const recipientOk = isHex32(recipientHex);

  async function attach() {
    if (!quoteId || !local || !recipientOk) return;
    setBusy(true);
    setError(undefined);
    try {
      const sdk = await import('@otc/sdk/browser');
      const sealed = sdk.sealNote(
        {
          tradeId: quoteId,
          pair: local.pair,
          // The note carries the dealer's side, as the quote terms do.
          side: oppositeSide(local.takerSide),
          price: local.price,
          size: local.size,
          settledAt: local.settledAt,
          dealerCmt: local.dealerCmt,
          parties: reference.trim() ? { reference: reference.trim() } : {},
        },
        hexToBytes(recipientHex),
      );
      const file: SavedNote = {
        kind: 'pyron-disclosure-note',
        v: 1,
        network: ports.network.id,
        contract: ports.network.contractAddress,
        tradeId: quoteId,
        recipientPk: recipientHex,
        blob: sealed.blob,
        savedAt: Math.floor(ports.clock.nowMs() / 1000),
      };
      ports.storage.session.set(noteKey(quoteId), file);
      downloadJson(noteFileName(quoteId), file);

      const hash = sdk.bytesToHex(sealed.attach.ciphertextHash);
      const out = await runCircuit(
        ports,
        {
          circuit: 'attachDisclosureNote',
          args: [sealed.attach.tradeId, sealed.attach.ciphertextHash, BigInt(sealed.attach.policyTag), sealed.attach.recipientHint],
        },
        {
          title: `Attach note to ${quoteId.slice(0, 8)}…`,
          kind: 'disclosure',
          href: `/trade/${quoteId}`,
          landed: async () => (await ports.chain.snapshot()).view.notes.get(quoteId)?.ciphertextHash === hash,
        },
      );
      setOutcome(out);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const done = outcome?.ok;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Attach a disclosure note"
      description="Encrypts this trade’s details to one recipient and ties them to the trade on-chain. Only a hash goes on-chain."
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {walletStatus === 'connected' ? (
              <Button variant="primary" onClick={() => void attach()} disabled={!local || !recipientOk || busy} busy={busy}>
                {busy ? 'Attaching…' : 'Save note and attach'}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => show('connect')}>
                Connect wallet
              </Button>
            )}
          </>
        )
      }
    >
      {!quoteId || !local ? (
        <Banner tone="warn" title="This trade’s details aren’t on this device">
          A note can only be written from the browser that settled the trade: the price and amounts were never stored anywhere else.
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-recipient" className="label">
              Recipient’s public key
            </label>
            <input
              id="note-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="64 hex characters (X25519)"
              spellCheck={false}
              disabled={busy || done}
              aria-invalid={recipient !== '' && !recipientOk}
              aria-describedby="note-recipient-help"
              className="h-control rounded-input border border-line bg-bg px-3 font-mono text-12.5 outline-none focus:border-mu"
            />
            <p id="note-recipient-help" className={recipient !== '' && !recipientOk ? 'text-12.5 text-bad' : 'text-12.5 text-mu'}>
              {recipient !== '' && !recipientOk ? 'A recipient key is 32 bytes: 64 hex characters.' : 'Ask the recipient for it. Anyone without the matching secret key learns nothing from the note.'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-reference" className="label">
              Reference (optional)
            </label>
            <input
              id="note-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. invoice 2026-114"
              disabled={busy || done}
              className="h-control rounded-input border border-line bg-bg px-3 text-13.5 outline-none focus:border-mu"
            />
          </div>

          <div className="rounded-input border border-line2 px-4 py-3 flex flex-col gap-1.5 text-13.5">
            <span className="font-medium">The recipient will see</span>
            <ul className="flex flex-col gap-1 text-mu">
              <li>Trade <Hash value={quoteId} label="trade" /></li>
              <li>
                {local.pair} · dealer {oppositeSide(local.takerSide)}s {local.size} at {local.price}
              </li>
              <li>Settled {formatUtc(local.settledAt)} with dealer <Hash value={local.dealerCmt} label="dealer" /></li>
              {reference.trim() && <li>Reference “{reference.trim()}”</li>}
            </ul>
            <span className="text-12.5 text-mu">On-chain: the note’s hash, the policy (named recipient) and a hint of the recipient’s key. Nothing else.</span>
          </div>

          <p className="text-12.5 text-mu">The sealed note downloads before the transaction is sent. Give that file to the recipient; they open it on Verify.</p>

          {error && (
            <Banner tone="bad" title="The note wasn’t attached">
              {error}
            </Banner>
          )}
          {outcome && !outcome.ok && (
            <Banner tone="bad" title="The note wasn’t attached">
              {outcome.error}
            </Banner>
          )}
          {done && (
            <Banner tone="ok" title="Note attached on-chain" icon={<FileText size={16} aria-hidden="true" />}>
              {outcome.ok && outcome.note ? outcome.note : 'The recipient can open the downloaded file on Verify.'}
            </Banner>
          )}
          {saved && (
            <Button size="sm" variant="ghost" onClick={() => downloadJson(noteFileName(saved.tradeId), saved)}>
              Download the sealed note again
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
