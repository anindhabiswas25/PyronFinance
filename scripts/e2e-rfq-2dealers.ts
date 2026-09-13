// Task A3 — the M2 definition of done, minus UI: one sealed-bid RFQ cycle with TWO COMPETING DEALERS,
// over TWO REAL RELAY PROCESSES, verified against the LIVE INDEXER, settled on-chain.
//
//   1. two `packages/relay-node` processes start on localhost and peer with each other;
//   2. dealer A and dealer B each post a bond (distinct dealer commitments and quote keys);
//   3. the taker publishes an RFQ through RelayAggregator to BOTH relays;
//   4. each dealer, listening on a different relay, receives it, prices it, builds + proves an Offer
//      File, commits on-chain, waits until the INDEXER shows the commitment, then gossips a signed
//      quote_ref and drops its encrypted reveal in its relay's mailbox;
//   5. the taker aggregates, verifies every reference against the live indexer (indexerChainReader),
//      pulls both reveals, verifies each against the chain, COMPARES PRICES CLIENT-SIDE, and settles
//      the better one;
//   6. the winner records the settlement; the loser's quote is left live, and is released later by
//      the TAKER — releaseExpiredQuote is permissionless — once validUntil + PROOF_GRACE_PERIOD passes.
//
// Price comparison happens here, in the taker's client, on revealed quotes. The chain never sees a
// price it could compare (CLAUDE.md drift alarm).
//
// Honest limits of this setup: both dealers are backed by ONE wallet (MN_WALLET_SEED) — they are
// distinct protocol identities with distinct bonds, keys and reveal channels, but share coins and a
// private-state store, so their on-chain calls are serialised here. The taker is a separate wallet
// (MN_TAKER_WALLET_SEED). Relays run on one machine over ws://, not over the internet with TLS.
//
// Resumable release phase: state goes to .wallet-state/rfq2-<network>.json; rerun with RFQ2_PHASE=release.
//
// REFUSES MAINNET.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet, type HeadlessWallet } from '../packages/sdk/src/wallet.js';
import { walletStateDir } from '../packages/sdk/src/wallet-state.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { schnorrPublicKey, freshNonce } from '../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../packages/sdk/src/domain.js';
import { postBond, minBondForNotional } from '../packages/sdk/src/bonding.js';
import { encodeTerms } from '../packages/sdk/src/terms.js';
import { sealQuote, commitQuote, buildReveal, verifyReveal } from '../packages/sdk/src/quotes.js';
import { recordSettlement, releaseExpiredQuote } from '../packages/sdk/src/fraud.js';
import { generateEncKeypair, encryptReveal, decryptReveal, plaintextToTerms, type RevealMessage } from '../packages/sdk/src/reveal-channel.js';
import { buildAndProveOffer, settleFromOffer, type ProvedOffer } from '../packages/sdk/src/offers.js';
import { usdmFor } from '../packages/sdk/src/assets.js';
import { queryLedgerParameters, queryLatestContractState, waitForTransaction } from '../packages/sdk/src/indexer.js';
import { RelayAggregator, indexerChainReader } from '../packages/sdk/src/relay-client.js';
import { computeId, encodeSignature, signBody, WIRE_VERSION, type Envelope, type QuoteRefBody, type RfqBody } from '../packages/relay-node/src/schema.js';
import { ledger as otcLedger, type Contract } from '../contracts/managed/otc-protocol/contract/index.js';
import type { OTCPrivateState } from '../packages/sdk/src/private-state.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: test script');
initNetworkId(chain.network);

const PROOF_GRACE_PERIOD = 3600;
const EDGE_MARGIN_SECS = 120;
const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const NIGHT = ledger.nativeToken().raw;
const SIZE_UNITS = 1000n; // tNIGHT the taker sells
const TERMS_SIZE = '0.001';
const VALIDITY_SECS = 600;
const RELAY_PORTS = [18787, 18788];
const DEALER_PRICES = { A: '41.44', B: '41.52' }; // taker SELLS tNIGHT for the counter-asset: higher is better

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const nowSecs = () => Math.floor(Date.now() / 1000);
const t = () => `+${((Date.now() - T0) / 1000).toFixed(1)}s`;
const T0 = Date.now();

const { address: contractAddress } = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`), 'utf-8'),
);
const usdm = usdmFor(chain.network);
const COUNTER: string = usdm
  ? usdm.tokenType
  : JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`), 'utf-8')).tokenType;
const PAIR = usdm ? 'tNIGHT/USDM' : 'tNIGHT/TESTUSD';
const stateFile = path.join(walletStateDir(), `rfq2-${chain.network}.json`);

const takerSeed = process.env.MN_TAKER_WALLET_SEED;
if (!takerSeed) throw new Error('MN_TAKER_WALLET_SEED is not set');

async function chainLedger() {
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await queryLatestContractState(chain.indexerHttp, contractAddress);
      if (!raw) throw new Error('contract not found');
      return otcLedger(raw.data);
    } catch (err) {
      if (attempt >= 10) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ── Release phase (resumable) ────────────────────────────────────────────────────────────────────
if (process.env.RFQ2_PHASE === 'release') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as { loserQuoteId: string; loserValidUntil: number; released?: boolean };
  const due = st.loserValidUntil + PROOF_GRACE_PERIOD + EDGE_MARGIN_SECS;
  if (nowSecs() < due) {
    console.log(`release not due until ${new Date(due * 1000).toISOString()} (${due - nowSecs()} s)`);
    process.exit(75);
  }
  const taker = await createHeadlessWallet(takerSeed, chain);
  await taker.waitForSync();
  const providers = buildOTCProviders(chain, taker);
  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiledOTCContract,
    privateStateId: OTC_PRIVATE_STATE_ID,
    initialPrivateState: { dealerSecretKey: null, takerAddress: unhex(taker.unshieldedAddressHex) },
  });
  const qid = unhex(st.loserQuoteId);
  const before = await chainLedger();
  const dealerCmt = before.quotes.lookup(qid).dealerCmt;
  const liveBefore = before.bonds.lookup(dealerCmt).liveQuotes;
  console.log(`releasing losing quote ${st.loserQuoteId} FROM THE TAKER'S WALLET (permissionless); liveQuotes ${liveBefore}`);
  if (!before.quotes.lookup(qid).resolved) await releaseExpiredQuote(contract, qid);
  const after = await chainLedger();
  const ok = after.quotes.lookup(qid).resolved && after.bonds.lookup(dealerCmt).liveQuotes === liveBefore - 1n;
  console.log(`  quote.resolved ${after.quotes.lookup(qid).resolved}; dealer liveQuotes ${liveBefore} -> ${after.bonds.lookup(dealerCmt).liveQuotes}`);
  if (!ok) throw new Error('release did not land as expected');
  fs.writeFileSync(stateFile, JSON.stringify({ ...st, released: true }, null, 2), { mode: 0o600 });
  console.log('✅ losing quote released by a third party');
  process.exit(0);
}

// ── Relays ───────────────────────────────────────────────────────────────────────────────────────
const relayProcs: ChildProcess[] = [];
const logDir = process.env.RFQ2_LOG_DIR ?? path.resolve(process.cwd(), '.wallet-state');
function startRelay(port: number, peers: string[]): ChildProcess {
  const out = fs.openSync(path.join(logDir, `relay-${port}.log`), 'w');
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', path.resolve(import.meta.dirname, '../packages/relay-node/src/bin.ts')],
    {
      env: { ...process.env, RELAY_PORT: String(port), RELAY_PEERS: peers.join(','), RELAY_ENABLE_MAILBOX: 'true', RELAY_PAIRS: PAIR },
      stdio: ['ignore', out, out],
    },
  );
  relayProcs.push(proc);
  return proc;
}
function shutdown(code: number): never {
  for (const p of relayProcs) p.kill('SIGTERM');
  process.exit(code);
}
process.on('uncaughtException', (err) => {
  console.error(err);
  shutdown(1);
});

const gossipUrl = (port: number) => `ws://127.0.0.1:${port}/gossip`;
const httpUrl = (port: number) => `http://127.0.0.1:${port}`;
startRelay(RELAY_PORTS[0], []);
startRelay(RELAY_PORTS[1], [gossipUrl(RELAY_PORTS[0])]);
async function waitHealthy(port: number, wantPeers: number) {
  for (let i = 0; i < 60; i++) {
    try {
      const h = (await (await fetch(`${httpUrl(port)}/health`)).json()) as { peers: number };
      if (h.peers >= wantPeers) return h;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`relay :${port} not healthy`);
}
await Promise.all([waitHealthy(RELAY_PORTS[0], 1), waitHealthy(RELAY_PORTS[1], 1)]);
console.log(`${t()} relays up and peered: ${RELAY_PORTS.map(gossipUrl).join(', ')}`);

// ── Wallets ──────────────────────────────────────────────────────────────────────────────────────
const [dealerWallet, takerWallet] = await Promise.all([
  createHeadlessWallet(requireWalletSeed(), chain),
  createHeadlessWallet(takerSeed, chain),
]);
await Promise.all([dealerWallet.waitForSync(), takerWallet.waitForSync()]);
console.log(`${t()} wallets synced`);

async function unshieldedState(w: HeadlessWallet) {
  return Rx.firstValueFrom(w.facade.state().pipe(Rx.filter((x) => x.isSynced)));
}

const wantUnits = (price: string) => (SIZE_UNITS * encodeTerms({ pair: PAIR, side: 'buy', price, size: '0' })[2]) / 1_000_000n;
const maxWant = [DEALER_PRICES.A, DEALER_PRICES.B].map(wantUnits).reduce((a, b) => (a > b ? a : b));

// Two dealers quoting from one wallet need two counter-asset coins: initSwap BOOKS the coin each
// offer selects, so the second offer would otherwise find nothing to spend. Split first.
{
  const s = await unshieldedState(dealerWallet);
  const coins = s.unshielded.availableCoins.filter((c) => c.utxo.type === COUNTER && c.utxo.value >= maxWant);
  console.log(`${t()} dealer wallet: ${coins.length} counter coins >= ${maxWant}`);
  if (coins.length < 2) {
    const self = new UnshieldedAddress(Buffer.from(dealerWallet.unshieldedAddressHex, 'hex'));
    const recipe = await dealerWallet.facade.transferTransaction(
      [{ type: 'unshielded', outputs: [{ type: COUNTER, receiverAddress: self, amount: maxWant * 3n }] }] as never,
      dealerWallet.secretKeys,
      { ttl: new Date(Date.now() + 30 * 60_000), payFees: true },
    );
    const txId = await dealerWallet.facade.submitTransaction(
      await dealerWallet.facade.finalizeRecipe(await dealerWallet.facade.signRecipe(recipe, dealerWallet.signFn)),
    );
    const tx = await waitForTransaction(chain.indexerHttp, { identifier: txId });
    console.log(`${t()} split tx ${tx.hash} status ${tx.status}`);
    const start = Date.now();
    for (;;) {
      await dealerWallet.waitForSync();
      const n = (await unshieldedState(dealerWallet)).unshielded.availableCoins.filter((c) => c.utxo.type === COUNTER && c.utxo.value >= maxWant).length;
      if (n >= 2) break;
      if (Date.now() - start > 10 * 60_000) throw new Error('split coins never appeared');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ── Dealers ──────────────────────────────────────────────────────────────────────────────────────
const providers = buildOTCProviders(chain, dealerWallet);
interface Dealer {
  name: 'A' | 'B';
  sk: Uint8Array;
  cmt: Uint8Array;
  quoteSk: bigint;
  enc: ReturnType<typeof generateEncKeypair>;
  relayPort: number;
  price: string;
  contract: import('../packages/sdk/src/types.js').DeployedOTCContract;
}
function newDealerKeys(name: 'A' | 'B', relayPort: number) {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  return {
    name,
    sk,
    cmt: dealerCommitment(sk),
    quoteSk: BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(32)))) % JUBJUB_ORDER,
    enc: generateEncKeypair(),
    relayPort,
    price: DEALER_PRICES[name],
  };
}
const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: null, takerAddress: null },
});
const dealers: Dealer[] = [newDealerKeys('A', RELAY_PORTS[0]), newDealerKeys('B', RELAY_PORTS[1])].map((k) => ({ ...k, contract }));

/** Both dealers share one private-state store and ONE privateStateId, so the witness reads whichever
 *  dealer key was written last. Every dealer call therefore sets its own key first, and calls are
 *  serialised — interleaving would sign dealer A's commit with dealer B's identity. */
let dealerLock: Promise<unknown> = Promise.resolve();
function asDealer<R>(d: Dealer, fn: () => Promise<R>): Promise<R> {
  const run = dealerLock.then(async () => {
    await providers.privateStateProvider.set(OTC_PRIVATE_STATE_ID, { dealerSecretKey: d.sk, takerAddress: null });
    return fn();
  });
  dealerLock = run.catch(() => undefined);
  return run;
}

const bondAmount = minBondForNotional(SIZE_UNITS);
for (const d of dealers) {
  await asDealer(d, () => postBond(d.contract, bondAmount, schnorrPublicKey(d.quoteSk)));
  console.log(`${t()} dealer ${d.name} bonded ${bondAmount}: ${hex(d.cmt)}`);
}

const { params: ledgerParameters } = await queryLedgerParameters(chain.indexerHttp);
const offers = new Map<string, ProvedOffer>();

function listenForRfqs(d: Dealer, onRfq: (rfq: RfqBody) => void): WebSocket {
  const ws = new WebSocket(gossipUrl(d.relayPort));
  const seen = new Set<string>();
  ws.on('message', (data) => {
    const env = JSON.parse(data.toString()) as Envelope;
    if (env.type !== 'rfq') return;
    const body = env.body as RfqBody;
    if (seen.has(body.rfqId) || body.pair !== PAIR) return;
    seen.add(body.rfqId);
    onRfq(body);
  });
  return ws;
}

async function answer(d: Dealer, ws: WebSocket, rfq: RfqBody): Promise<void> {
  console.log(`${t()} dealer ${d.name} received RFQ ${rfq.rfqId.slice(0, 12)}… via relay :${d.relayPort}`);
  const terms = { pair: PAIR, side: 'buy' as const, price: d.price, size: rfq.size };
  await asDealer(d, async () => {
    const offer = await buildAndProveOffer({
      wallet: dealerWallet,
      give: { kind: 'unshielded', token: COUNTER, amount: wantUnits(d.price) },
      want: { kind: 'unshielded', token: NIGHT, amount: SIZE_UNITS },
      validitySecs: VALIDITY_SECS,
      ledgerParameters,
    });
    const sealed = sealQuote(terms, unhex(rfq.rfqId), BigInt(nowSecs() + VALIDITY_SECS));
    const quoteId = deriveQuoteId(d.cmt, sealed.rfqId, sealed.commitment);
    offers.set(hex(quoteId), offer);
    const c0 = Date.now();
    const res = await commitQuote(d.contract, sealed);
    console.log(`${t()} dealer ${d.name} commit confirmed in ${Date.now() - c0} ms (quote ${hex(quoteId).slice(0, 12)}…)`);

    // Gossip only once the INDEXER shows the commitment: takers verify against the indexer, and a
    // reference they cannot yet find is indistinguishable from a lie.
    const i0 = Date.now();
    while (!(await chainLedger()).quotes.member(quoteId)) await new Promise((r) => setTimeout(r, 2000));
    console.log(`${t()} dealer ${d.name} commitment visible on indexer after ${Date.now() - i0} ms`);

    const body: QuoteRefBody = {
      rfqId: rfq.rfqId,
      dealerCmt: hex(d.cmt),
      quoteId: hex(quoteId),
      validUntil: Number(sealed.validUntil),
      txHash: res.public.txHash,
      revealVia: 'mailbox',
      dealerEndpoint: httpUrl(d.relayPort),
      dealerEncPk: hex(d.enc.pk),
    };
    const env: Envelope<QuoteRefBody> = {
      v: WIRE_VERSION, type: 'quote_ref', id: computeId(body), ts: nowSecs(), ttl: 8, body,
      sig: encodeSignature(signBody(body, d.quoteSk, freshNonce())),
    };
    ws.send(JSON.stringify(env));

    const reveal = encryptReveal(quoteId, buildReveal(sealed, d.quoteSk, offer.offerFileBase64, offer.expiresAt), d.enc.sk, unhex(rfq.takerEncPk));
    const post = await fetch(`${httpUrl(d.relayPort)}/mailbox/${rfq.takerEncPk}`, { method: 'POST', body: JSON.stringify(reveal) });
    if (post.status !== 202) throw new Error(`mailbox refused reveal: ${post.status} ${await post.text()}`);
    console.log(`${t()} dealer ${d.name} gossiped quote_ref and mailboxed its encrypted reveal`);
  });
}

const dealerDone: Promise<void>[] = [];
const sockets = dealers.map((d) => {
  const ws = listenForRfqs(d, (rfq) => dealerDone.push(answer(d, ws, rfq)));
  return ws;
});
await Promise.all(sockets.map((ws) => new Promise((r) => ws.once('open', r))));

// ── Taker ────────────────────────────────────────────────────────────────────────────────────────
const aggregator = new RelayAggregator({
  relays: RELAY_PORTS.map(gossipUrl),
  chain: indexerChainReader(chain.indexerHttp, contractAddress),
});
const status = await aggregator.connect();
console.log(`${t()} taker connected to ${aggregator.connectedCount}/${status.length} relays`);
const takerEnc = generateEncKeypair();
const rfq: RfqBody = {
  rfqId: hex(crypto.getRandomValues(new Uint8Array(32))),
  pair: PAIR,
  side: 'sell',
  size: TERMS_SIZE,
  expiry: nowSecs() + 900,
  takerEncPk: hex(takerEnc.pk),
  replyTo: RELAY_PORTS.map(gossipUrl),
};
aggregator.publishRfq(rfq);
console.log(`${t()} taker published RFQ ${rfq.rfqId.slice(0, 12)}… to both relays`);

let agg = await aggregator.collect(rfq);
const collectStart = Date.now();
while (agg.verified.length < 2) {
  if (Date.now() - collectStart > 15 * 60_000) throw new Error(`only ${agg.verified.length} verified quotes after 15 min`);
  await new Promise((r) => setTimeout(r, 5000));
  agg = await aggregator.collect(rfq);
}
await Promise.all(dealerDone);
agg = await aggregator.collect(rfq);
console.log(`${t()} taker aggregated ${agg.verified.length} verified quotes, ${agg.rejected.length} rejected`);
for (const q of agg.verified) {
  console.log(`  quote ${q.quoteId.slice(0, 12)}… dealer ${q.dealerCmt.slice(0, 12)}… bond ${q.bondAmount} notional ${q.notional} settled ${q.settled} slashed ${q.slashed} via [${q.relays.join(', ')}]`);
}
for (const r of agg.rejected) console.log(`  REJECTED ${r.quoteId.slice(0, 12)}…: ${r.reason}`);

// Pull and verify each reveal, then compare prices — in this client, never on-chain.
const chainReader = indexerChainReader(chain.indexerHttp, contractAddress, 0);
const candidates: Array<{ quoteId: string; price: bigint; offerFile: string; expiresAt: number; dealerCmt: string }> = [];
const mailboxes = new Map<string, RevealMessage[]>();
for (const q of agg.verified) {
  if (!mailboxes.has(q.dealerEndpoint)) {
    mailboxes.set(q.dealerEndpoint, (await (await fetch(`${q.dealerEndpoint}/mailbox/${rfq.takerEncPk}`)).json()) as RevealMessage[]);
  }
  const msg = mailboxes.get(q.dealerEndpoint)!.find((m) => m.quoteId === q.quoteId);
  if (!msg) throw new Error(`no reveal for ${q.quoteId} at ${q.dealerEndpoint}`);
  const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEnc.sk, unhex(q.dealerEncPk));
  const cq = (await chainReader.quote(unhex(q.quoteId)))!;
  const cd = await chainReader.dealer(cq.dealerCmt);
  const revealTerms = plaintextToTerms(plaintext);
  const encodedTerms = encodeTerms(revealTerms);
  const check = verifyReveal(
    { terms: revealTerms, encodedTerms, nonce: unhex(plaintext.nonce), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt },
    cq.commitment,
    cd.bond!.quotePk,
    cq.notional,
  );
  if (!check.valid) throw new Error(`reveal for ${q.quoteId} failed verification: ${check.reason}`);
  candidates.push({ quoteId: q.quoteId, price: encodedTerms[2], offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt, dealerCmt: q.dealerCmt });
  console.log(`  reveal ${q.quoteId.slice(0, 12)}… verified against chain: price ${revealTerms.price}`);
}
candidates.sort((a, b) => (b.price > a.price ? 1 : b.price < a.price ? -1 : 0));
const [best, loser] = candidates;
console.log(`${t()} taker chose ${best.quoteId.slice(0, 12)}… (price ${best.price}) over ${loser.quoteId.slice(0, 12)}… (price ${loser.price})`);

const takerBefore = await unshieldedState(takerWallet);
const s0 = Date.now();
const settlement = await settleFromOffer({ wallet: takerWallet, offerFileBase64: best.offerFile, expiresAt: best.expiresAt, ledgerParameters });
const indexed = await waitForTransaction(chain.indexerHttp, { identifier: settlement.txId });
console.log(`${t()} settlement ${indexed.hash} status ${indexed.status} (submit+index ${Date.now() - s0} ms)`);
if (indexed.status !== 'SUCCESS') throw new Error('settlement failed');

const winner = dealers.find((d) => hex(d.cmt) === best.dealerCmt)!;
const loserDealer = dealers.find((d) => hex(d.cmt) === loser.dealerCmt)!;
await asDealer(winner, () => recordSettlement(winner.contract, unhex(best.quoteId), unhex(dealerWallet.unshieldedAddressHex)));
console.log(`${t()} dealer ${winner.name} recorded settlement`);

// The losing offer will never be used; release its coin booking in the dealer wallet.
await offers.get(loser.quoteId)?.release();

const loserValidUntil = Number((await chainReader.quote(unhex(loser.quoteId)))!.validUntil);
fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
fs.writeFileSync(stateFile, JSON.stringify({ loserQuoteId: loser.quoteId, loserValidUntil, winnerQuoteId: best.quoteId }, null, 2), { mode: 0o600 });

// ── Verify ───────────────────────────────────────────────────────────────────────────────────────
const l = await chainLedger();
const expectReceive = wantUnits(winner.price);
let takerAfter = await unshieldedState(takerWallet);
for (let i = 0; i < 60 && ((takerAfter.unshielded.balances[COUNTER] ?? 0n) as bigint) - ((takerBefore.unshielded.balances[COUNTER] ?? 0n) as bigint) !== expectReceive; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  await takerWallet.waitForSync();
  takerAfter = await unshieldedState(takerWallet);
}
const checks: Array<[string, boolean]> = [
  ['better price won (B at 41.52)', winner.name === 'B'],
  ['winner settled counter 1', l.settled.lookup(winner.cmt).read() === 1n],
  ['winner quote resolved', l.quotes.lookup(unhex(best.quoteId)).resolved],
  ['winner liveQuotes 0', l.bonds.lookup(winner.cmt).liveQuotes === 0n],
  ['loser quote still live on-chain', !l.quotes.lookup(unhex(loser.quoteId)).resolved],
  ['loser liveQuotes 1 (until release)', l.bonds.lookup(loserDealer.cmt).liveQuotes === 1n],
  ['both bonds untouched', l.bonds.lookup(winner.cmt).amount === bondAmount && l.bonds.lookup(loserDealer.cmt).amount === bondAmount],
  [
    `taker received exactly ${expectReceive} counter`,
    ((takerAfter.unshielded.balances[COUNTER] ?? 0n) as bigint) - ((takerBefore.unshielded.balances[COUNTER] ?? 0n) as bigint) === expectReceive,
  ],
  [
    `taker paid exactly ${SIZE_UNITS} tNIGHT`,
    ((takerBefore.unshielded.balances[NIGHT] ?? 0n) as bigint) - ((takerAfter.unshielded.balances[NIGHT] ?? 0n) as bigint) === SIZE_UNITS,
  ],
  ['every verified quote arrived via both relays (gossip crossed)', agg.verified.every((q) => q.relays.length === 2)],
];
let ok = true;
for (const [label, pass] of checks) {
  ok &&= pass;
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label}`);
}
const due = loserValidUntil + PROOF_GRACE_PERIOD + EDGE_MARGIN_SECS;
console.log(`\nloser release due after ${new Date(due * 1000).toISOString()}: RFQ2_PHASE=release pnpm run e2e-rfq-2dealers`);
await aggregator.close();
for (const ws of sockets) ws.terminate();
if (!ok) {
  console.log('A3 FAILED');
  shutdown(1);
}
console.log('✅ TWO COMPETING DEALERS -> 2 RELAYS -> LIVE-INDEXER VERIFICATION -> BETTER QUOTE SETTLED');
shutdown(0);
