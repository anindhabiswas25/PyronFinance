// Recovers unshielded coins stuck PENDING in a wallet snapshot, when the transactions that booked them
// are gone and cannot be reverted.
//
// How coins get stuck (read from wallet-sdk-unshielded-wallet source, confirmed live 2026-09-14):
// building a transaction moves its inputs from `availableUtxos` to `pendingUtxos`; `Serialization.js`
// writes BOTH sets into the snapshot; sync removes a pending coin only once the chain shows it SPENT;
// nothing expires a booking. So a process that builds an Offer File, saves a snapshot, and dies without
// submitting or reverting it leaves those coins pending in every later process — permanently.
// `facade.revertTransaction(tx)` un-books them, but only if you still have the transaction bytes.
//
// When you don't, this resets ONLY the unshielded sub-wallet: the snapshot is backed up, then its
// `unshielded` state is replaced by a marker that the SDK's restore rejects. `createHeadlessWallet`
// already falls back per sub-wallet to a fresh sync (wallet.ts restoreOrFresh), so unshielded coins are
// re-derived from the chain — every unspent coin comes back AVAILABLE — while shielded and DUST state
// still restore quickly. No coin is invented: a coin that was really spent stays spent.
//
// RESET_PART=dust does the same for the DUST sub-wallet. Needed when a restored DUST state no longer
// lines up with the chain and every sync update fails with "values inserted non-linearly into dust
// commitment tree; expected to insert index N, but received M" — seen 2026-09-14 on the main Preprod
// wallet, where the sync retried silently for 48 minutes. DUST then re-syncs from genesis (slow).
//
// Env: MN_WALLET_SEED (whose snapshot), RESET_CONFIRM=1 (required), RESET_PART (unshielded | dust |
// shielded; default unshielded).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { walletStateDir } from '../packages/sdk/src/wallet-state.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const part = (process.env.RESET_PART ?? 'unshielded') as 'unshielded' | 'dust' | 'shielded';
if (!['unshielded', 'dust', 'shielded'].includes(part)) throw new Error(`RESET_PART must be unshielded, dust or shielded, not "${part}"`);
if (process.env.RESET_CONFIRM !== '1') throw new Error(`set RESET_CONFIRM=1 — this discards the ${part} part of the wallet snapshot`);

// Only to learn the address the snapshot is keyed by; sync is not started beyond construction.
const probe = await createHeadlessWallet(requireWalletSeed(), chain, { persistState: false });
const digest = crypto.createHash('sha256').update(probe.unshieldedAddress).digest('hex').slice(0, 16);
const file = path.join(walletStateDir(), `${chain.network}-${digest}.json`);
if (!fs.existsSync(file)) {
  console.log(`no snapshot at ${file}; nothing to reset`);
  process.exit(0);
}
const backup = `${file}.before-${part}-reset-${Date.now()}`;
fs.copyFileSync(file, backup);
fs.chmodSync(backup, 0o600);
const snap = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<'unshielded' | 'dust' | 'shielded', string>;
const pending = (() => {
  if (part !== 'unshielded') return 'n/a';
  try {
    return (JSON.parse(snap.unshielded) as { state: { pendingUtxos: unknown[] } }).state.pendingUtxos.length;
  } catch {
    return 'unknown';
  }
})();
snap[part] = `reset: ${part} state discarded (scripts/reset-unshielded-state.ts)`;
const tmp = `${file}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
fs.renameSync(tmp, file);
console.log(`backed up ${file} -> ${backup}`);
console.log(`discarded ${part} state (pending coins: ${pending}); the next start re-syncs ${part} from the chain`);
process.exit(0);
