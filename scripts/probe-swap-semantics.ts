// PHASE 0 probe (task 2.6): what do `WalletFacade.initSwap`'s `desiredInputs` and `desiredOutputs`
// actually MEAN — tokens this wallet SPENDS, or tokens it RECEIVES?
//
// Guessing here produces an Offer File that looks correct and fails at settlement, which is exactly
// the silent-failure class that kept packages/sdk/src/offers.ts a stub. So this script asks the real
// wallet, with real coin selection over real Preprod UTXOs, and prints the resulting balance vector.
//
// It deliberately SUBMITS NOTHING. `initSwap` books the selected UTXOs in local wallet state, so the
// script calls `facade.revert()` at the end to release them. Nothing touches the chain; the answer
// comes from ledger-v8's own arithmetic on a genuinely constructed transaction.
//
// Run: pnpm run probe-swap

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';

const chain = loadChainConfig();
initNetworkId(chain.network);

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('address:', wallet.unshieldedAddress);
console.log('syncing...');
await wallet.waitForSync();

const state = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced)));
const NIGHT = ledger.nativeToken().raw;
const balance = (state.unshielded.balances[NIGHT] ?? 0n) as bigint;
console.log('unshielded NIGHT balance:', balance);
console.log('utxos:', state.unshielded.availableCoins.map((c) => c.utxo.value));

const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));
const ttl = new Date(Date.now() + 30 * 60 * 1000);

/** Prints every segment's imbalance map for a locally-built transaction, then reverts it. */
async function probe(
  label: string,
  desiredInputs: { unshielded?: Record<string, bigint> },
  desiredOutputs: Array<{ type: 'unshielded'; outputs: Array<{ type: string; receiverAddress: UnshieldedAddress; amount: bigint }> }>,
): Promise<void> {
  console.log(`\n--- ${label} ---`);
  let recipe;
  try {
    recipe = await wallet.facade.initSwap(desiredInputs as any, desiredOutputs as any, wallet.secretKeys, {
      ttl,
      payFees: false,
    });
  } catch (err) {
    console.log('  THREW:', (err as Error).message);
    return;
  }
  const tx = recipe.transaction;
  // Segment 0 is the guaranteed section; 1 is fallible. initSwap puts the unshielded offer in the
  // guaranteed section (UnshieldedWallet Transacting.initSwap sets intent.guaranteedUnshieldedOffer).
  for (const segment of [0, 1]) {
    let m: Map<ledger.TokenType, bigint>;
    try {
      m = tx.imbalances(segment, 0n);
    } catch {
      continue;
    }
    if (m.size === 0) continue;
    for (const [token, delta] of m) {
      // TokenType is a tagged object here (shielded/unshielded variants), NOT a RawTokenType
      // string — unlike ZswapOffer.deltas, which is keyed by RawTokenType. Print it raw.
      console.log(`  segment ${segment}: ${JSON.stringify(token)} = ${delta > 0n ? '+' : ''}${delta}`);
    }
  }
  const intent = tx.intents?.get(1);
  const offer = intent?.guaranteedUnshieldedOffer;
  if (offer) {
    console.log(
      `  unshielded offer: ${offer.inputs.length} input(s) totalling ${offer.inputs.reduce((a, i) => a + i.value, 0n)}, ` +
        `${offer.outputs.length} output(s) totalling ${offer.outputs.reduce((a, o) => a + o.value, 0n)}`,
    );
    for (const o of offer.outputs) {
      const mine = o.owner === wallet.unshieldedAddressHex;
      console.log(`    output value=${o.value} owner=${mine ? 'SELF' : o.owner.slice(0, 12) + '…'}`);
    }
  }
  await wallet.facade.revert(recipe);
  console.log('  (reverted — nothing submitted)');
}

// Probe 1: ASYMMETRIC. desiredInputs 1000, desiredOutputs 700 to self.
// If desiredInputs means SPEND: net delta = +1000 - 700 = +300 (this wallet is long 300, i.e. it
//   hands 300 to whoever merges with it).
// If desiredInputs means RECEIVE: the sign would come out the other way (-1000 + 700 = -300).
// A symmetric 1000/1000 probe cannot distinguish the two — it nets to zero either way.
await probe(
  'probe 1: desiredInputs {NIGHT: 1000}, desiredOutputs [{NIGHT: 700 -> self}]',
  { unshielded: { [NIGHT]: 1000n } },
  [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: 700n }] }],
);

// Probe 2: inputs only. Isolates the sign contributed by desiredInputs alone.
await probe('probe 2: desiredInputs {NIGHT: 1000}, no desiredOutputs', { unshielded: { [NIGHT]: 1000n } }, []);

// Probe 3: outputs only. Isolates the sign contributed by desiredOutputs alone — and tests whether
// a pure receiver (a taker giving nothing on this token) can build a half at all. Note the facade
// only builds an unshielded leg when `desiredInputs.unshielded !== undefined`, so an empty object
// must be passed rather than omitting the field.
await probe(
  'probe 3: desiredInputs {} (empty), desiredOutputs [{NIGHT: 700 -> self}]',
  { unshielded: {} },
  [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: 700n }] }],
);

// Probe 4: omitting `unshielded` entirely, to confirm the silent-drop behaviour read out of
// wallet-sdk-facade's initSwap source. Expected: throws "At least one shielded or unshielded swap
// is required" only if outputs are also empty; otherwise the unshielded leg is silently skipped.
await probe(
  'probe 4: desiredInputs {} with NO unshielded key, desiredOutputs [{NIGHT: 700 -> self}]',
  {},
  [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: 700n }] }],
);

// ---------------------------------------------------------------------------
// PHASE 0b: can two independently-built halves actually be merged, signed and finalized?
//
// This is the part that decides whether "pre-proved Offer File" is real. If a half must stay
// unproven until the counterparty merges it, the dealer's warm pool cannot amortize proving, and
// the taker cannot settle unilaterally — both load-bearing assumptions elsewhere in the design.
// ---------------------------------------------------------------------------

async function probeMerge(): Promise<void> {
  console.log('\n--- probe 5: build two halves, serialize/deserialize, merge, inspect ---');
  const giveRecipe = await wallet.facade.initSwap(
    { unshielded: { [NIGHT]: 1000n } } as any,
    [],
    wallet.secretKeys,
    { ttl, payFees: false },
  );
  const wantRecipe = await wallet.facade.initSwap(
    { unshielded: {} } as any,
    [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: 1000n }] }] as any,
    wallet.secretKeys,
    { ttl, payFees: false },
  );

  // Wire round-trip: this is the base64 form that rides inside the encrypted reveal.
  const bytes = giveRecipe.transaction.serialize();
  console.log(`  serialized give-half: ${bytes.length} bytes (${Math.ceil((bytes.length * 4) / 3)} b64 chars)`);
  // Marker strings are 'signature' / 'pre-proof' / 'pre-binding'. Note SignatureEnabled's
  // `instance` is 'signature', NOT 'signature-enabled' — the class name and the marker differ, and
  // getting it wrong surfaces as a WASM "Invalid signature value." from deep inside deserialize,
  // which reads like a corrupt payload rather than a wrong marker.
  const roundTripped = ledger.Transaction.deserialize(
    'signature',
    'pre-proof',
    'pre-binding',
    bytes,
  ) as ledger.UnprovenTransaction;
  console.log('  deserialize OK; intents:', [...(roundTripped.intents?.keys() ?? [])]);
  console.log('  want-half intents:', [...(wantRecipe.transaction.intents?.keys() ?? [])]);

  try {
    const merged = roundTripped.merge(wantRecipe.transaction);
    console.log('  merge OK; merged intents:', [...(merged.intents?.keys() ?? [])]);
    for (const [token, delta] of merged.imbalances(0, 0n)) {
      console.log(`  merged segment 0: ${JSON.stringify(token)} = ${delta > 0n ? '+' : ''}${delta}`);
    }
  } catch (err) {
    console.log('  MERGE THREW:', (err as Error).message);
  }

  // Can a half be finalized (proved + bound) on its own, ahead of time?
  try {
    const finalized = await wallet.facade.finalizeRecipe(giveRecipe);
    console.log('  finalizeRecipe on an UNBALANCED half: OK, serialized', finalized.serialize().length, 'bytes');
  } catch (err) {
    console.log('  finalizeRecipe on an UNBALANCED half THREW:', (err as Error).message);
  }

  await wallet.facade.revert(giveRecipe);
  await wallet.facade.revert(wantRecipe);
  console.log('  (reverted — nothing submitted)');
}

await probeMerge();

// ---------------------------------------------------------------------------
// PHASE 0c: is a genuinely TWO-ASSET swap expressible with what Preprod actually has?
//
// Preprod has exactly one token: native tNIGHT. tNIGHT/USDM cannot be settled here because USDM
// does not exist. But `Transaction.imbalances` keys balances by a TAGGED token type, so shielded
// and unshielded tNIGHT are separate entries in the balance vector — which, if the ledger treats
// them as genuinely separate, makes "give unshielded tNIGHT, want shielded tNIGHT" a real
// two-asset swap rather than a same-token no-op.
// ---------------------------------------------------------------------------
async function probeTwoAsset(): Promise<void> {
  console.log('\n--- probe 6: give unshielded NIGHT, want SHIELDED NIGHT ---');
  const state2 = await wallet.facade.waitForSyncedState();
  const shieldedAddress = state2.shielded.address;
  console.log('  shielded balances:', JSON.stringify(state2.shielded.balances, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  try {
    const recipe = await wallet.facade.initSwap(
      { shielded: {}, unshielded: { [NIGHT]: 1000n } } as any,
      [{ type: 'shielded', outputs: [{ type: NIGHT, receiverAddress: shieldedAddress, amount: 900n }] }] as any,
      wallet.secretKeys,
      { ttl, payFees: false },
    );
    for (const [token, delta] of recipe.transaction.imbalances(0, 0n)) {
      console.log(`  segment 0: ${JSON.stringify(token)} = ${delta > 0n ? '+' : ''}${delta}`);
    }
    await wallet.facade.revert(recipe);
    console.log('  (reverted — nothing submitted)');
  } catch (err) {
    console.log('  THREW:', (err as Error).message);
  }
}

await probeTwoAsset();

process.exit(0);
