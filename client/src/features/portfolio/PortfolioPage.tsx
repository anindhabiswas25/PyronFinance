import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Lock, LockOpen, Trash2 } from 'lucide-react';
import { Banner, Button, ButtonLink, Card, Chip, DataTable, Dialog, EmptyState, Hash, Segmented, Skeleton, type Column } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useHistory, type TradeHistoryEntry } from '../../data/history';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from '../../lib/crypto-store';
import { downloadJson } from '../../lib/evidence';
import { formatUnits, parseUnits, truncateHash } from '../../lib/format';
import { formatRate } from '../../lib/compare';
import { formatUtc } from '../../lib/time';
import { messageOf } from '../../lib/errors';

type Filter = 'all' | 'settled' | 'failed' | 'expired';
const CONFIRM_PHRASE = 'delete my history';

export default function PortfolioPage() {
  const ports = useData();
  const { status, entries, pending } = useHistory();

  useEffect(() => {
    void useHistory.getState().bind(ports);
  }, [ports]);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-5 max-w-[1080px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 id="page-title" className="font-display font-bold text-30">
            My trades
          </h1>
          <p className="text-mu max-w-[62ch]">
            Trades you took from this browser on {ports.network.label}. Prices and amounts exist only here, encrypted under your passphrase. The chain never stores them.
          </p>
        </div>
        {status === 'unlocked' && (
          <Button size="sm" onClick={() => useHistory.getState().lock()}>
            <Lock size={14} aria-hidden="true" />
            Lock
          </Button>
        )}
      </div>

      {pending > 0 && status !== 'unlocked' && (
        <Banner tone="seal" title={`${pending} trade${pending === 1 ? '' : 's'} from this session will be added when you unlock`}>
          They wait in this tab only. Closing the tab before unlocking loses them from your history (their receipts stay on-chain).
        </Banner>
      )}

      {status === 'checking' && (
        <Card className="flex flex-col gap-3" aria-busy="true">
          <Skeleton height={18} width="40%" />
          <Skeleton height={44} />
        </Card>
      )}
      {status === 'none' && <CreateHistory />}
      {status === 'locked' && <UnlockHistory />}
      {status === 'unlocked' && <HistoryTable entries={entries} />}
    </section>
  );
}

function PassphraseField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange(v: string): void; autoComplete: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-control rounded-input border border-line bg-bg px-3 text-14 outline-none focus:border-mu"
      />
    </div>
  );
}

function CreateHistory() {
  const ports = useData();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const tooShort = pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = again.length > 0 && again !== pass;

  return (
    <Card className="flex flex-col gap-4 max-w-[560px]">
      <h2 className="font-display font-semibold text-19">Keep an encrypted history</h2>
      <p className="text-13.5 text-mu">
        Choose a passphrase. It never leaves this browser and can’t be recovered: if you forget it, the history is unreadable and can only be deleted.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pass.length < MIN_PASSPHRASE_LENGTH || pass !== again) return;
          setBusy(true);
          setError(undefined);
          try {
            await useHistory.getState().create(ports, pass);
          } catch (err) {
            setError(messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PassphraseField id="history-pass" label="Passphrase" value={pass} onChange={setPass} autoComplete="new-password" />
        {tooShort && <p className="text-12.5 text-bad">Use at least {MIN_PASSPHRASE_LENGTH} characters.</p>}
        <PassphraseField id="history-pass-again" label="Passphrase again" value={again} onChange={setAgain} autoComplete="new-password" />
        {mismatch && <p className="text-12.5 text-bad">The two passphrases differ.</p>}
        {error && <p className="text-13.5 text-bad">{error}</p>}
        <div>
          <Button type="submit" variant="primary" disabled={pass.length < MIN_PASSPHRASE_LENGTH || pass !== again || busy} busy={busy}>
            {busy ? 'Deriving the key…' : 'Create history'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function UnlockHistory() {
  const ports = useData();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className="flex flex-col gap-4 max-w-[560px]">
      <h2 className="font-display font-semibold text-19">Unlock your history</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await useHistory.getState().unlock(ports, pass);
            setPass('');
          } catch (err) {
            setError(err instanceof WrongPassphraseError ? 'That passphrase doesn’t unlock this history' : messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PassphraseField id="history-unlock" label="Passphrase" value={pass} onChange={setPass} autoComplete="current-password" />
        {error && (
          <p className="text-13.5 text-bad" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!pass || busy} busy={busy}>
            <LockOpen size={14} aria-hidden="true" />
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
            Forgot it? Delete the history
          </Button>
        </div>
      </form>
      <DeleteAllDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} />
    </Card>
  );
}

function DeleteAllDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ports = useData();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete your trade history?"
      description="Every trade stored on this device for this network is erased. Receipts on-chain are unaffected; the prices and amounts are gone for good."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={typed !== CONFIRM_PHRASE || busy}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await useHistory.getState().destroy(ports);
              setBusy(false);
              onClose();
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete everything
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="delete-confirm" className="text-13.5">
          Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-control rounded-input border border-line bg-bg px-3 text-14 outline-none focus:border-mu" />
      </div>
    </Dialog>
  );
}

const OUTCOME: Record<TradeHistoryEntry['outcome'], { label: string; tone: 'ok' | 'bad' | 'neutral' }> = {
  settled: { label: 'Settled', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  expired: { label: 'Expired', tone: 'neutral' },
};

function HistoryTable({ entries }: { entries: TradeHistoryEntry[] }) {
  const ports = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rows = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.outcome === filter)), [entries, filter]);
  const count = (f: Filter) => (f === 'all' ? entries.length : entries.filter((e) => e.outcome === f).length);

  const columns: Column<TradeHistoryEntry>[] = [
    { key: 'when', header: 'When', cell: (e) => <span className="whitespace-nowrap">{formatUtc(e.at)}</span> },
    {
      key: 'trade',
      header: 'Trade',
      cell: (e) => {
        let size = e.size;
        try {
          size = formatUnits(parseUnits(e.size, 6), 6);
        } catch {
          // keep as recorded
        }
        return `${e.takerSide === 'sell' ? 'Sold' : 'Bought'} ${size} ${e.baseSymbol}`;
      },
    },
    {
      key: 'amount',
      header: 'Received / paid',
      align: 'right',
      cell: (e) => (e.amount !== undefined ? `${formatUnits(e.amount, e.counterDecimals, { minFraction: 2 })} ${e.counterSymbol}` : '—'),
    },
    { key: 'rate', header: 'Rate', align: 'right', cell: (e) => (e.price ? formatRate(e.price) : '—') },
    { key: 'dealer', header: 'Dealer', cell: (e) => (e.dealerCmt ? <Link to={`/dealers/${e.dealerCmt}`} className="font-mono text-12.5 hover:text-seal">{truncateHash(e.dealerCmt)}</Link> : '—') },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (e) => (
        <span className="flex flex-col items-end md:items-start gap-0.5">
          <Chip tone={OUTCOME[e.outcome].tone}>{OUTCOME[e.outcome].label}</Chip>
          {e.failure && <span className="text-12.5 text-mu max-w-[36ch]">{e.failure.detail}</span>}
        </span>
      ),
    },
    {
      key: 'tx',
      header: 'Receipt',
      cell: (e) => (e.txHash ? <Link to={`/trade/${e.id}`} className="text-13.5 underline underline-offset-2 hover:text-seal">Open</Link> : <Hash value={e.id} label="quote" />),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter trades"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={(['all', 'settled', 'failed', 'expired'] as const).map((f) => ({ value: f, label: `${f === 'all' ? 'All' : OUTCOME[f].label} ${count(f)}` }))}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={entries.length === 0}
            onClick={() => downloadJson(`pyron-trades-${ports.network.id}.json`, { kind: 'pyron-trade-history', v: 1, network: ports.network.id, exportedAt: Math.floor(Date.now() / 1000), entries })}
          >
            <Download size={14} aria-hidden="true" />
            Export JSON
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} aria-hidden="true" />
            Delete all
          </Button>
        </div>
      </div>
      <p className="text-12.5 text-mu">Exports are not encrypted. Anyone with the file sees your prices.</p>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title={entries.length === 0 ? 'No trades yet' : 'Nothing matches this filter'} actions={entries.length === 0 ? <ButtonLink to="/trade" variant="primary" size="sm">Request quotes</ButtonLink> : undefined}>
            {entries.length === 0 ? 'Trades you settle, or that fail, from this browser appear here.' : undefined}
          </EmptyState>
        ) : (
          <DataTable caption={`Trades, ${filter}`} columns={columns} rows={rows} rowKey={(e) => e.id} />
        )}
      </Card>
      <DeleteAllDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}
