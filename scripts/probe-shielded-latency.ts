// M2 task 2.8: what does proving a SHIELDED offer cost, and what does a warm pool of them cost?
//
// Every latency number recorded before this script came from UNSHIELDED offers, which are
// signature-authorized and carry no ZK proof — hence "build + prove" in 7–16 ms, a figure that says
// nothing about the warm pool's premise. This script gets a real shielded balance (by minting one
// from contracts/src/TestShieldedToken.compact, testnet scaffolding) and times real proofs.
//
// Measured, per offer:  initSwap (coin selection + build) | signRecipe | finalizeRecipe (PROVE + bind)
//   1. an UNSHIELDED baseline offer, same run, same machine
//   2. a cold first SHIELDED offer
//   3. N sequential shielded offers, each reverted (steady-state proving latency)
//   4. K concurrent shielded offers, each on a distinct coin (what a warm pool refill looks like)
//
// Nothing here is submitted except the deploy and the mints. Offers are reverted, releasing coins.
//
// Env: PROBE_SEQ (default 5), PROBE_CONCURRENT (default 3; also how many coins are minted).
// REFUSES MAINNET.

import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { buildTestShieldedTokenProviders } from '../packages/sdk/src/providers.js';
import {
  compiledTestShieldedTokenContract,
  TEST_SHIELDED_TOKEN_PRIVATE_STATE_ID,
  testShieldedTokenType,
} from '../packages/sdk/src/test-shielded-token.js';
import { pollForContractState } from '../packages/sdk/src/indexer.js';
import { balanceVectorOf, describeIntents, showVector } from '../packages/sdk/src/offers.js';

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: TestShieldedToken is testnet scaffolding');
initNetworkId(chain.network);

const SEQ = Number(process.env.PROBE_SEQ ?? '5');
const CONCURRENT = Number(process.env.PROBE_CONCURRENT ?? '3');
const COIN_VALUE = 1_000_000n; // each minted shielded coin
const GIVE = 1000n; // shielded units the offer spends
const WANT_NIGHT = 400n; // unshielded tNIGHT it asks for
const NIGHT = ledger.nativeToken().raw;

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
console.log('syncing...');
await wallet.waitForSync();
const providers = buildTestShieldedTokenProviders(chain, wallet);

// ── Deploy (or reuse) the shielded test token ─────────────────────────────────────────────────
const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}-test-shielded-token.json`);
let contractAddress: string;
if (fs.existsSync(deploymentFile)) {
  contractAddress = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8')).address;
  console.log('reusing TestShieldedToken at', contractAddress);
} else {
  console.log('deploying TestShieldedToken...');
  // `as any`: the dual-module ZKIR brand hazard documented in scripts/deploy.ts.
  const deployed = await deployContract(providers as any, {
    compiledContract: compiledTestShieldedTokenContract,
    privateStateId: TEST_SHIELDED_TOKEN_PRIVATE_STATE_ID,
    initialPrivateState: {},
  } as any);
  contractAddress = deployed.deployTxData.public.contractAddress;
  if (!(await pollForContractState(chain.indexerHttp, contractAddress))) {
    throw new Error('TestShieldedToken not visible on the indexer after deploy');
  }
  const tokenType = testShieldedTokenType(contractAddress);
  fs.writeFileSync(
    deploymentFile,
    JSON.stringify({ network: chain.network, address: contractAddress, tokenType, deployedAt: Date.now() }, null, 2) + '\n',
  );
  console.log('deployed at', contractAddress);
}
const SHIELDED = testShieldedTokenType(contractAddress);
console.log('shielded token type:', SHIELDED);

// ── Ensure CONCURRENT distinct shielded coins exist ───────────────────────────────────────────
async function shieldedCoins(): Promise<bigint[]> {
  const s = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
  return s.shielded.availableCoins.filter((c) => c.coin.type === SHIELDED).map((c) => c.coin.value);
}

let coins = await shieldedCoins();
console.log(`shielded coins of this type held: ${coins.length}`);
if (coins.length < CONCURRENT) {
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledTestShieldedTokenContract,
    privateStateId: TEST_SHIELDED_TOKEN_PRIVATE_STATE_ID,
    initialPrivateState: {},
  } as any);
  const state = await wallet.facade.waitForSyncedState();
  const coinPk = Buffer.from(state.shielded.coinPublicKey.toHexString(), 'hex');
  for (let i = coins.length; i < CONCURRENT; i++) {
    const t0 = Date.now();
    // Distinct nonce per mint, or two coins would share a commitment.
    await (contract as any).callTx.mint(COIN_VALUE, crypto.getRandomValues(new Uint8Array(32)), { bytes: new Uint8Array(coinPk) });
    console.log(`  minted shielded coin ${i + 1}/${CONCURRENT} in ${Date.now() - t0} ms`);
  }
  const t0 = Date.now();
  while ((coins = await shieldedCoins()).length < CONCURRENT) {
    if (Date.now() - t0 > 10 * 60_000) throw new Error(`wallet still sees ${coins.length} shielded coins after 10 min`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`  wallet sees ${coins.length} shielded coins after ${Date.now() - t0} ms`);
}

// ── Timing harness ────────────────────────────────────────────────────────────────────────────
const self = new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));

interface Timing {
  label: string;
  initSwapMs: number;
  signMs: number;
  proveMs: number;
  totalMs: number;
  bytes: number;
}

async function timeOffer(label: string, kind: 'shielded' | 'unshielded'): Promise<{ timing: Timing; revert: () => Promise<void> }> {
  const token = kind === 'shielded' ? SHIELDED : NIGHT;
  const give = kind === 'shielded' ? GIVE : WANT_NIGHT; // baseline gives tNIGHT
  const inputs = { shielded: {} as Record<string, bigint>, unshielded: {} as Record<string, bigint> };
  inputs[kind][token] = give;
  const outputs = kind === 'shielded'
    ? [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: self, amount: WANT_NIGHT }] }]
    : [];
  const ttl = new Date(Date.now() + 3600_000);

  const t0 = performance.now();
  const recipe = await wallet.facade.initSwap(inputs as never, outputs as never, wallet.secretKeys, { ttl, payFees: false });
  const t1 = performance.now();
  const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
  const t2 = performance.now();
  const finalized = await wallet.facade.finalizeRecipe(signed);
  const t3 = performance.now();

  const timing: Timing = {
    label,
    initSwapMs: t1 - t0,
    signMs: t2 - t1,
    proveMs: t3 - t2,
    totalMs: t3 - t0,
    bytes: finalized.serialize().length,
  };
  console.log(
    `  ${label}: initSwap ${timing.initSwapMs.toFixed(0)} ms | sign ${timing.signMs.toFixed(0)} ms | ` +
      `prove+bind ${timing.proveMs.toFixed(0)} ms | TOTAL ${timing.totalMs.toFixed(0)} ms | ${timing.bytes} B`,
  );
  if (label.endsWith('#1')) {
    console.log(`    vector ${showVector(balanceVectorOf(finalized))}; ${describeIntents(finalized)}`);
    const zswap = finalized.intents?.get(1)?.guaranteedUnshieldedOffer;
    void zswap;
    console.log(`    shielded zswap offer present: ${finalized.guaranteedOffer !== undefined || (finalized.fallibleOffer?.size ?? 0) > 0}`);
  }
  return { timing, revert: () => wallet.facade.revert(recipe).catch(() => undefined) };
}

function stats(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return `min ${s[0].toFixed(0)} / median ${s[Math.floor(s.length / 2)].toFixed(0)} / mean ${mean.toFixed(0)} / max ${s[s.length - 1].toFixed(0)} ms (n=${s.length})`;
}

console.log('\n[1] unshielded baseline');
const base = await timeOffer('unshielded #1', 'unshielded');
await base.revert();

console.log('\n[2] cold first shielded offer');
const cold = await timeOffer('shielded cold #1', 'shielded');
await cold.revert();

console.log(`\n[3] ${SEQ} sequential shielded offers (each reverted)`);
const seq: Timing[] = [];
for (let i = 0; i < SEQ; i++) {
  const r = await timeOffer(`shielded seq #${i + 2}`, 'shielded');
  seq.push(r.timing);
  await r.revert();
}

console.log(`\n[4] ${CONCURRENT} concurrent shielded offers — a warm-pool refill, each holding a distinct coin`);
const wallStart = performance.now();
const concurrent = await Promise.allSettled(
  Array.from({ length: CONCURRENT }, (_, i) => timeOffer(`shielded concurrent ${i + 1}/${CONCURRENT}`, 'shielded')),
);
const wallMs = performance.now() - wallStart;
const okConcurrent = concurrent.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof timeOffer>>> => r.status === 'fulfilled');
for (const r of concurrent) if (r.status === 'rejected') console.log(`  concurrent offer FAILED: ${(r.reason as Error).message}`);
for (const r of okConcurrent) await r.value.revert();

console.log('\n--- summary (task 2.8) ---');
console.log(`unshielded baseline total: ${base.timing.totalMs.toFixed(0)} ms (prove+bind ${base.timing.proveMs.toFixed(0)} ms)`);
console.log(`shielded cold total:       ${cold.timing.totalMs.toFixed(0)} ms (prove+bind ${cold.timing.proveMs.toFixed(0)} ms)`);
console.log(`shielded sequential total: ${stats(seq.map((t) => t.totalMs))}`);
console.log(`shielded sequential prove: ${stats(seq.map((t) => t.proveMs))}`);
console.log(
  `concurrent x${CONCURRENT}: wall ${wallMs.toFixed(0)} ms for ${okConcurrent.length} offers ` +
    `(${okConcurrent.length ? (wallMs / okConcurrent.length).toFixed(0) : 'n/a'} ms/offer effective)`,
);
console.log('proof server:', chain.proofServer);
process.exit(0);
