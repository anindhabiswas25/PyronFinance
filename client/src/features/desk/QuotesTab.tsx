import { useMemo, useState } from 'react';
import { Banner, Button, Card, Countdown, DataTable, Dialog, EmptyState, Hash, type Column } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { dealerQuotes, type DealerQuote } from '../../data/selectors';
import { runCircuit } from '../../data/useCircuit';
import { hexToBytes } from '../../lib/hex';
import { OutcomeChip, fmtBase } from '../shared/protocol';
import { actorGate, releaseGate } from './rules';
import { useDealer } from './dealerVault';
import type { DeskView } from './DeskPage';

export function QuotesTab({ view }: { view: DeskView }) {
  const ports = useData();
  const { dealerCmt, snap, feed, now, actor } = view;
  const journal = useDealer((s) => s.journal);
  const identity = useDealer((s) => s.identity);
  const [busy, setBusy] = useState<string>();
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [recording, setRecording] = useState<DealerQuote>();

  const quotes = useMemo(() => (snap.snapshot && dealerCmt ? dealerQuotes(snap.snapshot.view, feed.events, dealerCmt, now) : []), [snap.snapshot, feed.events, dealerCmt, now]);
  const releasable = quotes.filter((q) => releaseGate({ validUntil: q.validUntil, resolved: false }, now, actor.walletConnected).ok && q.outcome === 'expired');

  async function release(q: DealerQuote) {
    setBusy(q.quoteId);
    const out = await runCircuit(
      ports,
      { circuit: 'releaseExpiredQuote', args: [hexToBytes(q.quoteId)] },
      { title: `Release quote ${q.quoteId.slice(0, 8)}…`, kind: 'release', landed: async () => (await ports.chain.quote(q.quoteId))?.resolved === true },
    );
    setNotes((n) => ({ ...n, [q.quoteId]: out.ok ? { ok: true, text: out.note ?? 'Released' } : { ok: false, text: out.error } }));
    setBusy(undefined);
    snap.retry();
  }

  async function releaseAll() {
    for (const q of releasable) await release(q);
  }

  async function record(q: DealerQuote) {
    if (!identity) return;
    setRecording(undefined);
    setBusy(q.quoteId);
    const out = await runCircuit(
      ports,
      { circuit: 'recordSettlement', args: [hexToBytes(q.quoteId)], dealerSecretKey: identity.secret },
      { title: `Record settlement ${q.quoteId.slice(0, 8)}…`, kind: 'record', landed: async () => (await ports.chain.quote(q.quoteId))?.resolved === true },
    );
    const entry = journal.find((e) => e.quoteId === q.quoteId);
    if (out.ok && entry) await useDealer.getState().putJournal({ ...entry, state: 'recorded', updatedAt: Math.floor(ports.clock.nowMs() / 1000) });
    setNotes((n) => ({ ...n, [q.quoteId]: out.ok ? { ok: true, text: out.note ?? 'Recorded as settled' } : { ok: false, text: out.error } }));
    setBusy(undefined);
    snap.retry();
  }

  if (!dealerCmt) return <EmptyState title="Open a dealer to see its quotes" actions={<Button onClick={() => view.go('keys')}>Keys</Button>} />;

  const columns: Column<DealerQuote>[] = [
    { key: 'quote', header: 'Quote', cell: (q) => <Hash value={q.quoteId} label="quote" /> },
    { key: 'size', header: 'Size (tNIGHT)', label: 'Size', align: 'right', cell: (q) => fmtBase(q.notional) },
    {
      key: 'state',
      header: 'State',
      cell: (q) =>
        q.outcome === 'live' ? (
          <OutcomeChip
            outcome="live"
            suffix={
              <>
                {' · '}
                <Countdown until={Number(q.validUntil)} now={now} />
              </>
            }
          />
        ) : (
          <OutcomeChip outcome={q.outcome} />
        ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (q) => {
        const note = notes[q.quoteId];
        if (note) return <span className={note.ok ? 'text-12.5 text-ok' : 'text-12.5 text-bad'}>{note.text}</span>;
        if (q.outcome === 'expired') {
          const g = releaseGate({ validUntil: q.validUntil, resolved: false }, now, actor.walletConnected);
          return g.ok ? (
            <Button size="sm" onClick={() => void release(q)} busy={busy === q.quoteId} disabled={Boolean(busy)}>
              Release
            </Button>
          ) : (
            <span className="text-12.5 text-mu">{g.reason}</span>
          );
        }
        if (q.outcome === 'live' && view.own) {
          const g = actorGate(actor);
          return g.ok ? (
            <Button size="sm" variant="ghost" onClick={() => setRecording(q)} disabled={Boolean(busy)} busy={busy === q.quoteId}>
              Record settlement
            </Button>
          ) : (
            <span className="text-12.5 text-mu">{g.reason}</span>
          );
        }
        return <span className="text-12.5 text-mu">—</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-13.5 text-mu">Releasing is permissionless: any wallet can release any quote an hour after it expired. It moves no funds.</p>
        <Button size="sm" onClick={() => void releaseAll()} disabled={releasable.length === 0 || Boolean(busy)}>
          Release all expired ({releasable.length})
        </Button>
      </div>
      <Card padded={false}>
        {quotes.length === 0 ? (
          <EmptyState compact title={snap.snapshot ? 'No quotes sealed by this dealer' : 'Reading quotes from the chain…'} />
        ) : (
          <DataTable caption="Quotes by this dealer" columns={columns} rows={quotes} rowKey={(q) => q.quoteId} />
        )}
      </Card>
      <Dialog
        open={Boolean(recording)}
        onClose={() => setRecording(undefined)}
        title="Record this trade as settled?"
        description="Only record a quote whose Offer File a taker actually settled. The contract can’t check it; your settled count is your public word."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecording(undefined)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => recording && void record(recording)}>
              Record settlement
            </Button>
          </>
        }
      >
        <Banner tone="warn" title="A quote nobody settled should be released, not recorded">
          Releasing is available one hour after it expires.
        </Banner>
      </Dialog>
    </div>
  );
}
