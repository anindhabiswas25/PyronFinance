// The web client driven end to end on Preprod through its real pages, with a test wallet injected into
// the browser (inject.ts) and served from Node by the project's headless wallets (wallet-bridge.ts).
//
// Phases (E2E_PHASES, comma-separated; default all, in this order):
//   circuit  /dev/circuits: the taker wallet releases an expired quote (browser contract call)
//   trade    /trade: two relays + a Dealer Node (main wallet); the taker wallet requests, compares, settles
//   note     receipt: attach a disclosure note; /verify: the recipient opens it
//   fraud    main wallet (Node) bonds a throwaway dealer and commits, signs a mismatched price;
//            /verify: the taker wallet checks it and submits the fraud proof
//   desk     /desk: the taker wallet becomes a dealer (key, backup, bond), quotes an RFQ the main wallet
//            publishes from Node; the main wallet verifies the reveal and settles; the desk records it
//
// Run from the repo root with Preprod endpoints taking precedence over .env:
//   env $(grep -v '^#' .env.preprod | grep = | xargs) pnpm exec tsx --env-file=.env scripts/browser-e2e/run.ts
// Needs: the client dev server on E2E_BASE_URL (default http://127.0.0.1:5175), a proof server on
// MN_PROOF_SERVER, MN_WALLET_SEED (main, also the Dealer Node's) and MN_TAKER_WALLET_SEED. REFUSES MAINNET.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { x25519 } from '@noble/curves/ed25519';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig } from '../../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet, type HeadlessWallet } from '../../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../../packages/sdk/src/contract.js';
import { schnorrPublicKey, encodeSchnorrSignature } from '../../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../../packages/sdk/src/domain.js';
import { postBond, minBondForNotional } from '../../packages/sdk/src/bonding.js';
import { sealQuote, commitQuote, buildReveal, verifyReveal } from '../../packages/sdk/src/quotes.js';
import { encodeTerms, counterAmountFor } from '../../packages/sdk/src/terms.js';
import { generateEncKeypair, decryptReveal, plaintextToTerms, type RevealMessage } from '../../packages/sdk/src/reveal-channel.js';
import { offerMatchesTerms, settleFromOffer } from '../../packages/sdk/src/offers.js';
import { queryLatestContractState, queryLedgerParameters } from '../../packages/sdk/src/indexer.js';
import { RelayAggregator, indexerChainReader } from '../../packages/sdk/src/relay-client.js';
import { nodeSocketFactory } from '../../packages/sdk/src/relay-client-node.js';
import { startRelayServer, type RelayServer } from '../../packages/relay-node/src/server.js';
import type { RfqBody } from '../../packages/relay-node/src/schema.js';
import { ledger as otcLedger } from '../../contracts/managed/otc-protocol/contract/index.js';
import { createWalletBridge } from './wallet-bridge.js';
import { injectScript, TEST_WALLET_NAME } from './inject.js';

const chain = loadChainConfig();
if (chain.network !== 'preprod') throw new Error(`browser-e2e runs on preprod only (MN_NETWORK is ${chain.network}); prefix the command with .env.preprod`);
initNetworkId(chain.network);

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5175';
const PHASES = (process.env.E2E_PHASES ?? 'circuit,trade,note,fraud,desk').split(',').map((s) => s.trim());
const RELAYS = ['ws://127.0.0.1:18787/gossip', 'ws://127.0.0.1:18788/gossip'];
const HEADLESS = process.env.E2E_HEADED !== '1';
const PAIR = 'tNIGHT/TESTUSD';
const { address: CONTRACT } = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/preprod.json'), 'utf-8'));
const OUT = path.join(ROOT, '.wallet-state', `browser-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(OUT, { recursive: true });

const T0 = Date.now();
const logFile = fs.openSync(path.join(OUT, 'run.log'), 'a');
function log(m: string) {
  const line = `${new Date().toISOString()} +${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`;
  console.log(line);
  fs.writeSync(logFile, line + '\n');
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const nowSecs = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN = 60_000;

const results: Array<{ phase: string; ok: boolean; ms: number; detail: string }> = [];

async function chainLedger() {
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await queryLatestContractState(chain.indexerHttp, CONTRACT);
      if (!raw) throw new Error('contract not found');
      return otcLedger(raw.data);
    } catch (err) {
      if (attempt >= 10) throw err;
      await sleep(5000);
    }
  }
}

async function until<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, everyMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs / 1000} s: ${what}`);
    await sleep(everyMs);
  }
}

// ── Infrastructure ──────────────────────────────────────────────────────────────────────────────
async function preflight() {
  const res = await fetch(BASE).catch(() => undefined);
  if (!res?.ok) throw new Error(`the client dev server is not answering at ${BASE}`);
  const proof = await fetch(`${chain.proofServer}/health`).catch(() => undefined);
  if (!proof?.ok) throw new Error(`the proof server is not answering at ${chain.proofServer}`);
}

async function syncedWallet(label: string, seed: string | undefined): Promise<HeadlessWallet> {
  if (!seed) throw new Error(`${label} seed is not set`);
  const started = Date.now();
  log(`[${label}] starting wallet and syncing (a snapshot restores in seconds; a reset sub-wallet replays from genesis)`);
  const w = await createHeadlessWallet(seed, chain);
  await w.waitForSync();
  log(`[${label}] synced in ${((Date.now() - started) / 1000).toFixed(0)} s: ${w.unshieldedAddress}`);
  return w;
}

let relayServers: RelayServer[] = [];
async function startRelays() {
  if (relayServers.length) return;
  const a = startRelayServer({ port: 18787, enableMailbox: true, reconnectDelayMs: 500 });
  const b = startRelayServer({ port: 18788, peers: [RELAYS[0]], enableMailbox: true, reconnectDelayMs: 500 });
  relayServers = [a, b];
  await until('relays peered', async () => ((await (await fetch('http://127.0.0.1:18787/health')).json()) as { peers: number }).peers > 0, 30_000, 500);
  log('[relays] :18787 and :18788 up and peered, mailboxes on');
}

let dealerNode: ChildProcess | undefined;
async function startDealerNode(): Promise<void> {
  const out = fs.openSync(path.join(OUT, 'dealer-node.log'), 'a');
  dealerNode = spawn('pnpm', ['start', '--config', 'dealer.toml'], { cwd: path.join(ROOT, 'packages/dealer-node'), env: process.env, stdio: ['ignore', out, out], detached: true });
  log(`[dealer-node] started (pid ${dealerNode.pid}); waiting for a warm offer`);
  await until(
    'the Dealer Node to warm an offer',
    async () => {
      if (dealerNode?.exitCode !== null) throw new Error(`dealer node exited with ${dealerNode?.exitCode}`);
      const text = fs.readFileSync(path.join(OUT, 'dealer-node.log'), 'utf-8');
      const m = [...text.matchAll(/\[tick\] pool (\d+) warm/g)].pop();
      return m && Number(m[1]) > 0;
    },
    45 * MIN,
    5000,
  );
  log('[dealer-node] at least one offer warm');
}

async function stopDealerNode() {
  if (!dealerNode || dealerNode.exitCode !== null) return;
  process.kill(-dealerNode.pid!, 'SIGTERM');
  await until('the Dealer Node to stop', async () => dealerNode!.exitCode !== null || dealerNode!.signalCode !== null, 2 * MIN, 1000).catch(() => process.kill(-dealerNode!.pid!, 'SIGKILL'));
  log('[dealer-node] stopped');
}

async function openBrowser(wallet: HeadlessWallet): Promise<{ context: BrowserContext; page: Page; close(): Promise<void> }> {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 } });
  const bridge = createWalletBridge(wallet, chain, log);
  await context.exposeFunction('__pyronWallet', (method: string, args: string) => bridge.call(method, args));
  await context.addInitScript({ content: injectScript(chain.network) });
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`[page error] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log(`[console] ${msg.text().slice(0, 300)}`);
  });
  return { context, page, close: () => browser.close() };
}

async function connectWallet(page: Page) {
  if (await page.getByRole('button', { name: /^Wallet mn_addr/ }).isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Connect wallet/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect a wallet' });
  await dialog.getByRole('button', { name: new RegExp(TEST_WALLET_NAME) }).click();
  await page.getByRole('button', { name: /^Wallet mn_addr/ }).waitFor({ timeout: 2 * MIN });
  log('[browser] test wallet connected');
}

async function phase(name: string, fn: () => Promise<string>, pages: () => Page[]) {
  if (!PHASES.includes(name)) return;
  const started = Date.now();
  log(`\n===== phase ${name} =====`);
  try {
    const detail = await fn();
    results.push({ phase: name, ok: true, ms: Date.now() - started, detail });
    log(`✅ ${name}: ${detail}`);
  } catch (err) {
    const detail = (err as Error).message.split('\n').slice(0, 4).join(' | ');
    results.push({ phase: name, ok: false, ms: Date.now() - started, detail });
    log(`❌ ${name}: ${detail}`);
    for (const [i, p] of pages().entries()) await p.screenshot({ path: path.join(OUT, `${name}-fail-${i}.png`), fullPage: true }).catch(() => undefined);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────────
await preflight();
const taker = await syncedWallet('taker', process.env.MN_TAKER_WALLET_SEED);
const ui = await openBrowser(taker);
const page = ui.page;
let main: HeadlessWallet | undefined;
let settledQuoteId: string | undefined;

try {
  await phase(
    'circuit',
    async () => {
      const before = await chainLedger();
      await page.goto(`${BASE}/dev/circuits`);
      await connectWallet(page);
      const release = page.getByRole('button', { name: 'Release', exact: true }).first();
      await release.waitFor({ timeout: 2 * MIN });
      const row = release.locator('xpath=ancestor::li[1]');
      const quoteId = (await row.getByRole('button', { name: /quote/i }).first().getAttribute('title').catch(() => null)) ?? '';
      await release.click();
      log('[circuit] Release clicked; waiting for prepare → prove → balance → submit → confirm');
      const outcome = row.getByText(/^Released · block|Landed on-chain|^Failed at/);
      await outcome.waitFor({ timeout: 15 * MIN });
      const text = (await outcome.textContent()) ?? '';
      if (text.startsWith('Failed')) throw new Error(`release failed in the browser: ${text}`);
      const after = await chainLedger();
      const resolvedNow = [...after.quotes].filter(([id, q]) => q.resolved && before.quotes.member(id) && !before.quotes.lookup(id).resolved).map(([id]) => hex(id));
      if (resolvedNow.length === 0) throw new Error(`the page reported "${text}" but no quote resolved on-chain`);
      return `${text}; resolved on-chain: ${resolvedNow.map((q) => q.slice(0, 12)).join(', ')}${quoteId ? ` (${quoteId})` : ''}`;
    },
    () => [page],
  );

  await phase(
    'trade',
    async () => {
      await startRelays();
      await startDealerNode();
      await page.goto(`${BASE}/trade`);
      await connectWallet(page);
      await page.getByLabel('You sell').fill('0.001');
      await page.getByRole('button', { name: /^Request quotes/ }).click();
      log('[trade] RFQ published; waiting for a verified, revealed quote');
      const compare = page.getByRole('button', { name: /^Compare [1-9]\d* now/ });
      await until('a revealed quote', async () => (await compare.isEnabled().catch(() => false)) || (await page.getByRole('heading', { name: 'Compare quotes' }).isVisible()), 5 * MIN, 2000);
      if (await compare.isVisible()) await compare.click();
      await page.getByRole('heading', { name: 'Compare quotes' }).waitFor();
      const select = page.getByRole('button', { name: 'Select', exact: true }).first();
      if (await select.isVisible().catch(() => false)) await select.click();
      await page.getByRole('button', { name: /^Settle · about 20 s/ }).click();
      log('[trade] Settle clicked');
      const done = page.getByRole('link', { name: 'Open receipt' }).or(page.getByText(/^Couldn’t settle with/));
      await done.first().waitFor({ timeout: 15 * MIN });
      if (!(await page.getByRole('link', { name: 'Open receipt' }).isVisible())) {
        const stages = await page.getByRole('list', { name: 'Settlement stages' }).textContent();
        throw new Error(`settlement failed: ${stages}`);
      }
      await page.getByRole('link', { name: 'Open receipt' }).click();
      settledQuoteId = page.url().split('/trade/')[1];
      log(`[trade] settled; receipt for ${settledQuoteId}; waiting for the dealer to record it`);
      await until('the dealer node to record the trade', async () => (await chainLedger()).quotes.lookup(unhex(settledQuoteId!)).resolved, 20 * MIN, 10_000);
      return `settled quote ${settledQuoteId}; recorded by the dealer on-chain`;
    },
    () => [page],
  );

  await phase(
    'note',
    async () => {
      if (!settledQuoteId) throw new Error('needs a settled trade from the trade phase');
      await page.goto(`${BASE}/trade/${settledQuoteId}`);
      await connectWallet(page);
      const attach = page.getByRole('button', { name: 'Attach disclosure note' });
      await until('the receipt to offer a note', () => attach.isVisible(), 3 * MIN, 5000);
      await attach.click();
      const recipientSk = x25519.utils.randomSecretKey();
      await page.getByLabel('Recipient’s public key').fill(hex(x25519.getPublicKey(recipientSk)));
      const download = page.waitForEvent('download', { timeout: 2 * MIN });
      await page.getByRole('button', { name: 'Save note and attach' }).click();
      const file = path.join(OUT, 'note.json');
      await (await download).saveAs(file);
      log('[note] sealed note downloaded; waiting for attachDisclosureNote');
      const verdict = page.getByText('Note attached on-chain').or(page.getByText('The note wasn’t attached'));
      await verdict.first().waitFor({ timeout: 15 * MIN });
      if (await page.getByText('The note wasn’t attached').isVisible()) throw new Error(`attach failed: ${await page.getByRole('dialog').textContent()}`);
      await page.keyboard.press('Escape');

      await page.goto(`${BASE}/verify?tab=note`);
      await page.getByLabel('Disclosure note').fill(fs.readFileSync(file, 'utf-8'));
      await page.getByLabel('Your secret key').fill(hex(recipientSk));
      await page.getByRole('button', { name: 'Open and verify' }).click();
      await page.getByText('Verified: this note is attached to this trade and addressed to you').waitFor({ timeout: 3 * MIN });
      // And a stranger is refused.
      await page.getByLabel('Your secret key').fill(hex(x25519.utils.randomSecretKey()));
      await page.getByRole('button', { name: 'Open and verify' }).click();
      await page.getByText('This note isn’t addressed to this key.').first().waitFor({ timeout: 3 * MIN });
      return `note attached on-chain for ${settledQuoteId.slice(0, 12)}…; opened by the recipient; refused for another key`;
    },
    () => [page],
  );

  await stopDealerNode();

  await phase(
    'fraud',
    async () => {
      main ??= await syncedWallet('main', process.env.MN_WALLET_SEED);
      const dealerSk = crypto.getRandomValues(new Uint8Array(32));
      const quoteSk = BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(32)))) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
      const contract = await findDeployedContract(buildOTCProviders(chain, main), {
        contractAddress: CONTRACT,
        compiledContract: compiledOTCContract,
        privateStateId: OTC_PRIVATE_STATE_ID,
        initialPrivateState: { dealerSecretKey: dealerSk, takerAddress: dealerSk },
      });
      const terms = { pair: PAIR, side: 'buy' as const, price: '41.3', size: '0.001' };
      const sealed = sealQuote(terms, crypto.getRandomValues(new Uint8Array(32)), BigInt(nowSecs() + 600));
      log('[fraud] main wallet posts a throwaway bond and commits a quote');
      await postBond(contract, minBondForNotional(sealed.notional), schnorrPublicKey(quoteSk));
      await commitQuote(contract, sealed);
      const dealerCmt = dealerCommitment(dealerSk);
      const quoteId = hex(deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment));
      const lied = { ...terms, price: '99.9' };
      const reveal = buildReveal({ ...sealed, terms: lied, encodedTerms: encodeTerms(lied) }, quoteSk, '', nowSecs() + 600);
      const evidence = { quoteId, dealerCmt: hex(dealerCmt), terms: lied, nonce: hex(sealed.nonce), signature: encodeSchnorrSignature(reveal.signature) };
      fs.writeFileSync(path.join(OUT, 'mismatched-reveal.json'), JSON.stringify(evidence, null, 2));
      await until('the quote on the indexer', async () => (await chainLedger()).quotes.member(unhex(quoteId)), 3 * MIN);

      await page.goto(`${BASE}/verify`);
      await connectWallet(page);
      await page.getByLabel('Signed reveal or saved evidence').fill(JSON.stringify(evidence));
      await page.getByRole('button', { name: 'Check', exact: true }).click();
      await page.getByText('Provable fraud: the dealer signed a price that doesn’t open their seal.').waitFor({ timeout: 3 * MIN });
      await page.getByRole('button', { name: /^Submit proof/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Submit fraud proof' });
      await dialog.getByText('✓ Does not open the on-chain seal').waitFor({ timeout: 3 * MIN });
      await dialog.getByRole('button', { name: /^Slash bond · receive/ }).click();
      log('[fraud] proof submitted from the browser; waiting for the slash');
      const verdict = dialog.getByText('Bond slashed').or(dialog.getByText('The proof wasn’t accepted'));
      await verdict.first().waitFor({ timeout: 20 * MIN });
      if (await dialog.getByText('The proof wasn’t accepted').isVisible()) throw new Error(`fraud proof failed: ${await dialog.textContent()}`);
      const after = await chainLedger();
      const slashed = after.slashed.lookup(dealerCmt).read();
      if (slashed !== 1n || after.bonds.lookup(dealerCmt).amount !== 0n) throw new Error(`the page said "Bond slashed" but the chain shows slashed ${slashed}`);
      return `dealer ${hex(dealerCmt).slice(0, 12)}… slashed on-chain (bond 0, slashed 1) by a proof submitted from the browser`;
    },
    () => [page],
  );

  await phase(
    'desk',
    async () => {
      main ??= await syncedWallet('main', process.env.MN_WALLET_SEED);
      await startRelays();
      await page.goto(`${BASE}/desk?tab=keys`);
      await connectWallet(page);
      const passphrase = 'correct horse battery staple 9!';
      await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
      await page.getByLabel('Passphrase again').fill(passphrase);
      await page.getByRole('button', { name: 'Generate key' }).click();
      const backup = page.waitForEvent('download', { timeout: MIN });
      await page.getByRole('button', { name: 'Download backup' }).click({ timeout: 2 * MIN });
      await (await backup).saveAs(path.join(OUT, 'dealer-key-backup.json'));
      await page.getByLabel('I stored the backup somewhere safe').check();
      await page.getByRole('button', { name: 'Confirm backup' }).click();
      const dealerCmt = JSON.parse(fs.readFileSync(path.join(OUT, 'dealer-key-backup.json'), 'utf-8')).dealerCmt as string;
      log(`[desk] dealer key ${dealerCmt}`);

      await page.getByRole('tab', { name: 'Bond' }).click();
      await page.getByLabel('Bond amount').fill('0.0001');
      await page.getByRole('button', { name: 'Post bond' }).click();
      await page.getByText(/^Post bond: done|^Post bond failed/).first().waitFor({ timeout: 20 * MIN });
      if (await page.getByText('Post bond failed').isVisible()) throw new Error(`postBond failed: ${await page.getByRole('list', { name: 'Bond lifecycle' }).textContent()}`);
      await until('the bond on the indexer', async () => (await chainLedger()).bonds.member(unhex(dealerCmt)), 3 * MIN);
      log('[desk] bond posted from the browser');

      await page.getByRole('tab', { name: 'Manual quote' }).click();
      const connect = page.getByRole('button', { name: 'Connect relays' });
      if (await connect.isVisible().catch(() => false)) await connect.click();
      await sleep(3000);

      const aggregator = new RelayAggregator({ relays: RELAYS, chain: indexerChainReader(chain.indexerHttp, CONTRACT), socketFactory: nodeSocketFactory });
      await aggregator.connect();
      const takerEnc = generateEncKeypair();
      const rfq: RfqBody = { rfqId: hex(crypto.getRandomValues(new Uint8Array(32))), pair: PAIR, side: 'sell', size: '0.001', expiry: nowSecs() + 600, takerEncPk: hex(takerEnc.pk), replyTo: RELAYS };
      aggregator.publishRfq(rfq);
      log(`[desk] main wallet published RFQ ${rfq.rfqId.slice(0, 12)}…`);

      await page.getByRole('option', { name: /Taker sells 0\.001 tNIGHT/ }).first().click({ timeout: 2 * MIN });
      await page.getByLabel(/^Your price/).fill('41.3');
      await page.getByRole('button', { name: 'Commit sealed quote' }).click();
      log('[desk] commit clicked: wallet builds the offer, nonce journaled, commitQuote submitted');
      const reveal = page.getByRole('button', { name: 'Reveal to taker' });
      await until('the reveal button (commit visible on the indexer)', async () => (await reveal.isVisible()) || (await page.getByText('Not quoted').isVisible()), 15 * MIN, 3000);
      if (await page.getByText('Not quoted').isVisible()) throw new Error(`manual quote failed: ${await page.getByRole('status').allTextContents()} ${await page.locator('[role=status],[role=alert]').allTextContents()}`);
      await reveal.click();
      log('[desk] reveal clicked');

      const agg = await until('the taker to verify the quote', async () => {
        const r = await aggregator.collect(rfq);
        return r.verified[0];
      }, 5 * MIN, 3000);
      const msg = await until('the reveal in the mailbox', async () => {
        const res = await fetch(`${agg.dealerEndpoint}/mailbox/${rfq.takerEncPk}`);
        return ((await res.json()) as RevealMessage[]).find((m) => m.quoteId === agg.quoteId);
      }, 3 * MIN, 2000);
      const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEnc.sk, unhex(agg.dealerEncPk));
      const terms = plaintextToTerms(plaintext);
      const reader = indexerChainReader(chain.indexerHttp, CONTRACT, 0);
      const cq = (await reader.quote(unhex(agg.quoteId)))!;
      const cd = await reader.dealer(cq.dealerCmt);
      const verdict = verifyReveal({ terms, encodedTerms: encodeTerms(terms), nonce: unhex(plaintext.nonce), signature: encodedTermsSignature, offerFile: plaintext.offerFile, expiresAt: plaintext.expiresAt }, cq.commitment, cd.bond!.quotePk, cq.notional);
      if (!verdict.valid) throw new Error(`the browser dealer's reveal failed verification: ${verdict.reason}`);
      const counter = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/preprod-test-token.json'), 'utf-8')).tokenType as string;
      const om = offerMatchesTerms(plaintext.offerFile, {
        dealerSide: terms.side,
        base: { kind: 'unshielded', token: '0'.repeat(64), amount: encodeTerms(terms)[3] },
        counter: { kind: 'unshielded', token: counter, amount: counterAmountFor(terms) },
      });
      if (!om.ok) throw new Error(`the browser dealer's Offer File does not pay the terms: ${om.reason}`);
      log(`[desk] reveal verified by the taker: dealer ${terms.side}s ${terms.size} @ ${terms.price}; Offer File matches`);
      const { params } = await queryLedgerParameters(chain.indexerHttp);
      const settled = await settleFromOffer({ wallet: main!, offerFileBase64: plaintext.offerFile, expiresAt: plaintext.expiresAt, ledgerParameters: params });
      log(`[desk] main wallet settled the browser dealer's offer: ${settled.txId}`);
      await aggregator.close();
      await sleep(30_000);

      await page.getByRole('tab', { name: 'Quotes' }).click();
      await page.getByRole('button', { name: 'Record settlement' }).first().click({ timeout: 3 * MIN });
      await page.getByRole('dialog', { name: 'Record this trade as settled?' }).getByRole('button', { name: 'Record settlement' }).click();
      await until('the settled counter', async () => {
        const l = await chainLedger();
        return l.settled.member(unhex(dealerCmt)) && l.settled.lookup(unhex(dealerCmt)).read() === 1n;
      }, 20 * MIN, 10_000);
      return `browser dealer ${dealerCmt.slice(0, 12)}… bonded, sealed and revealed a quote; the main wallet verified and settled it (${settled.txId}); recorded from the desk (settled 1)`;
    },
    () => [page],
  );
} finally {
  await stopDealerNode().catch(() => undefined);
  await ui.close().catch(() => undefined);
  await Promise.all(relayServers.map((s) => s.close())).catch(() => undefined);
  await taker.saveState().catch(() => undefined);
  await main?.saveState().catch(() => undefined);
  log(`\n===== summary =====`);
  for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'} ${r.phase} (${(r.ms / 1000).toFixed(0)} s): ${r.detail}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  log(`artifacts: ${OUT}`);
}
process.exit(results.every((r) => r.ok) && results.length > 0 ? 0 : 1);
