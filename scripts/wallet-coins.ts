// Read-only: lists a wallet's unshielded coins per token — AVAILABLE and PENDING (booked by a built but
// unsubmitted transaction, e.g. a live Offer File). Submits nothing.
//
// Why it exists: after a crashed script, the main Preprod wallet reported 0 TESTUSD while its one
// TESTUSD coin was unspent on-chain. The wallet state keeps `pendingUtxos` beside `availableUtxos`, and
// `restore(available, pending)` takes both, so a snapshot saved while an offer was booked may carry the
// booking into the next process. This shows it directly instead of inferring it from a balance.
//
// Env: WALLET_COINS_SEED_VAR (name of the env var holding the seed; default MN_WALLET_SEED).

import * as Rx from 'rxjs';
import { loadChainConfig } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seedVar = process.env.WALLET_COINS_SEED_VAR ?? 'MN_WALLET_SEED';
const seed = process.env[seedVar];
if (!seed) throw new Error(`${seedVar} is not set`);

// persistState is left ON so this reads exactly what the other scripts restore — but it only saves
// after sync, which records nothing this script changed (it changes nothing).
const wallet = await createHeadlessWallet(seed, chain);
await wallet.waitForSync();
const s = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));

const label = (t: string) => (/^0+$/.test(t) ? 'tNIGHT' : `${t.slice(0, 12)}…`);
function show(kind: string, coins: ReadonlyArray<{ utxo: { type: string; value: bigint; intentHash: string; outputNo: number } }>) {
  console.log(`${kind}: ${coins.length}`);
  for (const c of coins) {
    console.log(`  ${label(c.utxo.type).padEnd(14)} ${String(c.utxo.value).padStart(14)}  ${c.utxo.intentHash}:${c.utxo.outputNo}`);
  }
}
console.log(`wallet ${wallet.unshieldedAddress} (${chain.network})`);
show('AVAILABLE', s.unshielded.availableCoins);
show('PENDING (booked, not spendable by new transactions)', s.unshielded.pendingCoins);
process.exit(0);
