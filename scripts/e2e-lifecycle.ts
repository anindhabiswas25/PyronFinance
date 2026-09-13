// Task A6: execute the bond-lifecycle circuits that had only ever run in simulation —
// topUpBond, releaseExpiredQuote, requestBondWithdrawal, withdrawBond — against a live chain.
//
// Two real waits sit inside this lifecycle, and neither is something to block a terminal on:
//   * releaseExpiredQuote needs chain time >= validUntil + PROOF_GRACE_PERIOD (3600 s);
//   * withdrawBond needs chain time >= withdrawRequested + BOND_WITHDRAW_DELAY (86400 s).
// So the script is RESUMABLE. Each invocation reads its state file AND the chain, performs whatever
// phase is due, verifies it by indexer read-back, and exits. Run it again later to advance.
//
//   phase "bonded"     postBond -> topUpBond -> commitQuote          (verify amount, liveQuotes 1)
//   phase "released"   releaseExpiredQuote -> requestBondWithdrawal  (verify resolved, active false)
//   phase "withdrawn"  withdrawBond                                  (verify bond gone, counters kept,
//                                                                     wallet tNIGHT up by exactly the bond)
//
// Exit codes: 0 = a phase completed or everything is done; 75 = next phase not due yet (prints when).
//
// State file: .wallet-state/lifecycle-<network>.json (git-ignored, 0600). It holds a TEST dealer secret
// key. The key is written BEFORE postBond is submitted — the same rule the Dealer Node's journal
// follows for nonces: a key lost after the bond lands is a bond nobody can ever withdraw.
//
// Env: LIFECYCLE_RESET=1 abandons an existing state file (it is renamed, never deleted).

import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadChainConfig, requireWalletSeed } from '../packages/sdk/src/config.js';
import { initNetworkId, createHeadlessWallet } from '../packages/sdk/src/wallet.js';
import { walletStateDir } from '../packages/sdk/src/wallet-state.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../packages/sdk/src/providers.js';
import { compiledOTCContract } from '../packages/sdk/src/contract.js';
import { schnorrPublicKey } from '../packages/sdk/src/schnorr.js';
import { dealerCommitment, deriveQuoteId } from '../packages/sdk/src/domain.js';
import { postBond, topUpBond, requestBondWithdrawal, withdrawBond } from '../packages/sdk/src/bonding.js';
import { sealQuote, commitQuote } from '../packages/sdk/src/quotes.js';
import { releaseExpiredQuote } from '../packages/sdk/src/fraud.js';
import { queryLatestContractState } from '../packages/sdk/src/indexer.js';
import { ledger as otcLedger } from '../contracts/managed/otc-protocol/contract/index.js';

const PROOF_GRACE_PERIOD = 3600;
const BOND_WITHDRAW_DELAY = 86400;
/** Chain time lags wall time by up to a block or two; don't submit a time-gated call at the edge. */
const EDGE_MARGIN_SECS = 120;
const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const POST_AMOUNT = 50n;
const TOPUP_AMOUNT = 25n;
const TERMS = { pair: 'tNIGHT/USDM', side: 'sell' as const, price: '0.0412', size: '0.001' }; // notional 1000 <= 75*20
const VALIDITY_SECS = 300;

interface LifecycleState {
  network: string;
  contractAddress: string;
  dealerSkHex: string;
  quoteSkHex: string;
  phase: 'keyed' | 'bonded' | 'released' | 'withdrawn';
  quoteIdHex?: string;
  validUntil?: number;
  withdrawRequested?: number;
  log: string[];
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const nowSecs = () => Math.floor(Date.now() / 1000);

const chain = loadChainConfig();
if (chain.network === 'mainnet') throw new Error('REFUSING: e2e-lifecycle posts and abandons test bonds');
initNetworkId(chain.network);

const deploymentFile = path.resolve(import.meta.dirname, `../deployments/${chain.network}.json`);
const { address: contractAddress } = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
// A lifecycle begun on a different deployment is moved aside below, NOT resumed: prover keys come from
// contracts/managed/, which always matches the CURRENT contract, so proofs for an older deployment's
// circuits fail once the contract is recompiled (learned 2026-09-14, the Class B removal).
const stateFile = path.join(walletStateDir(), `lifecycle-${chain.network}.json`);

function save(s: LifecycleState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const tmp = `${stateFile}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  fs.writeSync(fd, JSON.stringify(s, null, 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, stateFile);
}

function note(s: LifecycleState, msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log('  ' + msg);
  s.log.push(line);
  save(s);
}

let state: LifecycleState | undefined;
if (fs.existsSync(stateFile)) {
  const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as LifecycleState;
  if (process.env.LIFECYCLE_RESET === '1' || loaded.contractAddress !== contractAddress) {
    const aside = `${stateFile}.abandoned-${Date.now()}`;
    fs.renameSync(stateFile, aside);
    console.log(`previous lifecycle state moved aside to ${aside}`);
  } else {
    state = loaded;
  }
}
if (!state) {
  const quoteSk = BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(32)))) % JUBJUB_ORDER;
  state = {
    network: chain.network,
    contractAddress,
    dealerSkHex: hex(crypto.getRandomValues(new Uint8Array(32))),
    quoteSkHex: quoteSk.toString(16),
    phase: 'keyed',
    log: [],
  };
  save(state); // BEFORE any bond exists
}
const s = state;

const dealerSk = unhex(s.dealerSkHex);
const dealerCmt = dealerCommitment(dealerSk);
const quotePk = schnorrPublicKey(BigInt('0x' + s.quoteSkHex));
console.log(`contract ${contractAddress}; dealer ${hex(dealerCmt)}; phase ${s.phase}`);

async function chainView() {
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await queryLatestContractState(chain.indexerHttp, contractAddress);
      if (!raw) throw new Error('contract state not found');
      return otcLedger(raw.data);
    } catch (err) {
      if (attempt >= 8) throw err;
      console.log(`  indexer read failed (${(err as Error).message}); retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Decide what is due BEFORE paying for a wallet sync.
if (s.phase === 'released' && nowSecs() < s.withdrawRequested! + BOND_WITHDRAW_DELAY + EDGE_MARGIN_SECS) {
  const due = s.withdrawRequested! + BOND_WITHDRAW_DELAY + EDGE_MARGIN_SECS;
  console.log(`withdrawBond not due: timelock ends ${new Date(due * 1000).toISOString()} (${due - nowSecs()} s)`);
  process.exit(75);
}
if (s.phase === 'bonded' && nowSecs() < s.validUntil! + PROOF_GRACE_PERIOD + EDGE_MARGIN_SECS) {
  const due = s.validUntil! + PROOF_GRACE_PERIOD + EDGE_MARGIN_SECS;
  console.log(`releaseExpiredQuote not due: grace period ends ${new Date(due * 1000).toISOString()} (${due - nowSecs()} s)`);
  process.exit(75);
}
if (s.phase === 'withdrawn') {
  console.log('lifecycle complete:\n' + s.log.join('\n'));
  process.exit(0);
}

const wallet = await createHeadlessWallet(requireWalletSeed(), chain);
await wallet.waitForSync();
const providers = buildOTCProviders(chain, wallet);
const contract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiledOTCContract,
  privateStateId: OTC_PRIVATE_STATE_ID,
  initialPrivateState: { dealerSecretKey: dealerSk, takerAddress: unhex(wallet.unshieldedAddressHex) },
});

function fail(msg: string): never {
  note(s, `FAILED: ${msg}`);
  throw new Error(msg);
}

async function nightBalance(): Promise<bigint> {
  const st = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
  return (st.unshielded.balances[ledger.nativeToken().raw] ?? 0n) as bigint;
}

if (s.phase === 'keyed') {
  const existing = await chainView();
  if (!existing.bonds.member(dealerCmt)) {
    console.log('\n[bonded 1/3] postBond', POST_AMOUNT);
    await postBond(contract, POST_AMOUNT, quotePk);
    note(s, `postBond ${POST_AMOUNT} submitted`);
  }
  let l = await chainView();
  if (l.bonds.lookup(dealerCmt).amount === POST_AMOUNT) {
    console.log('\n[bonded 2/3] topUpBond', TOPUP_AMOUNT);
    await topUpBond(contract, TOPUP_AMOUNT);
  }
  l = await chainView();
  const amount = l.bonds.lookup(dealerCmt).amount;
  if (amount !== POST_AMOUNT + TOPUP_AMOUNT) fail(`bond.amount ${amount}, expected ${POST_AMOUNT + TOPUP_AMOUNT} after topUpBond`);
  note(s, `topUpBond VERIFIED on-chain: bond.amount ${amount}`);

  console.log('\n[bonded 3/3] commitQuote (left to expire unsettled)');
  const validUntil = BigInt(nowSecs() + VALIDITY_SECS);
  const sealed = sealQuote(TERMS, crypto.getRandomValues(new Uint8Array(32)), validUntil);
  const quoteId = deriveQuoteId(dealerCmt, sealed.rfqId, sealed.commitment);
  s.quoteIdHex = hex(quoteId);
  s.validUntil = Number(validUntil);
  save(s); // before submit
  await commitQuote(contract, sealed);
  l = await chainView();
  if (!l.quotes.member(quoteId)) fail('quote not on-chain after commitQuote');
  if (l.bonds.lookup(dealerCmt).liveQuotes !== 1n) fail(`liveQuotes ${l.bonds.lookup(dealerCmt).liveQuotes}, expected 1`);
  s.phase = 'bonded';
  note(s, `commitQuote VERIFIED: quote ${s.quoteIdHex}, validUntil ${s.validUntil}, liveQuotes 1`);

  // Negative case, cheap and informative: release must be refused while the grace period is open.
  // Local circuit execution should reject it before anything is proved or submitted.
  try {
    await releaseExpiredQuote(contract, quoteId);
    fail('releaseExpiredQuote was ACCEPTED inside the grace period');
  } catch (err) {
    const m = ((err as Error).message ?? String(err)).split('\n')[0].slice(0, 200);
    if (m.startsWith('releaseExpiredQuote was ACCEPTED')) throw err;
    note(s, `negative: releaseExpiredQuote inside grace period refused (${m})`);
  }
  const due = s.validUntil + PROOF_GRACE_PERIOD + EDGE_MARGIN_SECS;
  console.log(`\nphase "bonded" done. Rerun after ${new Date(due * 1000).toISOString()} to release.`);
  process.exit(0);
}

if (s.phase === 'bonded') {
  const quoteId = unhex(s.quoteIdHex!);
  let l = await chainView();
  if (!l.quotes.lookup(quoteId).resolved) {
    console.log('\n[released 1/2] releaseExpiredQuote');
    await releaseExpiredQuote(contract, quoteId);
  }
  l = await chainView();
  if (!l.quotes.lookup(quoteId).resolved) fail('quote not resolved after releaseExpiredQuote');
  if (l.bonds.lookup(dealerCmt).liveQuotes !== 0n) fail(`liveQuotes ${l.bonds.lookup(dealerCmt).liveQuotes} after release`);
  note(s, 'releaseExpiredQuote VERIFIED: quote resolved, liveQuotes 0');

  console.log('\n[released 2/2] requestBondWithdrawal');
  const requestedAt = BigInt(nowSecs() - 30); // inside TIME_SLACK, never in the chain's future
  if (l.bonds.lookup(dealerCmt).withdrawRequested === 0n) await requestBondWithdrawal(contract, requestedAt);
  l = await chainView();
  const b = l.bonds.lookup(dealerCmt);
  if (b.withdrawRequested === 0n || b.active) fail(`withdrawRequested ${b.withdrawRequested}, active ${b.active}`);
  s.withdrawRequested = Number(b.withdrawRequested);
  s.phase = 'released';
  note(s, `requestBondWithdrawal VERIFIED: withdrawRequested ${b.withdrawRequested}, active false`);
  const due = s.withdrawRequested + BOND_WITHDRAW_DELAY + EDGE_MARGIN_SECS;
  console.log(`\nphase "released" done. Rerun after ${new Date(due * 1000).toISOString()} to withdraw.`);
  process.exit(0);
}

if (s.phase === 'released') {
  let l = await chainView();
  const bondAmount = l.bonds.member(dealerCmt) ? l.bonds.lookup(dealerCmt).amount : 0n;
  if (l.bonds.member(dealerCmt)) {
    const before = await nightBalance();
    console.log(`\n[withdrawn 1/1] withdrawBond (${bondAmount}) -> own address; tNIGHT before ${before}`);
    await withdrawBond(contract, unhex(wallet.unshieldedAddressHex));
    l = await chainView();
    if (l.bonds.member(dealerCmt)) fail('bond still present after withdrawBond');
    // Fees are paid in DUST, so tNIGHT should rise by exactly the bond. Wait for the wallet to see it.
    const t0 = Date.now();
    let after = await nightBalance();
    while (after - before < bondAmount && Date.now() - t0 < 5 * 60_000) {
      await new Promise((r) => setTimeout(r, 5000));
      after = await nightBalance();
    }
    note(s, `withdrawBond: tNIGHT ${before} -> ${after} (delta ${after - before}, bond ${bondAmount})`);
    if (after - before !== bondAmount) fail(`tNIGHT delta ${after - before} != bond ${bondAmount}`);
  }
  const settled = l.settled.lookup(dealerCmt).read();
  const slashed = l.slashed.lookup(dealerCmt).read();
  s.phase = 'withdrawn';
  note(s, `withdrawBond VERIFIED: bond removed, counters persist (settled ${settled}, slashed ${slashed})`);
  process.exit(0);
}
