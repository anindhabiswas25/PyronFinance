#!/usr/bin/env node
// Dealer Node entrypoint — DEALER-NODE.md §8.
//
//   gen-key  [--config dealer.toml]            write the 0600 dealer key named by [identity]
//   bond     --amount <tNIGHT> [--config ...]  post (or top up) the bond for this dealer key
//   status   [--config ...]                    print dealer commitment, bond, journal summary
//   start    [--config ...]                    run the node unattended
//
// Secrets: the dealer key file (0600) and MN_WALLET_SEED / wallet_seed_path. MN_PRIVATE_STATE_PASSWORD
// encrypts the local private-state cache. Nothing secret is ever read from the TOML.

import fs from 'node:fs';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadConfig, type DealerConfig, type QuotePolicy } from './config.js';
import { generateSecretFile, loadSecretFile, loadWalletSeed, type DealerIdentity } from './identity.js';
import { QuoteJournal, recover } from './journal.js';
import { WarmPool, type PairTokens } from './pool.js';
import { QuotingEngine } from './quoting.js';
import { LiveRelays, UnshieldedActivity, liveBuilder, liveChain, liveInventory, midSource } from './live.js';
import { initNetworkId, createHeadlessWallet, type HeadlessWallet } from '../../sdk/src/wallet.js';
import { buildOTCProviders, OTC_PRIVATE_STATE_ID } from '../../sdk/src/providers.js';
import { compiledOTCContract } from '../../sdk/src/contract.js';
import { postBond, topUpBond, maxNotionalForBond } from '../../sdk/src/bonding.js';
import { indexerChainReader } from '../../sdk/src/relay-client.js';
import { usdmFor } from '../../sdk/src/assets.js';
import { listCoins, consolidateSmallest, registerNewNight } from '../../sdk/src/inventory.js';
import { queryLedgerParameters } from '../../sdk/src/indexer.js';
import type { ChainConfig } from '../../sdk/src/config.js';

const NIGHT = ledger.nativeToken().raw;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

/** Preprod's indexer times out on connect intermittently; the first live `bond` died on a bare
 *  "fetch failed" right after wallet sync. Every indexer read in the CLI goes through this. */
async function retry<T>(what: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw new Error(`${what} failed after ${attempts} attempts: ${(err as Error).message}`);
      log(`[retry] ${what}: ${(err as Error).message} (attempt ${i})`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function chainConfigOf(cfg: DealerConfig): ChainConfig {
  if (cfg.network.proofServers.length > 1) {
    log(`[config] ${cfg.network.proofServers.length} proof servers configured; the wallet proves through the first only (multi-server fan-out is not wired yet)`);
  }
  return {
    network: cfg.network.network,
    indexerHttp: cfg.network.indexer,
    indexerWs: cfg.network.indexerWs,
    rpc: cfg.network.rpc,
    proofServer: cfg.network.proofServers[0],
    contractAddress: cfg.network.contract,
  };
}

function tokensFor(cfg: DealerConfig, policy: QuotePolicy): PairTokens {
  const [base, quote] = policy.pair.split('/');
  if (base !== 'tNIGHT') throw new Error(`pair ${policy.pair}: only tNIGHT-based pairs can be bonded (CONTRACTS.md §7)`);
  const usdm = quote === 'USDM' ? usdmFor(cfg.network.network) : undefined;
  const counter = policy.counterToken ?? usdm?.tokenType;
  if (!counter) throw new Error(`pair ${policy.pair}: set counter_token (no known ${quote} on ${cfg.network.network})`);
  return { base: { kind: 'unshielded', token: NIGHT }, counter: { kind: 'unshielded', token: counter } };
}

async function openWalletAndContract(cfg: DealerConfig, identity: DealerIdentity) {
  const chain = chainConfigOf(cfg);
  initNetworkId(chain.network);
  const wallet = await createHeadlessWallet(loadWalletSeed(cfg.identity.walletSeedPath), chain);
  log(`[wallet] ${wallet.unshieldedAddress} — syncing`);
  await wallet.waitForSync();
  const providers = buildOTCProviders(chain, wallet);
  const contract = await findDeployedContract(providers, {
    contractAddress: cfg.network.contract,
    compiledContract: compiledOTCContract,
    privateStateId: OTC_PRIVATE_STATE_ID,
    // takerAddress doubles as the prover-bounty payout if this node ever submits a fraud proof.
    initialPrivateState: { dealerSecretKey: identity.dealerSk, takerAddress: Buffer.from(wallet.unshieldedAddressHex, 'hex') },
  });
  return { chain, wallet, contract };
}

async function cmdGenKey(cfg: DealerConfig): Promise<void> {
  const id = generateSecretFile(cfg.identity.secretKeyPath);
  log(`wrote ${cfg.identity.secretKeyPath} (0600)`);
  log(`dealer commitment: ${hex(id.dealerCmt)} — your entire public identity`);
}

async function cmdBond(cfg: DealerConfig): Promise<void> {
  const amountStr = arg('amount');
  if (!amountStr || !/^\d+$/.test(amountStr)) throw new Error('bond --amount <base units of tNIGHT> is required');
  const amount = BigInt(amountStr);
  const identity = loadSecretFile(cfg.identity.secretKeyPath);
  const { contract } = await openWalletAndContract(cfg, identity);
  const reader = indexerChainReader(cfg.network.indexer, cfg.network.contract, 0);
  const before = await retry('bond read', () => reader.dealer(identity.dealerCmt));
  if (before.bond) {
    log(`[bond] existing bond ${before.bond.amount}; topping up by ${amount}`);
    await topUpBond(contract, amount);
  } else {
    log(`[bond] posting ${amount}`);
    await postBond(contract, amount, identity.quotePk);
  }
  const after = await retry('bond read-back', () => reader.dealer(identity.dealerCmt));
  log(`[bond] on-chain: amount ${after.bond?.amount}, active ${after.bond?.active}; may back quotes up to ${maxNotionalForBond(after.bond?.amount ?? 0n)} notional`);
  process.exit(0);
}

async function cmdStatus(cfg: DealerConfig): Promise<void> {
  const identity = loadSecretFile(cfg.identity.secretKeyPath);
  const reader = indexerChainReader(cfg.network.indexer, cfg.network.contract, 0);
  const d = await retry('dealer read', () => reader.dealer(identity.dealerCmt));
  log(`dealer ${hex(identity.dealerCmt)}: bond ${d.bond?.amount ?? 'none'} active ${d.bond?.active ?? '-'} settled ${d.settled} slashed ${d.slashed}`);
  if (fs.existsSync(cfg.journalPath)) {
    const j = QuoteJournal.open(cfg.journalPath);
    const counts = new Map<string, number>();
    for (const q of j.all()) counts.set(q.state, (counts.get(q.state) ?? 0) + 1);
    log(`journal: ${[...counts].map(([s, n]) => `${s} ${n}`).join(', ') || 'empty'}`);
    j.close();
  }
  process.exit(0);
}

async function cmdStart(cfg: DealerConfig): Promise<void> {
  const identity = loadSecretFile(cfg.identity.secretKeyPath);
  log(`[start] dealer ${hex(identity.dealerCmt)} on ${cfg.network.network}, contract ${cfg.network.contract}`);
  if (!cfg.relays.useMailbox) throw new Error('only relay-mailbox reveals are implemented; set use_mailbox = true');
  if (cfg.policies.length !== 1) throw new Error('this build runs exactly one [[quote_policy]]');
  const policy = cfg.policies[0];
  const tokens = tokensFor(cfg, policy);
  const { wallet, contract } = await openWalletAndContract(cfg, identity);

  const activity = new UnshieldedActivity(cfg.network.indexerWs, wallet.unshieldedAddress, log);
  activity.start();
  const chain = liveChain({
    contract,
    indexerHttp: cfg.network.indexer,
    contractAddress: cfg.network.contract,
    dealerCmt: identity.dealerCmt,
    dealerAddress: wallet.unshieldedAddress,
    tokens,
    activity,
  });

  const journal = QuoteJournal.open(cfg.journalPath);
  const pool = new WarmPool({
    policy,
    tokens,
    builder: liveBuilder(wallet, cfg.network.indexer, cfg.pool.maxOfferInputs),
    inventory: liveInventory(wallet),
    mid: midSource(policy),
    reserve: { [NIGHT]: cfg.reserve.minUtxoValue * BigInt(cfg.reserve.minUtxos) },
    onEvent: (e) => log(`[pool] ${e.kind} ${e.key}${e.detail ? ` — ${e.detail}` : ''}`),
  });

  let engine: QuotingEngine;
  const relays = new LiveRelays(
    cfg.relays.endpoints,
    (rfq) => {
      engine.handleRfq(rfq).catch((err) => log(`[quote] rfq ${rfq.rfqId.slice(0, 12)}… failed: ${(err as Error).message}`));
    },
    log,
  );
  engine = new QuotingEngine({
    config: cfg,
    policy,
    identity,
    journal,
    pool,
    chain,
    relay: relays,
    dealerEndpoint: relays.mailboxBase,
    revealVia: 'mailbox',
    onEvent: (e) => log(`[quote] ${JSON.stringify(e)}`),
  });

  // Give the activity subscription time to replay history before recovery asks what happened to offers.
  await new Promise((r) => setTimeout(r, 15_000));
  const { actions, hostageInputs } = await recover(journal, chain);
  log(`[recover] ${actions.length} action(s); ${hostageInputs.length} hostage input(s): ${actions.map((a) => `${a.action}:${a.quoteId.slice(0, 8)}`).join(' ')}`);
  await engine.resume(actions);

  relays.connect();

  let busy = false;
  let stopping = false;
  async function keeper(): Promise<void> {
    if (busy || stopping) return;
    busy = true;
    try {
      await engine.watch();
      await consolidateIfNeeded(wallet, cfg, tokens, pool, engine, hostageInputs);
      await pool.tick();
      log(`[tick] pool ${pool.size} warm; live quotes ${journal.live().length}; relays ${relays.connectedCount()}/${cfg.relays.endpoints.length}`);
    } catch (err) {
      log(`[tick] error: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }
  await keeper();
  const tickTimer = setInterval(keeper, 60_000);
  const watchTimer = setInterval(() => {
    if (!busy) engine.watch().catch((err) => log(`[watch] ${(err as Error).message}`));
  }, 15_000);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      stopping = true;
      log(`[stop] ${sig}: halting quoting; the journal keeps every live quote for the next start`);
      clearInterval(tickTimer);
      clearInterval(watchTimer);
      relays.close();
      activity.close();
      await pool.halt('shutdown');
      await wallet.saveState();
      journal.close();
      process.exit(0);
    });
  }
}

/** Consolidation keeper (DEALER-NODE.md §5.3). Runs between pool ticks, never while a build is in
 *  progress, and never touches coins that live offers or restarted quotes still depend on. */
async function consolidateIfNeeded(
  wallet: HeadlessWallet,
  cfg: DealerConfig,
  tokens: PairTokens,
  pool: WarmPool,
  engine: QuotingEngine,
  hostage: string[],
): Promise<void> {
  const exclude = new Set([...hostage, ...engine.bookedInputs(), ...pool.list().flatMap((e) => e.offer.inputs)]);
  for (const token of [tokens.base.token, tokens.counter.token]) {
    const coins = (await listCoins(wallet, token)).filter((c) => !exclude.has(c.ref));
    if (coins.length <= cfg.pool.consolidateAbove) continue;
    const { params } = await retry('ledger parameters', () => queryLedgerParameters(cfg.network.indexer));
    const out = await consolidateSmallest(wallet, token, 3, params, { exclude });
    log(`[consolidate] ${token.slice(0, 8)}…: ${coins.length} coins; merged ${out?.inputs ?? 0} -> ${out?.outputs ?? 0} (${out?.txId ?? 'skipped'})`);
    if (out && token === NIGHT) await registerNewNight(wallet).catch((err) => log(`[consolidate] DUST re-registration failed: ${(err as Error).message}`));
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const cfgPath = path.resolve(arg('config') ?? 'dealer.toml');
  const cfg = loadConfig(cfgPath);
  switch (command) {
    case 'gen-key':
      return cmdGenKey(cfg);
    case 'bond':
      return cmdBond(cfg);
    case 'status':
      return cmdStatus(cfg);
    case 'start':
      return cmdStart(cfg);
    default:
      console.error('usage: otc-dealer-node <gen-key|bond|status|start> [--config dealer.toml] [--amount N]');
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} FATAL ${(err as Error).stack ?? err}`);
  process.exit(1);
});
