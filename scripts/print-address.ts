// Prints the unshielded address for MN_WALLET_SEED, for pasting into the Preprod faucet.
// Does NOT wait for sync or touch the chain beyond wallet startup — fast, safe to run before
// funding exists.

import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

const wallet = await createHeadlessWallet(seed, chain);
console.log('Unshielded address (paste into https://faucet.preprod.midnight.network):');
console.log(wallet.unshieldedAddress);
process.exit(0);
