// Root-cause probe for `1010: Invalid Transaction: Custom error: 168` (docs/ROADMAP.md S5).
// Submits NOTHING unless PROBE_SUBMIT names a shape.
//
// WHAT 168 ACTUALLY IS — read from source, not inferred. Midnight Preview runs node 1.0.2
// (`system_version` → 1.0.2-eb71e64e), which pins midnight-ledger =8.1.2 — the same ledger this SDK
// uses. In that node, `ledger/src/versions/common/types.rs` maps
//
//     MalformedError::FeeCalculation => 168
//
// and `conversions.rs` maps every `MalformedTransaction::FeeCalculation(..)` onto it. The ledger
// raises that in `verify.rs` when `self.fees(params, /* enforce_time_to_dismiss */ true)` FAILS —
// before any balance check runs. An underpaid fee is a different code entirely
// (138, BalanceCheckOverspend). `FeeCalculationError` has exactly two cases (ledger `error.rs`):
//
//   BlockLimitExceeded    — the normalized cost exceeds the block limits
//   OutsideTimeToDismiss  — guaranteed application cost + validation cost (compute / parallelism)
//                           exceeds max(time_to_dismiss_per_byte * size, min_time_to_dismiss)
//
// Neither is affected by how much DUST is provisioned, which is why 1e16 did not help.
//
// WHY NOTHING LOCAL EVER CAUGHT IT. The dust wallet prices fees with `feesWithMargin`, which calls
// `cost(params, false)` — time-to-dismiss NOT enforced. offers.ts's second opinion called
// `tx.fees(LedgerParameters.initialParameters())`, also unenforced, and against static defaults whose
// per-operation costs are lower than the live chain's. So the wallet can build, and we could check, a
// transaction the node is guaranteed to reject.
//
// This probe runs the node's own check locally: `tx.fees(liveParams, true)`, with the live
// LedgerParameters read from the indexer (the same source the dust wallet syncs them from). If the
// local verdict matches the node's on every shape submitted, 168 is characterised and reproducible
// offline.
//
// Shapes:
//   one-asset   give 1000 tNIGHT, want nothing        — the shape ACCEPTED on Preprod
//   both-spend  give 1000 tNIGHT, want 2000 tNIGHT    — one token, but the taker must SPEND to
//                                                       balance: S5's structural difference, without
//                                                       needing a second asset
//   two-asset   give 1000 tNIGHT, want 41440 USDM     — only if the wallet holds the counter-asset
//
// Run:    pnpm run probe-fee-calc
// Submit: PROBE_SUBMIT=both-spend pnpm run probe-fee-calc

import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { usdmFor } from '../packages/sdk/src/assets.js';
import { balanceVectorOf, describeIntents, showVector } from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
initNetworkId(chain.network);

const NIGHT = ledger.nativeToken().raw;
const SUBMIT = process.env.PROBE_SUBMIT;

async function liveLedgerParameters(): Promise<{ height: number; params: ledger.LedgerParameters }> {
  // Preprod's hosted indexer times out on connect often enough to kill a run outright (ROADMAP
  // "Reliability"), so retry rather than fail the whole probe on one bad handshake.
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchLedgerParameters();
    } catch (err) {
      if (attempt >= 8) throw err;
      console.log(`  indexer attempt ${attempt} failed (${(err as Error).message}); retrying`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function fetchLedgerParameters(): Promise<{ height: number; params: ledger.LedgerParameters }> {
  const res = await fetch(chain.indexerHttp, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ block { height ledgerParameters } }' }),
  });
  const body = (await res.json()) as { data?: { block?: { height: number; ledgerParameters: string } } };
  const block = body.data?.block;
  if (!block) throw new Error(`indexer returned no block: ${JSON.stringify(body)}`);
  return {
    height: block.height,
    params: ledger.LedgerParameters.deserialize(Buffer.from(block.ledgerParameters.replace(/^0x/, ''), 'hex')),
  };
}

type AnyTx = ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>;

interface Verdict {
  passes: boolean;
  detail: string;
}

/** The node's check, run locally. */
function nodeFeeCheck(tx: AnyTx, params: ledger.LedgerParameters): Verdict {
  try {
    return { passes: true, detail: `fees(params, enforceTimeToDismiss=true) = ${tx.fees(params, true)} SPECK` };
  } catch (err) {
    return { passes: false, detail: (err as Error).message ?? String(err) };
  }
}

function report(label: string, tx: AnyTx, live: ledger.LedgerParameters): Verdict {
  const size = tx.serialize().length;
  const c = tx.cost(live, false);
  const verdict = nodeFeeCheck(tx, live);
  const initialVerdict = nodeFeeCheck(tx, ledger.LedgerParameters.initialParameters());
  // Allowance per ledger 8.1.2 structure.rs `cost()`, with the live limits (2 µs/byte, 15 ms floor
  // on both Preview and Preprod as of 2026-09-13). Informational; the verdict above is authoritative.
  const allowancePs = BigInt(Math.max(size * 2_000_000, 15_000_000_000));
  console.log(`\n  [${label}] ${size} bytes; ${describeIntents(tx)}`);
  console.log(`    vector ${showVector(balanceVectorOf(tx))}`);
  console.log(
    `    cost(live, unenforced): compute ${fmtPs(c.computeTime)}, read ${fmtPs(c.readTime)}, ` +
      `block ${c.blockUsage} B; size-derived dismiss allowance ≈ ${fmtPs(allowancePs)}`,
  );
  console.log(`    NODE CHECK (live params):    ${verdict.passes ? 'PASS' : 'FAIL'} — ${verdict.detail}`);
  console.log(`    same check, initialParams:   ${initialVerdict.passes ? 'PASS' : 'FAIL'} — ${initialVerdict.detail}`);
  return verdict;
}

function fmtPs(ps: bigint): string {
  return `${(Number(ps) / 1e9).toFixed(3)} ms`;
}

const { height, params: live } = await liveLedgerParameters();
console.log(`network ${chain.network}; live LedgerParameters from indexer at height ${height}`);

// Both knobs change the transaction's SHAPE, which is what the time-to-dismiss check prices:
//   MN_ADDITIONAL_FEE_OVERHEAD  how much DUST is provisioned → how many DUST coins get spent
//   PROBE_GIVE_UNITS            trade size → how many unshielded UTXOs coin selection pulls in
const overheadEnv = process.env.MN_ADDITIONAL_FEE_OVERHEAD;
const GIVE_UNITS = BigInt(process.env.PROBE_GIVE_UNITS ?? '1000');
// Counter-asset leg at the docs' 41.44 price; must be a whole number of base units.
if ((GIVE_UNITS * 41_440n) % 1000n !== 0n) throw new Error('PROBE_GIVE_UNITS * 41.44 is not a whole number');
const WANT_COUNTER = (GIVE_UNITS * 41_440n) / 1000n;

const wallet = await createHeadlessWallet(requireWalletSeed(), chain, {
  additionalFeeOverhead: overheadEnv ? BigInt(overheadEnv) : undefined,
});
console.log(`additionalFeeOverhead ${overheadEnv ?? '(default)'}; give ${GIVE_UNITS} tNIGHT base units`);
console.log('syncing...');
await wallet.waitForSync();

const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));
const ttl = new Date(Date.now() + 3600_000);

// Counter-asset for the two-asset shape: real USDM where it exists, else the minted stand-in.
let counter: string | undefined = usdmFor(chain.network)?.tokenType;
if (!counter) {
  const tokenFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-token.json`);
  if (fs.existsSync(tokenFile)) counter = JSON.parse(fs.readFileSync(tokenFile, 'utf-8')).tokenType;
}
const state = await wallet.facade.waitForSyncedState();
const balances = state.unshielded.balances as Record<string, bigint>;
const counterBalance = counter ? (balances[counter] ?? 0n) : 0n;
console.log(
  `unshielded UTXOs: ${state.unshielded.availableCoins.length}; tNIGHT ${balances[NIGHT] ?? 0n}; ` +
    `counter-asset ${counter ?? '(none)'} balance ${counterBalance}; DUST ${state.dust.balance(new Date())}; ` +
    `DUST coins ${state.dust.availableCoins.length}`,
);
for (const c of state.unshielded.availableCoins) {
  console.log(`  utxo ${c.utxo.type.slice(0, 8)}… value ${c.utxo.value}`);
}
// With one wallet in both roles, the dealer half BOOKS the UTXOs it selects, so the taker can only
// spend a token the dealer half left untouched. A wallet holding a single tNIGHT UTXO therefore
// cannot build `both-spend` at all (Wallet.InsufficientFunds) — that is a limit of this probe's
// one-wallet setup, not a finding about the ledger.
const only = process.env.PROBE_SHAPES?.split(',');

interface Shape {
  name: string;
  giveNight: bigint;
  want?: { token: string; amount: bigint };
}
const shapes: Shape[] = [
  { name: 'one-asset', giveNight: GIVE_UNITS },
  { name: 'both-spend', giveNight: GIVE_UNITS, want: { token: NIGHT, amount: GIVE_UNITS * 2n } },
];
if (counter && counterBalance >= WANT_COUNTER) {
  shapes.push({ name: 'two-asset', giveNight: GIVE_UNITS, want: { token: counter, amount: WANT_COUNTER } });
} else {
  console.log(`two-asset shape SKIPPED: wallet holds < ${WANT_COUNTER} of the counter-asset`);
}

for (const shape of shapes) {
  if (only && !only.includes(shape.name)) continue;
  console.log(`\n=== ${shape.name} ===`);
  try {
    await runShape(shape);
  } catch (err) {
    // One shape failing to BUILD must not hide the others' verdicts.
    console.log(`  shape could not be built: ${((err as Error).message ?? String(err)).split('\n')[0]}`);
  }
}

console.log('\n(done; unsubmitted recipes reverted)');
process.exit(0);

async function runShape(shape: Shape): Promise<void> {
  const dealerRecipe = await wallet.facade.initSwap(
    { shielded: {}, unshielded: { [NIGHT]: shape.giveNight } } as never,
    (shape.want
      ? [{ type: 'unshielded', outputs: [{ type: shape.want.token, receiverAddress: self, amount: shape.want.amount }] }]
      : []) as never,
    wallet.secretKeys,
    { ttl, payFees: false },
  );
  const dealerHalf = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(dealerRecipe, wallet.signFn));
  report('dealer half', dealerHalf, live);

  const takerRecipe = await wallet.facade.balanceFinalizedTransaction(dealerHalf, wallet.secretKeys, { ttl });
  const merged = await wallet.facade.finalizeRecipe(await wallet.facade.signRecipe(takerRecipe, wallet.signFn));
  const verdict = report('merged settlement', merged, live);

  if (SUBMIT === shape.name) {
    console.log(`\n  SUBMITTING ${shape.name} (local verdict: ${verdict.passes ? 'PASS' : 'FAIL'})...`);
    try {
      const txId = await wallet.facade.submitTransaction(merged);
      console.log(`  node ACCEPTED: ${txId}`);
      console.log(`  local verdict ${verdict.passes ? 'AGREES' : 'DISAGREES'} with the node`);
    } catch (err) {
      // The facade wraps the node's reason in an Effect failure whose top-level message is just
      // "Transaction submission error"; the `1010 ... Custom error: N` text sits in nested fields
      // that are neither `.message` nor a plain `.cause` chain. Inspect the whole object.
      const dump = inspect(err, { depth: 12, maxStringLength: 20_000 });
      const code = dump.match(/Custom error:?\s*(\d+)/)?.[1] ?? '(no Custom error code found)';
      const first = ((err as Error).message ?? String(err)).split('\n')[0].slice(0, 200);
      console.log(`  node REJECTED: ${first} — Custom error ${code}`);
      if (code.startsWith('(')) console.log(dump.slice(0, 4000));
      console.log(`  local verdict ${verdict.passes ? 'DISAGREES' : 'AGREES'} with the node`);
    }
  } else {
    await wallet.facade.revert(takerRecipe).catch(() => undefined);
    await wallet.facade.revert(dealerRecipe).catch(() => undefined);
  }
}

console.log('\n(done; unsubmitted recipes reverted)');
process.exit(0);
