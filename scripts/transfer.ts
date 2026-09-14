// Sends unshielded tokens from MN_WALLET_SEED's wallet to another address, and confirms on the indexer.
//
// Written for the operator-README timing run (M3 task 3.10): a fresh operator wallet is funded from an
// existing test wallet instead of the CAPTCHA-gated faucet, so every later step can be timed end to end.
// The faucet wait itself still needs a human and is NOT measured by this path.
//
// Env: TRANSFER_TO (bech32 unshielded address), TRANSFER_AMOUNT (base units), TRANSFER_TOKEN (RawTokenType;
// default native tNIGHT). Refuses Mainnet.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { queryLedgerParameters, waitForTransaction } from '../packages/sdk/src/indexer.js';
import { checkTimeToDismiss, describeIntents, nodeErrorCode } from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: test script');
initNetworkId(chain.network);

const to = process.env.TRANSFER_TO;
const amountText = process.env.TRANSFER_AMOUNT;
if (!to || !amountText || !/^\d+$/.test(amountText)) throw new Error('set TRANSFER_TO and TRANSFER_AMOUNT (base units, digits only)');
const amount = BigInt(amountText);
const token = process.env.TRANSFER_TOKEN ?? ledger.nativeToken().raw;
const receiver = MidnightBech32m.parse(to).decode(UnshieldedAddress, chain.network as never);

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const { params } = await queryLedgerParameters(chain.indexerHttp);

const recipe = await wallet.facade.transferTransaction(
  [{ type: 'unshielded', outputs: [{ type: token, receiverAddress: receiver, amount }] }] as never,
  wallet.secretKeys,
  { ttl: new Date(Date.now() + 30 * 60_000), payFees: true },
);
const tx = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(recipe, wallet.signFn));
const dismiss = checkTimeToDismiss(tx, params);
if (dismiss.ok === false) {
  await wallet.facade.revert(recipe).catch(() => undefined);
  throw new Error(`transfer would be rejected (168): ${dismiss.reason}; ${describeIntents(tx)}`);
}
let txId: string;
try {
  txId = await wallet.facade.submitTransaction(tx);
} catch (err) {
  await wallet.facade.revert(recipe).catch(() => undefined);
  throw new Error(`transfer rejected: node code ${nodeErrorCode(err) ?? '(none found)'}; ${(err as Error).message}`);
}
console.log(`submitted ${amount} of ${token.slice(0, 8)}… to ${to}: ${txId}`);
const indexed = await waitForTransaction(chain.indexerHttp, { identifier: txId });
console.log(`indexed: hash ${indexed.hash}, block ${indexed.blockHeight}, status ${indexed.status}`);
if (indexed.status !== 'SUCCESS') process.exit(1);
process.exit(0);
