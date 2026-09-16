import { ArrowRight, Lock, KeyRound, Radio, ArrowUpDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ButtonLink, Card, ErrorState, Hash, Skeleton, Button, Chip } from '../../design/primitives';
import { useNow } from '../../design/clock';
import { useData } from '../../data/DataProvider';
import { useEventFeed, useSnapshot } from '../../data/hooks';
import { protocolTotals } from '../../data/selectors';
import { formatAgo } from '../../lib/time';
import { formatCount } from '../../lib/format';
import { EventChip, describeEvent, fmtBase } from '../shared/protocol';

const STEPS = [
  { n: 1, title: 'Ask', body: 'Say what you sell and how much. The request goes to several relays at once.', icon: Radio },
  { n: 2, title: 'Dealers seal', body: 'Each dealer locks a hidden price on-chain, backed by their bond.', icon: Lock },
  { n: 3, title: 'Only you open it', body: 'Prices arrive encrypted to you. Other dealers and relays never see them.', icon: KeyRound },
  { n: 4, title: 'Settle atomically', body: 'Pick one. Both sides swap in a single Zswap transaction, or nothing moves.', icon: ArrowUpDown },
];

const NOT = [
  { title: 'Not an AMM', body: 'There is no pool and no curve. A dealer quotes your exact size.' },
  { title: 'Not an order book', body: 'Nothing rests and nothing is matched. Prices exist only after you ask.' },
  { title: 'Not a hosted API', body: 'Relays are a public message format. Run your own and change nothing.' },
];

export default function VenuePage() {
  const { network } = useData();
  const feed = useEventFeed();
  const snap = useSnapshot(feed.events.length);
  const now = useNow(10_000);
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';
  const totals = snap.snapshot ? protocolTotals(snap.snapshot.view) : undefined;
  const recent = [...feed.events].reverse().slice(0, 5);
  const sealed = [...feed.events].reverse().filter((e) => e.kind === 'quote-sealed').slice(0, 3);
  const chainError = snap.status === 'error' || feed.status === 'error';

  return (
    <div className="flex flex-col gap-12 md:gap-16 pt-2 md:pt-8">
      <section className="grid grid-cols-1 gap-10 lg:gap-16 lg:grid-cols-[1.05fr_1fr] items-center" aria-labelledby="venue-title">
        <div className="flex flex-col gap-5">
          <Chip tone="seal" icon={<Lock size={13} aria-hidden="true" />} className="self-start">
            Sealed-quote OTC on Midnight
          </Chip>
          <h1 id="venue-title" className="font-display font-bold text-[40px] md:text-[56px] leading-[1.04] tracking-[-0.015em]">
            Quotes a dealer can’t take back.
          </h1>
          <p className="text-mu text-[17px] md:text-[18px] max-w-[520px]">
            Dealers post a bond and seal their price on-chain before you ever see it. Break the seal and anyone can take the bond. No sign-up, no allowlist, no one in the middle.
          </p>
          <div className="flex flex-wrap gap-3 mt-1">
            <ButtonLink to="/trade" variant="primary">
              Request a quote
              <ArrowRight size={16} strokeWidth={1.7} aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to="/deal">Become a dealer</ButtonLink>
          </div>
        </div>

        <Card className="flex flex-col gap-3.5" aria-labelledby="sealed-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sealed-title" className="font-display font-semibold text-15">
              Latest sealed quotes
            </h2>
            <Link to="/activity" className="text-13.5 text-mu hover:text-tx">
              All activity
            </Link>
          </div>
          {feed.status === 'loading' && sealed.length === 0 ? (
            [0, 1, 2].map((i) => <Skeleton key={i} height={58} className="rounded-input" />)
          ) : sealed.length === 0 ? (
            <p className="text-13.5 text-mu py-4">No dealer has sealed a quote on this contract yet.</p>
          ) : (
            sealed.map((e) => {
              if (e.kind !== 'quote-sealed') return null;
              const bond = snap.snapshot?.view.bonds.get(e.dealerCmt);
              const settled = snap.snapshot?.view.settled.get(e.dealerCmt);
              const resolved = snap.snapshot?.view.quotes.get(e.quoteId)?.resolved;
              const live = !resolved && Number(e.validUntil) > now;
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-input border border-line2 bg-bg px-3.5 py-3">
                  <span aria-hidden="true" className="grid place-items-center w-8 h-8 rounded-[8px] bg-sealbg text-seal shrink-0">
                    <Lock size={16} strokeWidth={1.7} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <Link to={`/dealers/${e.dealerCmt}`} className="font-mono text-12.5 hover:text-seal">
                      {e.dealerCmt.slice(0, 4)}…{e.dealerCmt.slice(-2)}
                    </Link>
                    <p className="text-12.5 text-mu tabular-nums truncate">
                      {bond ? `bond ${fmtBase(bond.amount, 0)} ${symbol}` : 'bond —'} · {settled === undefined ? '—' : formatCount(settled)} settled · size {fmtBase(e.notional)}
                    </p>
                  </div>
                  <Chip tone={live ? 'seal' : 'neutral'}>{live ? 'Sealed · live' : resolved ? 'Resolved' : 'Expired'}</Chip>
                </div>
              );
            })
          )}
          <p className="text-12.5 text-mu">Each row is a commitment on the chain. The price is not there, only its seal.</p>
        </Card>
      </section>

      <section aria-labelledby="totals-title">
        <h2 id="totals-title" className="sr-only">
          Protocol totals
        </h2>
        {chainError ? (
          <Card>
            <ErrorState
              compact
              title="Can’t read the chain right now"
              actions={
                <Button
                  onClick={() => {
                    snap.retry();
                    feed.retry();
                  }}
                >
                  Try again
                </Button>
              }
            >
              {snap.error ?? feed.error}. The totals below need the indexer; nothing is shown until it answers.
            </ErrorState>
          </Card>
        ) : (
          <Card padded={false} className="grid grid-cols-2 md:grid-cols-5">
            {[
              { label: 'Resolved quotes', value: totals && formatCount(totals.resolvedQuotes) },
              { label: 'Bonded dealers', value: totals && formatCount(totals.bondedDealers) },
              { label: 'Total bonded', value: totals && `${fmtBase(totals.totalBonded, 0)} ${symbol}` },
              { label: 'Bonds slashed', value: totals && formatCount(totals.bondsSlashed) },
              { label: 'Burned forever', value: totals && `${fmtBase(totals.burned)} ${symbol}` },
            ].map((t, i) => (
              <div key={t.label} className={`flex flex-col gap-1.5 px-5 py-4 md:px-6 md:py-5 ${i > 0 ? 'md:border-l border-line2' : ''} ${i >= 2 ? 'max-md:border-t border-line2' : ''}`}>
                <span className="label">{t.label}</span>
                {t.value === undefined ? <Skeleton width="60%" height={22} /> : <span className="font-display font-semibold text-22 tabular-nums">{t.value}</span>}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="how-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="how-title" className="font-display font-semibold text-22">
            How a sealed quote works
          </h2>
          <span className="text-13.5 text-mu">about 80 seconds end to end, measured on Preprod</span>
        </div>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col gap-2.5 p-5 border-t border-line">
              <div className="flex items-center justify-between">
                <span className="font-mono text-12.5 text-mu">{s.n}</span>
                <s.icon size={18} strokeWidth={1.7} className="text-mu" aria-hidden="true" />
              </div>
              <h3 className="font-display font-semibold text-15">{s.title}</h3>
              <p className="text-13.5 text-mu">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="What this is not">
        {NOT.map((n) => (
          <Card key={n.title} className="!p-5">
            <h3 className="font-display font-semibold text-15">{n.title}</h3>
            <p className="text-13.5 text-mu mt-1.5">{n.body}</p>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="recent-title">
        <div className="flex items-center justify-between">
          <h2 id="recent-title" className="font-display font-semibold text-19">
            Recent protocol events
          </h2>
          <Link to="/activity" className="text-13.5 text-mu hover:text-tx">
            See all
          </Link>
        </div>
        <Card padded={false}>
          {feed.status === 'error' ? (
            <ErrorState compact title="Events unavailable" actions={<Button onClick={feed.retry}>Try again</Button>}>
              {feed.error}
            </ErrorState>
          ) : recent.length === 0 && feed.status === 'loading' ? (
            <div className="p-5 flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={16} />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="p-5 text-13.5 text-mu">No protocol events on this contract yet.</p>
          ) : (
            <ul>
              {recent.map((e) => {
                const p = describeEvent(e, now, symbol);
                const dealer = 'dealerCmt' in e ? e.dealerCmt : undefined;
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-line2 last:border-b-0">
                    <span className="text-13.5 text-mu w-20 shrink-0">{formatAgo(e.timestamp, now)}</span>
                    <EventChip e={e} now={now} symbol={symbol} />
                    {dealer && (
                      <Link to={`/dealers/${dealer}`} className="font-mono text-12.5 hover:text-seal">
                        {dealer.slice(0, 4)}…{dealer.slice(-2)}
                      </Link>
                    )}
                    {p.size !== undefined && (
                      <span className="text-13.5 tabular-nums">
                        {fmtBase(p.size)} <span className="text-mu">{symbol}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <footer className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-6 border-t border-line2 text-13.5">
        <span className="text-mu flex flex-wrap items-center gap-x-2">
          Contract <Hash value={network.contractAddress} label="contract address" /> · {network.label}
        </span>
        <nav aria-label="Run the protocol" className="flex flex-wrap gap-5">
          <Link to="/deal#run-a-relay" className="text-mu hover:text-tx">
            Run a relay
          </Link>
          <Link to="/deal#dealer-node" className="text-mu hover:text-tx">
            Run a Dealer Node
          </Link>
          <Link to="/verify" className="text-mu hover:text-tx">
            Verify a quote
          </Link>
        </nav>
      </footer>
    </div>
  );
}
