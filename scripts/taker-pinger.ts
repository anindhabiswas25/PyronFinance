// M3 definition-of-done driver: a taker that keeps asking a Dealer Node for quotes, unattended, so a
// multi-hour run proves the node holds a standing quote alive across several Offer File expiry cycles.
//
// Every PINGER_INTERVAL_SECS it:
//   1. publishes an RFQ through RelayAggregator to every configured relay (>= 2);
//   2. collects quote_refs and verifies each against the LIVE indexer;
//   3. pulls the encrypted reveal from the dealer's relay mailbox, runs verifyReveal against the chain,
//      and offerMatchesTerms against the Offer File — the check that stops a dealer revealing honest
//      terms beside an offer that pays less;
//   4. every PINGER_SETTLE_EVERY-th verified quote: settles it from the taker wallet, waits for the
//      dealer node to record it, attaches a named-recipient disclosure note to the trade, and decrypts
//      and verifies it as the recipient (M3's disclosure round-trip, DISCLOSURE.md).
//
// Everything is logged with the Offer File's expiresAt, so the log shows quotes answered by offers
// proved in different expiry cycles.
//
// Env: MN_TAKER_WALLET_SEED (taker), PINGER_RELAYS (comma-separated ws URLs), PINGER_INTERVAL_SECS
// (default 900), PINGER_SETTLE_EVERY (default 4; 0 = never), PINGER_CYCLES (default 16), PINGER_SIZE
// (default 0.001), PINGER_SIDE (default sell), PINGER_COUNTER_TOKEN (required off USDM networks).

import fs from 'node:fs';
import path from 'node:path';
import { x25519 } from '@noble/curves/ed25519';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { RelayAggregator, indexerChainReader } from '../packages/sdk/src/relay-client.js';
import { decryptReveal, generateEncKeypair, plaintextToTerms, type RevealMessage } from '../packages/sdk/src/reveal-channel.js';
import { verifyReveal } from '../packages/sdk/src/quotes.js';
import { counterAmountFor, encodeTerms } from '../packages/sdk/src/terms.js';
import { offerMatchesTerms, settleFromOffer } from '../packages/sdk/src/offers.js';
import { queryLatestContractState, queryLedgerParameters, waitForTransaction } from '../packages/sdk/src/indexer.js';
import { sealNote, verifyNote } from '../packages/sdk/src/disclosure.js';
import { usdmFor } from '../packages/sdk/src/assets.js';
import { ledger as otcLedger } from '../contracts/managed/otc-protocol/contract/index.js';
import type { RfqBody } from '../packages/relay-node/src/schema.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: test driver');
initNetworkId(chain.network);

const seed = process.env.MN_TAKER_WALLET_SEED;
if (!seed) throw new Error('MN_TAKER_WALLET_SEED is not set');
const RELAYS = (process.env.PINGER_RELAYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const INTERVAL = Number(process.env.PINGER_INTERVAL_SECS ?? '900');
const SETTLE_EVERY = Number(process.env.PINGER_SETTLE_EVERY ?? '4');
const CYCLES = Number(process.env.PINGER_CYCLES ?? '16');
const SIZE = process.env.PINGER_SIZE ?? '0.001';
const SIDE = (process.env.PINGER_SIDE ?? 'sell') as 'buy' | 'sell';
const NIGHT = ledger.nativeToken().raw;
const COUNTER = process.env.PINGER_COUNTER_TOKEN ?? usdmFor(chain.network)?.tokenType;
if (!COUNTER) throw new Error('PINGER_COUNTER_TOKEN is required on this network');
const PAIR = usdmFor(chain.network) && !process.env.PINGER_COUNTER_TOKEN ? 'tNIGHT/USDM' : 'tNIGHT/TESTUSD';

const { address: contractAddress } = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`), 'utf-8'),
);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nowSecs = () => Math.floor(Date.now() / 1000);

const wallet = await createHeadlessWallet(seed, chain);
await wallet.waitForSync();
const providers = buildOTCProviders(chain, wallet);
const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: null, takerAddress: new Uint8Array(Buffer.from(wallet.unshieldedAddressHex, 'hex')) },
});
const reader = indexerChainReader(chain.indexerHttp, contractAddress, 0);
const aggregator = new RelayAggregator({ relays: RELAYS, chain: indexerChainReader(chain.indexerHttp, contractAddress) });
const status = await aggregator.connect();
log(`taker ${wallet.unshieldedAddress}; relays ${status.map((s) => `${s.url}=${s.connected}`).join(' ')}; pair ${PAIR}`);

let verifiedCount = 0;
const summary: string[] = [];

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  const started = Date.now();
  const takerEnc = generateEncKeypair();
  const rfq: RfqBody = {
    rfqId: hex(crypto.getRandomValues(new Uint8Array(32))),
    pair: PAIR,
    side: SIDE,
    size: SIZE,
    expiry: nowSecs() + 600,
    takerEncPk: hex(takerEnc.pk),
    replyTo: RELAYS,
  };
  try {
    aggregator.publishRfq(rfq);
    log(`[cycle ${cycle}] RFQ ${rfq.rfqId.slice(0, 12)}… published (${SIDE} ${SIZE})`);

    let agg = await aggregator.collect(rfq);
    while (agg.verified.length === 0 && nowSecs() < rfq.expiry - 60) {
      await new Promise((r) => setTimeout(r, 5000));
      agg = await aggregator.collect(rfq);
    }
    if (agg.verified.length === 0) {
      const line = `[cycle ${cycle}] NO verified quote before RFQ expiry (${agg.rejected.length} rejected: ${agg.rejected.map((r) => r.reason).join('; ')})`;
      log(line);
      summary.push(line);
      continue;
    }
    const q = agg.verified[0];
    log(`[cycle ${cycle}] quote ${q.quoteId.slice(0, 12)}… verified on-chain after ${Math.round((Date.now() - started) / 1000)} s (bond ${q.bondAmount}, settled ${q.settled}, via ${q.relays.length} relay(s))`);

    let msg: RevealMessage | undefined;
    for (let i = 0; i < 24 && !msg; i++) {
      const box = (await (await fetch(`${q.dealerEndpoint}/mailbox/${rfq.takerEncPk}`)).json()) as RevealMessage[];
      msg = box.find((m) => m.quoteId === q.quoteId);
      if (!msg) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!msg) throw new Error('reveal never reached the mailbox');
    const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEnc.sk, Buffer.from(q.dealerEncPk, 'hex'));
    const terms = plaintextToTerms(plaintext);
    const cq = (await reader.quote(Buffer.from(q.quoteId, 'hex')))!;
    const cd = await reader.dealer(cq.dealerCmt);
    const rv = verifyReveal(
      { terms, encodedTerms: encodeTerms(terms), nonce: Buffer.from(plaintext.nonce, 'hex'), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
      cq.commitment, cd.bond!.quotePk, cq.notional,
    );
    if (!rv.valid) throw new Error(`reveal failed verification: ${rv.reason}`);
    const size = encodeTerms(terms)[3];
    const om = offerMatchesTerms(plaintext.offerFile, {
      dealerSide: terms.side,
      base: { kind: 'unshielded', token: NIGHT, amount: size },
      counter: { kind: 'unshielded', token: COUNTER, amount: counterAmountFor(terms) },
    });
    if (!om.ok) throw new Error(om.reason);
    verifiedCount++;
    const offerLeft = plaintext.expiresAt - nowSecs();
    const line = `[cycle ${cycle}] reveal OK: ${terms.side} ${terms.size} @ ${terms.price}; offer expires ${new Date(plaintext.expiresAt * 1000).toISOString()} (${offerLeft} s left); offer matches terms`;
    log(line);
    summary.push(line);

    if (SETTLE_EVERY > 0 && verifiedCount % SETTLE_EVERY === 0) {
      const { params } = await queryLedgerParameters(chain.indexerHttp);
      const s = await settleFromOffer({ wallet, offerFileBase64: plaintext.offerFile, expiresAt: plaintext.expiresAt, ledgerParameters: params });
      const tx = await waitForTransaction(chain.indexerHttp, { identifier: s.txId });
      log(`[cycle ${cycle}] SETTLED ${tx.hash} status ${tx.status}`);
      // The dealer node records the settlement on its own watch loop; wait for the chain to show it.
      const t0 = Date.now();
      let resolved = false;
      while (!resolved && Date.now() - t0 < 10 * 60_000) {
        await new Promise((r) => setTimeout(r, 10_000));
        resolved = !!(await reader.quote(Buffer.from(q.quoteId, 'hex')))?.resolved;
      }
      const d2 = await reader.dealer(cq.dealerCmt);
      summary.push(`[cycle ${cycle}] settled ${tx.hash} (${tx.status}); dealer recorded: ${resolved}; dealer settled counter ${d2.settled}`);
      log(summary[summary.length - 1]);

      if (resolved) {
        const recipient = { sk: x25519.utils.randomSecretKey() };
        const recipientPk = x25519.getPublicKey(recipient.sk);
        const sealed = sealNote({ tradeId: q.quoteId, pair: terms.pair, side: terms.side, price: terms.price, size: terms.size, settledAt: nowSecs(), dealerCmt: hex(cq.dealerCmt), parties: { run: 'm3-dod' } }, recipientPk);
        await contract.callTx.attachDisclosureNote(sealed.attach.tradeId, sealed.attach.ciphertextHash, BigInt(sealed.attach.policyTag), sealed.attach.recipientHint);
        const chainView = {
          async note(id: Uint8Array) {
            const raw = await queryLatestContractState(chain.indexerHttp, contractAddress);
            const l = otcLedger(raw!.data);
            return l.notes.member(id) ? l.notes.lookup(id) : undefined;
          },
          quote: (id: Uint8Array) => reader.quote(id),
        };
        const ok = await verifyNote(sealed.blob, recipient.sk, q.quoteId, chainView);
        const wrong = await verifyNote(sealed.blob, x25519.utils.randomSecretKey(), q.quoteId, chainView);
        const line2 = `[cycle ${cycle}] DISCLOSURE attached on-chain; intended recipient verifies: ${ok.ok}; a different key: ${wrong.ok ? 'DECRYPTED (BAD)' : `refused (${(wrong as { reason: string }).reason})`}`;
        log(line2);
        summary.push(line2);
      }
    }
  } catch (err) {
    const line = `[cycle ${cycle}] ERROR ${(err as Error).message.split('\n')[0]}`;
    log(line);
    summary.push(line);
  }
  const wait = INTERVAL * 1000 - (Date.now() - started);
  if (cycle < CYCLES && wait > 0) await new Promise((r) => setTimeout(r, wait));
}

log('--- summary ---');
for (const s of summary) log(s);
await aggregator.close();
process.exit(0);
