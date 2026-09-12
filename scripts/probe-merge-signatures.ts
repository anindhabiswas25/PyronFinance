// Root-cause probe for `Custom error: 168` on a TWO-ASSET settlement. Submits NOTHING.
//
// What is already established:
//   - The one-asset settlement succeeds on-chain, and there the taker's balancing half has
//     `0 in / 0 sig` — it only creates an output.
//   - The two-asset settlement is rejected even with the fee over-provisioned ~5.7x, and there the
//     taker's balancing half has `1 in / 1 sig` — it must SPEND TESTUSD to pay.
//   - TESTUSD itself is spendable: a plain self-transfer was accepted on-chain.
//
// So the distinguishing feature is a merged settlement in which BOTH halves carry signed unshielded
// inputs. The suspicion: `Intent.signatureData(segmentId)` binds a signature to its SEGMENT ID. The
// taker's balancing transaction is built standalone (landing at segment 1) and signed there, and
// `finalizeRecipe` then does `originalTransaction.merge(finalizedBalancing)`, which must renumber it
// to segment 2. A signature made over segment 1's data would not verify at segment 2 — and in the
// one-asset case there was no signature to invalidate, which is exactly why it worked.
//
// This checks that offline, which is the only way to see it: a node rejection never says which
// segment failed, or even that a signature was the problem.
//
// Run: pnpm run probe-merge-sigs

import fs from 'node:fs';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildAndProveOffer, deserializeOffer, describeIntents } from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
initNetworkId(chain.network);

const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`);
const { tokenType: TESTUSD } = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
const NIGHT = ledger.nativeToken().raw;

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('syncing...');
await wallet.waitForSync();

console.log('\nBuilding the dealer half (gives tNIGHT, wants TESTUSD)...');
const offer = await buildAndProveOffer({
  wallet,
  give: { kind: 'unshielded', token: NIGHT, amount: 1000n },
  want: { kind: 'unshielded', token: TESTUSD, amount: 41440n },
  validitySecs: 300,
});
const dealerHalf = deserializeOffer(offer.offerFileBase64);
console.log('  dealer half:', describeIntents(dealerHalf));

console.log('\nBalancing it as the taker (this is what settleFromOffer does)...');
const recipe = await wallet.facade.balanceFinalizedTransaction(dealerHalf, wallet.secretKeys, {
  ttl: new Date(offer.expiresAt * 1000),
});

// Inspect the balancing transaction BEFORE the merge: which segment does it think it is on?
if (recipe.type !== 'FINALIZED_TRANSACTION') throw new Error(`unexpected recipe ${recipe.type}`);
console.log('  balancing tx BEFORE merge:', describeIntents(recipe.balancingTransaction));

const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
if (signed.type !== 'FINALIZED_TRANSACTION') throw new Error('unexpected signed recipe type');
console.log('  balancing tx AFTER signing:', describeIntents(signed.balancingTransaction));

const merged = await wallet.facade.finalizeRecipe(signed);
console.log('  merged:', describeIntents(merged));

// ── The actual check ──────────────────────────────────────────────────────
// For every intent carrying unshielded inputs, verify each signature against the signatureData of
// the segment it now occupies — and, for contrast, against every other segment present.
console.log('\nVerifying each signature against each candidate segment id:');
const vk = wallet.unshieldedVerifyingKey;
const segments = [...(merged.intents?.keys() ?? [])];

for (const [segment, intent] of merged.intents ?? []) {
  const offerPart = intent.guaranteedUnshieldedOffer;
  if (!offerPart || offerPart.signatures.length === 0) {
    console.log(`  seg${segment}: no unshielded signatures to check`);
    continue;
  }
  for (let i = 0; i < offerPart.signatures.length; i++) {
    const sig = offerPart.signatures[i];
    const results = segments.map((candidate) => {
      let ok = false;
      try {
        ok = ledger.verifySignature(vk, intent.signatureData(candidate), sig);
      } catch {
        ok = false;
      }
      return `${candidate}:${ok ? 'VALID' : 'invalid'}`;
    });
    const own = (() => {
      try {
        return ledger.verifySignature(vk, intent.signatureData(segment), sig);
      } catch {
        return false;
      }
    })();
    console.log(
      `  seg${segment} sig[${i}] — verifies at its OWN segment: ${own ? 'YES' : 'NO'}  ` +
        `(all candidates: ${results.join(', ')})`,
    );
  }
}

console.log(
  '\nReading: a signature that is invalid at its own segment but VALID at another is the ' +
    'segment-renumbering bug. All-valid means signatures are fine and 168 is something else.',
);

// Release the coins this probe booked — it submits nothing.
await wallet.facade.revert(recipe).catch(() => undefined);
console.log('(reverted — nothing submitted)');
process.exit(0);
