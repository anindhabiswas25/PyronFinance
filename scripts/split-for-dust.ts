// Test: can a wallet raise its own DUST coin count, so that as a taker it can reach the ~3 DUST spends a
// compact one-input-per-side settlement needs (ROADMAP S5, controlled test 2026-09-14)?
//
// Hypothesis, NOT established: each registered tNIGHT UTXO generates into its own DUST coin, so splitting
// tNIGHT into N coins and registering them yields ~N DUST coins. Every piece is kept >= SPLIT_MIN_PIECE
// so a trade of that size still spends exactly ONE tNIGHT coin under smallest-first selection.
//
// Steps: report coins -> dismiss-checked split -> wait for the pieces -> register new tNIGHT for DUST ->
// report DUST coin count now, and again after SPLIT_WAIT_SECS of generation.
//
// Env: SPLIT_PIECES (default 3), SPLIT_PIECE (base units per piece, default 100000), SPLIT_WAIT_SECS
// (default 300). Uses MN_WALLET_SEED — point it at the wallet under test.

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { queryLedgerParameters, waitForTransaction } from '../packages/sdk/src/indexer.js';
import { listCoins, splitExact, registerNewNight } from '../packages/sdk/src/inventory.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: test script');
initNetworkId(chain.network);
const PIECES = Number(process.env.SPLIT_PIECES ?? '3');
const PIECE = BigInt(process.env.SPLIT_PIECE ?? '100000');
const WAIT = Number(process.env.SPLIT_WAIT_SECS ?? '300');
const NIGHT = ledger.nativeToken().raw;

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const dust = async () => {
  const s = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
  return { coins: s.dust.availableCoins.length, balance: s.dust.balance(new Date()) };
};
const report = async (label: string) => {
  const night = await listCoins(wallet, NIGHT);
  const d = await dust();
  console.log(`${label}: tNIGHT coins [${night.map((c) => `${c.value}${c.registeredForDust ? '*' : ''}`).join(', ')}]; DUST coins ${d.coins}, balance ${d.balance}`);
  return { night, d };
};

const before = await report('before');
const { params } = await queryLedgerParameters(chain.indexerHttp);
const out = await splitExact(wallet, NIGHT, Array.from({ length: PIECES }, () => PIECE), params);
const tx = await waitForTransaction(chain.indexerHttp, { identifier: out.txId });
console.log(`split: ${out.inputs} in -> ${out.outputs} out, ${out.bytes} B; tx ${tx.hash} status ${tx.status}`);
for (let i = 0; i < 60; i++) {
  await wallet.waitForSync();
  if ((await listCoins(wallet, NIGHT)).length >= before.night.length + PIECES) break;
  await new Promise((r) => setTimeout(r, 5000));
}
await report('after split');
const registered = await registerNewNight(wallet);
console.log(`registered ${registered} new tNIGHT coin(s) for DUST generation`);
await new Promise((r) => setTimeout(r, 30_000));
await wallet.waitForSync();
await report('after registration');
await new Promise((r) => setTimeout(r, WAIT * 1000));
await wallet.waitForSync();
const after = await report(`after ${WAIT}s of generation`);
console.log(`RESULT: DUST coins ${before.d.coins} -> ${after.d.coins}`);
process.exit(0);
