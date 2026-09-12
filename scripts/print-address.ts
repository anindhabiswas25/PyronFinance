// Prints the unshielded address for MN_WALLET_SEED, for pasting into the faucet for the CURRENT
// network. The faucet URL is network-derived, not hardcoded: this script named the Preprod faucet
// unconditionally, which on Preview would have sent you to fund an address on the wrong chain.
// Does NOT wait for sync or touch the chain beyond wallet startup — fast, safe to run before
// funding exists.

import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);
const seed = requireWalletSeed();

// The faucet is CAPTCHA-gated (Cloudflare Turnstile) and cannot be scripted — a human must
// request funds. Fund THIS address, not a browser-wallet address: the first Preprod funding
// attempt went to a different wallet and nothing looked wrong until an indexer query showed zero
// UTXOs (docs/ROADMAP.md M1).
const FAUCETS: Partial<Record<typeof chain.network, string>> = {
  preprod: 'https://midnight-tmnight-preprod.nethermind.dev/',
  preview: 'https://midnight-tmnight-preview.nethermind.dev/',
};

const wallet = await createHeadlessWallet(seed, chain);
console.log(`network: ${chain.network}`);
const faucet = FAUCETS[chain.network];
console.log(
  faucet
    ? `Unshielded address (paste into the ${chain.network} faucet: ${faucet}):`
    : `Unshielded address (no faucet for ${chain.network} — fund it however that network expects):`,
);
console.log(wallet.unshieldedAddress);
process.exit(0);
