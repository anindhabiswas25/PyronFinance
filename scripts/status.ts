// Wallet + deployment status. Fast once a wallet snapshot exists (see packages/sdk/src/wallet-state.ts).
// Prints what every other script depends on: NIGHT balance, DUST balance (fees are paid in DUST,
// and a wallet with NIGHT but no DUST cannot transact at all), and which UTXOs are registered for
// DUST generation.

import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const ONE_NIGHT = 1_000_000n; // Stars
const ONE_DUST = 1_000_000_000_000_000n; // Specks

function fmt(raw: bigint, unit: bigint, label: string): string {
  const whole = raw / unit;
  const frac = raw % unit;
  return `${raw} (${whole}.${frac.toString().padStart(unit.toString().length - 1, '0').slice(0, 6)} ${label})`;
}

async function main() {
  const chain = loadChainConfig();
  initNetworkId(chain.network);

  const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
  console.log('network: ', chain.network);
  console.log('address: ', wallet.unshieldedAddress);
  console.log('syncing...');
  await wallet.waitForSync();

  const s = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));

  const night = Object.entries(s.unshielded.balances);
  console.log('\n--- unshielded (NIGHT) ---');
  if (night.length === 0) console.log('  (no balance)');
  for (const [token, amount] of night) {
    const label = /^0+$/.test(token) ? 'native NIGHT' : token.slice(0, 16) + '…';
    console.log(`  ${label}: ${fmt(amount as bigint, ONE_NIGHT, 'NIGHT')}`);
  }

  const utxos = s.unshielded.availableCoins;
  const registered = utxos.filter((u) => u.meta?.registeredForDustGeneration === true);
  console.log(`  utxos: ${utxos.length} total, ${registered.length} registered for DUST generation`);
  for (const u of utxos) {
    console.log(`    - value=${u.utxo.value} registered=${u.meta?.registeredForDustGeneration === true}`);
  }

  console.log('\n--- DUST (fees) ---');
  const dustBalance = s.dust.balance(new Date());
  console.log(`  balance: ${fmt(dustBalance, ONE_DUST, 'DUST')}`);
  console.log(`  coins:   ${s.dust.availableCoins.length}`);
  if (dustBalance === 0n) {
    console.log('  WARNING: zero DUST — no transaction can pay fees. Run `pnpm run fund`.');
  }

  const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
  console.log('\n--- deployment ---');
  console.log(
    fs.existsSync(deploymentFile)
      ? '  ' + fs.readFileSync(deploymentFile, 'utf-8').trim().replace(/\n/g, '\n  ')
      : '  (none — run `pnpm run deploy`)',
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
