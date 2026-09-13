// Task A2: the settlement path with TWO DISTINCT WALLETS. Every earlier settlement (2.6) used one
// wallet in both roles. The mechanism argument said that cannot matter — the taker's balancing draws
// only on the taker's coins and signs only the taker's half — but it was an argument, not a run.
//
// Roles, each with its own seed, coins, DUST and keys:
//   DEALER (MN_WALLET_SEED)        bonds, builds + proves the Offer File, commits, reveals encrypted,
//                                  records the settlement. Never sees the taker's keys.
//   TAKER  (MN_TAKER_WALLET_SEED)  receives only the wire reveal message, verifies it against the
//                                  CHAIN, settles unilaterally and pays its own DUST. Never sees the
//                                  dealer's keys.
//
// Trade direction is chosen so a faucet-funded taker can pay: the DEALER BUYS tNIGHT with the second
// asset (TESTUSD on Preprod, real USDM where it exists), so the taker spends tNIGHT — which a fresh
// faucet wallet actually holds. Notional is still the tNIGHT leg (docs/CONTRACTS.md §7).
//
//   dealer half:  { unshielded COUNTER: +WANT, unshielded tNIGHT: -GIVE }
//   taker pays GIVE tNIGHT, receives WANT COUNTER
//
// Verified by read-back, not receipts: settlement tx status from the indexer; both wallets' exact
// balance deltas (fees are DUST, so token deltas are exact); settled counter 1; bond untouched.
//
// Env: E2E_GIVE_UNITS (tNIGHT base units, default 1000). REFUSES MAINNET.

import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet, type HeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { schnorrPublicKey } from '../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../packages/sdk/src/domain.js';
import { postBond, minBondForNotional } from '../packages/sdk/src/bonding.js';
import { sealQuote, commitQuote, buildReveal, verifyReveal } from '../packages/sdk/src/quotes.js';
import { recordSettlement } from '../packages/sdk/src/fraud.js';
import {
  generateEncKeypair,
  encryptReveal,
  decryptReveal,
  plaintextToTerms,
  type RevealMessage,
} from '../packages/sdk/src/reveal-channel.js';
import { buildAndProveOffer, settleFromOffer, balanceKey, showVector } from '../packages/sdk/src/offers.js';
import { usdmFor } from '../packages/sdk/src/assets.js';
import {
  queryLatestContractState,
  queryLedgerParameters,
  waitForTransaction,
} from '../packages/sdk/src/indexer.js';
import { ledger as otcLedger } from '../contracts/managed/otc-protocol/contract/index.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: test settlement script');
initNetworkId(chain.network);

const takerSeed = process.env.MN_TAKER_WALLET_SEED;
if (!takerSeed) throw new Error('MN_TAKER_WALLET_SEED is not set — the taker needs its own wallet (task A2)');
const dealerSeed = requireWalletSeed();
if (takerSeed === dealerSeed) throw new Error('taker and dealer seeds are identical — that is the one-wallet run A2 replaces');

const NIGHT = ledger.nativeToken().raw;
const DECIMALS = 1_000_000n;
const PRICE = '41.44';
const PRICE_FIXED = 41_440_000n;
const GIVE_UNITS = BigInt(process.env.E2E_GIVE_UNITS ?? '1000'); // tNIGHT the TAKER pays
if ((GIVE_UNITS * PRICE_FIXED) % DECIMALS !== 0n) throw new Error('size x price is not a whole number of base units');
const WANT_UNITS = (GIVE_UNITS * PRICE_FIXED) / DECIMALS; // counter-asset the DEALER pays
const VALIDITY_SECS = 300;
const TERMS_SIZE = `${GIVE_UNITS / DECIMALS}.${(GIVE_UNITS % DECIMALS).toString().padStart(6, '0')}`;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const { address: contractAddress } = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`), 'utf-8'),
);

const usdm = usdmFor(chain.network);
let COUNTER: string;
let PAIR: string;
if (usdm) {
  COUNTER = usdm.tokenType;
  PAIR = 'tNIGHT/USDM';
} else {
  const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`);
  COUNTER = JSON.parse(fs.readFileSync(tokenFile, 'utf-8')).tokenType;
  PAIR = 'tNIGHT/TESTUSD';
}
console.log(`contract ${contractAddress}; pair ${PAIR}; taker pays ${GIVE_UNITS} tNIGHT for ${WANT_UNITS} counter`);

async function balances(w: HeadlessWallet): Promise<{ night: bigint; counter: bigint; utxos: number; dust: bigint }> {
  const s = await Rx.firstValueFrom(w.facade.state().pipe(Rx.filter((x) => x.isSynced)));
  return {
    night: (s.unshielded.balances[NIGHT] ?? 0n) as bigint,
    counter: (s.unshielded.balances[COUNTER] ?? 0n) as bigint,
    utxos: s.unshielded.availableCoins.length,
    dust: s.dust.balance(new Date()),
  };
}

async function chainState() {
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await queryLatestContractState(chain.indexerHttp, contractAddress);
      if (!raw) throw new Error('contract state not found');
      return otcLedger(raw.data);
    } catch (err) {
      if (attempt >= 8) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Wallets sync in parallel: they are distinct wallets with distinct snapshots and coin books.
console.log('\nsyncing dealer and taker wallets...');
const [dealerWallet, takerWallet] = await Promise.all([
  createHeadlessWallet(dealerSeed, chain),
  createHeadlessWallet(takerSeed, chain),
]);
await Promise.all([dealerWallet.waitForSync(), takerWallet.waitForSync()]);
console.log(`  dealer ${dealerWallet.unshieldedAddress}`);
console.log(`  taker  ${takerWallet.unshieldedAddress}`);
if (dealerWallet.unshieldedAddressHex === takerWallet.unshieldedAddressHex) throw new Error('same address');

const takerStart = await balances(takerWallet);
console.log(`  taker: tNIGHT ${takerStart.night}, DUST ${takerStart.dust}, UTXOs ${takerStart.utxos}`);
if (takerStart.night < GIVE_UNITS) throw new Error(`taker holds ${takerStart.night} tNIGHT, needs ${GIVE_UNITS} — fund it`);
if (takerStart.dust === 0n) throw new Error('taker has no DUST — run `pnpm run fund` with MN_WALLET_SEED set to the taker seed');

// ── DEALER ──────────────────────────────────────────────────────────────────────────────────────
const dealerSk = crypto.getRandomValues(new Uint8Array(32));
const dealerCmt = dealerCommitment(dealerSk);
const quoteSk =
  BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(32)))) %
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const quotePk = schnorrPublicKey(quoteSk);
const providers = buildOTCProviders(chain, dealerWallet);
const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: dealerSk, takerAddress: new Uint8Array(32) },
});

const terms = { pair: PAIR, side: 'buy' as const, price: PRICE, size: TERMS_SIZE };
const sealedPreview = sealQuote(terms, new Uint8Array(32), 0n);
const bondAmount = minBondForNotional(sealedPreview.notional);
console.log(`\n[dealer 1/5] postBond ${bondAmount} (notional ${sealedPreview.notional})`);
await postBond(contract, bondAmount, quotePk);

const { params: ledgerParameters } = await queryLedgerParameters(chain.indexerHttp);
console.log('[dealer 2/5] build + prove Offer File (checked against live time-to-dismiss)');
const offer = await buildAndProveOffer({
  wallet: dealerWallet,
  give: { kind: 'unshielded', token: COUNTER, amount: WANT_UNITS },
  want: { kind: 'unshielded', token: NIGHT, amount: GIVE_UNITS },
  validitySecs: VALIDITY_SECS,
  ledgerParameters,
});
console.log(`  vector ${showVector(offer.balanceVector)}`);
if (
  offer.balanceVector[balanceKey({ tag: 'unshielded', raw: COUNTER })] !== WANT_UNITS ||
  offer.balanceVector[balanceKey({ tag: 'unshielded', raw: NIGHT })] !== -GIVE_UNITS
) {
  throw new Error('dealer half is not the trade asked for');
}

console.log('[dealer 3/5] commitQuote');
const rfqId = crypto.getRandomValues(new Uint8Array(32));
const sealed = sealQuote(terms, rfqId, BigInt(Math.floor(Date.now() / 1000) + VALIDITY_SECS));
await commitQuote(contract, sealed);
const quoteId = deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment);
console.log(`  quoteId ${hex(quoteId)}`);

// Snapshot the dealer AFTER bond + commit, BEFORE settlement, so the delta isolates the trade.
await dealerWallet.waitForSync();
const dealerBefore = await balances(dealerWallet);
const takerBefore = await balances(takerWallet);

console.log('[dealer 4/5] encrypted reveal -> wire bytes');
const takerEnc = generateEncKeypair(); // the taker's ephemeral RFQ key; only its PUBLIC half crosses
const dealerEnc = generateEncKeypair();
const wire: string = JSON.stringify(
  encryptReveal(quoteId, buildReveal(sealed, quoteSk, offer.offerFileBase64, offer.expiresAt), dealerEnc.sk, takerEnc.pk),
);

// ── TAKER — holds only: its own wallet, its own enc secret, the wire string, dealer's public keys ──
console.log('\n[taker 1/2] decrypt + verify against the chain');
const msg = JSON.parse(wire) as RevealMessage;
const { plaintext, encodedTermsSignature } = decryptReveal(msg, takerEnc.sk, dealerEnc.pk);
const onChain = (await chainState()).quotes.lookup(Buffer.from(msg.quoteId, 'hex'));
const onChainBond = (await chainState()).bonds.lookup(onChain.dealerCmt);
const revealTerms = plaintextToTerms(plaintext);
const check = verifyReveal(
  {
    terms: revealTerms,
    encodedTerms: sealQuote(revealTerms, new Uint8Array(32), 0n).encodedTerms,
    nonce: Buffer.from(plaintext.nonce, 'hex'),
    signature: encodedTermsSignature,
    offerFile: plaintext.offerFile,
    expiresAt: plaintext.expiresAt,
  },
  onChain.commitment,
  onChainBond.quotePk,
  onChain.notional,
);
if (!check.valid) throw new Error(`taker rejected reveal: ${check.reason}`);
console.log('  signature valid under ON-CHAIN quotePk; opens ON-CHAIN commitment; notional matches');

console.log('[taker 2/2] settle unilaterally, paying own DUST');
// E2E_FORCE_SUBMIT=1: record the LOCAL time-to-dismiss verdict with a dry run, then submit WITHOUT the
// local gate, so the node's own verdict on this exact shape is on record. Added after the first A2 run
// was refused locally by 0.098 ms (15.098 vs a 15.000 ms floor): at that margin the node's answer is
// worth more than the local model's, and a node rejection costs nothing (it happens before inclusion).
const FORCE = process.env.E2E_FORCE_SUBMIT === '1';
if (FORCE) {
  try {
    await settleFromOffer({ wallet: takerWallet, offerFileBase64: plaintext.offerFile, expiresAt: plaintext.expiresAt, ledgerParameters, submit: false });
    console.log('  local time-to-dismiss verdict: PASS');
  } catch (err) {
    console.log(`  local time-to-dismiss verdict: FAIL — ${(err as Error).message.split('\n').slice(0, 2).join(' | ')}`);
  }
  console.log('  submitting WITHOUT the local gate (E2E_FORCE_SUBMIT=1)...');
}
const t0 = Date.now();
let settlement: Awaited<ReturnType<typeof settleFromOffer>>;
try {
  settlement = await settleFromOffer({
    wallet: takerWallet,
    offerFileBase64: plaintext.offerFile,
    expiresAt: plaintext.expiresAt,
    ledgerParameters: FORCE ? undefined : ledgerParameters,
  });
} catch (err) {
  const text = String((err as Error).message);
  const code = text.match(/Custom error:?\s*(\d+)/)?.[1];
  console.log(`  NODE VERDICT: rejected${code ? ` with Custom error ${code}` : ''} — ${text.split('\n')[0].slice(0, 300)}`);
  throw err;
}
if (FORCE) console.log('  NODE VERDICT: accepted into the pool (inclusion checked below)');
console.log(`  submitted in ${Date.now() - t0} ms: ${settlement.txId}; DUST provisioned ${settlement.dustSurplus}`);
const indexed = await waitForTransaction(chain.indexerHttp, { identifier: settlement.txId });
console.log(`  INDEXER: hash ${indexed.hash}, block ${indexed.blockHeight}, status ${indexed.status}`);
if (indexed.status !== 'SUCCESS') throw new Error(`settlement status ${indexed.status}`);

// ── DEALER records ─────────────────────────────────────────────────────────────────────────────
console.log('\n[dealer 5/5] recordSettlement');
await recordSettlement(contract, quoteId);

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nverifying...');
async function settledBalances(w: HeadlessWallet, pred: (b: Awaited<ReturnType<typeof balances>>) => boolean) {
  const start = Date.now();
  for (;;) {
    await w.waitForSync();
    const b = await balances(w);
    if (pred(b) || Date.now() - start > 5 * 60_000) return b;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const takerAfter = await settledBalances(takerWallet, (b) => b.counter - takerBefore.counter === WANT_UNITS);
const dealerAfter = await settledBalances(dealerWallet, (b) => dealerBefore.counter - b.counter === WANT_UNITS);
const l = await chainState();
const bond = l.bonds.lookup(dealerCmt);

const rows: Array<[string, bigint, bigint]> = [
  ['taker tNIGHT delta', takerAfter.night - takerBefore.night, -GIVE_UNITS],
  ['taker counter delta', takerAfter.counter - takerBefore.counter, WANT_UNITS],
  ['dealer tNIGHT delta', dealerAfter.night - dealerBefore.night, GIVE_UNITS],
  ['dealer counter delta', dealerAfter.counter - dealerBefore.counter, -WANT_UNITS],
  ['settled counter', l.settled.lookup(dealerCmt).read(), 1n],
  ['slashed counter', l.slashed.lookup(dealerCmt).read(), 0n],
  ['bond.amount', bond.amount, bondAmount],
  ['bond.liveQuotes', bond.liveQuotes, 0n],
];
let ok = bond.active && l.quotes.lookup(quoteId).resolved;
for (const [label, got, want] of rows) {
  const pass = got === want;
  ok &&= pass;
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label}: ${got} (expect ${want})`);
}
console.log(`  ${bond.active ? 'PASS' : 'FAIL'} bond.active; ${l.quotes.lookup(quoteId).resolved ? 'PASS' : 'FAIL'} quote.resolved`);
console.log(`  taker DUST ${takerBefore.dust} -> ${takerAfter.dust} (taker paid its own fee)`);
if (!ok) throw new Error('A2 FAILED — see rows above');
console.log('\n✅ TWO-WALLET SETTLEMENT ON-CHAIN: distinct dealer and taker wallets, exact deltas verified.');
process.exit(0);
