import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Clock, Check, FileText, LayoutGrid, Lock } from 'lucide-react';
import { Button, ButtonLink, Card, Chip, EmptyState, ErrorState, Hash, LoadingRegion, Skeleton } from '../../design/primitives';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useOverlays } from '../../state/overlays';
import type { DealerView, NoteView, QuoteView } from '../../data/ports';
import { isHex32, normalizeHex } from '../../lib/hex';
import { formatUnits, parseUnits, truncateHash } from '../../lib/format';
import { formatUtc } from '../../lib/time';
import { messageOf } from '../../lib/errors';
import { formatRate } from '../../lib/compare';
import { fmtBase } from '../shared/protocol';
import type { LocalReceipt } from '../trade/engine';

const receiptKey = (quoteId: string) => `receipt:${quoteId}`;
const WAIT_LIMIT_SECS = 10 * 60;

interface PublicView {
  quote?: QuoteView;
  dealer?: DealerView;
  note?: NoteView;
  height: number;
}

export default function ReceiptPage() {
  const { quoteId: raw = '' } = useParams();
  const quoteId = normalizeHex(raw);
  const valid = isHex32(quoteId);
  const ports = useData();
  const { network, chain, storage } = ports;
  const showFor = useOverlays((s) => s.showFor);
  const now = useNow(10_000);
  const [pub, setPub] = useState<PublicView>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const local = valid ? storage.session.get<LocalReceipt>(receiptKey(quoteId)) : undefined;
  const openedAt = useState(() => now)[0];

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const load = async () => {
      try {
        const snap = await chain.snapshot();
        const quote = snap.view.quotes.get(quoteId);
        const dealer = quote ? await chain.dealer(quote.dealerCmt) : undefined;
        if (alive) {
          setPub({ quote, dealer, note: snap.view.notes.get(quoteId), height: snap.height });
          setError(undefined);
        }
      } catch (err) {
        if (alive) setError(messageOf(err));
      }
    };
    void load();
    // Poll while waiting for the dealer to record the trade (at most 10 minutes).
    const id = setInterval(() => {
      if (Math.floor(ports.clock.nowMs() / 1000) - openedAt < WAIT_LIMIT_SECS) void load();
    }, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [chain, quoteId, valid, attempt, ports.clock, openedAt]);

  const back = (
    <Link to="/me" className="inline-flex items-center gap-1 text-13.5 text-mu hover:text-tx self-start">
      <ChevronLeft size={15} aria-hidden="true" />
      My trades
    </Link>
  );

  if (!valid) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <h1 className="font-display font-bold text-26">Trade receipt</h1>
        <Card>
          <EmptyState title="That isn’t a quote id" actions={<ButtonLink to="/trade">Request quotes</ButtonLink>}>
            A quote id is 64 hex characters.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const resolved = pub?.quote?.resolved;
  const settledLocally = Boolean(local?.txHash);
  const waitingForRecord = settledLocally && pub?.quote && !resolved && now - openedAt < WAIT_LIMIT_SECS;
  const pair = network.pairs.find((p) => p.code === local?.pair) ?? network.pairs[0];
  const title = local
    ? `${local.takerSide === 'sell' ? 'Sold' : 'Bought'} ${formatUnits(parseUnits(local.size, pair.base.decimals), pair.base.decimals)} ${local.baseSymbol} for ${formatUnits(local.amount, local.counterDecimals, { minFraction: 2 })} ${local.counterSymbol}`
    : `Quote ${truncateHash(quoteId)}`;

  const status = settledLocally ? (
    resolved ? (
      <Chip tone="ok" icon={<Check size={12} aria-hidden="true" />}>
        Settled · recorded by dealer
      </Chip>
    ) : (
      <Chip tone="seal" icon={<Clock size={12} aria-hidden="true" />}>
        Settled · not yet recorded
      </Chip>
    )
  ) : resolved ? (
    <Chip title="The chain can’t tell a settled quote from one released unsettled; only a settlement transaction on this device can.">Resolved</Chip>
  ) : pub?.quote ? (
    <Chip tone="seal">Not resolved yet</Chip>
  ) : null;

  const canAttach = settledLocally && resolved && !pub?.note;

  return (
    <div className="flex flex-col gap-5 max-w-[1080px]">
      {back}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          {status}
          <h1 className="font-display font-bold text-26 md:text-30">{title}</h1>
          {local && (
            <span className="text-mu">
              {formatUtc(local.settledAt)} · with{' '}
              <Link to={`/dealers/${local.dealerCmt}`} className="font-mono text-tx hover:text-seal">
                {truncateHash(local.dealerCmt)}
              </Link>
              {local.source === 'fixture' && ' · sample data'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {canAttach && (
            <Button size="sm" onClick={() => showFor('disclosure', { quoteId })}>
              <FileText size={14} aria-hidden="true" />
              Attach disclosure note
            </Button>
          )}
          <ButtonLink size="sm" variant="primary" to="/trade">
            New request
          </ButtonLink>
        </div>
      </div>

      {waitingForRecord && (
        <p className="text-13.5 text-seal" role="status">
          Waiting for the dealer to record this trade. Checking every 10 s for up to 10 minutes; your settlement already landed either way.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-15">What anyone can see</h2>
            <LayoutGrid size={16} className="text-mu" aria-hidden="true" />
          </div>
          {error ? (
            <ErrorState compact title="Can’t read the chain" actions={<Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
              {error}
            </ErrorState>
          ) : !pub ? (
            <LoadingRegion label="Reading this quote from the chain" className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={16} />
              ))}
            </LoadingRegion>
          ) : !pub.quote ? (
            <p className="text-13.5 text-mu">No quote with this id on {network.label}. It may be on another network, or not indexed yet.</p>
          ) : (
            <dl className="flex flex-col gap-2 text-13.5">
              <Row label="Quote">
                <Hash value={quoteId} label="quote" />
              </Row>
              <Row label="Dealer">
                <Link to={`/dealers/${pub.quote.dealerCmt}`} className="font-mono text-12.5 hover:text-seal">
                  {truncateHash(pub.quote.dealerCmt)}
                </Link>
              </Row>
              <Row label="Size">
                {fmtBase(pub.quote.notional)} {pair.base.symbol}
              </Row>
              <Row label="Valid until">{formatUtc(Number(pub.quote.validUntil))}</Row>
              <Row label="Settlement tx">{local?.txHash ? <Hash value={local.txHash} label="settlement transaction" /> : <span className="text-mu">Not known on this device</span>}</Row>
              <Row label="Block">{local?.blockHeight ?? <span className="text-mu">—</span>}</Row>
              <Row label="Status on-chain">{resolved ? 'Resolved' : 'Open'}</Row>
              <Row label="Disclosure note">{pub.note ? `Attached · policy ${pub.note.policyTag === 1 ? 'named recipient' : pub.note.policyTag}` : 'None'}</Row>
            </dl>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-15">Only on this device</h2>
            <Lock size={16} className="text-seal" aria-hidden="true" />
          </div>
          {local ? (
            <>
              <dl className="flex flex-col gap-2 text-13.5">
                <Row label="Price">
                  {formatRate(local.price)} {local.counterSymbol} / {local.baseSymbol}
                </Row>
                <Row label={local.takerSide === 'sell' ? 'You received' : 'You paid'}>
                  {formatUnits(local.amount, local.counterDecimals, { minFraction: 2 })} {local.counterSymbol}
                </Row>
                <Row label="Other quotes">
                  {local.others.length === 0
                    ? 'None'
                    : local.others.map((o) => (o.amount !== undefined ? formatUnits(o.amount, local.counterDecimals, { minFraction: 2 }) : o.state === 'seal-mismatch' ? 'fraud' : o.state)).join(' · ')}
                </Row>
                <Row label="Request key">fresh, used once</Row>
              </dl>
              <p className="text-12.5 text-mu mt-auto">The chain never stores a price. Nobody can link this trade to your others unless you attach a note.</p>
            </>
          ) : (
            <p className="text-13.5 text-mu">Nothing about this trade is stored on this device. The price and amounts are known only to the browser that settled it.</p>
          )}
        </Card>
      </div>

      {canAttach && (
        <Card className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <h2 className="font-display font-semibold text-15">Need to show this trade to someone?</h2>
            <p className="text-13.5 text-mu">A disclosure note encrypts the details to one recipient’s key and ties it to this trade on-chain. They learn nothing about your other trades. Only a hash goes on-chain.</p>
          </div>
          <Button onClick={() => showFor('disclosure', { quoteId })}>Attach note</Button>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-mu">{label}</dt>
      <dd className="text-right min-w-0">{children}</dd>
    </div>
  );
}
