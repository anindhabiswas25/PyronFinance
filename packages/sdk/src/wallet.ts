// Node.js headless wallet setup and WalletProvider/MidnightProvider bridge.
//
// NOTE ON API DRIFT: the midnight-js skill's documented wallet construction pattern
// (`new WalletFacade(shielded, unshielded, dust); await facade.start(...)`) does NOT match the
// actually-installed package versions it itself pins (wallet-sdk-facade 3.0.0 etc.) — WalletFacade's
// constructor is private, and construction is `WalletFacade.init({ configuration, shielded,
// unshielded, dust })` where shielded/unshielded/dust are factory functions. This was discovered
// by reading the installed .d.ts files directly (node_modules/@midnight-ntwrk/wallet-sdk-facade),
// since the official wallet SDK docs are still "coming soon" per the skill. Recorded here rather
// than silently worked around — flag for skill update once this can be verified end-to-end against
// a live proof server (blocked in this environment, see docs/ROADMAP.md M1 status).

import { WebSocket } from 'ws';
// Required for GraphQL subscriptions (wallet sync) to work in Node.js — must run before any
// wallet import touches the network. See midnight-js SKILL.md §5, §13.
(globalThis as any).WebSocket = WebSocket;

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, generateRandomSeed, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  UnshieldedWallet,
  createKeystore,
  PublicKey,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import type { ChainConfig, NetworkId } from './config.js';
import { loadWalletSnapshot, saveWalletSnapshot } from './wallet-state.js';

export function initNetworkId(network: NetworkId): void {
  // Must be called before any other SDK operation — midnight-js SKILL.md §2.
  setNetworkId(network);
}

export function generateNewSeedHex(): string {
  const seed = generateRandomSeed();
  return Buffer.from(seed).toString('hex');
}

export interface HeadlessWallet {
  facade: WalletFacade;
  walletAndMidnightProvider: WalletProvider & MidnightProvider;
  unshieldedAddress: string;
  waitForSync(): Promise<void>;
  waitForUnshieldedBalance(): Promise<bigint>;
  waitForDust(): Promise<void>;
  registerForDustGeneration(): Promise<void>;
  /** Persists sync progress so the next start resumes instead of replaying from genesis.
   *  waitForSync() already calls this; call it directly after submitting transactions if you want
   *  the resulting state captured without waiting for the next sync. */
  saveState(): Promise<void>;
}

export interface HeadlessWalletOptions {
  /** Set false to ignore any on-disk snapshot and force a full genesis sync. Default true. */
  persistState?: boolean;
}

/** Builds and starts a headless (Node.js) wallet from a hex seed, wired for use as both
 *  WalletProvider and MidnightProvider. Construction follows WalletFacade.init's real signature
 *  (see file header) — NOT the simpler pattern in midnight-js SKILL.md, which is stale relative
 *  to the pinned package versions. */
export async function createHeadlessWallet(
  seedHex: string,
  chain: ChainConfig,
  options: HeadlessWalletOptions = {},
): Promise<HeadlessWallet> {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid wallet seed');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') throw new Error('Key derivation failed');

  hdWallet.hdWallet.clear(); // wipe secret material from memory

  const keys = derivationResult.keys;
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const publicKey = PublicKey.fromKeyStore(unshieldedKeystore);

  const indexerClientConnection = { indexerHttpUrl: chain.indexerHttp, indexerWsUrl: chain.indexerWs };
  const relayURL = new URL(chain.rpc.replace(/^http/, 'ws'));
  const provingServerUrl = new URL(chain.proofServer);

  // batchUpdates is what makes a from-genesis Preprod sync survivable. The SDK default is
  // { size: 10, spacing: 4 } — 10 events per 4 ms, i.e. a ~2500 events/s ceiling. Measured against
  // live Preprod (~1.5M events to replay from genesis), the dust wallet applied only ~306 events/s
  // under that default while the indexer pushed ~430/s, so the unapplied-event queue grew without
  // bound and the process OOM'd — at 47 s on a 2 GB heap, and still at 26 min on a 6 GB one, which
  // is what rules out "just needs more memory." The shielded wallet, by contrast, managed ~20k
  // events/s with a flat ~200 MB heap, which is how the dust path was isolated as the culprit.
  //
  // spacing: 0 removes the inter-batch delay entirely and size: 500 amortizes per-batch overhead,
  // letting the consumer outrun the producer so the queue drains instead of growing. Note this
  // knob did not exist in the versions this file was originally written against
  // (wallet-sdk-dust-wallet 3.0.0 hardcoded `const batchSize = 10`); it arrived in 4.2.0, which is
  // the reason for the coordinated wallet-SDK major bump in packages/sdk/package.json.
  const batchUpdates = { size: 500, spacing: 0 };

  // costParameters became a REQUIRED dust-wallet config field in wallet-sdk-dust-wallet 4.x — it
  // did not exist in 3.0.0. Omitting it does not fail to typecheck (the facade's DefaultConfiguration
  // does not surface it as required), it fails at run time deep inside balancing with
  // "Cannot read properties of undefined (reading 'feeBlocksMargin')" the first time a transaction
  // is balanced — i.e. only once you have a synced, funded wallet and are actually deploying.
  // Values per midnight-js SKILL.md §5.
  //
  // feeBlocksMargin is an EXPONENT, not a block count — ledger-v8 warns "it is very easy to get a
  // completely unreasonable margin here." Do not raise it casually to buy fee headroom; 5 is the
  // documented value.
  const costParameters = {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  };

  const configuration = {
    networkId: getNetworkId(),
    indexerClientConnection,
    relayURL,
    provingServerUrl,
    batchUpdates,
    costParameters,
  };

  // Resume from a previous run's snapshot when one is valid for this exact wallet, network and SDK
  // version set; otherwise fall back to a full genesis sync. See wallet-state.ts for why that costs
  // ~20 minutes on Preprod. A snapshot is only ever a sync shortcut — restore() sets the starting
  // state, and facade.start() below still syncs forward from it to the chain tip, so a stale
  // snapshot costs a longer catch-up, never a wrong balance.
  const persistState = options.persistState !== false;
  const snapshot = persistState ? loadWalletSnapshot(chain.network, publicKey.address) : undefined;

  /** A corrupt or incompatible snapshot must degrade to a slow start, never abort startup. */
  function restoreOrFresh<T>(label: string, restore: () => T, fresh: () => T): T {
    if (!snapshot) return fresh();
    try {
      return restore();
    } catch (err) {
      console.warn(`[wallet-state] ${label} restore failed (${(err as Error).message}); syncing from genesis`);
      return fresh();
    }
  }

  const facade = await WalletFacade.init({
    configuration,
    shielded: (config: any) =>
      restoreOrFresh(
        'shielded',
        () => ShieldedWallet(config).restore(snapshot!.shielded),
        () => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
      ),
    unshielded: (config: any) =>
      restoreOrFresh(
        'unshielded',
        () => UnshieldedWallet(config).restore(snapshot!.unshielded),
        () => UnshieldedWallet(config).startWithPublicKey(publicKey),
      ),
    dust: (config: any) =>
      restoreOrFresh(
        'dust',
        () => DustWallet(config).restore(snapshot!.dust),
        () => DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
      ),
  });

  // WalletFacade.init() only wires the sub-wallets together — it does NOT start syncing.
  // facade.start() is what actually calls shielded/unshielded/dust.start(), which kicks off the
  // indexer subscriptions. Without this, facade.state() emits exactly one isSynced:false event
  // and then never updates, no matter how long you wait (confirmed by a live run against Preprod:
  // 8 minutes, zero further state events). Found by reading wallet-sdk-facade's dist/index.js
  // directly — undocumented, and the stale `new WalletFacade(...); await wallet.start(...)`
  // pattern in midnight-js SKILL.md §5 (superseded by the .init() factory-function pattern noted
  // in this file's header) still had the start() call; it was dropped when this file switched to
  // .init() and never added back.
  await facade.start(shieldedSecretKeys, dustSecretKey);

  // Populated by waitForSync(); read by the WalletProvider getters below. Deliberately NOT
  // fetched during construction — createHeadlessWallet must stay fast and non-blocking so
  // address-only use (scripts/print-address.ts, before any funding exists) doesn't hang waiting
  // for a sync that may never produce data for a brand-new, unfunded address. Callers that need
  // to actually transact must call `wallet.waitForSync()` first — deploy.ts/fund.ts/e2e-fraud.ts
  // already do this.
  let latestSyncedState: Awaited<ReturnType<typeof facade.waitForSyncedState>> | undefined;

  async function saveState(): Promise<void> {
    if (!persistState) return;
    try {
      const [shielded, unshielded, dust] = await Promise.all([
        facade.shielded.serializeState(),
        facade.unshielded.serializeState(),
        facade.dust.serializeState(),
      ]);
      saveWalletSnapshot(chain.network, publicKey.address, { shielded, unshielded, dust });
    } catch (err) {
      // Never fail a caller's real work because a cache write failed — the next run just resyncs.
      console.warn(`[wallet-state] could not save snapshot: ${(err as Error).message}`);
    }
  }

  async function waitForSync(): Promise<void> {
    latestSyncedState = await facade.waitForSyncedState();
    // Snapshot at the point sync completes: this is both the most expensive state to rebuild and
    // the one every script reaches before doing anything else.
    await saveState();
  }

  async function waitForUnshieldedBalance(): Promise<bigint> {
    const { unshieldedToken } = ledger as any;
    return Rx.firstValueFrom(
      facade.state().pipe(
        Rx.throttleTime(10_000),
        Rx.filter((s) => s.isSynced),
        Rx.map((s) => (s.unshielded.balances[unshieldedToken().raw] ?? 0n) as bigint),
        Rx.filter((balance) => balance > 0n),
      ),
    );
  }

  // DustWalletState.walletBalance(date) was renamed to .balance(date) in wallet-sdk-dust-wallet 4.x.
  // The old name was reached through an `as any`, so the rename did not fail to typecheck — it threw
  // "s.dust.walletBalance is not a function" at run time, and only after a full ~20 min genesis sync
  // plus a successfully submitted registration transaction. Kept typed (no cast) so the next rename
  // is caught by tsc instead of 20 minutes into a live run.
  async function waitForDust(): Promise<void> {
    await Rx.firstValueFrom(
      facade.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }

  const signFn = (payload: Uint8Array) => unshieldedKeystore.signData(payload);

  // getCoinPublicKey/getEncryptionPublicKey are called synchronously by midnight-js, so they
  // can't await a sync themselves — callers must call wallet.waitForSync() before using
  // walletAndMidnightProvider for any actual transaction (deploy/call), not before merely
  // reading wallet.unshieldedAddress.
  const walletAndMidnightProvider: WalletProvider & MidnightProvider = {
    getCoinPublicKey() {
      if (!latestSyncedState) {
        throw new Error('Wallet not synced yet — call wallet.waitForSync() before submitting any transaction');
      }
      return (latestSyncedState.shielded as any).coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      if (!latestSyncedState) {
        throw new Error('Wallet not synced yet — call wallet.waitForSync() before submitting any transaction');
      }
      return (latestSyncedState.shielded as any).encryptionPublicKey.toHexString();
    },
    // Signing goes through facade.signRecipe, NOT a hand-rolled intent walk. This file previously
    // carried a signTransactionIntents() workaround for a wallet-SDK bug where signRecipe hardcoded
    // the 'pre-proof' marker. That bug is fixed as of wallet-sdk-facade 4.1.0: signRecipe now uses
    // signUnboundTransaction for the base transaction and signUnprovenTransaction for the balancing
    // one, and additionally signs a dust registration when present — which the workaround never did.
    //
    // Keeping the workaround cost us a live failure that only appears on transactions carrying
    // unshielded inputs: the node rejected postBond with "1010: Invalid Transaction: Custom error:
    // 192" (MalformedError::InputsSignaturesLengthMismatch — fewer signatures than unshielded
    // inputs). Deploy was unaffected because it moves no unshielded funds, so this stayed hidden
    // until the first receiveUnshielded circuit was called.
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await facade.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await facade.signRecipe(recipe, signFn);
      return facade.finalizeRecipe(signed);
    },
    submitTx(tx: any) {
      return facade.submitTransaction(tx) as any;
    },
  };

  async function registerForDustGeneration(): Promise<void> {
    const s = await Rx.firstValueFrom(facade.state().pipe(Rx.filter((s) => s.isSynced)));
    if (s.dust.availableCoins.length > 0) return;

    // No `as any` on these state getters: both DustWalletState.availableCoins and
    // UnshieldedWalletState.availableCoins are real, typed members. Casting here is what let the
    // walletBalance -> balance rename above reach production undetected.
    const nightUtxos = s.unshielded.availableCoins.filter(
      (coin) => coin.meta?.registeredForDustGeneration !== true,
    );
    if (nightUtxos.length === 0) {
      throw new Error('No unregistered NIGHT UTXOs found — wallet may not be funded yet');
    }

    const recipe = await facade.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      signFn,
    );
    const finalized = await facade.finalizeRecipe(recipe as any);
    await facade.submitTransaction(finalized);
    await waitForDust();
  }

  return {
    facade,
    walletAndMidnightProvider,
    unshieldedAddress: publicKey.address,
    waitForSync,
    waitForUnshieldedBalance,
    waitForDust,
    registerForDustGeneration,
    saveState,
  };
}
