// Generates a fresh 32-byte wallet seed for Preprod use. Run once, save the output into
// .env's MN_WALLET_SEED (git-ignored — see .gitignore and midnight-deployment SKILL.md §2),
// then fund the corresponding unshielded address via https://faucet.preprod.midnight.network.

import { generateNewSeedHex } from '../packages/sdk/src/wallet.js';

const seedHex = generateNewSeedHex();
console.log('New wallet seed (hex, 32 bytes) — SAVE THIS SECURELY, it is shown only once:\n');
console.log(seedHex);
console.log('\nAdd it to your .env file as:\n  MN_WALLET_SEED=' + seedHex);
console.log('\nThen run: node --env-file=.env --experimental-strip-types scripts/print-address.ts');
