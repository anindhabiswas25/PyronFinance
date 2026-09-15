import { useEffect, useState } from 'react';
import { Download, KeyRound, Lock, Trash2 } from 'lucide-react';
import { Banner, Button, Card, Dialog, Hash, Skeleton } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from '../../lib/crypto-store';
import { downloadJson } from '../../lib/evidence';
import { bytesToHex } from '../../lib/hex';
import { messageOf } from '../../lib/errors';
import { formatUtc } from '../../lib/time';
import { useDealer } from './dealerVault';
import { parseDealerKeyInput } from './identity';
import type { DeskView } from './DeskPage';

const CONFIRM_PHRASE = 'delete my dealer key';

export function KeysTab({ view }: { view: DeskView }) {
  const status = useDealer((s) => s.status);
  if (status === 'checking') return <Skeleton height={160} className="rounded-card mt-4" />;
  if (status === 'none') return <SetUp />;
  if (status === 'locked') return <Unlock />;
  return <Unlocked bonded={Boolean(view.dealerCmt && view.snap.snapshot?.view.bonds.get(view.dealerCmt))} />;
}

function Passphrase({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange(v: string): void; autoComplete: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="h-control rounded-input border border-line bg-bg px-3 text-14 outline-none focus:border-mu" />
    </div>
  );
}

function SetUp() {
  const ports = useData();
  const [mode, setMode] = useState<'generate' | 'import'>('generate');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [keyText, setKeyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const parsed = mode === 'import' && keyText.trim() ? parseDealerKeyInput(keyText) : undefined;
  const passOk = pass.length >= MIN_PASSPHRASE_LENGTH && pass === again;
  const ready = passOk && (mode === 'generate' || parsed?.ok === true);

  return (
    <Card className="flex flex-col gap-4 mt-4 max-w-[620px]">
      <h2 className="font-display font-semibold text-19">Set up a dealer key</h2>
      <p className="text-13.5 text-mu">
        The key is your dealer identity: it owns your bond and signs your prices. It is stored in this browser only, encrypted under a passphrase, and a backup is required before you can use it. The same key works in the Dealer Node.
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="How to set up">
        {(['generate', 'import'] as const).map((m) => (
          <Button key={m} size="sm" role="radio" aria-checked={mode === m} variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>
            {m === 'generate' ? 'Generate a new key' : 'Import an existing key'}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError(undefined);
          try {
            if (mode === 'generate') await useDealer.getState().generate(ports, pass);
            else if (parsed?.ok) await useDealer.getState().importKey(ports, parsed.secret, pass);
          } catch (err) {
            setError(messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === 'import' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dealer-key-import" className="label">
              Key (64 hex, or a backup file’s contents)
            </label>
            <textarea id="dealer-key-import" rows={3} value={keyText} onChange={(e) => setKeyText(e.target.value)} spellCheck={false} className="rounded-input border border-line bg-bg px-3 py-2 font-mono text-12.5 outline-none focus:border-mu" />
            {parsed && !parsed.ok && <p className="text-12.5 text-bad">{parsed.error}</p>}
          </div>
        )}
        <Passphrase id="dealer-pass" label="Passphrase" value={pass} onChange={setPass} autoComplete="new-password" />
        {pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH && <p className="text-12.5 text-bad">Use at least {MIN_PASSPHRASE_LENGTH} characters.</p>}
        <Passphrase id="dealer-pass-again" label="Passphrase again" value={again} onChange={setAgain} autoComplete="new-password" />
        {again.length > 0 && again !== pass && <p className="text-12.5 text-bad">The two passphrases differ.</p>}
        {error && <p className="text-13.5 text-bad">{error}</p>}
        <div>
          <Button type="submit" variant="primary" disabled={!ready || busy} busy={busy}>
            <KeyRound size={14} aria-hidden="true" />
            {mode === 'generate' ? 'Generate key' : 'Import key'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Unlock() {
  const ports = useData();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [del, setDel] = useState(false);
  return (
    <Card className="flex flex-col gap-4 mt-4 max-w-[560px]">
      <h2 className="font-display font-semibold text-19">Unlock your dealer key</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await useDealer.getState().unlock(ports, pass);
          } catch (err) {
            setError(err instanceof WrongPassphraseError ? 'That passphrase doesn’t unlock this key' : messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Passphrase id="dealer-unlock" label="Passphrase" value={pass} onChange={setPass} autoComplete="current-password" />
        {error && (
          <p className="text-13.5 text-bad" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!pass || busy} busy={busy}>
            Unlock
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDel(true)}>
            Delete this key
          </Button>
        </div>
      </form>
      <DeleteKeyDialog open={del} onClose={() => setDel(false)} bonded={false} />
    </Card>
  );
}

function Unlocked({ bonded }: { bonded: boolean }) {
  const ports = useData();
  const identity = useDealer((s) => s.identity)!;
  const key = useDealer((s) => s.key)!;
  const [downloaded, setDownloaded] = useState(false);
  const [stored, setStored] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => setStored(false), [key.backedUpAt]);

  const backup = () => {
    downloadJson(`pyron-dealer-key-${identity.dealerCmt.slice(0, 12)}.json`, {
      kind: 'pyron-dealer-key',
      v: 1,
      network: ports.network.id,
      dealerCmt: identity.dealerCmt,
      secret: key.secret,
      warning: 'Anyone holding this file can sign as this dealer and withdraw its bond. The Dealer Node reads the secret as a 64-hex key file.',
    });
    setDownloaded(true);
  };

  return (
    <div className="flex flex-col gap-4 pt-4 max-w-[760px]">
      {!key.backedUpAt && (
        <Card className="flex flex-col gap-3 border-warn">
          <h2 className="font-display font-semibold text-15">Save your backup before using this key</h2>
          <p className="text-13.5 text-mu">
            This browser is the only place the key exists. If the browser’s storage is cleared, a bond posted with it can never be withdrawn and live quotes can never be revealed.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={backup}>
              <Download size={14} aria-hidden="true" />
              Download backup
            </Button>
            <label className="flex items-center gap-2 text-13.5">
              <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} disabled={!downloaded} />
              I stored the backup somewhere safe
            </label>
            <Button onClick={() => void useDealer.getState().markBackedUp(ports)} disabled={!downloaded || !stored}>
              Confirm backup
            </Button>
          </div>
        </Card>
      )}
      <Card className="flex flex-col gap-2 text-13.5">
        <h2 className="font-display font-semibold text-15">Your dealer identity</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-mu">Dealer key (public)</dt>
          <dd className="min-w-0">
            <Hash value={identity.dealerCmt} label="dealer key" full />
          </dd>
          <dt className="text-mu">Reveal key (public)</dt>
          <dd className="font-mono text-12.5 break-all">{bytesToHex(identity.revealPk)}</dd>
          <dt className="text-mu">Source</dt>
          <dd>
            {key.source === 'generated' ? 'Generated here' : 'Imported'} {formatUtc(key.createdAt)}
          </dd>
          <dt className="text-mu">Backup</dt>
          <dd>{key.backedUpAt ? `Confirmed ${formatUtc(key.backedUpAt)}` : 'Not confirmed'}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 pt-2">
          {key.backedUpAt && (
            <Button size="sm" onClick={backup}>
              <Download size={14} aria-hidden="true" />
              Download backup again
            </Button>
          )}
          <Button size="sm" onClick={() => useDealer.getState().lock()}>
            <Lock size={14} aria-hidden="true" />
            Lock
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDel(true)}>
            <Trash2 size={14} aria-hidden="true" />
            Delete key
          </Button>
        </div>
      </Card>
      <DeleteKeyDialog open={del} onClose={() => setDel(false)} bonded={bonded} />
    </div>
  );
}

function DeleteKeyDialog({ open, onClose, bonded }: { open: boolean; onClose(): void; bonded: boolean }) {
  const ports = useData();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete the dealer key from this browser?"
      description="The key and the quote journal are erased here. Only a backup can bring them back."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={typed !== CONFIRM_PHRASE}
            onClick={async () => {
              await useDealer.getState().destroy(ports);
              onClose();
            }}
          >
            Delete key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {bonded && (
          <Banner tone="bad" title="This key has a bond on-chain">
            Without the key, the bond can’t be withdrawn and live quotes can’t be revealed.
          </Banner>
        )}
        <label htmlFor="delete-key-confirm" className="text-13.5">
          Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <input id="delete-key-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-control rounded-input border border-line bg-bg px-3 text-14 outline-none focus:border-mu" />
      </div>
    </Dialog>
  );
}
