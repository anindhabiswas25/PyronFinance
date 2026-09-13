// Unshielded inventory shaping — the SDK half of the Dealer Node's consolidation keeper
// (DEALER-NODE.md §5, task 3.2).
//
// WHY THIS EXISTS, learned twice on Preprod. The node's time-to-dismiss rule (ROADMAP S5, Custom
// error 168) prices every unshielded input and signature. The wallet's coin selection takes the
// SMALLEST coins first, so each settlement's change leaves the wallet more fragmented, and the next
// offer sweeps several small coins: on 2026-09-14, right after the Class B redeploy, e2e-settle's
// dealer half pulled 3 inputs and the merged settlement was refused locally at 27.3 ms against a
// 21.2 ms allowance. The same trade backed by one coin settles.
//
// Two tools, both built on plain self-transfers (fees are DUST, so token amounts are exact):
//   * consolidate: merge the k smallest coins of a token into one, using an exact-sum transfer so
//     coin selection takes exactly those k coins and writes no change.
//   * split: carve exact-denomination coins, so an offer giving amount X is backed by a coin worth
//     exactly X — one input and no change output, the cheapest shape a half can have.
//
// CAVEAT — DUST generation. Native tNIGHT generates DUST only while its UTXO is registered. A
// transfer creates NEW UTXOs, which are not registered. Consolidating registered tNIGHT therefore
// stops DUST generation on that value until the outputs are registered again; `registerNewNight`
// does that. Contract-minted tokens generate no DUST and need nothing.

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { HeadlessWallet } from './wallet.js';
import { checkTimeToDismiss, describeIntents } from './offers.js';

export interface InventoryCoin {
  /** "intentHash:outputNo" — stable identity of an unshielded UTXO. */
  ref: string;
  token: string;
  value: bigint;
  registeredForDust: boolean;
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

async function syncedState(wallet: HeadlessWallet) {
  return Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced)));
}

export async function listCoins(wallet: HeadlessWallet, token?: string): Promise<InventoryCoin[]> {
  const s = await syncedState(wallet);
  return s.unshielded.availableCoins
    .map((c) => ({
      ref: `${c.utxo.intentHash}:${c.utxo.outputNo}`,
      token: c.utxo.type,
      value: c.utxo.value,
      registeredForDust: c.meta?.registeredForDustGeneration === true,
    }))
    .filter((c) => token === undefined || c.token === token)
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

export interface TransferOutcome {
  txId: string;
  inputs: number;
  outputs: number;
  bytes: number;
}

/** Builds, dismiss-checks and submits a self-transfer of `outputs` (amounts of `token`). Refuses to
 *  submit anything the node would reject with 168. */
async function selfTransfer(
  wallet: HeadlessWallet,
  token: string,
  outputs: bigint[],
  ledgerParameters: ledger.LedgerParameters,
): Promise<TransferOutcome> {
  const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));
  const recipe = await wallet.facade.transferTransaction(
    [{ type: 'unshielded', outputs: outputs.map((amount) => ({ type: token, receiverAddress: self, amount })) }] as never,
    wallet.secretKeys,
    { ttl: new Date(Date.now() + 30 * 60_000), payFees: true },
  );
  let tx: ledger.FinalizedTransaction;
  try {
    tx = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(recipe, wallet.signFn));
  } catch (err) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw err;
  }
  const dismiss = checkTimeToDismiss(tx, ledgerParameters);
  if (!dismiss.ok) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw new InventoryError(`self-transfer would be rejected (168): ${dismiss.reason}; ${describeIntents(tx)}`);
  }
  let inputs = 0;
  let outs = 0;
  // Count both sections: a wallet transfer does not necessarily use the guaranteed one (the first
  // live consolidation reported "0 in -> 0 out" from counting only guaranteedUnshieldedOffer).
  for (const [, intent] of tx.intents ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      inputs += offer?.inputs.length ?? 0;
      outs += offer?.outputs.length ?? 0;
    }
  }
  const txId = await wallet.facade.submitTransaction(tx);
  return { txId, inputs, outputs: outs, bytes: tx.serialize().length };
}

/** Merges the `k` smallest coins of `token` into one coin. The transfer amount is their exact sum, so
 *  smallest-first coin selection takes exactly those coins and produces no change. Skips (returns
 *  undefined) when there are fewer than two coins to merge. `keepLargest` coins are never touched,
 *  which is how a caller protects its reserve. */
export async function consolidateSmallest(
  wallet: HeadlessWallet,
  token: string,
  k: number,
  ledgerParameters: ledger.LedgerParameters,
  options: { keepLargest?: number; exclude?: ReadonlySet<string> } = {},
): Promise<TransferOutcome | undefined> {
  if (k < 2) throw new InventoryError('consolidation needs k >= 2');
  const coins = (await listCoins(wallet, token)).filter((c) => !options.exclude?.has(c.ref));
  const candidates = coins.slice(0, Math.max(0, coins.length - (options.keepLargest ?? 0)));
  const batch = candidates.slice(0, k);
  if (batch.length < 2) return undefined;
  const sum = batch.reduce((a, c) => a + c.value, 0n);
  return selfTransfer(wallet, token, [sum], ledgerParameters);
}

/** Carves exact-denomination coins of `token` (plus change). */
export async function splitExact(
  wallet: HeadlessWallet,
  token: string,
  amounts: bigint[],
  ledgerParameters: ledger.LedgerParameters,
): Promise<TransferOutcome> {
  if (amounts.length === 0 || amounts.some((a) => a <= 0n)) throw new InventoryError('split amounts must be positive');
  return selfTransfer(wallet, token, amounts, ledgerParameters);
}

/** Registers any unregistered native tNIGHT coins for DUST generation (see the caveat above). */
export async function registerNewNight(wallet: HeadlessWallet): Promise<number> {
  const s = await syncedState(wallet);
  const night = ledger.nativeToken().raw;
  const fresh = s.unshielded.availableCoins.filter(
    (c) => c.utxo.type === night && c.meta?.registeredForDustGeneration !== true,
  );
  if (fresh.length === 0) return 0;
  const recipe = await wallet.facade.registerNightUtxosForDustGeneration(fresh, wallet.unshieldedVerifyingKey, wallet.signFn);
  const finalized = await wallet.facade.finalizeRecipe(recipe as never);
  await wallet.facade.submitTransaction(finalized);
  return fresh.length;
}
