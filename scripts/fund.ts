// Faucet helper. The faucet is a CAPTCHA-gated web UI, not a scriptable API, so this script prints
// the address to paste in and then polls until funds and DUST are both confirmed.
// See midnight-deployment SKILL.md §5.
//
// The URL is derived from the network, not hardcoded: naming Preprod's faucet unconditionally
// would send you to fund an address on the wrong chain when MN_NETWORK=preview.

import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

const FAUCETS: Partial<Record<typeof chain.network, string>> = {
  preprod: 'https://midnight-tmnight-preprod.nethermind.dev/',
  preview: 'https://midnight-tmnight-preview.nethermind.dev/',
};

const wallet = await createHeadlessWallet(seed, chain);
console.log(`network: ${chain.network}`);
console.log('1. Go to ' + (FAUCETS[chain.network] ?? '(no known faucet for this network)'));
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
