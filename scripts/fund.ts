// Faucet helper — Preprod only. The faucet itself is a web UI
// (https://faucet.preprod.midnight.network), not a scriptable API we know of, so this script
// prints the address to paste in and then polls the indexer + wallet until funds and DUST are
// both confirmed. See midnight-deployment SKILL.md §5.

import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

const wallet = await createHeadlessWallet(seed, chain);
console.log('1. Go to https://faucet.preprod.midnight.network');
console.log('2. Paste this UNSHIELDED address and request unshielded tNIGHT + tDUST:');
console.log('   ' + wallet.unshieldedAddress);
console.log('\nWaiting for wallet sync...');
await wallet.waitForSync();

console.log('Waiting for unshielded tNIGHT balance (poll every ~10s)...');
const balance = await wallet.waitForUnshieldedBalance();
console.log(`Funded: ${balance} (raw units) unshielded tNIGHT received.`);

console.log('Registering NIGHT UTXOs for DUST generation (required before any transaction)...');
await wallet.registerForDustGeneration();
console.log('DUST generation active. This wallet is ready for scripts/deploy.ts.');

process.exit(0);
