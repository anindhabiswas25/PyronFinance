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
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { loadConfig, configWarnings, type DealerConfig, type QuotePolicy } from './config.js';
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
import { listCoins, consolidateSmallest, splitExact, registerNewNight } from '../../sdk/src/inventory.js';
import { planInventory } from './inventory-plan.js';
import { counterAmountFor } from '../../sdk/src/terms.js';
import { quotePrice, toFixed, fromFixed } from './pool.js';
import { queryLedgerParameters } from '../../sdk/src/indexer.js';
import { deserializeOffer } from '../../sdk/src/offers.js';
import { TERMINAL } from './journal.js';
import { requirePrivateStatePassword, type ChainConfig } from '../../sdk/src/config.js';

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
  requirePrivateStatePassword(); // before the sync, not after it
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
  for (const w of configWarnings(cfg)) log(`[config] WARNING ${w}`);
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
  await unbookDeadOffers(wallet, journal);
  await engine.resume(actions);

  relays.connect();

  let busy = false;
  let stopping = false;
  async function keeper(): Promise<void> {
    if (busy || stopping) return;
    busy = true;
    try {
      await engine.watch();
      await shapeInventory(wallet, cfg, policy, tokens, pool, engine, hostageInputs);
      await pool.tick();
      for (const id of await engine.retryDeferred()) log(`[quote] deferred RFQ answered: ${id.slice(0, 12)}…`);
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

/** A wallet snapshot KEEPS booked coins across restarts (DEALER-NODE.md §3.1, corrected 2026-09-14):
 *  building an offer moves its inputs to `pendingUtxos`, the snapshot serialises that set, and sync only
 *  clears a coin once it is spent. An offer that can no longer settle therefore leaks its coins forever
 *  unless reverted. The journal holds every offer's bytes, and `revertTransaction` needs nothing else:
 *  it rolls back the transaction's own inputs. Live offers are left booked. */
async function unbookDeadOffers(wallet: HeadlessWallet, journal: QuoteJournal): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  for (const rec of journal.all()) {
    const dead = TERMINAL.has(rec.state) || rec.state === 'expired' ? now >= rec.offerExpiresAt || rec.state === 'abandoned' : false;
    if (!dead || rec.state === 'recorded') continue; // a recorded settlement spent its inputs already
    try {
      await wallet.facade.revertTransaction(deserializeOffer(rec.offerFile));
      n++;
    } catch (err) {
      log(`[unbook] ${rec.quoteId.slice(0, 8)}: ${(err as Error).message}`);
    }
  }
  if (n) {
    log(`[unbook] released coins booked by ${n} dead offer(s)`);
    await wallet.saveState();
  }
}

/** Inventory keeper (DEALER-NODE.md §5.3). Runs between pool ticks, never while a build is in progress,
 *  and never touches coins that live offers or restarted quotes still depend on. Asks `planInventory` for
 *  one action per token per tick — merge dust (smallest-first selection sweeps it into halves) or split a
 *  large coin into rung-sized pieces (each offer books a WHOLE coin, so N concurrent quotes need N coins;
 *  M3 run #2 starved on two). */
async function shapeInventory(
  wallet: HeadlessWallet,
  cfg: DealerConfig,
  policy: QuotePolicy,
  tokens: PairTokens,
  pool: WarmPool,
  engine: QuotingEngine,
  hostage: string[],
): Promise<void> {
  // DUST guard. Every keeper transaction books a whole DUST coin for its fee until it confirms. Found live
  // (M3 run #3): back-to-back keeper splits left no free DUST coin, a split failed "could not balance dust",
  // and the next commitQuote failed — the keeper cost a quote. So: keep at least 2 DUST coins free for the
  // node's own commit/record/release transactions, and submit at most ONE keeper transaction per tick.
  const owed = engine.owedTransactions();
  if (owed.length > 0) {
    log(`[inventory] skipped: ${owed.length} settlement record(s) / release(s) owed first (${owed.map((id) => id.slice(0, 8)).join(', ')})`);
    return;
  }
  const dustState = await Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((x) => x.isSynced)));
  if (dustState.dust.availableCoins.length < 2) {
    log(`[inventory] skipped: only ${dustState.dust.availableCoins.length} free DUST coin(s); reserved for quote transactions`);
    return;
  }
  const exclude = new Set([...hostage, ...engine.bookedInputs(), ...pool.list().flatMap((e) => e.offer.inputs)]);
  const maxSize = policy.ladderSizes.reduce((a, b) => (a > b ? a : b), 0n);
  // The counter rung is what the dealer PAYS on its bid for the largest size (the larger of its two legs).
  const mid = policy.midPrice ? toFixed(policy.midPrice) : undefined;
  const counterRung = mid
    ? counterAmountFor({ pair: policy.pair, side: 'buy', price: fromFixed(quotePrice(mid, 'buy', policy.spreadBps)), size: fromFixed(maxSize) })
    : 0n;
  const rungs: Array<[string, bigint]> = [[tokens.base.token, maxSize], [tokens.counter.token, counterRung]];
  for (const [token, rungAmount] of rungs) {
    const coins = (await listCoins(wallet, token)).filter((c) => !exclude.has(c.ref));
    // Coins held by live offers are part of the ladder: counting only unbooked coins made the keeper split
    // again every time a warm offer booked one (M3 run #3, "3 backing coin(s) < target 4" each tick).
    const inUse = pool.list().filter((e) => e.give.token === token).length + engine.offersGiving(token);
    const targetCoins = Math.max(0, cfg.pool.ladderCoins - inUse);
    const plan = planInventory({ coins, rungAmount, targetCoins, consolidateAbove: cfg.pool.consolidateAbove });
    if (plan.action === 'none') continue;
    const { params } = await retry('ledger parameters', () => queryLedgerParameters(cfg.network.indexer));
    try {
      const out =
        plan.action === 'merge'
          ? await consolidateSmallest(wallet, token, plan.refs.length, params, { exclude, forbiddenInputs: exclude })
          : await splitExact(wallet, token, plan.pieces, params, { forbiddenInputs: exclude });
      log(`[inventory] ${token.slice(0, 8)}…: ${plan.action} (${plan.reason}) -> ${out?.inputs ?? 0} in / ${out?.outputs ?? 0} out, tx ${out?.txId ?? 'skipped'}`);
      if (out && token === NIGHT) await registerNewNight(wallet).catch((err) => log(`[inventory] DUST registration: ${(err as Error).message}`));
    } catch (err) {
      log(`[inventory] ${token.slice(0, 8)}…: ${plan.action} failed: ${(err as Error).message.split('\n')[0]}`);
    }
    return; // one keeper transaction per tick — the next token waits for the next tick
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
