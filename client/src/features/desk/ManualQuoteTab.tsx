// Quote one RFQ by hand: the Dealer Node's commit → reveal, with a person in the loop.
//
//   1. Build the Offer File with the wallet (makeIntent) and check it: sealed, pays exactly the terms,
//      passes the network's validation limit on its own.
//   2. Seal the terms, write nonce + terms + offer to the encrypted journal, THEN submit commitQuote.
//   3. Only once the indexer shows the seal: gossip the signed quote_ref and post the encrypted reveal
//      to the mailbox. The Reveal button does not exist before that.

import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card, EmptyState, Hash, Segmented } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useRelays } from '../../data/useRelays';
import { runCircuit } from '../../data/useCircuit';
import type { IncomingRfq } from '../../data/ports';
import { tokenTypeOf } from '../../config/networks';
import { httpBaseOf } from '../../data/relay-util';
import { isAmountInput, parseUnits, formatUnits, truncateHash } from '../../lib/format';
import { formatUtc } from '../../lib/time';
import { messageOf } from '../../lib/errors';
import { oppositeSide } from '../../lib/side';
import { fmtBase } from '../shared/protocol';
import { manualQuoteGate } from './rules';
import { useDealer, type DealerJournalEntry } from './dealerVault';
import type { DeskView } from './DeskPage';

const VALIDITY = [
  { value: '300', label: '5 min' },
  { value: '600', label: '10 min' },
  { value: '900', label: '15 min' },
];

type Step = { kind: 'idle' } | { kind: 'working'; what: string } | { kind: 'error'; message: string };

export function ManualQuoteTab({ view }: { view: DeskView }) {
  const ports = useData();
  const relays = useRelays();
  const identity = useDealer((s) => s.identity);
  const journal = useDealer((s) => s.journal);
  const [rfqs, setRfqs] = useState<IncomingRfq[]>([]);
  const [selected, setSelected] = useState<string>();
  const [price, setPrice] = useState('');
  const [validity, setValidity] = useState('300');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const { now, snap, actor } = view;

  const connected = relays.count > 0 && ports.relays.status().some((s) => s.connected);
  useEffect(() => {
    const read = () => setRfqs(ports.relays.incomingRfqs().filter((r) => ports.network.pairs.some((p) => p.code === r.body.pair)));
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, [ports.relays, ports.network]);

  // Quotes committed but not yet revealed: wait for the indexer before offering the reveal.
  const pendingReveal = journal.filter((e) => e.state === 'committed' && e.validUntil > now);
  useEffect(() => {
    if (pendingReveal.length === 0) return;
    let alive = true;
    const check = async () => {
      for (const e of pendingReveal) {
        const q = await ports.chain.quote(e.quoteId).catch(() => undefined);
        if (alive && q) setVisible((v) => (v[e.quoteId] ? v : { ...v, [e.quoteId]: true }));
      }
    };
    void check();
    const id = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pendingReveal.map((e) => e.quoteId).join(','), ports.chain]);

  const rfq = rfqs.find((r) => r.envelopeId === selected)?.body;
  const pair = ports.network.pairs.find((p) => p.code === rfq?.pair);
  const bond = identity ? snap.snapshot?.view.bonds.get(identity.dealerCmt) : undefined;

  const derived = useMemo(() => {
    if (!rfq || !pair) return undefined;
    let notional: bigint;
    try {
      notional = parseUnits(rfq.size, pair.base.decimals);
    } catch {
      return undefined;
    }
    let priceUnits: bigint | undefined;
    try {
      priceUnits = price ? parseUnits(price, 6) : undefined;
    } catch {
      priceUnits = undefined;
    }
    const dealerSide = oppositeSide(rfq.side);
    // counterAmountFor, without loading the SDK for the preview: size × price at 6 dp, rounded against the dealer.
    const product = notional * (priceUnits ?? 0n);
    const floor = product / 1_000_000n;
    const counter = dealerSide === 'sell' ? floor : product % 1_000_000n === 0n ? floor : floor + 1n;
    return { notional, dealerSide, priceOk: priceUnits !== undefined && priceUnits > 0n, counter };
  }, [rfq, pair, price]);

  const gate = rfq && derived ? manualQuoteGate({ bond, notional: derived.notional, validitySecs: Number(validity), rfqExpiry: rfq.expiry, now, priceValid: derived.priceOk, actor }) : undefined;

  async function commit() {
    if (!rfq || !pair || !derived || !identity || !gate?.ok) return;
    const put = useDealer.getState().putJournal;
    try {
      const sdk = await import('@otc/sdk/browser');
      const terms = { pair: rfq.pair, side: derived.dealerSide, price, size: rfq.size };
      const counterAmount = sdk.counterAmountFor(terms);
      const baseToken = pair.base.tokenType === 'native' ? sdk.nativeTokenRaw() : tokenTypeOf(pair.base);
      const counterToken = tokenTypeOf(pair.counter);
      const give = derived.dealerSide === 'sell' ? { type: baseToken, value: derived.notional } : { type: counterToken, value: counterAmount };
      const want = derived.dealerSide === 'sell' ? { type: counterToken, value: counterAmount } : { type: baseToken, value: derived.notional };

      setStep({ kind: 'working', what: 'Your wallet builds the offer — approve it there' });
      const address = await ports.wallet.address();
      const offerHex = await ports.wallet.makeIntent([{ kind: 'unshielded', ...give }], [{ kind: 'unshielded', ...want, recipient: address }]);
      const offerFile = sdk.bytesToBase64(sdk.hexToBytes(offerHex));
      let tx;
      try {
        tx = sdk.deserializeOffer(offerFile);
      } catch (err) {
        throw new Error(`Your wallet’s intent isn’t a sealed, proved transaction, so a taker couldn’t settle it (${messageOf(err)}). Quote with the Dealer Node instead.`);
      }
      const matches = sdk.offerMatchesTerms(offerFile, {
        dealerSide: derived.dealerSide,
        base: { kind: 'unshielded', token: baseToken, amount: derived.notional },
        counter: { kind: 'unshielded', token: counterToken, amount: counterAmount },
      });
      if (!matches.ok) throw new Error(`The offer your wallet built doesn’t pay exactly these terms: ${matches.reason}`);
      const { params } = await ports.chain.ledgerParameters();
      const dismiss = sdk.checkTimeToDismiss(tx, params);
      if (!dismiss.ok) throw new Error(`The offer spends ${sdk.inputsOf(tx).length} coins and is too heavy for any taker to settle (${dismiss.reason}). Merge coins in your wallet first.`);
      const ttls = [...(tx.intents ?? [])].map(([, intent]) => (intent as { ttl?: Date }).ttl?.getTime()).filter((t): t is number => typeof t === 'number');
      const offerExpiresAt = ttls.length ? Math.floor(Math.min(...ttls) / 1000) : now + sdk.OFFER_FILE_EXPIRY_SECS;

      const validUntil = BigInt(Math.floor(Date.now() / 1000) + Number(validity));
      if (offerExpiresAt < Number(validUntil) + sdk.DEFAULT_SETTLEMENT_MARGIN_SECS) {
        throw new Error(`The offer expires ${formatUtc(offerExpiresAt)}, before the quote window closes. Choose a shorter validity.`);
      }
      const sealed = sdk.sealQuote(terms, sdk.hexToBytes(rfq.rfqId), validUntil);
      const quoteId = sdk.bytesToHex(sdk.quoteIdFor(sdk.hexToBytes(identity.dealerCmt), sealed));
      const endpoint = ports.relays.status().find((s) => s.connected)?.url;
      if (!endpoint) throw new Error('No relay is connected to receive the reveal.');

      const entry: DealerJournalEntry = {
        quoteId,
        rfqId: rfq.rfqId,
        terms,
        nonce: sdk.bytesToHex(sealed.nonce),
        commitment: sdk.bytesToHex(sealed.commitment),
        validUntil: Number(validUntil),
        notional: sealed.notional,
        offerFile,
        offerExpiresAt,
        takerEncPk: rfq.takerEncPk,
        dealerEndpoint: httpBaseOf(endpoint),
        state: 'intent',
        updatedAt: Math.floor(Date.now() / 1000),
      };
      setStep({ kind: 'working', what: 'Saving the seal’s nonce before anything is sent' });
      await put(entry); // PERSIST BEFORE SUBMIT

      setStep({ kind: 'working', what: 'Committing the sealed quote on-chain' });
      const out = await runCircuit(
        ports,
        { circuit: 'commitQuote', args: [sealed.rfqId, sealed.commitment, sealed.validUntil, sealed.notional], dealerSecretKey: identity.secret },
        { title: `Seal quote for ${truncateHash(rfq.rfqId)}`, kind: 'commit', landed: async () => Boolean(await ports.chain.quote(quoteId)) },
      );
      if (!out.ok) {
        await put({ ...entry, state: 'abandoned', error: out.error, updatedAt: Math.floor(Date.now() / 1000) });
        throw new Error(`The commit didn’t land: ${out.error}`);
      }
      await put({ ...entry, state: 'committed', txHash: out.result?.txHash, updatedAt: Math.floor(Date.now() / 1000) });
      setStep({ kind: 'idle' });
      setPrice('');
    } catch (err) {
      setStep({ kind: 'error', message: messageOf(err) });
    }
  }

  async function reveal(entry: DealerJournalEntry) {
    if (!identity) return;
    try {
      setStep({ kind: 'working', what: 'Announcing the seal and sending the price to the taker' });
      const sdk = await import('@otc/sdk/browser');
      const body = {
        rfqId: entry.rfqId,
        dealerCmt: identity.dealerCmt,
        quoteId: entry.quoteId,
        validUntil: entry.validUntil,
        txHash: entry.txHash && /^[0-9a-f]{64}$/.test(entry.txHash) ? entry.txHash : entry.commitment,
        revealVia: 'mailbox' as const,
        dealerEndpoint: entry.dealerEndpoint,
        dealerEncPk: sdk.bytesToHex(identity.revealPk),
      };
      ports.relays.publishQuoteRef({
        v: sdk.WIRE_VERSION,
        type: 'quote_ref',
        id: sdk.computeId(body),
        ts: Math.floor(Date.now() / 1000),
        ttl: 8,
        body,
        sig: sdk.encodeSignature(sdk.signBody(body, identity.quoteSk)),
      });
      const sealed = { terms: entry.terms, encodedTerms: sdk.encodeTerms(entry.terms), nonce: sdk.hexToBytes(entry.nonce), commitment: sdk.hexToBytes(entry.commitment), rfqId: sdk.hexToBytes(entry.rfqId), validUntil: BigInt(entry.validUntil), notional: entry.notional };
      const message = sdk.encryptReveal(sdk.hexToBytes(entry.quoteId), sdk.buildReveal(sealed, identity.quoteSk, entry.offerFile, entry.offerExpiresAt), identity.revealSk, sdk.hexToBytes(entry.takerEncPk));
      await ports.relays.postReveal(entry.dealerEndpoint, entry.takerEncPk, message);
      await useDealer.getState().putJournal({ ...entry, state: 'revealed', updatedAt: Math.floor(Date.now() / 1000) });
      setStep({ kind: 'idle' });
    } catch (err) {
      setStep({ kind: 'error', message: messageOf(err) });
    }
  }

  if (!view.own || !identity) {
    return (
      <Card className="mt-4">
        <EmptyState title="Quoting needs your dealer key" actions={<Button variant="primary" onClick={() => view.go('keys')}>Set up or unlock your key</Button>}>
          A quote is sealed and signed with the key your bond belongs to.
        </EmptyState>
      </Card>
    );
  }

  const busy = step.kind === 'working';

  return (
    <div className="flex flex-col gap-4 pt-4">
      {!connected && (
        <Banner tone="warn" title="Not connected to relays" actions={<Button size="sm" onClick={() => void ports.relays.connect(relays.urls)}>Connect relays</Button>}>
          Requests reach you over the relays in the relay list ({relays.urls.length}).
        </Banner>
      )}

      {pendingReveal.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-display font-semibold text-15">Step 2 — reveal your price to the taker</h2>
          <p className="text-13.5 text-mu">Sent point-to-point and encrypted to the taker’s key. No other dealer or relay can read it.</p>
          <ul className="flex flex-col gap-2">
            {pendingReveal.map((e) => (
              <li key={e.quoteId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line2 pt-2 text-13.5">
                <span>
                  <Hash value={e.quoteId} label="quote" /> · {e.terms.side} {e.terms.size} at {e.terms.price} · valid to {formatUtc(e.validUntil).slice(11)}
                </span>
                {visible[e.quoteId] ? (
                  <Button size="sm" variant="primary" onClick={() => void reveal(e)} disabled={busy}>
                    Reveal to taker
                  </Button>
                ) : (
                  <span className="text-12.5 text-seal" role="status">
                    Commitment confirmed · waiting for the indexer to show it
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card padded={false}>
          <h2 className="font-display font-semibold text-15 px-4 pt-4 pb-2">Incoming requests</h2>
          {rfqs.length === 0 ? (
            <EmptyState compact title="No requests right now">
              Requests appear as takers publish them. Relays don’t replay old ones.
            </EmptyState>
          ) : (
            <ul role="listbox" aria-label="Incoming requests" className="flex flex-col">
              {rfqs.map((r) => (
                <li key={r.envelopeId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === r.envelopeId}
                    onClick={() => setSelected(r.envelopeId)}
                    className={`w-full text-left px-4 py-3 border-t border-line2 text-13.5 ${selected === r.envelopeId ? 'bg-s2' : 'hover:bg-s2'}`}
                  >
                    <span className="block font-medium">
                      Taker {r.body.side === 'sell' ? 'sells' : 'buys'} {r.body.size} {r.body.pair.split('/')[0]}
                    </span>
                    <span className="block text-12.5 text-mu">
                      {r.body.pair} · open to {formatUtc(r.body.expiry).slice(11)} · via {r.relays.length} relay{r.relays.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          {!rfq || !pair || !derived ? (
            <p className="text-13.5 text-mu">Choose a request to quote it.</p>
          ) : (
            <>
              <h2 className="font-display font-semibold text-15">
                Taker wants to {rfq.side} {rfq.size} {pair.base.symbol} for {pair.counter.symbol}
              </h2>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="quote-price" className="label">
                  Your price ({pair.counter.symbol} per {pair.base.symbol})
                </label>
                <input
                  id="quote-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    if (isAmountInput(e.target.value, 6)) setPrice(e.target.value);
                  }}
                  disabled={busy}
                  className="h-control rounded-input border border-line bg-bg px-3 text-15 tabular-nums outline-none focus:border-mu"
                />
                {derived.priceOk && (
                  <span className="text-13.5">
                    Taker {rfq.side === 'sell' ? 'receives' : 'pays'} {formatUnits(derived.counter, pair.counter.decimals, { minFraction: 2 })} {pair.counter.symbol}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-13.5">Valid for</span>
                <Segmented label="Valid for" value={validity} onChange={(v) => setValidity(String(v))} options={VALIDITY} />
              </div>
              {bond && (
                <Banner tone="warn" title="Committing binds you">
                  You’re bound to this price for {Number(validity) / 60} minutes. If the price you reveal doesn’t open this seal, anyone can slash your entire {fmtBase(bond.amount)} tNIGHT bond: 60 % to the taker, 10 % to the prover, 30 % burned. If your offer’s coins are spent before the taker settles, that failure counts against your record.
                </Banner>
              )}
              {gate && !gate.ok && <p className="text-13.5 text-mu">{gate.reason}</p>}
              <div>
                <Button variant="primary" onClick={() => void commit()} disabled={!gate?.ok || busy || !connected} busy={busy}>
                  Commit sealed quote
                </Button>
              </div>
            </>
          )}
          {step.kind === 'working' && (
            <p className="text-13.5 text-seal" role="status">
              {step.what}…
            </p>
          )}
          {step.kind === 'error' && (
            <Banner tone="bad" title="Not quoted">
              {step.message}
            </Banner>
          )}
        </Card>
      </div>
      <p className="text-12.5 text-mu">Browser quoting builds its Offer File with your wallet’s makeIntent, which hasn’t been run live yet. The Dealer Node’s path is the proven one.</p>
    </div>
  );
}
