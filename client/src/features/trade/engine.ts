// The taker loop behind /trade: scripts/taker-pinger.ts with a UI. Loaded only by the trade page, so
// importing the SDK here keeps it (and its WASM) off every public page.
//
//   request   fresh X25519 key and rfqId; connect ≥ 2 relays; publish.
//   tick      every 2 s: collect quote_refs (each verified against the chain), fetch reveals from each
//             quote's signed dealerEndpoint (persisted before use), decrypt and verify every reveal:
//             verifyReveal with the on-chain notional, the opposite-side check, offerMatchesTerms,
//             and the offer check on the dealer's half alone.
//   settle    inputs pre-check → wallet balances the sealed offer → the node's time-to-dismiss rule
//             on the merged transaction → submit → indexer confirmation; each stage is real and
//             mirrored into the transaction tray.

import * as sdk from '@otc/sdk/browser';
import type { RevealMessage, RfqBody } from '@otc/sdk/browser';
import type { DataPorts, LedgerParameters } from '../../data/ports';
import { tokenTypeOf } from '../../config/networks';
import { useRfq, type RequestForm, type SettleStageId } from '../../state/rfq';
import { useTray } from '../../state/tray';
import { parseUnits, formatUnits, truncateHash } from '../../lib/format';
import { isValidDealerSide } from '../../lib/side';
import { messageOf, WalletError } from '../../lib/errors';
import { nodeErrorMeaning } from '../../lib/node-errors';
import { revealsKey, type StoredReveal } from '../../data/relay-util';
import type { OfferCheck } from '../../lib/compare';
import { recordTrade, type TradeHistoryEntry } from '../../data/history';
import { downloadJson, evidenceFileName, type FailureEvidence } from '../../lib/evidence';

const SETTLE_STAGES: Array<{ id: SettleStageId; label: string }> = [
  { id: 'inputs', label: 'Offer coins still unspent' },
  { id: 'balance', label: 'Wallet balances the offer' },
  { id: 'check', label: 'Passes the network’s validation limit' },
  { id: 'submit', label: 'Submitting' },
  { id: 'confirm', label: 'Confirmed on-chain' },
];

export interface LocalReceipt {
  quoteId: string;
  dealerCmt: string;
  network: string;
  source: string;
  pair: string;
  takerSide: 'buy' | 'sell';
  size: string;
  price: string;
  amount: bigint;
  baseSymbol: string;
  counterSymbol: string;
  counterDecimals: number;
  txHash: string;
  blockHeight?: number;
  settledAt: number;
  others: Array<{ dealerCmt: string; amount?: bigint; state: string }>;
}

export const receiptKey = (quoteId: string) => `receipt:${quoteId}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TradeEngine {
  private ticking = false;
  private stopScenario?: () => void;
  private params?: Promise<{ height: number; params: LedgerParameters }>;
  private settling = false;

  constructor(
    private readonly ports: DataPorts,
    private readonly relayUrls: () => string[],
  ) {}

  private now(): number {
    return Math.floor(this.ports.clock.nowMs() / 1000);
  }
  private get state() {
    return useRfq.getState().state;
  }
  private dispatch = useRfq.getState().dispatch;

  private pair(code: string) {
    return this.ports.network.pairs.find((p) => p.code === code);
  }

  private ledgerParams() {
    this.params ??= this.ports.chain.ledgerParameters().catch((err) => {
      this.params = undefined;
      throw err;
    });
    return this.params;
  }

  // -------------------------------------------------------------------------------------------
  // Request
  // -------------------------------------------------------------------------------------------

  async request(form: RequestForm): Promise<void> {
    const pair = this.pair(form.pair);
    if (!pair) return this.dispatch({ type: 'request-failed', error: `${form.pair} is not a pair on ${this.ports.network.label}.` });
    let sizeUnits: bigint;
    try {
      sizeUnits = parseUnits(form.size, pair.base.decimals);
    } catch (err) {
      return this.dispatch({ type: 'request-failed', error: `Size: ${messageOf(err)}.` });
    }
    if (sizeUnits <= 0n) return this.dispatch({ type: 'request-failed', error: 'Enter a size above zero.' });

    this.dispatch({ type: 'request', at: this.now() });
    try {
      const urls = this.relayUrls();
      const current = this.ports.relays.status();
      const sameList = current.length === urls.length && current.every((s) => urls.includes(s.url));
      if (!sameList || current.filter((s) => s.connected).length < sdk.MIN_RELAYS) await this.ports.relays.connect(urls);
      const connected = this.ports.relays.status().filter((s) => s.connected).length;

      const keys = sdk.generateEncKeypair();
      const rfq: RfqBody = {
        rfqId: sdk.bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        pair: form.pair,
        side: form.side,
        size: formatUnits(sizeUnits, pair.base.decimals, { group: false }),
        expiry: this.now() + form.windowSecs,
        takerEncPk: sdk.bytesToHex(keys.pk),
        replyTo: urls,
        ...(form.minBond ? { minBond: form.minBond } : {}),
      };

      this.stopScenario = this.ports.startCounterparties?.(rfq, { resume: false });
      this.ports.relays.publishRfq(rfq); // refuses below two connected relays
      this.dispatch({ type: 'published', rfq, takerEncSk: sdk.bytesToHex(keys.sk), at: this.now(), relays: connected });
    } catch (err) {
      this.stopScenario?.();
      this.stopScenario = undefined;
      this.dispatch({ type: 'request-failed', error: messageOf(err) });
    }
  }

  /** After a reload, scripted counterparties (tests) lost their timers; restart what is still pending. */
  resumeScenario(): void {
    const s = this.state;
    if (!this.ports.startCounterparties || !s.rfq || this.stopScenario) return;
    if (s.phase !== 'sealed' && s.phase !== 'revealed') return;
    this.stopScenario = this.ports.startCounterparties(s.rfq, { resume: true });
  }

  cancel(): void {
    this.stopScenario?.();
    this.stopScenario = undefined;
    this.dispatch({ type: 'cancel', at: this.now() });
  }

  dispose(): void {
    this.stopScenario?.();
    this.stopScenario = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Collect and reveal
  // -------------------------------------------------------------------------------------------

  async tick(): Promise<void> {
    const s0 = this.state;
    if (!s0.rfq || (s0.phase !== 'sealed' && s0.phase !== 'revealed') || this.ticking) return;
    this.ticking = true;
    try {
      const rfq = s0.rfq;
      try {
        const agg = await this.ports.relays.collect(rfq);
        this.dispatch({ type: 'chain-error', message: undefined, at: this.now() });
        const now = this.now();
        for (const r of agg.rejected) {
          if (!this.state.quotes[r.quoteId]) this.dispatch({ type: 'announced', quoteId: r.quoteId, dealerCmt: '', relays: r.relays, at: now });
          // "Not found on-chain" is routinely indexer lag behind a fresh commit: keep checking while
          // the window is open instead of calling an honest quote rejected.
          if (/not found on-chain/.test(r.reason) && now < rfq.expiry) this.dispatch({ type: 'checking', quoteId: r.quoteId });
          else this.dispatch({ type: 'rejected', quoteId: r.quoteId, reason: r.reason, at: now });
        }
        for (const v of agg.verified) {
          if (!this.state.quotes[v.quoteId]) this.dispatch({ type: 'announced', quoteId: v.quoteId, dealerCmt: v.dealerCmt, relays: v.relays, at: now });
          this.dispatch({
            type: 'verified',
            quoteId: v.quoteId,
            at: now,
            relays: v.relays,
            chain: {
              bond: v.bondAmount,
              settled: v.settled,
              slashed: v.slashed,
              validUntil: Number(v.validUntil),
              notional: v.notional,
              dealerEndpoint: v.dealerEndpoint,
              dealerEncPk: v.dealerEncPk,
            },
          });
        }
      } catch (err) {
        // "Couldn't verify" is not "rejected": quotes pause; nothing already verified is dropped.
        this.dispatch({ type: 'chain-error', message: messageOf(err), at: this.now() });
      }

      await this.fetchReveals(rfq);

      const s = this.state;
      if (s.phase === 'sealed' && this.now() >= rfq.expiry) this.dispatch({ type: 'to-compare', at: this.now() });
    } finally {
      this.ticking = false;
    }
  }

  private async fetchReveals(rfq: RfqBody): Promise<void> {
    const waiting = Object.values(this.state.quotes).filter((q) => q.verification === 'on-chain' && q.reveal === 'waiting' && q.dealerEndpoint);
    const endpoints = [...new Set(waiting.map((q) => q.dealerEndpoint!))];
    for (const endpoint of endpoints) {
      try {
        await this.ports.relays.fetchMailbox(endpoint, rfq.takerEncPk);
      } catch (err) {
        this.dispatch({ type: 'log', line: { at: this.now(), text: `Mailbox at ${endpoint} unavailable: ${messageOf(err)}`, tone: 'bad' } });
      }
    }
    // Read every message this RFQ has ever received from storage, not just this fetch: the relay
    // deleted them on read, and after a reload storage is the only copy.
    const stored = this.ports.storage.session.get<StoredReveal[]>(revealsKey(rfq.takerEncPk)) ?? [];
    for (const { msg } of stored) {
      const q = this.state.quotes[msg.quoteId];
      if (q && q.verification === 'on-chain' && q.reveal === 'waiting') await this.openReveal(rfq, msg);
    }
  }

  private async openReveal(rfq: RfqBody, msg: RevealMessage): Promise<void> {
    const q = this.state.quotes[msg.quoteId];
    const sk = this.state.takerEncSk;
    if (!q?.dealerEncPk || !sk) return;
    this.dispatch({ type: 'decrypting', quoteId: q.quoteId, message: msg });
    const at = this.now();
    const fail = (status: 'reveal-invalid' | 'seal-mismatch' | 'offer-mismatch', reason: string, extra: Record<string, unknown> = {}) =>
      this.dispatch({ type: 'reveal-failed', quoteId: q.quoteId, status, reason, at, ...extra });

    let plaintext: ReturnType<typeof sdk.decryptReveal>['plaintext'];
    let signature: ReturnType<typeof sdk.decryptReveal>['encodedTermsSignature'];
    try {
      const opened = sdk.decryptReveal(msg, sdk.hexToBytes(sk), sdk.hexToBytes(q.dealerEncPk));
      plaintext = opened.plaintext;
      signature = opened.encodedTermsSignature;
    } catch (err) {
      return fail('reveal-invalid', `couldn’t decrypt: ${messageOf(err)}`);
    }
    const terms = sdk.plaintextToTerms(plaintext);
    const evidence = { terms, nonce: plaintext.nonce, signature: msg.sig, offerFile: plaintext.offerFile };
    if (terms.pair !== rfq.pair) return fail('reveal-invalid', `reveals pair ${terms.pair}, not ${rfq.pair}`, evidence);
    if (!isValidDealerSide(rfq.side, terms.side)) return fail('reveal-invalid', `the dealer revealed side “${terms.side}”, the same side as your request`, evidence);

    let verdict: { valid: boolean; reason?: string };
    try {
      const reader = this.ports.chain.chainReader();
      const cq = await reader.quote(sdk.hexToBytes(q.quoteId));
      if (!cq) return fail('reveal-invalid', 'the quote is no longer on the chain', evidence);
      const cd = await reader.dealer(cq.dealerCmt);
      if (!cd.bond) return fail('reveal-invalid', 'the dealer has no bond on the chain', evidence);
      verdict = sdk.verifyReveal(
        { terms, encodedTerms: sdk.encodeTerms(terms), nonce: sdk.hexToBytes(plaintext.nonce), signature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
        cq.commitment,
        cd.bond.quotePk,
        cq.notional,
      );
    } catch (err) {
      // The chain couldn't be read: put it back to waiting so the next tick tries again.
      this.dispatch({ type: 'chain-error', message: messageOf(err), at });
      useRfq.setState((st) => ({ state: { ...st.state, quotes: { ...st.state.quotes, [q.quoteId]: { ...st.state.quotes[q.quoteId], reveal: 'waiting' } } } }));
      return;
    }
    if (!verdict.valid) {
      // verifyReveal checks the signature first, so a price that fails to open the seal is signed by
      // the dealer's on-chain key: provable fraud, not a garbled message.
      if (/does not open the on-chain commitment/.test(verdict.reason ?? '')) return fail('seal-mismatch', verdict.reason!, evidence);
      return fail('reveal-invalid', verdict.reason ?? 'failed verification', evidence);
    }

    const pair = this.pair(rfq.pair)!;
    const amount = sdk.counterAmountFor(terms);
    const matches = sdk.offerMatchesTerms(plaintext.offerFile, {
      dealerSide: terms.side,
      base: { kind: 'unshielded', token: tokenTypeOf(pair.base), amount: sdk.encodeTerms(terms)[3] },
      counter: { kind: 'unshielded', token: tokenTypeOf(pair.counter), amount },
    });
    if (!matches.ok) return fail('offer-mismatch', matches.reason, evidence);

    let offer: OfferCheck | undefined;
    try {
      const { params } = await this.ledgerParams();
      const tx = sdk.deserializeOffer(plaintext.offerFile);
      const report = sdk.dismissReport(tx, params);
      offer = { inputs: sdk.inputsOf(tx).length, fits: report.ok, computePs: report.computePs, allowancePs: report.allowancePs, reason: report.reason };
    } catch (err) {
      offer = { inputs: 0, fits: false, reason: `couldn’t check: ${messageOf(err)}` };
    }

    this.dispatch({
      type: 'revealed',
      quoteId: q.quoteId,
      at,
      terms,
      nonce: plaintext.nonce,
      offerFile: plaintext.offerFile,
      offerExpiresAt: plaintext.expiresAt,
      amount,
      signature: msg.sig,
      offer,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Settle
  // -------------------------------------------------------------------------------------------

  async settle(quoteId: string): Promise<void> {
    const s0 = this.state;
    const q = s0.quotes[quoteId];
    if (this.settling || !s0.rfq || !q?.offerFile || q.reveal !== 'revealed') return;
    this.settling = true;
    const rfq = s0.rfq;
    const pair = this.pair(rfq.pair)!;
    const started = Date.now();
    const trayId = useTray.getState().start({
      kind: 'settle',
      title: `Settle with ${truncateHash(q.dealerCmt)}`,
      source: this.ports.source,
      href: `/trade/${quoteId}`,
      stages: SETTLE_STAGES.map((st) => ({ id: st.id, label: st.label, status: 'pending' as const })),
    });
    this.dispatch({ type: 'settle-start', quoteId, at: this.now(), trayId });

    let stageStart = Date.now();
    const stage = (id: SettleStageId, status: 'active' | 'done' | 'failed' | 'skipped', detail?: string) => {
      const ms = status === 'active' ? undefined : Date.now() - stageStart;
      if (status === 'active') stageStart = Date.now();
      this.dispatch({ type: 'settle-stage', stage: id, status, detail, ms });
      useTray.getState().stage(trayId, id, { status, detail });
    };
    const failWith = (reason: 'inputs-spent' | 'wallet-shape' | 'expired' | 'rejected', detail: string, extra: { code?: number; spentBy?: string } = {}) => {
      recordTrade(this.ports, this.historyEntry(quoteId, reason === 'expired' ? 'expired' : 'failed', { failure: { reason, detail, code: extra.code } }));
      this.dispatch({ type: 'failed', at: this.now(), failure: { reason, quoteId, detail, ...extra } });
      useTray.getState().fail(trayId, detail);
    };

    try {
      const dealerTx = sdk.deserializeOffer(q.offerFile);
      const inputs = sdk.offerInputsOf(dealerTx);

      // 1. Inputs still unspent (where the indexer can tell us).
      stage('inputs', 'active');
      if (q.validUntil !== undefined && q.validUntil <= this.now()) {
        stage('inputs', 'failed', 'The quote expired');
        return failWith('expired', 'The quote expired before settling started. The dealer is no longer bound to it.');
      }
      const spent = await this.spentInput(inputs);
      if (spent === 'unsupported') {
        stage('inputs', 'skipped', 'Couldn’t check the offer’s coins; a spent coin shows up as a rejection');
      } else if (spent) {
        stage('inputs', 'failed', `Spent in ${truncateHash(spent.byTx ?? '')}`);
        return failWith('inputs-spent', 'The coins behind this offer were already spent, before the quote expired.', { spentBy: spent.byTx });
      } else {
        stage('inputs', 'done', `${inputs.length} coin${inputs.length === 1 ? '' : 's'} unspent`);
      }

      // 2. The wallet balances the sealed offer in its own intent.
      stage('balance', 'active', 'Approve in your wallet');
      let mergedHex: string;
      try {
        mergedHex = await this.ports.wallet.balanceSealed(sdk.bytesToHex(dealerTx.serialize()));
      } catch (err) {
        stage('balance', 'failed', messageOf(err));
        const code = sdk.nodeErrorCode(err);
        return failWith('rejected', err instanceof WalletError ? err.message : `The wallet didn’t balance the offer: ${messageOf(err)}`, { code });
      }
      stage('balance', 'done');

      // 3. The node's time-to-dismiss rule, on the merged transaction, before anything is submitted.
      stage('check', 'active');
      const merged = sdk.deserializeOffer(sdk.bytesToBase64(sdk.hexToBytes(mergedHex)));
      const { params } = await this.ledgerParams();
      const report = sdk.dismissReport(merged, params);
      const figures = `${fmtMs(report.computePs)} of ${fmtMs(report.allowancePs)} ms`;
      this.dispatch({ type: 'settle-info', patch: { mergedSize: report.sizeBytes, computePs: report.computePs, allowancePs: report.allowancePs } });
      if (!report.ok) {
        stage('check', 'failed', figures);
        return failWith('wallet-shape', `Your wallet’s side of this swap is too heavy for the network: ${figures} to validate. The node would reject it (code 168), so nothing was submitted.`, { code: 168 });
      }
      const tradeable = sdk.tradeableBalance(sdk.balanceVectorOf(merged));
      if (!sdk.balanceVectorNetsToZero([tradeable])) {
        stage('check', 'failed', 'Unbalanced');
        return failWith('rejected', `The wallet returned a transaction that doesn’t balance (${sdk.showVector(tradeable)}). Nothing was submitted.`);
      }
      stage('check', 'done', figures);

      // 4. Submit. The connector resolves void; identifiers come from the transaction itself.
      const identifiers = merged.identifiers().map(String);
      this.dispatch({ type: 'settle-info', patch: { identifier: identifiers[0] } });
      stage('submit', 'active', `Usually 17–24 s on ${this.ports.network.label}`);
      try {
        await this.ports.wallet.submit(mergedHex);
      } catch (err) {
        const code = sdk.nodeErrorCode(err);
        stage('submit', 'failed', code !== undefined ? `Node code ${code}` : messageOf(err));
        // Re-check the offer's coins: a rejection is often the dealer having spent them.
        const after = await this.spentInput(inputs);
        if (after && after !== 'unsupported') return failWith('inputs-spent', 'The coins behind this offer were spent by another transaction before yours landed.', { spentBy: after.byTx, code });
        if (q.validUntil !== undefined && q.validUntil <= this.now()) return failWith('expired', 'The quote expired while the settlement was being submitted.', { code });
        return failWith('rejected', nodeErrorMeaning(code), { code });
      }
      stage('submit', 'done');

      // 5. Indexer confirmation.
      stage('confirm', 'active', 'Waiting for the indexer');
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        try {
          const tx = await this.ports.chain.transaction({ identifier: identifiers[0] });
          if (tx) {
            if (tx.status && tx.status !== 'SUCCESS') {
              stage('confirm', 'failed', `Status ${tx.status}`);
              return failWith('rejected', `The transaction landed with status ${tx.status}; nothing was exchanged.`);
            }
            stage('confirm', 'done', `Block ${tx.blockHeight}`);
            recordTrade(this.ports, this.historyEntry(quoteId, 'settled', { txHash: tx.hash, blockHeight: tx.blockHeight }));
            this.dispatch({ type: 'settled', at: this.now(), txHash: tx.hash, blockHeight: tx.blockHeight });
            useTray.getState().finish(trayId, { txHash: tx.hash });
            this.saveReceipt(quoteId, tx.hash, tx.blockHeight, pair);
            return;
          }
        } catch {
          // Indexer hiccup: keep waiting until the deadline.
        }
        await sleep(this.ports.pollMs ?? 2000);
      }
      stage('confirm', 'failed', 'Not seen after 10 minutes');
      failWith('rejected', 'The indexer has not shown this transaction after 10 minutes. It may still land; check the transaction tray before trying again.');
    } catch (err) {
      failWith('rejected', `Settlement stopped: ${messageOf(err)}`);
    } finally {
      this.settling = false;
      void started;
    }
  }

  /** Downloads the failed settlement's evidence (the signed reveal and the Offer File), which anyone
   *  can check on /verify. False when there is no failure to save. */
  saveEvidence(): boolean {
    const s = this.state;
    const failure = s.failure;
    const q = failure ? s.quotes[failure.quoteId] : undefined;
    if (!failure || !q || !s.rfq) return false;
    let offerInputs: FailureEvidence['offerInputs'] = [];
    try {
      if (q.offerFile) offerInputs = sdk.inputsOf(sdk.deserializeOffer(q.offerFile));
    } catch {
      // The file still carries the Offer File itself.
    }
    const evidence: FailureEvidence = {
      kind: 'pyron-failure-evidence',
      v: 1,
      network: this.ports.network.id,
      contract: this.ports.network.contractAddress,
      quoteId: q.quoteId,
      dealerCmt: q.dealerCmt,
      rfqId: s.rfq.rfqId,
      revealMessage: q.message,
      dealerEncPk: q.dealerEncPk,
      terms: q.terms,
      nonce: q.nonce,
      signature: q.signature,
      offerFile: q.offerFile,
      offerInputs,
      validUntil: q.validUntil,
      failure: { reason: failure.reason, detail: failure.detail, code: failure.code, spentBy: failure.spentBy, at: failure.at },
      savedAt: this.now(),
      sampleData: this.ports.source === 'fixture',
    };
    downloadJson(evidenceFileName(evidence), evidence);
    return true;
  }

  /** 'unsupported' also when the indexer can't answer: a pre-check that couldn't run never blocks a
   *  settlement, and never reads as "unspent" either. */
  private async spentInput(inputs: Array<{ intentHash: string; outputNo: number; owner: string }>): Promise<{ spent: true; byTx?: string } | false | 'unsupported'> {
    const lookup = this.ports.chain.inputSpent;
    if (!lookup || !this.ports.capabilities.inputSpentLookup) return 'unsupported';
    try {
      for (const input of inputs) {
        const r = await lookup.call(this.ports.chain, input.intentHash, input.outputNo, input.owner);
        if (r === 'unsupported') return 'unsupported';
        if (r.spent) return { spent: true, byTx: r.byTx };
      }
      return false;
    } catch {
      return 'unsupported';
    }
  }

  private historyEntry(quoteId: string, outcome: TradeHistoryEntry['outcome'], extra: Partial<TradeHistoryEntry>): TradeHistoryEntry {
    const s = this.state;
    const q = s.quotes[quoteId];
    const pair = this.pair(s.rfq?.pair ?? '');
    return {
      id: quoteId,
      network: this.ports.network.id,
      pair: s.rfq?.pair ?? '',
      takerSide: s.rfq?.side ?? 'sell',
      size: s.rfq?.size ?? '',
      dealerCmt: q?.dealerCmt ?? '',
      price: q?.terms?.price,
      amount: q?.amount,
      baseSymbol: pair?.base.symbol ?? '',
      counterSymbol: pair?.counter.symbol ?? '',
      counterDecimals: pair?.counter.decimals ?? 6,
      outcome,
      at: this.now(),
      ...extra,
    };
  }

  private saveReceipt(quoteId: string, txHash: string, blockHeight: number | undefined, pair: NonNullable<ReturnType<TradeEngine['pair']>>) {
    const s = this.state;
    const q = s.quotes[quoteId];
    if (!q?.terms || q.amount === undefined || !s.rfq) return;
    const receipt: LocalReceipt = {
      quoteId,
      dealerCmt: q.dealerCmt,
      network: this.ports.network.id,
      source: this.ports.source,
      pair: s.rfq.pair,
      takerSide: s.rfq.side,
      size: s.rfq.size,
      price: q.terms.price,
      amount: q.amount,
      baseSymbol: pair.base.symbol,
      counterSymbol: pair.counter.symbol,
      counterDecimals: pair.counter.decimals,
      txHash,
      blockHeight,
      settledAt: this.now(),
      others: Object.values(s.quotes)
        .filter((o) => o.quoteId !== quoteId)
        .map((o) => ({ dealerCmt: o.dealerCmt, amount: o.amount, state: o.reveal === 'revealed' ? 'revealed' : o.reveal })),
    };
    this.ports.storage.session.set(receiptKey(quoteId), receipt);
  }
}

function fmtMs(ps: bigint): string {
  return formatUnits(ps / 1_000_000n, 3, { maxFraction: 1, minFraction: 1, round: 'half-up' });
}
