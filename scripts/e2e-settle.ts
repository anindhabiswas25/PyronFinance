// M2 task 2.6: the happy path, on-chain. bond -> commit -> honest reveal -> SETTLE -> settled +1.
//
// This is the first complete trade the protocol executes. Where e2e-fraud.ts proves the punishment
// works, this proves the thing being punished for failing to do actually works.
//
// THE PAIR. Preprod has exactly one native asset (tNIGHT) and USDM does not exist there, so the
// production pair cannot settle on this network. No substitute is obtainable either: shielded
// tNIGHT genuinely is a separate balance-vector entry, but neither the wallet SDK nor ledger-v8
// exposes any unshielded -> shielded conversion, so a faucet-funded wallet can never acquire a
// shielded balance to pay with.
//
// So the second leg is MINTED: contracts/src/TestToken.compact (testnet scaffolding, deployed by
// `pnpm run deploy-test-token`) mints TESTUSD as a real unshielded LEDGER token, which is what
// Zswap actually settles. This trade therefore produces a genuine two-entry balance vector,
//
//     dealer half: { unshielded tNIGHT: +1000, unshielded TESTUSD: -41440 }
//
// which is exactly the shape of zswap-offer-files SKILL.md §2's tNIGHT/USDM example, down to the
// numbers. Nothing about the settlement path is aware of which assets these are — `SwapLeg.token`
// is just a RawTokenType — which is what makes the Mainnet second leg a config change.
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
import { postBond, minBondForNotional } from '../packages/sdk/src/bonding.js';
import { notionalOf } from '../packages/sdk/src/terms.js';
import { sealQuote, commitQuote, buildReveal, verifyReveal } from '../packages/sdk/src/quotes.js';
import { recordSettlement } from '../packages/sdk/src/fraud.js';
import { generateEncKeypair, encryptReveal, decryptReveal, plaintextToTerms } from '../packages/sdk/src/reveal-channel.js';
import { buildAndProveOffer, settleFromOffer, balanceKey } from '../packages/sdk/src/offers.js';
import { usdmFor, USDM_GATEWAY_BY_NETWORK } from '../packages/sdk/src/assets.js';
import { queryLatestContractState, queryLedgerParameters } from '../packages/sdk/src/indexer.js';
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

// The trade. Price and size are decimal strings on the wire and EXACT INTEGERS internally — never
// floats (zswap-offer-files SKILL.md §7). Both legs use 6-decimal base units, so the fixed-point
// arithmetic below is exact and the divisibility assert is a real check, not decoration: a price
// and size that do not multiply to a whole number of base units is precisely the rounding
// discrepancy that surfaces later as a balance vector which doesn't quite net to zero.
const SIZE = '0.001'; //  1000 base units of tNIGHT, handed over by the dealer
const PRICE = '41.44'; // TESTUSD per tNIGHT — the docs' own example price
const DECIMALS = 1_000_000n; // 6 dp, matching PRICE_DECIMALS / SIZE_DECIMALS in terms.ts

/** Override with E2E_GIVE_UNITS to vary the trade size — useful for isolating coin-selection
 *  effects, since the dealer half's shape depends on how many UTXOs the size forces it to spend. */
const GIVE_UNITS = BigInt(process.env.E2E_GIVE_UNITS ?? '1000');
const PRICE_FIXED = 41_440_000n; // PRICE at 6 dp
const WANT_NUMERATOR = GIVE_UNITS * PRICE_FIXED;
if (WANT_NUMERATOR % DECIMALS !== 0n) {
  throw new Error(
    `size ${SIZE} at price ${PRICE} is not a whole number of TESTUSD base units ` +
      `(${WANT_NUMERATOR} / ${DECIMALS}). Pick a size/price pair that divides exactly — settling a ` +
      'rounded amount is how a balance vector ends up not quite netting to zero.',
  );
}
const WANT_UNITS = WANT_NUMERATOR / DECIMALS;

const VALIDITY_SECS = 300; // within MAX_QUOTE_VALIDITY (900s)

const chain = loadChainConfig();
initNetworkId(chain.network);

const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
if (!fs.existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile} — run scripts/deploy.ts first`);
}
const { address: contractAddress } = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
console.log('Testing against contract:', contractAddress);

// ── Resolve the counter-asset ────────────────────────────────────────────────────────────────
// Real USDM where the network actually has it (Preview, Mainnet); the minted testnet stand-in
// otherwise (Preprod). Both are unshielded LEDGER tokens, so the settlement path below is
// identical either way — which is the whole point of keeping `SwapLeg.token` a bare RawTokenType.
const usdm = usdmFor(chain.network);
let COUNTER_ASSET: string;
let COUNTER_SYMBOL: string;
let PAIR: string;

if (usdm) {
  COUNTER_ASSET = usdm.tokenType;
  COUNTER_SYMBOL = usdm.symbol;
  PAIR = 'tNIGHT/USDM';
  console.log(`Counter-asset: REAL ${usdm.symbol} on ${chain.network} (${usdm.decimals} decimals)`);
  console.log('  token color:', usdm.tokenType);
  console.log('  bridge gateway:', USDM_GATEWAY_BY_NETWORK[chain.network] ?? '(unknown)');
} else {
  const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`);
  if (!fs.existsSync(tokenFile)) {
    throw new Error(
      `No USDM on Midnight ${chain.network}, and no TestToken deployment at ${tokenFile}. ` +
        'Either set MN_NETWORK=preview (where real USDM exists) or run `pnpm run deploy-test-token`.',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
  COUNTER_ASSET = parsed.tokenType;
  COUNTER_SYMBOL = 'TESTUSD';
  PAIR = 'tNIGHT/TESTUSD';
  console.log(`Counter-asset: minted stand-in TESTUSD (no USDM on ${chain.network})`);
  console.log('  TestToken contract:', parsed.address);
}

const UNSHIELDED_NIGHT = balanceKey({ tag: 'unshielded', raw: NIGHT });
const UNSHIELDED_COUNTER = balanceKey({ tag: 'unshielded', raw: COUNTER_ASSET });

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const providers = buildOTCProviders(chain, wallet);

// The taker pays in the counter-asset, so it must actually hold some. Checked up front with a
// pointed error: discovering this inside `balanceFinalizedTransaction` surfaces as an opaque
// insufficient-funds failure from deep in the wallet SDK.
console.log(`\nTaker needs >= ${WANT_UNITS} ${COUNTER_SYMBOL} to pay with...`);
const takerCounter = await wallet.waitForUnshieldedTokenBalance(COUNTER_ASSET, WANT_UNITS).catch(() => 0n);
if (takerCounter < WANT_UNITS) {
  throw new Error(
    `Wallet holds ${takerCounter} ${COUNTER_SYMBOL}, needs ${WANT_UNITS}. ` +
      (usdm
        ? 'Bridge USDM from Cardano Preprod to this Midnight Preview address (VIA Labs USDM bridge).'
        : 'Run `pnpm run deploy-test-token`.'),
  );
}
console.log(`  ${COUNTER_SYMBOL} balance:`, takerCounter);

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
// [1/6] Dealer posts a bond.
//
// ORDERING NOTE, and a correction to an earlier version of this script. The bond was briefly moved
// AFTER offer construction on the theory that `postBond` spends the smallest UTXO first and could
// race offer construction into selecting an already-spent coin. That theory was WRONG — the
// rejection it was meant to explain (`Custom error: 168`) turned out to be an underpaid fee (see
// docs/ROADMAP.md S4) — and the reordering caused a second, real failure: `initSwap` BOOKS every
// coin it selects, and an offer large enough to need all of the wallet's tNIGHT UTXOs left
// `postBond` with nothing to spend, failing with `Wallet.InsufficientFunds`.
//
// So the bond goes first, and the ordering constraint worth remembering is the general one: a
// pre-proved Offer File holds its inputs hostage for its whole lifetime. A dealer node running a
// warm pool must reserve UTXOs for its own on-chain operations, not assume the pool can consume
// the wallet. That belongs in DEALER-NODE.md §5 at M3.
// ---------------------------------------------------------------------------
console.log('\n[1/6] postBond...');
// The bond must cover the quote it backs: notional <= bond * 20 (docs/CONTRACTS.md §7). The notional
// is the tNIGHT leg, i.e. GIVE_UNITS — derived from the same terms that get committed below, so the
// two cannot disagree.
// Exact decimal string from exact base units — never via a float (zswap-offer-files SKILL.md §7).
const TERMS_SIZE = `${GIVE_UNITS / DECIMALS}.${(GIVE_UNITS % DECIMALS).toString().padStart(6, '0')}`;
const bondAmount = minBondForNotional(notionalOf({ pair: PAIR, side: 'sell', price: PRICE, size: TERMS_SIZE }));
console.log(`  notional ${GIVE_UNITS} -> minimum bond ${bondAmount}`);
await postBond(contract, bondAmount, quotePk);
console.log('  bond posted.');

// ---------------------------------------------------------------------------
// [2/6] Dealer builds and PROVES the Offer File — the warm-pool step.
//
// `canBackQuote` is enforced inside `buildAndProveOffer`, so an offer that would die inside the
// quote window is refused here rather than discovered after the dealer is already bound on-chain —
// at which point the taker challenges and the whole bond goes.
// ---------------------------------------------------------------------------
console.log('\n[2/6] Building + proving the Offer File (dealer, warm-pool step)...');
const proveStart = Date.now();
const offer = await buildAndProveOffer({
  wallet,
  give: { kind: 'unshielded', token: NIGHT, amount: GIVE_UNITS },
  want: { kind: 'unshielded', token: COUNTER_ASSET, amount: WANT_UNITS },
  validitySecs: VALIDITY_SECS,
});
const proveMs = Date.now() - proveStart;
console.log(`  proved in ${proveMs} ms`);
console.log('  balance vector:', showVector(offer.balanceVector));
console.log(`  offer file: ${offer.offerFileBase64.length} base64 chars, expires at ${offer.expiresAt}`);

// TWO entries, opposite signs. This assertion is the point of the whole exercise: it is the
// difference between "settlement works" and "a balance vector with two legs nets to zero".
if (
  offer.balanceVector[UNSHIELDED_NIGHT] !== GIVE_UNITS ||
  offer.balanceVector[UNSHIELDED_COUNTER] !== -WANT_UNITS ||
  Object.keys(offer.balanceVector).length !== 2
) {
  throw new Error(
    `Offer balance vector is not the trade we asked for. Expected exactly ` +
      `{unshielded tNIGHT: +${GIVE_UNITS}, unshielded ${COUNTER_SYMBOL}: -${WANT_UNITS}}, ` +
      `got ${showVector(offer.balanceVector)}`,
  );
}

// ---------------------------------------------------------------------------
// [3/6] Dealer seals and commits the quote. The commitment covers the TERMS, never the serialized
// offer bytes — serialization may not be canonical, and non-canonical bytes would make an honest
// dealer fail to open their own commitment (zswap-offer-files SKILL.md §6).
// ---------------------------------------------------------------------------
console.log('\n[3/6] commitQuote...');
const rfqId = randomBytes32();
const validUntil = BigInt(Math.floor(Date.now() / 1000) + VALIDITY_SECS);
// TERMS_SIZE, not the SIZE constant: the committed size must equal the bonded notional and the
// offer's tNIGHT leg, including when E2E_GIVE_UNITS overrides the default.
const terms = { pair: PAIR, side: 'sell' as const, price: PRICE, size: TERMS_SIZE };
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
// The taker reads the commitment and declared notional from the CHAIN, not from the dealer: the
// notional check is the only thing that ties the bond cap to the size actually being quoted.
const onChain = await queryLatestContractState(chain.indexerHttp, contractAddress);
if (!onChain) throw new Error('contract state not found when verifying the reveal');
const onChainQuote = otcLedger(onChain.data).quotes.lookup(quoteId);
const check = verifyReveal(takerView, onChainQuote.commitment, quotePk, onChainQuote.notional);
if (!check.valid) throw new Error(`Taker rejected the reveal: ${check.reason}`);
console.log('  taker verified: signature valid, reveal opens the on-chain commitment, not expired.');

// ---------------------------------------------------------------------------
// [5/6] The taker settles from the dealer's bytes alone. No further action by the dealer.
// ---------------------------------------------------------------------------
console.log('\n[5/6] Settling (taker, unilaterally, from the Offer File)...');
// Live parameters, so the node's time-to-dismiss rule (Custom error 168, ROADMAP S5) is checked
// locally before submitting rather than discovered as an opaque rejection.
const { params: ledgerParameters } = await queryLedgerParameters(chain.indexerHttp);
const settleStart = Date.now();
const settlement = await settleFromOffer({
  wallet,
  offerFileBase64: plaintext.offerFile,
  expiresAt: plaintext.expiresAt,
  ledgerParameters,
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
console.log(`  bond.amount  (expect ${bondAmount}, untouched):`, bond.amount);
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
