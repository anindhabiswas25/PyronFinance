// Phase 0 task 0.2 (docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md §3) — dev-only page. Not a real
// route yet (Phase 1 adds routing); mounted directly by App.tsx.
//
// Goal: prove the taker path works in a REAL browser wallet before any Compare/Settle UI is built
// on the assumption that it does. This page:
//   1. connects Lace or 1AM via the DApp Connector API (docs/RELAY.md's actors table;
//      react-wallet-connector / 1am-wallet skills for the connection pattern),
//   2. takes a real `reveal` message from a running Dealer Node (paste it — a full relay-connected
//      RFQ flow is Phase 1's `/trade` page, not this probe),
//   3. decrypts and verifies it against the chain, deserializes the Offer File,
//   4. calls `balanceSealedTransaction` -> `checkTimeToDismiss` (against LIVE ledger parameters)
//      -> `submitTransaction`, and records exactly what happened — accepted or rejected, the
//      node's error code, merged size, input/DUST counts, timings.
//
// Every crypto/verification/offer call below goes through `@otc/sdk/browser` — nothing here
// reimplements verification or touches node:crypto/Buffer. If this file needs something
// browser.ts doesn't export, that is itself a Phase 0 finding to record in docs/ROADMAP.md, not a
// reason to reach for a Node-only import.

import { useState } from 'react';
import '@midnight-ntwrk/dapp-connector-api';
import {
  generateEncKeypair,
  decryptReveal,
  plaintextToTerms,
  encodeTerms,
  verifyReveal,
  deserializeOffer,
  checkTimeToDismiss,
  inputsOf,
  nodeErrorCode,
  indexerChainReader,
  queryLedgerParameters,
  hexToBytes,
  bytesToHex,
  bytesToBase64,
  type RevealMessage,
} from '@otc/sdk/browser';

// Shapes below are copied from the REAL installed @midnight-ntwrk/dapp-connector-api types
// (node_modules/@midnight-ntwrk/dapp-connector-api/dist/api.d.ts), not guessed — a first version
// of this probe guessed makeTransfer's argument shape and it broke on a real 1AM wallet
// ("Cannot read properties of undefined (reading 'toString')"), which is exactly the kind of thing
// Phase 0 exists to catch before it's built into real UI.
type DesiredOutput = { kind: 'shielded' | 'unshielded'; type: string; value: bigint; recipient: string };

type WalletApi = {
  getConfiguration: () => Promise<{ indexerUri: string; indexerWsUri: string; networkId: string }>;
  getUnshieldedAddress: () => Promise<{ unshieldedAddress: string }>;
  getUnshieldedBalances: () => Promise<Record<string, bigint>>;
  getDustBalance: () => Promise<{ balance: bigint; cap?: bigint }>;
  balanceSealedTransaction: (offerHex: string, options?: { payFees?: boolean }) => Promise<{ tx: string }>;
  makeTransfer: (outputs: DesiredOutput[], options?: { payFees?: boolean }) => Promise<{ tx: string }>;
  submitTransaction: (txHex: string) => Promise<void>;
};

type InitialApi = { name: string; connect: (network: string) => Promise<WalletApi> };

function listWallets(): InitialApi[] {
  const injected = (window as unknown as { midnight?: Record<string, InitialApi> }).midnight;
  return injected ? Object.values(injected) : [];
}

type LogLine = { t: number; text: string };

export function SettleProbe() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [wallet, setWallet] = useState<WalletApi | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState('c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34');
  const [revealJson, setRevealJson] = useState('');
  const [takerEncSkHex, setTakerEncSkHex] = useState('');
  const [dealerEncPkHex, setDealerEncPkHex] = useState('');
  const [busy, setBusy] = useState(false);

  const t0 = useState(() => Date.now())[0];
  function record(text: string) {
    setLog((prev) => [...prev, { t: Date.now() - t0, text }]);
  }

  async function connect(name?: string) {
    const wallets = listWallets();
    if (wallets.length === 0) {
      record('ERROR: no Midnight wallet found on window.midnight — install Lace or 1AM and reload');
      return;
    }
    const chosen = name ? wallets.find((w) => w.name === name) ?? wallets[0] : wallets[0];
    record(`connecting to "${chosen.name}" on preprod (approve the popup)...`);
    try {
      const api = await chosen.connect('preprod');
      const [{ unshieldedAddress }, config] = await Promise.all([api.getUnshieldedAddress(), api.getConfiguration()]);
      setWallet(api);
      setAddress(unshieldedAddress);
      record(`connected: ${unshieldedAddress}`);
      record(`indexer: ${config.indexerUri}`);
      const [balances, dust] = await Promise.all([api.getUnshieldedBalances(), api.getDustBalance()]);
      record(`unshielded balances: ${JSON.stringify(balances, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
      record(`DUST: ${dust.balance} (cap ${dust.cap ?? '?'})`);
    } catch (err) {
      record(`ERROR connecting: ${(err as Error).message}`);
    }
  }

  async function tryMergeCoins() {
    if (!wallet || !address) return record('connect a wallet first');
    record('attempting a self-transfer to merge coins (the "prepare wallet" idea)...');
    try {
      const before = await wallet.getUnshieldedBalances();
      const tokenType = Object.keys(before)[0];
      if (!tokenType) throw new Error('wallet holds no unshielded tokens to self-transfer');
      const half = before[tokenType] / 2n;
      if (half <= 0n) throw new Error(`balance of ${tokenType} too small to split`);
      const output: DesiredOutput = { kind: 'unshielded', type: tokenType, value: half, recipient: address };
      const result = await wallet.makeTransfer([output]);
      record(`makeTransfer returned a tx (${result.tx.length / 2} bytes) — submitting...`);
      await wallet.submitTransaction(result.tx);
      record('submitted (submitTransaction resolves void on success)');
      const after = await wallet.getUnshieldedBalances();
      record(`balances before: ${JSON.stringify(before, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
      record(`balances after:  ${JSON.stringify(after, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    } catch (err) {
      record(`ERROR merging coins: ${(err as Error).message} (node code: ${nodeErrorCode(err) ?? 'none found'})`);
    }
  }

  async function settle() {
    if (!wallet) return record('connect a wallet first');
    setBusy(true);
    const started = Date.now();
    try {
      // 1. Parse and decrypt the pasted reveal.
      if (!revealJson.trim()) throw new Error('paste a reveal message JSON first — see step 2');
      const msg = JSON.parse(revealJson) as RevealMessage;
      const takerEncSk = hexToBytes(takerEncSkHex);
      const dealerEncPk = hexToBytes(dealerEncPkHex);
      const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEncSk, dealerEncPk);
      record(`decrypted reveal: ${plaintext.pair} ${plaintext.side} ${plaintext.size} @ ${plaintext.price}`);

      // 2. Verify against the chain — never trust the plaintext alone (docs/ARCHITECTURE.md "COMPARE").
      const config = await wallet.getConfiguration();
      const chain = indexerChainReader(config.indexerUri, contractAddress);
      const quoteId = hexToBytes(msg.quoteId);
      const onChainQuote = await chain.quote(quoteId);
      if (!onChainQuote) throw new Error('quoteId not found on-chain — cannot verify this reveal');
      const dealer = await chain.dealer(onChainQuote.dealerCmt);
      if (!dealer.bond) throw new Error('dealer has no bond on-chain');

      const terms = plaintextToTerms(plaintext);
      const encodedTerms = encodeTerms(terms);
      const nonce = hexToBytes(plaintext.nonce);
      const verdict = verifyReveal(
        { terms, encodedTerms, nonce, signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
        onChainQuote.commitment,
        dealer.bond.quotePk,
        onChainQuote.notional,
      );
      if (!verdict.valid) throw new Error(`reveal failed verification: ${verdict.reason}`);
      record('reveal verified: signature valid, opens the on-chain commitment, notional matches');

      // 3. Deserialize the Offer File. `offerMatchesTerms` (a second, pair-aware sanity check that
      //    the offer pays exactly base=size/counter=counterAmountFor(terms)) needs a pair->asset
      //    RawTokenType table that doesn't exist yet outside Node scripts — that's Phase 1's
      //    apps/web/src/config/networks.ts (prompt §4). Skipped here; verifyReveal above already
      //    checked the revealed size against the on-chain notional, which is the load-bearing guard.
      const dealerTx = deserializeOffer(plaintext.offerFile);
      record(`offer file deserialized: ${inputsOf(dealerTx).length} input(s)`);

      // 4. checkTimeToDismiss on the dealer's half ALONE first — this is the "Offer check" the
      //    Compare screen will show later (docs/prompts §7.1), never balancing the whole wallet
      //    against every quote.
      const { params: liveParams } = await queryLedgerParameters(config.indexerUri);
      const soloCheck = checkTimeToDismiss(dealerTx, liveParams);
      record(`dealer half alone: ${soloCheck.ok ? `fits (fee ${soloCheck.fee})` : `too heavy — ${soloCheck.reason}`}`);

      // 5. Hand it to the wallet to balance. `balanceSealedTransaction` completes a swap FROM an
      //    already-sealed (proved, signed) transaction — distinct from `balanceUnsealedTransaction`,
      //    which is for building a fresh contract call from an unproven tx (CLAUDE.md's split table;
      //    the prompt's §2 wallet-API list).
      const offerHex = bytesToHex(dealerTx.serialize());
      record('calling balanceSealedTransaction (approve the popup)...');
      const balanced = await wallet.balanceSealedTransaction(offerHex);
      const mergedTx = deserializeOffer(bytesToBase64(hexToBytes(balanced.tx)));
      const mergedCheck = checkTimeToDismiss(mergedTx, liveParams);
      record(
        `merged transaction: ${inputsOf(mergedTx).length} input(s), ${mergedCheck.ok ? `fits (fee ${mergedCheck.fee})` : `REJECTED LOCALLY — ${mergedCheck.reason}`}`,
      );
      if (!mergedCheck.ok) {
        record('not submitting — the node would reject this with Custom error: 168 (docs/ROADMAP.md S5)');
        return;
      }

      // 6. Submit for real. Resolves void on success (dapp-connector-api's real signature).
      record('calling submitTransaction (approve the popup)...');
      await wallet.submitTransaction(balanced.tx);
      record(`SETTLED — elapsed ${Date.now() - started} ms`);
    } catch (err) {
      const code = nodeErrorCode(err);
      record(`FAILED: ${(err as Error).message}${code !== undefined ? ` (node code: ${code})` : ''} — elapsed ${Date.now() - started} ms`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 900 }}>
      <h1>Settle probe — Phase 0 task 0.2</h1>
      <p>Dev-only. Not part of the real IA. See docs/ROADMAP.md for what this has and hasn't proven live.</p>

      <section>
        <h2>1. Wallet</h2>
        <button onClick={() => connect()} disabled={busy}>
          Connect (Lace or 1AM, whichever injects first)
        </button>
        {address && <p>Connected: {address}</p>}
      </section>

      <section>
        <h2>2. Reveal (paste from a running Dealer Node / taker-pinger run)</h2>
        <label>
          Contract address
          <input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Reveal message JSON
          <textarea value={revealJson} onChange={(e) => setRevealJson(e.target.value)} rows={6} style={{ width: '100%' }} />
        </label>
        <label>
          Taker enc secret key (hex) — generate one with generateEncKeypair() when publishing the RFQ
          <input value={takerEncSkHex} onChange={(e) => setTakerEncSkHex(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Dealer enc public key (hex) — from the quote_ref's dealerEncPk
          <input value={dealerEncPkHex} onChange={(e) => setDealerEncPkHex(e.target.value)} style={{ width: '100%' }} />
        </label>
        <button
          onClick={() => {
            const kp = generateEncKeypair();
            setTakerEncSkHex(bytesToHex(kp.sk));
            record(`generated a fresh taker enc keypair — pk ${bytesToHex(kp.pk)} (put this in the RFQ's takerEncPk)`);
          }}
        >
          Generate a fresh taker keypair
        </button>
      </section>

      <section>
        <h2>3. Run it</h2>
        <button onClick={settle} disabled={busy || !wallet}>
          Decrypt, verify, balance, check, submit
        </button>
        <button onClick={tryMergeCoins} disabled={busy || !wallet}>
          Try the "prepare wallet" merge-coins self-transfer
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
