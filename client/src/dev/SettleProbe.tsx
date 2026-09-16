// Phase 0 gate (docs/prompts/PHASE-1-TAKER-TRADE-PROMPT.md §4 Step 1.0) — dev-only page.
//
// Proves the whole taker loop in a REAL browser wallet before `/trade` is built on it. It is
// `scripts/taker-pinger.ts` with a browser wallet in place of the headless one:
//   1. connect Lace or 1AM via the DApp Connector API, refuse a wallet on another network;
//   2. publish a real RFQ through RelayAggregator over the browser's own WebSocket;
//   3. collect quote_refs and verify each against the chain (verifyQuoteRef);
//   4. fetch the reveal from the signed dealerEndpoint's mailbox — persisting every message to
//      sessionStorage BEFORE decrypting, because the mailbox read is destructive;
//   5. decrypt, verifyReveal against the chain, check the dealer's side is opposite the RFQ's, and
//      offerMatchesTerms (the Offer File pays exactly the revealed terms);
//   6. checkTimeToDismiss on the dealer half alone, then balanceSealedTransaction, the same check
//      on the merged transaction, submitTransaction, and confirmation on the indexer;
//   7. wait for the dealer to record the trade (quote resolved on-chain).
// Every stage is timed and the merged shape is logged, for docs/ROADMAP.md's Phase 0 gate report.
//
// Everything goes through `@otc/sdk/browser`. Wallet types come from the installed
// dapp-connector-api, never from memory.

import { useRef, useState } from 'react';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  RelayAggregator,
  indexerChainReader,
  generateEncKeypair,
  decryptReveal,
  plaintextToTerms,
  encodeTerms,
  counterAmountFor,
  verifyReveal,
  offerMatchesTerms,
  deserializeOffer,
  describeIntents,
  checkTimeToDismiss,
  inputsOf,
  nodeErrorCode,
  queryLedgerParameters,
  waitForTransaction,
  nativeTokenRaw,
  hexToBytes,
  bytesToHex,
  bytesToBase64,
  type RevealMessage,
  type RfqBody,
} from '@otc/sdk/browser';

const DEFAULTS = {
  network: 'preprod',
  contract: 'c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34', // deployments/preprod.json
  counterToken: '53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc', // deployments/preprod-test-token.json
  pair: 'tNIGHT/TESTUSD',
  relays: 'ws://127.0.0.1:18787/gossip,ws://127.0.0.1:18788/gossip',
  size: '0.001',
};

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSecs = () => Math.floor(Date.now() / 1000);

function listWallets(): InitialAPI[] {
  const injected = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  return injected ? Object.values(injected) : [];
}

/** Appends every fetched mailbox message to sessionStorage before anything reads it. A reveal lost
 *  to a reload after `GET /mailbox` has cleared it is gone for good. */
function persistReveals(takerEncPk: string, messages: RevealMessage[]): RevealMessage[] {
  const key = `otc-probe:reveals:${takerEncPk}`;
  let stored: Array<{ fetchedAt: number; msg: RevealMessage }> = [];
  try {
    stored = JSON.parse(sessionStorage.getItem(key) ?? '[]');
  } catch {
    stored = [];
  }
  for (const msg of messages) stored.push({ fetchedAt: Date.now(), msg });
  sessionStorage.setItem(key, JSON.stringify(stored));
  return stored.map((s) => s.msg);
}

type LogLine = { t: number; text: string };

export function SettleProbe() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [wallet, setWallet] = useState<ConnectedAPI | null>(null);
  const [walletName, setWalletName] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [contract, setContract] = useState(DEFAULTS.contract);
  const [counterToken, setCounterToken] = useState(DEFAULTS.counterToken);
  const [relays, setRelays] = useState(DEFAULTS.relays);
  const [size, setSize] = useState(DEFAULTS.size);
  const [busy, setBusy] = useState(false);
  const t0 = useRef(Date.now());

  function record(text: string) {
    setLog((prev) => [...prev, { t: Date.now() - t0.current, text }]);
  }

  async function connect(w: InitialAPI) {
    record(`connecting to "${w.name}" (${w.rdns}, api ${w.apiVersion}) on ${DEFAULTS.network} — approve the popup`);
    try {
      const api = await w.connect(DEFAULTS.network);
      const config = await api.getConfiguration();
      if (config.networkId !== DEFAULTS.network) {
        record(`REFUSED: wallet is on "${config.networkId}", this probe runs on ${DEFAULTS.network}`);
        return;
      }
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      setWallet(api);
      setWalletName(`${w.name} ${w.apiVersion}`);
      setAddress(unshieldedAddress);
      record(`connected: ${unshieldedAddress}; indexer ${config.indexerUri}`);
      await showBalances(api);
    } catch (err) {
      record(`ERROR connecting: ${(err as Error).message}`);
    }
  }

  async function showBalances(api: ConnectedAPI) {
    const [balances, dust] = await Promise.all([api.getUnshieldedBalances(), api.getDustBalance()]);
    record(`unshielded balances: ${json(balances)}`);
    record(`DUST: balance ${dust.balance}, cap ${dust.cap}`);
  }

  /** §4.3: a self-transfer of a token's WHOLE balance. Smallest-first coin selection must then take
   *  every coin of that token, so the wallet ends up holding one. Whether that reduces a later
   *  settlement's inputs is what the before/after settle runs measure. */
  async function mergeCoins() {
    if (!wallet || !address) return record('connect a wallet first');
    setBusy(true);
    try {
      const token = nativeTokenRaw();
      const before = await wallet.getUnshieldedBalances();
      const value = before[token] ?? 0n;
      if (value <= 0n) throw new Error('wallet holds no tNIGHT');
      record(`merge: self-transfer of the whole tNIGHT balance (${value}) — approve the popup`);
      const started = Date.now();
      const result = await wallet.makeTransfer([{ kind: 'unshielded', type: token, value, recipient: address }]);
      // 1AM resolved this with something other than the declared { tx: string } and submitted the
      // transfer itself (Phase 0). Log the real shape, and only submit a real tx string.
      record(`makeTransfer resolved after ${Date.now() - started} ms: ${json(result).slice(0, 300)}`);
      const tx = (result as { tx?: unknown } | undefined)?.tx;
      if (typeof tx === 'string') {
        await wallet.submitTransaction(tx);
        record('submitted the returned tx');
      } else {
        record('no .tx string on the result — the wallet submitted it itself; not submitting again');
      }
      await showBalances(wallet);
    } catch (err) {
      record(`ERROR merging: ${(err as Error).message} (node code: ${nodeErrorCode(err) ?? 'none found'})`);
    } finally {
      setBusy(false);
    }
  }

  async function runLive() {
    if (!wallet) return record('connect a wallet first');
    setBusy(true);
    const started = Date.now();
    const stage = (() => {
      let last = Date.now();
      return (name: string) => {
        const now = Date.now();
        record(`  ⏱ ${name}: ${now - last} ms (total ${now - started} ms)`);
        last = now;
      };
    })();
    let aggregator: RelayAggregator | undefined;
    let rfqKey: string | undefined;
    try {
      const config = await wallet.getConfiguration();
      const relayList = relays.split(',').map((s) => s.trim()).filter(Boolean);

      // 1. Relays.
      aggregator = new RelayAggregator({
        relays: relayList,
        chain: indexerChainReader(config.indexerUri, contract),
        socketFactory: (url) => new WebSocket(url),
      });
      const status = await aggregator.connect();
      record(`relays: ${status.map((s) => `${s.url}=${s.connected ? 'up' : 'DOWN'}`).join(' ')}`);
      stage('relay connect');

      // 2. RFQ — fresh X25519 key and rfqId, the taker SELLS tNIGHT so it needs only tNIGHT + DUST.
      const takerEnc = generateEncKeypair();
      const rfq: RfqBody = {
        rfqId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        pair: DEFAULTS.pair,
        side: 'sell',
        size,
        expiry: nowSecs() + 600,
        takerEncPk: bytesToHex(takerEnc.pk),
        replyTo: relayList,
      };
      rfqKey = `otc-probe:rfq-sk:${rfq.rfqId}`;
      sessionStorage.setItem(rfqKey, bytesToHex(takerEnc.sk));
      aggregator.publishRfq(rfq);
      record(`RFQ ${rfq.rfqId.slice(0, 12)}… published: ${rfq.side} ${rfq.size} ${rfq.pair}`);
      stage('publish');

      // 3. Collect and verify against the chain.
      let agg = await aggregator.collect(rfq);
      const seenRejections = new Set<string>();
      while (agg.verified.length === 0 && nowSecs() < rfq.expiry - 60) {
        for (const r of agg.rejected) {
          const line = `${r.quoteId.slice(0, 12)}…: ${r.reason}`;
          if (!seenRejections.has(line)) record(`  not verified (yet): ${line}`);
          seenRejections.add(line);
        }
        await sleep(2000);
        agg = await aggregator.collect(rfq);
      }
      if (agg.verified.length === 0) throw new Error('no verified quote before the RFQ window closed');
      const q = agg.verified[0];
      record(
        `quote ${q.quoteId.slice(0, 12)}… VERIFIED on-chain: bond ${q.bondAmount}, settled ${q.settled}, slashed ${q.slashed}, ` +
          `validUntil ${new Date(Number(q.validUntil) * 1000).toISOString()}, via ${q.relays.length} relay(s), mailbox ${q.dealerEndpoint}`,
      );
      stage('RFQ → verified quote');

      // 4. Reveal from the signed dealerEndpoint's mailbox (CORS-enabled), persisted first.
      let msg: RevealMessage | undefined;
      while (!msg && BigInt(nowSecs()) < q.validUntil) {
        const res = await fetch(`${q.dealerEndpoint}/mailbox/${rfq.takerEncPk}`);
        if (!res.ok) throw new Error(`mailbox HTTP ${res.status}`);
        const all = persistReveals(rfq.takerEncPk, (await res.json()) as RevealMessage[]);
        msg = all.find((m) => m.quoteId === q.quoteId);
        if (!msg) await sleep(2000);
      }
      if (!msg) throw new Error('reveal never reached the mailbox before the quote expired');
      stage('verified → reveal fetched');

      // 5. Decrypt and verify everything before trusting a single field.
      const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEnc.sk, hexToBytes(q.dealerEncPk));
      const terms = plaintextToTerms(plaintext);
      const reader = indexerChainReader(config.indexerUri, contract, 0);
      const cq = await reader.quote(hexToBytes(q.quoteId));
      if (!cq) throw new Error('quote vanished from the chain between verification and reveal');
      const cd = await reader.dealer(cq.dealerCmt);
      if (!cd.bond) throw new Error('dealer has no bond on-chain');
      const verdict = verifyReveal(
        { terms, encodedTerms: encodeTerms(terms), nonce: hexToBytes(plaintext.nonce), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
        cq.commitment,
        cd.bond.quotePk,
        cq.notional,
      );
      if (!verdict.valid) throw new Error(`reveal failed verification: ${verdict.reason}`);
      // The RFQ side is the taker's; the terms carry the dealer's. They must be opposite.
      if (terms.side === rfq.side) throw new Error(`dealer revealed side "${terms.side}", the same as the taker's RFQ side`);
      const counter = counterAmountFor(terms);
      const om = offerMatchesTerms(plaintext.offerFile, {
        dealerSide: terms.side,
        base: { kind: 'unshielded', token: nativeTokenRaw(), amount: encodeTerms(terms)[3] },
        counter: { kind: 'unshielded', token: counterToken, amount: counter },
      });
      if (!om.ok) throw new Error(`offer does not match the revealed terms: ${om.reason}`);
      record(
        `reveal VERIFIED: dealer ${terms.side}s ${terms.size} @ ${terms.price}; taker receives ${counter} counter units; ` +
          `Offer File matches terms; offer expires ${new Date(plaintext.expiresAt * 1000).toISOString()}`,
      );
      stage('decrypt + verify + offerMatchesTerms');

      // 6. Offer check on the dealer half alone, then balance, check, submit.
      const { params, height } = await queryLedgerParameters(config.indexerUri);
      const dealerTx = deserializeOffer(plaintext.offerFile);
      const solo = checkTimeToDismiss(dealerTx, params);
      record(
        `dealer half: ${inputsOf(dealerTx).length} input(s), ${dealerTx.serialize().length} B, ${describeIntents(dealerTx)}; ` +
          `dismiss ${solo.ok ? `PASS (fee ${solo.fee})` : `FAIL — ${solo.reason}`}; ledger params at block ${height}`,
      );
      stage('offer check');

      record('balanceSealedTransaction — approve the popup');
      const balanced = await wallet.balanceSealedTransaction(bytesToHex(dealerTx.serialize()));
      stage('balanceSealedTransaction');
      const merged = deserializeOffer(bytesToBase64(hexToBytes(balanced.tx)));
      const mergedCheck = checkTimeToDismiss(merged, params);
      const identifiers = merged.identifiers().map(String);
      record(
        `merged: ${inputsOf(merged).length} unshielded input(s), ${merged.serialize().length} B, ${describeIntents(merged)}; ` +
          `hash ${String(merged.transactionHash())}; identifiers ${identifiers.join(',')}`,
      );
      record(`merged dismiss check: ${mergedCheck.ok ? `PASS (fee ${mergedCheck.fee})` : `FAIL — ${mergedCheck.reason}`}`);
      if (!mergedCheck.ok) {
        throw new Error('not submitting: the node would reject this with Custom error 168 (wallet-shape)');
      }

      record('submitTransaction — approve the popup');
      await wallet.submitTransaction(balanced.tx);
      stage('submitTransaction');
      const tx = await waitForTransaction(config.indexerUri, { identifier: identifiers[0] }, { intervalMs: 2000 });
      record(`SETTLED: tx ${tx.hash}, status ${tx.status}, block ${tx.blockHeight}`);
      stage('submit → indexer');
      try {
        const history = await wallet.getTxHistory(0, 5);
        record(`wallet history (top 5): ${json(history)}`);
      } catch (err) {
        record(`getTxHistory failed: ${(err as Error).message}`);
      }

      // 7. The dealer records the settlement on its own loop.
      const recordStart = Date.now();
      let resolved = false;
      while (!resolved && Date.now() - recordStart < 10 * 60_000) {
        await sleep(10_000);
        resolved = !!(await reader.quote(hexToBytes(q.quoteId)))?.resolved;
      }
      const after = await reader.dealer(cq.dealerCmt);
      record(`dealer recorded the trade: ${resolved}; dealer settled counter ${after.settled}`);
      stage('settled → recorded');
      await showBalances(wallet);
    } catch (err) {
      const code = nodeErrorCode(err);
      record(`FAILED: ${(err as Error).message}${code !== undefined ? ` (node code ${code})` : ''} — total ${Date.now() - started} ms`);
    } finally {
      if (rfqKey) sessionStorage.removeItem(rfqKey);
      await aggregator?.close();
      setBusy(false);
    }
  }

  const wallets = listWallets();
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label style={{ display: 'block', marginBottom: 8 }}>
      {label}
      <input value={value} onChange={(e) => set(e.target.value)} style={{ width: '100%' }} disabled={busy} />
    </label>
  );

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 1000 }}>
      <h1>Settle probe — Phase 0 gate</h1>
      <p>Dev-only. Real RFQ → verify → reveal → settle from a browser wallet. See docs/ROADMAP.md "Phase 0 — browser".</p>

      <section>
        <h2>1. Wallet</h2>
        {wallets.length === 0 && <p>No wallet on window.midnight — install 1AM or Lace and reload.</p>}
        {wallets.map((w) => (
          <button key={w.rdns + w.apiVersion} onClick={() => connect(w)} disabled={busy} style={{ marginRight: 8 }}>
            Connect {w.name} ({w.apiVersion})
          </button>
        ))}
        {address && <p>Connected: {walletName} — {address}</p>}
      </section>

      <section>
        <h2>2. Trade</h2>
        {field('Relays (comma-separated, ≥ 2)', relays, setRelays)}
        {field('Contract', contract, setContract)}
        {field(`Counter token (${DEFAULTS.pair})`, counterToken, setCounterToken)}
        {field('Size to SELL (tNIGHT)', size, setSize)}
        <button onClick={runLive} disabled={busy || !wallet}>
          Run: RFQ → verify → reveal → settle → confirm
        </button>{' '}
        <button onClick={mergeCoins} disabled={busy || !wallet}>
          Merge tNIGHT coins (whole-balance self-transfer)
        </button>{' '}
        <button onClick={() => navigator.clipboard.writeText(log.map((l) => `+${(l.t / 1000).toFixed(1)}s  ${l.text}`).join('\n'))}>
          Copy log
        </button>
      </section>

      <section>
        <h2>Log</h2>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#0f0', padding: 12 }}>
          {log.map((l) => `+${(l.t / 1000).toFixed(1)}s  ${l.text}`).join('\n')}
        </pre>
      </section>
    </div>
  );
}
