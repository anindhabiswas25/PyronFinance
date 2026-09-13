// Merges a wallet's small unshielded coins so offers are backed by few, large UTXOs (ROADMAP S5,
// DEALER-NODE.md §5). Each round merges the CONSOLIDATE_K smallest coins of the token into one via an
// exact-sum self-transfer, dismiss-checked before submission, verified by indexer read-back.
//
// Env: CONSOLIDATE_TOKEN (default native tNIGHT), CONSOLIDATE_K (default 3), CONSOLIDATE_TARGET
// (stop once the wallet holds at most this many coins of the token; default 1),
// CONSOLIDATE_KEEP_LARGEST (never touch this many largest coins; default 0).
//
// WHY THE DEFAULT TARGET IS 1, learned on Preprod 2026-09-14. Coin selection takes the SMALLEST coins
// first: a dealer half giving 1000 tNIGHT from coins {249, 500, 4999998990} came out with 3 inputs,
// 249 + 500 + the large one. So an offer gets a single input only when NO coin of that token is
// smaller than its give amount. Leaving "a few" small coins is not enough; they must all be merged away.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { queryLedgerParameters, waitForTransaction } from '../packages/sdk/src/indexer.js';
import { listCoins, consolidateSmallest, registerNewNight } from '../packages/sdk/src/inventory.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const TOKEN = process.env.CONSOLIDATE_TOKEN ?? ledger.nativeToken().raw;
const K = Number(process.env.CONSOLIDATE_K ?? '3');
const TARGET = Number(process.env.CONSOLIDATE_TARGET ?? '1');
const KEEP = Number(process.env.CONSOLIDATE_KEEP_LARGEST ?? '0');

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const { params } = await queryLedgerParameters(chain.indexerHttp);

const show = async () => {
  const coins = await listCoins(wallet, TOKEN);
  console.log(`  ${coins.length} coins: ${coins.map((c) => `${c.value}${c.registeredForDust ? '*' : ''}`).join(', ')}  (* = DUST-registered)`);
  return coins;
};
console.log(`token ${TOKEN.slice(0, 12)}…; merging ${K} smallest per round until <= ${TARGET} coins`);
let coins = await show();
for (let round = 1; coins.length > TARGET && round <= 20; round++) {
  const k = Math.min(K, coins.length - TARGET + 1);
  const out = await consolidateSmallest(wallet, TOKEN, Math.max(2, k), params, { keepLargest: KEEP });
  if (!out) break;
  const tx = await waitForTransaction(chain.indexerHttp, { identifier: out.txId });
  console.log(`round ${round}: ${out.inputs} in -> ${out.outputs} out, ${out.bytes} B; tx ${tx.hash} status ${tx.status}`);
  if (tx.status !== 'SUCCESS') throw new Error(`consolidation tx status ${tx.status}`);
  const before = coins.length;
  for (let i = 0; i < 60; i++) {
    await wallet.waitForSync();
    coins = await listCoins(wallet, TOKEN);
    if (coins.length < before) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  coins = await show();
}
if (TOKEN === ledger.nativeToken().raw) {
  const n = await registerNewNight(wallet);
  console.log(n ? `registered ${n} new tNIGHT coin(s) for DUST generation` : 'no unregistered tNIGHT coins');
}
process.exit(0);
