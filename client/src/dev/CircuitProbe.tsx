// Dev-only: the first contract circuit run from a browser wallet (docs/ROADMAP.md task 0.3).
// releaseExpiredQuote is the smallest circuit (155 kB prover key), moves no funds and is
// permissionless, so any connected wallet can release any quote past its grace period.

import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card, Hash } from '../design/primitives';
import { useData } from '../data/DataProvider';
import { useSnapshot } from '../data/hooks';
import { runCircuit, type CircuitOutcome } from '../data/useCircuit';
import { useWalletStore } from '../state/wallet';
import { useOverlays } from '../state/overlays';
import { PROOF_GRACE_PERIOD_SECS } from '../lib/bond';
import { hexToBytes, isHex32, normalizeHex } from '../lib/hex';

export function CircuitProbe() {
  const ports = useData();
  const snap = useSnapshot();
  const walletStatus = useWalletStore((s) => s.status);
  const show = useOverlays((s) => s.show);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string>();
  const [outcomes, setOutcomes] = useState<Record<string, CircuitOutcome>>({});

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10_000);
    return () => clearInterval(id);
  }, []);

  const releasable = useMemo(() => {
    const quotes = snap.snapshot ? [...snap.snapshot.view.quotes.values()] : [];
    return quotes.filter((q) => !q.resolved && BigInt(now) >= q.validUntil + BigInt(PROOF_GRACE_PERIOD_SECS));
  }, [snap.snapshot, now]);

  async function release(quoteId: string) {
    setBusy(quoteId);
    show('notifications');
    const out = await runCircuit(
      ports,
      { circuit: 'releaseExpiredQuote', args: [hexToBytes(quoteId)] },
      { title: `Release quote ${quoteId.slice(0, 8)}…`, kind: 'release', landed: async () => (await ports.chain.quote(quoteId))?.resolved === true },
    );
    setOutcomes((o) => ({ ...o, [quoteId]: out }));
    setBusy(undefined);
  }

  const manualId = normalizeHex(manual.trim());

  return (
    <section className="flex flex-col gap-5 max-w-[860px]">
      <h1 className="font-display font-bold text-30">Circuit probe</h1>
      <p className="text-mu">
        Dev only. Runs <code className="font-mono">releaseExpiredQuote</code> from the connected wallet on {ports.network.label}: the circuit runs here,
        the wallet proves, balances and submits, and the indexer confirms. Every stage is in the transaction tray.
      </p>
      {walletStatus !== 'connected' && (
        <Banner tone="warn" title="Connect a wallet first">
          <Button size="sm" onClick={() => show('connect')}>
            Connect wallet
          </Button>
        </Banner>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-display font-semibold text-15">Releasable quotes (past validity + 1 h grace, unresolved)</h2>
        {snap.status === 'error' && <p className="text-bad text-13.5">Can’t read the chain: {snap.error}</p>}
        {snap.snapshot && releasable.length === 0 && <p className="text-mu text-13.5">None on-chain right now.</p>}
        <ul className="flex flex-col gap-2">
          {releasable.map((q) => (
            <li key={q.quoteId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line2 pt-2">
              <span className="flex flex-col gap-0.5">
                <Hash value={q.quoteId} />
                <span className="text-12.5 text-mu">
                  expired {new Date(Number(q.validUntil) * 1000).toISOString()} · dealer {q.dealerCmt.slice(0, 8)}…
                </span>
                <Outcome out={outcomes[q.quoteId]} />
              </span>
              <Button size="sm" onClick={() => void release(q.quoteId)} disabled={walletStatus !== 'connected' || Boolean(busy)} busy={busy === q.quoteId}>
                Release
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <label htmlFor="probe-quote" className="label">
          Or a quote id
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="probe-quote"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="64 hex characters"
            className="flex-1 min-w-0 h-control rounded-input border border-line bg-bg px-3 font-mono text-13.5"
          />
          <Button onClick={() => void release(manualId)} disabled={!isHex32(manualId) || walletStatus !== 'connected' || Boolean(busy)} busy={busy === manualId}>
            Release
          </Button>
        </div>
        <Outcome out={outcomes[manualId]} />
      </Card>
    </section>
  );
}

function Outcome({ out }: { out?: CircuitOutcome }) {
  if (!out) return null;
  if (out.ok) return <span className="text-12.5 text-ok">{out.result ? `Released · block ${out.result.blockHeight}` : out.note}</span>;
  return (
    <span className="text-12.5 text-bad">
      Failed at {out.stage ?? 'start'}: {out.error}
    </span>
  );
}
