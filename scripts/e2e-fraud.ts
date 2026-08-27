// M1 definition of done: on Preprod, a test dealer posts a bond and commits a quote, and a
// scripted fraud-proof test correctly slashes the bond on a deliberately mismatched reveal.
//
// Uses a single wallet playing both dealer and taker roles for simplicity — the protocol places
// no restriction on this (docs/ARCHITECTURE.md: "these roles are not exclusive").

import fs from 'node:fs';
import path from 'node:path';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { schnorrPublicKey, freshNonce } from '../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../packages/sdk/src/domain.js';
import { postBond } from '../packages/sdk/src/bonding.js';
import { sealQuote, commitQuote, buildReveal } from '../packages/sdk/src/quotes.js';
import { encodeTerms } from '../packages/sdk/src/terms.js';
import { submitFraudProofMismatch } from '../packages/sdk/src/fraud.js';
import { queryLatestContractState } from '../packages/sdk/src/indexer.js';
import { ledger } from '../contracts/managed/otc-protocol/contract/index.js';

function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
if (!fs.existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile} — run scripts/deploy.ts first`);
}
const { address: contractAddress } = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
console.log('Testing against contract:', contractAddress);

const wallet = await createHeadlessWallet(seed, chain);
await wallet.waitForSync();
const providers = buildOTCProviders(chain, wallet);

// Dealer identity — fresh secret key for this test run.
const dealerSk = randomBytes32();
const dealerCmt = dealerCommitment(dealerSk);
console.log('Test dealer commitment:', Buffer.from(dealerCmt).toString('hex'));

// Dealer's quote-signing key (Jubjub scalar, separate from dealerSk).
const quoteSk = BigInt('0x' + Buffer.from(randomBytes32()).toString('hex')) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const quotePk = schnorrPublicKey(quoteSk);

const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: dealerSk, takerAddress: dealerSk }, // single wallet, both roles
});

console.log('\n[1/5] postBond...');
const bondAmount = 1n; // PLACEHOLDER_MIN_BOND — see docs/CONTRACTS.md §7, deliberately unset
await postBond(contract, bondAmount, quotePk);
console.log('Bond posted.');

console.log('\n[2/5] commitQuote (real terms)...');
const rfqId = randomBytes32();
const now = BigInt(Math.floor(Date.now() / 1000));
const validUntil = now + 300n; // 5 min — within MAX_QUOTE_VALIDITY (900s)
const realTerms = { pair: 'tNIGHT/USDM', side: 'sell' as const, price: '0.0412', size: '1000.0' };
const sealed = sealQuote(realTerms, rfqId, validUntil);
await commitQuote(contract, sealed);
const quoteId = deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment);
console.log('Quote committed. quoteId:', Buffer.from(quoteId).toString('hex'));

console.log('\n[3/5] Building a DELIBERATELY MISMATCHED reveal (Class A fraud)...');
// Sign different terms than what was committed to — this is the fraud we're proving the
// contract catches. A real dealer would never do this; this script exists to verify the
// slashing path works, not to demonstrate normal operation.
const fraudulentTerms = { pair: 'tNIGHT/USDM', side: 'sell' as const, price: '0.0999', size: '1000.0' };
const fraudulentSealed = { ...sealed, terms: fraudulentTerms, encodedTerms: encodeTerms(fraudulentTerms) };
const reveal = buildReveal(fraudulentSealed, quoteSk, 'unused-offer-file-b64', Math.floor(Date.now() / 1000) + 300);
console.log('Reveal signed over mismatched terms (price 0.0999 vs committed 0.0412).');

console.log('\n[4/5] submitFraudProofMismatch...');
const beneficiary = randomBytes32(); // wronged-taker payout address for this test
await submitFraudProofMismatch(contract, quoteId, reveal, beneficiary);
console.log('Fraud proof submitted.');

console.log('\n[5/5] Verifying slash landed on-chain...');
const state = await queryLatestContractState(chain.indexerHttp, contractAddress);
if (!state) throw new Error('Contract state not found after fraud proof');
const ledgerState = ledger(state.data);

const bond = ledgerState.bonds.lookup(dealerCmt);
const slashedCount = ledgerState.slashed.lookup(dealerCmt).read();
const quote = ledgerState.quotes.lookup(quoteId);

console.log('Post-slash bond.amount (expect 0):', bond.amount);
console.log('Post-slash bond.active (expect false):', bond.active);
console.log('slashed counter (expect 1):', slashedCount);
console.log('quote.resolved (expect true):', quote.resolved);

if (bond.amount !== 0n || bond.active !== false || slashedCount !== 1n || quote.resolved !== true) {
  throw new Error('E2E FAILED: slash did not land as expected — see values above');
}

console.log('\n✅ M1 DEFINITION OF DONE MET: bond posted, quote committed, mismatched reveal proved fraud, bond slashed.');
process.exit(0);
