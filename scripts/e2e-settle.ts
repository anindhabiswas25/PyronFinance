// M2 task 2.6: the happy path, on-chain. bond -> commit -> honest reveal -> SETTLE -> settled +1.
//
// This is the first complete trade the protocol executes. Where e2e-fraud.ts proves the punishment
// works, this proves the thing being punished for failing to do actually works.
//
// THE PAIR, AND WHAT THIS SCRIPT DOES NOT PROVE. Read this before quoting the result anywhere.
//
// Preprod has exactly one asset: native unshielded tNIGHT. USDM does not exist there, so the
// production pair cannot settle on this network, and no substitute second asset is obtainable:
// shielded tNIGHT genuinely is a separate balance-vector entry (probe 6 in
// scripts/probe-swap-semantics.ts shows `{unshielded:+1000, shielded:-900}` building cleanly), but
// neither the wallet SDK nor ledger-v8 exposes any unshielded -> shielded conversion, so a
// faucet-funded wallet can never acquire a shielded balance to pay with.
//
// So this settles a ONE-ASSET offer: the dealer's half is `{unshielded tNIGHT: +1000}` and the
// taker's complementary half absorbs it. Everything in the settlement path is real and asset-
// independent — construction, proving, binding, serialization, the encrypted reveal, commitment
// verification, `balanceFinalizedTransaction`, the client-side nets-to-zero assertion, submission,
// and `recordSettlement`. What is NOT exercised is a SECOND entry in the balance vector. The
// nets-to-zero rule is per-token-independent arithmetic, so the two-asset case differs only by
// having another entry — but that is an argument, not a live run, and it is recorded as such in
// docs/ROADMAP.md rather than glossed over.
//
// ROLES. One wallet plays both dealer and taker, as e2e-fraud.ts does — the protocol places no
// restriction on this (docs/ARCHITECTURE.md: "these roles are not exclusive"). It is not a shortcut
// around the mechanism: the offer file is proved, bound, serialized, encrypted to the taker,
// decrypted, verified against the on-chain commitment and settled strictly through the public path,
// and the settling side never touches the dealer's signing keys.

import fs from 'node:fs';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { schnorrPublicKey } from '../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../packages/sdk/src/domain.js';
import { postBond } from '../packages/sdk/src/bonding.js';
import { sealQuote, commitQuote, buildReveal, verifyReveal } from '../packages/sdk/src/quotes.js';
import { recordSettlement } from '../packages/sdk/src/fraud.js';
import { generateEncKeypair, encryptReveal, decryptReveal, plaintextToTerms } from '../packages/sdk/src/reveal-channel.js';
import { buildAndProveOffer, settleFromOffer, balanceKey } from '../packages/sdk/src/offers.js';
import { queryLatestContractState } from '../packages/sdk/src/indexer.js';
import { ledger as otcLedger } from '../contracts/managed/otc-protocol/contract/index.js';

function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}
function showVector(v: Record<string, bigint>): string {
  const entries = Object.entries(v).map(([k, amount]) => {
    const [tag, raw] = k.split(':');
    const name = raw && /^0+$/.test(raw) ? `${tag} tNIGHT` : k;
    return `${name}: ${amount > 0n ? '+' : ''}${amount}`;
  });
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

const NIGHT = ledger.nativeToken().raw;
const UNSHIELDED_KEY = balanceKey({ tag: 'unshielded', raw: NIGHT });

// The trade. Size and price are decimal strings on the wire and exact integers internally — never
// floats (zswap-offer-files SKILL.md §7). Base units are Stars: 1 tNIGHT = 1e6 Stars, and
// terms.ts uses 6 decimals for both, so these line up exactly.
const SIZE = '0.001'; // 1000 Stars, handed over by the dealer
const PRICE = '1.0'; //  degenerate on Preprod — see the header
/** Override with E2E_GIVE_UNITS to vary the trade size — useful for isolating coin-selection
 *  effects, since the dealer half's shape depends on how many UTXOs the size forces it to spend. */
const GIVE_UNITS = BigInt(process.env.E2E_GIVE_UNITS ?? '1000');
const VALIDITY_SECS = 300; // within MAX_QUOTE_VALIDITY (900s)

const chain = loadChainConfig();
initNetworkId(chain.network);

const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
if (!fs.existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile} — run scripts/deploy.ts first`);
}
const { address: contractAddress } = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
console.log('Testing against contract:', contractAddress);

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const providers = buildOTCProviders(chain, wallet);

// ---------------------------------------------------------------------------
// [1/6] Dealer builds and PROVES the Offer File — BEFORE anything else touches the wallet.
//
// This is the warm-pool step, and its position here is load-bearing in two ways.
//
// Protocol-wise: `canBackQuote` is enforced inside `buildAndProveOffer`, so an offer that would die
// inside the quote window is refused now rather than discovered after the dealer is already bound
// on-chain — at which point the taker challenges and the whole bond goes.
//
// Mechanically: building the offer FIRST books its UTXOs in local wallet state, so the bond
// transaction's own coin selection cannot pick the same coin. Doing it the other way round was a
// real, reproducible failure — see the comment at step [2/6].
// ---------------------------------------------------------------------------
console.log('\n[1/6] Building + proving the Offer File (dealer, warm-pool step)...');
const proveStart = Date.now();
const offer = await buildAndProveOffer({
  wallet,
  give: { kind: 'unshielded', token: NIGHT, amount: GIVE_UNITS },
  // No `want` leg: on Preprod there is no second asset to ask for. See the header.
  validitySecs: VALIDITY_SECS,
});
const proveMs = Date.now() - proveStart;
console.log(`  proved in ${proveMs} ms`);
console.log('  balance vector:', showVector(offer.balanceVector));
console.log(`  offer file: ${offer.offerFileBase64.length} base64 chars, expires at ${offer.expiresAt}`);

if (offer.balanceVector[UNSHIELDED_KEY] !== GIVE_UNITS || Object.keys(offer.balanceVector).length !== 1) {
  throw new Error(
    `Offer balance vector is not the trade we asked for. Expected exactly ` +
      `{unshielded tNIGHT: +${GIVE_UNITS}}, got ${showVector(offer.balanceVector)}`,
  );
}

const dealerSk = randomBytes32();
const dealerCmt = dealerCommitment(dealerSk);
console.log('\nTest dealer commitment:', hex(dealerCmt));

const quoteSk =
  BigInt('0x' + hex(randomBytes32())) %
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const quotePk = schnorrPublicKey(quoteSk);

const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: dealerSk, takerAddress: dealerSk },
});

// ---------------------------------------------------------------------------
// [2/6] Dealer posts a bond.
//
// WHY THIS COMES AFTER THE OFFER. `postBond` moves unshielded funds, so it does its own coin
// selection, and `chooseCoin` always takes the SMALLEST matching UTXO. Building the offer after the
// bond produced a reproducible `1010: Invalid Transaction: Custom error: 168` at settlement: the
// bond had already spent the small UTXO, the wallet's local view had not caught up, and offer
// construction selected the same, now-spent coin. It only appeared once the wallet held more than
// one UTXO — with a single UTXO the two selections could not diverge, which is exactly why the
// first successful run did not show it.
//
// Building the offer first fixes it structurally rather than by sleeping: `initSwap` books its
// inputs in local wallet state, so the bond's selection cannot reach them.
// ---------------------------------------------------------------------------
console.log('\n[2/6] postBond...');
const bondAmount = 1n; // PLACEHOLDER_MIN_BOND — docs/CONTRACTS.md §7, deliberately unset
await postBond(contract, bondAmount, quotePk);
console.log('  bond posted.');

// ---------------------------------------------------------------------------
// [3/6] Dealer seals and commits the quote. The commitment covers the TERMS, never the serialized
// offer bytes — serialization may not be canonical, and non-canonical bytes would make an honest
// dealer fail to open their own commitment (zswap-offer-files SKILL.md §6).
// ---------------------------------------------------------------------------
console.log('\n[3/6] commitQuote...');
const rfqId = randomBytes32();
const validUntil = BigInt(Math.floor(Date.now() / 1000) + VALIDITY_SECS);
const terms = { pair: 'tNIGHT/tNIGHT', side: 'sell' as const, price: PRICE, size: SIZE };
const sealed = sealQuote(terms, rfqId, validUntil);
const commitStart = Date.now();
await commitQuote(contract, sealed);
const commitMs = Date.now() - commitStart;
const quoteId = deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment);
console.log(`  committed in ${commitMs} ms. quoteId: ${hex(quoteId)}`);

// ---------------------------------------------------------------------------
// [4/6] Dealer reveals point-to-point, encrypted to this taker only. The Offer File rides INSIDE
// the ciphertext and never enters the gossip layer — a broadcast Offer File is a broadcast price.
// ---------------------------------------------------------------------------
console.log('\n[4/6] Encrypted point-to-point reveal...');
const dealerEnc = generateEncKeypair();
const takerEnc = generateEncKeypair(); // ephemeral per RFQ, per docs/RELAY.md
const reveal = buildReveal(sealed, quoteSk, offer.offerFileBase64, offer.expiresAt);
const message = encryptReveal(quoteId, reveal, dealerEnc.sk, takerEnc.pk);
console.log(`  reveal ciphertext: ${message.ciphertext.length} base64 chars`);

// --- everything below this line is the TAKER, holding only the wire message ---
const { plaintext } = decryptReveal(message, takerEnc.sk, dealerEnc.pk);
const takerView = { ...reveal, terms: plaintextToTerms(plaintext), offerFile: plaintext.offerFile };
const check = verifyReveal(takerView, sealed.commitment, quotePk);
if (!check.valid) throw new Error(`Taker rejected the reveal: ${check.reason}`);
console.log('  taker verified: signature valid, reveal opens the on-chain commitment, not expired.');

// ---------------------------------------------------------------------------
// [5/6] The taker settles from the dealer's bytes alone. No further action by the dealer.
// ---------------------------------------------------------------------------
console.log('\n[5/6] Settling (taker, unilaterally, from the Offer File)...');
const settleStart = Date.now();
const settlement = await settleFromOffer({
  wallet,
  offerFileBase64: plaintext.offerFile,
  expiresAt: plaintext.expiresAt,
});
const settleMs = Date.now() - settleStart;
console.log(`  settled in ${settleMs} ms. tx: ${settlement.txId}`);
console.log(
  `  fee ${settlement.fee} (ledger-default estimate ${settlement.ledgerDefaultFee}), ` +
    `DUST provisioned ${settlement.dustSurplus}`,
);
console.log('  merged balance vector (asserted zero before submit):', showVector(settlement.mergedBalanceVector));

// ---------------------------------------------------------------------------
// [6/6] Dealer records the settlement on-chain.
// ---------------------------------------------------------------------------
console.log('\n[6/6] recordSettlement...');
const recipient = Buffer.from(wallet.unshieldedAddressHex, 'hex');
if (recipient.length !== 32) throw new Error(`recipient must be 32 raw bytes, got ${recipient.length}`);
await recordSettlement(contract, quoteId, new Uint8Array(recipient));
console.log('  recorded.');

// ---------------------------------------------------------------------------
// [6/6, cont.] Verify against the chain, not against our own optimism.
// ---------------------------------------------------------------------------
console.log('\n[6/6] Verifying on-chain...');
const state = await queryLatestContractState(chain.indexerHttp, contractAddress);
if (!state) throw new Error('Contract state not found after settlement');
const ledgerState = otcLedger(state.data);

const bond = ledgerState.bonds.lookup(dealerCmt);
const settledCount = ledgerState.settled.lookup(dealerCmt).read();
const slashedCount = ledgerState.slashed.lookup(dealerCmt).read();
const quote = ledgerState.quotes.lookup(quoteId);

console.log('  settled counter (expect 1):', settledCount);
console.log('  slashed counter (expect 0):', slashedCount);
console.log('  quote.resolved (expect true):', quote.resolved);
console.log('  bond.amount  (expect 1, untouched):', bond.amount);
console.log('  bond.active  (expect true):', bond.active);
console.log('  bond.liveQuotes (expect 0):', bond.liveQuotes);

if (
  settledCount !== 1n ||
  slashedCount !== 0n ||
  quote.resolved !== true ||
  bond.amount !== bondAmount ||
  bond.active !== true ||
  bond.liveQuotes !== 0n
) {
  throw new Error('E2E FAILED: settlement did not land as expected — see values above');
}

console.log('\n--- measured latencies (task 2.8 input) ---');
console.log(`  offer build + prove:      ${proveMs} ms`);
console.log(`  commitQuote (prove+submit+confirm): ${commitMs} ms`);
console.log(`  settle (balance+prove+submit):      ${settleMs} ms`);

console.log('\n✅ FIRST COMPLETE TRADE SETTLED ON-CHAIN: bond posted, quote committed, honest reveal');
console.log('   delivered point-to-point, Offer File settled by the taker, settled counter = 1.');
process.exit(0);
