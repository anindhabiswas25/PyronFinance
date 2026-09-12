// Discriminator probe: is a contract-minted unshielded token actually SPENDABLE by the wallet?
//
// The two-asset settlement is rejected by the node with `1010: Invalid Transaction: Custom error:
// 168` even with the fee over-provisioned ~5.7x and with signature counts matching input counts in
// every segment. So 168 is not a fee problem here, and it is not the W5 signature mismatch.
//
// This isolates the one variable the one-asset settlement did not have: a TESTUSD leg. It does the
// simplest possible thing that spends TESTUSD — a plain self-transfer, no offer, no merge, no
// contract call — so the answer is unambiguous:
//
//   succeeds -> TESTUSD is an ordinary spendable UTXO; the fault is in the settlement merge path.
//   fails    -> contract-minted unshielded tokens cannot be spent this way at all, and the whole
//               test-token approach to a second asset needs rethinking.
//
// Run: pnpm run probe-testusd

import fs from 'node:fs';
import path from 'node:path';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { describeIntents, balanceVectorOf, showVector } from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
initNetworkId(chain.network);

const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`);
const { tokenType: TESTUSD } = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('syncing...');
await wallet.waitForSync();

const balance = await wallet.waitForUnshieldedTokenBalance(TESTUSD, 1n).catch(() => 0n);
console.log('TESTUSD balance:', balance);
if (balance < 41440n) throw new Error('not enough TESTUSD — run `pnpm run deploy-test-token`');

const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));

console.log('\nBuilding a plain TESTUSD self-transfer (no offer, no merge)...');
const recipe = await wallet.facade.transferTransaction(
  [{ type: 'unshielded', outputs: [{ type: TESTUSD, receiverAddress: self, amount: 41440n }] }] as never,
  wallet.secretKeys,
  { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: true },
);
const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
const finalized = await wallet.facade.finalizeRecipe(signed);

console.log('  structure:', describeIntents(finalized));
console.log('  balance vector:', showVector(balanceVectorOf(finalized)));
console.log('  bytes:', finalized.serialize().length);

try {
  const txId = await wallet.facade.submitTransaction(finalized);
  console.log('\n✅ TESTUSD IS SPENDABLE. tx:', txId);
  console.log('   => the fault is in the settlement merge path, not the token.');
} catch (err) {
  console.log('\n❌ TESTUSD self-transfer REJECTED:', (err as Error).message);
  console.log('   => contract-minted unshielded tokens are not spendable by this path.');
  process.exit(1);
}

process.exit(0);
