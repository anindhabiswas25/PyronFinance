// Task A5: does a SHIELDED dealer half pass the node's time-to-dismiss rule, and does one settle?
//
// Task 2.8 measured shielded offer proving (~3 s, 10.5 KB) but never checked the half, or a merged
// settlement of it, against time-to-dismiss (ROADMAP S5: Custom error 168), and never submitted one.
// A shielded half carries a ZK proof whose VERIFICATION is modelled cost, but it is also ~16x larger,
// and the allowance scales with size (2 µs/byte). Which effect wins is an empirical question.
//
// Shape (one wallet in both roles, as probe-fee-calc does):
//   dealer half  give 1000 shielded TSU, want 400 unshielded tNIGHT   -> { shielded:+1000, unshielded tNIGHT:-400 }
//   taker        balanceFinalizedTransaction: pays 400 tNIGHT, receives the 1000 shielded TSU
//
// Reports the local verdict on both the half and the merged settlement, with live LedgerParameters.
// Submits only with PROBE_SUBMIT=1 — and then submits EVEN IF the local verdict is FAIL, because
// the node's verdict on a FAIL is also evidence (it confirms or refutes the local check for this
// shape). Verification is by indexer read-back of the transaction status, never the submit receipt.
//
// Prerequisite: shielded TSU coins in the wallet (`pnpm run probe-shielded-latency` mints them).
// REFUSES MAINNET.

import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { testShieldedTokenType } from '../packages/sdk/src/test-shielded-token.js';
import { queryLedgerParameters, waitForTransaction } from '../packages/sdk/src/indexer.js';
import {
  balanceVectorOf,
  checkTimeToDismiss,
  describeIntents,
  showVector,
  tradeableBalance,
  balanceVectorNetsToZero,
} from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: TestShieldedToken is testnet scaffolding');
initNetworkId(chain.network);

const GIVE_SHIELDED = BigInt(process.env.PROBE_GIVE ?? '1000');
const WANT_NIGHT = BigInt(process.env.PROBE_WANT_NIGHT ?? '400');
const SUBMIT = process.env.PROBE_SUBMIT === '1';
const NIGHT = ledger.nativeToken().raw;

const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-shielded-token.json`);
if (!fs.existsSync(tokenFile)) throw new Error(`no TestShieldedToken deployment at ${tokenFile}; run probe-shielded-latency`);
const SHIELDED = testShieldedTokenType(JSON.parse(fs.readFileSync(tokenFile, 'utf-8')).address);

async function liveParams(): Promise<ledger.LedgerParameters> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { height, params } = await queryLedgerParameters(chain.indexerHttp);
      console.log(`live LedgerParameters at height ${height}`);
      return params;
    } catch (err) {
      if (attempt >= 8) throw err;
      console.log(`  indexer attempt ${attempt} failed (${(err as Error).message}); retrying`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

type AnyTx = ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>;

function report(label: string, tx: AnyTx, params: ledger.LedgerParameters): boolean {
  const size = tx.serialize().length;
  const cost = tx.cost(params, false);
  const verdict = checkTimeToDismiss(tx, params);
  const allowanceMs = Math.max(size * 0.002, 15);
  console.log(`\n  [${label}] ${size} B; ${describeIntents(tx)}`);
  console.log(`    shielded offer present: ${tx.guaranteedOffer !== undefined}`);
  console.log(`    vector ${showVector(balanceVectorOf(tx))}`);
  console.log(
    `    modelled compute ${(Number(cost.computeTime) / 1e9).toFixed(3)} ms (÷4 parallelism in the rule), ` +
      `read ${(Number(cost.readTime) / 1e9).toFixed(3)} ms; size allowance ≈ ${allowanceMs.toFixed(1)} ms`,
  );
  console.log(`    TIME-TO-DISMISS (live): ${verdict.ok ? `PASS (fee ${verdict.fee})` : `FAIL — ${verdict.reason}`}`);
  return verdict.ok;
}

const params = await liveParams();
const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('syncing...');
await wallet.waitForSync();

const st = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
const shieldedCoins = st.shielded.availableCoins.filter((c) => c.coin.type === SHIELDED);
const shieldedBefore = shieldedCoins.reduce((a, c) => a + c.coin.value, 0n);
const nightBefore = (st.unshielded.balances[NIGHT] ?? 0n) as bigint;
console.log(
  `shielded TSU: ${shieldedCoins.length} coins, ${shieldedBefore} total; tNIGHT ${nightBefore}; ` +
    `unshielded UTXOs ${st.unshielded.availableCoins.length}; DUST coins ${st.dust.availableCoins.length}`,
);
if (shieldedBefore < GIVE_SHIELDED) throw new Error(`wallet holds ${shieldedBefore} shielded TSU, needs ${GIVE_SHIELDED}`);

const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));
const ttl = new Date(Date.now() + 3600_000);

console.log('\n[1] dealer half (shielded give, unshielded want)');
const t0 = performance.now();
const dealerRecipe = await wallet.facade.initSwap(
  { shielded: { [SHIELDED]: GIVE_SHIELDED }, unshielded: {} } as never,
  [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: WANT_NIGHT }] }] as never,
  wallet.secretKeys,
  { ttl, payFees: false },
);
const dealerHalf = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(dealerRecipe, wallet.signFn));
console.log(`  built + proved in ${(performance.now() - t0).toFixed(0)} ms`);
const halfOk = report('dealer half', dealerHalf, params);

console.log('\n[2] taker balances it (unilateral settlement)');
const t1 = performance.now();
const takerRecipe = await wallet.facade.balanceFinalizedTransaction(dealerHalf, wallet.secretKeys, { ttl });
const merged = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(takerRecipe, wallet.signFn));
console.log(`  balanced + proved in ${(performance.now() - t1).toFixed(0)} ms`);
const mergedOk = report('merged settlement', merged, params);
const tradeable = tradeableBalance(balanceVectorOf(merged));
console.log(`  tradeable nets to zero: ${balanceVectorNetsToZero([tradeable])} ${showVector(tradeable)}`);

if (!SUBMIT) {
  await wallet.facade.revert(takerRecipe).catch(() => undefined);
  await wallet.facade.revert(dealerRecipe).catch(() => undefined);
  console.log(`\nnot submitted (PROBE_SUBMIT=1 to submit). half ${halfOk ? 'PASS' : 'FAIL'}, merged ${mergedOk ? 'PASS' : 'FAIL'}`);
  process.exit(0);
}

console.log(`\n[3] SUBMITTING merged settlement (local verdict ${mergedOk ? 'PASS' : 'FAIL'})`);
let txId: string;
try {
  txId = await wallet.facade.submitTransaction(merged);
} catch (err) {
  const dump = inspect(err, { depth: 12, maxStringLength: 20_000 });
  const code = dump.match(/Custom error:?\s*(\d+)/)?.[1];
  console.log(`  node REJECTED — Custom error ${code ?? '(none found)'}; local verdict ${mergedOk ? 'DISAGREES' : 'AGREES'}`);
  if (!code) console.log(dump.slice(0, 4000));
  process.exit(1);
}
console.log(`  node accepted into pool: ${txId}; local verdict ${mergedOk ? 'AGREES' : 'DISAGREES'}`);

const indexed = await waitForTransaction(chain.indexerHttp, { identifier: txId });
console.log(`  INDEXER: hash ${indexed.hash}, block ${indexed.blockHeight}, status ${indexed.status}`);

// Balance read-back: one wallet in both roles, so tNIGHT and shielded TSU should each net to ~0
// (tNIGHT exactly 0 — fees are DUST). What proves settlement is the indexer status above.
await wallet.waitForSync();
const after = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
const shieldedAfter = after.shielded.availableCoins.filter((c) => c.coin.type === SHIELDED).reduce((a, c) => a + c.coin.value, 0n);
console.log(
  `  shielded TSU ${shieldedBefore} -> ${shieldedAfter}; tNIGHT ${nightBefore} -> ${after.unshielded.balances[NIGHT] ?? 0n} ` +
    '(one wallet in both roles: both should be unchanged)',
);
process.exit(indexed.status === 'SUCCESS' ? 0 : 1);
