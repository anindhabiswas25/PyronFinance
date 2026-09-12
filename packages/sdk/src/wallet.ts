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

export function initNetworkId(network: NetworkId): void {
  // Must be called before any other SDK operation — midnight-js SKILL.md §2.
  setNetworkId(network);
}

export function generateNewSeedHex(): string {
  const seed = generateRandomSeed();
  return Buffer.from(seed).toString('hex');
}

/** Workaround for a wallet SDK bug where signRecipe hardcodes 'pre-proof', causing failures
 *  when signing proven (UnboundTransaction) intents. See midnight-js SKILL.md §8. Call with
 *  proofMarker='proof' for baseTransaction, 'pre-proof' for balancingTransaction. UNVERIFIED
 *  against this installed version — the skill's workaround predates the WalletFacade.init
 *  rewrite discovered above; keep but re-test once a live proof server is available. */
function signTransactionIntents(
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = (ledger.Intent as any).deserialize(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const signature = signFn(cloned.signatureData(segment));

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: unknown, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: unknown, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
}

export interface HeadlessWallet {
  facade: WalletFacade;
  walletAndMidnightProvider: WalletProvider & MidnightProvider;
  unshieldedAddress: string;
  waitForSync(): Promise<void>;
  waitForUnshieldedBalance(): Promise<bigint>;
  waitForDust(): Promise<void>;
  registerForDustGeneration(): Promise<void>;
}

/** Builds and starts a headless (Node.js) wallet from a hex seed, wired for use as both
 *  WalletProvider and MidnightProvider. Construction follows WalletFacade.init's real signature
 *  (see file header) — NOT the simpler pattern in midnight-js SKILL.md, which is stale relative
 *  to the pinned package versions. */
export async function createHeadlessWallet(seedHex: string, chain: ChainConfig): Promise<HeadlessWallet> {
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

  const configuration = {
    networkId: getNetworkId(),
    indexerClientConnection,
    relayURL,
    provingServerUrl,
  };

  const facade = await WalletFacade.init({
    configuration,
    shielded: (config: any) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (config: any) => UnshieldedWallet(config).startWithPublicKey(publicKey),
    dust: (config: any) => DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
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

  async function waitForSync(): Promise<void> {
    latestSyncedState = await facade.waitForSyncedState();
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

  async function waitForDust(): Promise<void> {
    await Rx.firstValueFrom(
      facade.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => (s.dust as any).walletBalance(new Date()) > 0n),
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
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await facade.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      signTransactionIntents((recipe as any).baseTransaction, signFn, 'proof');
      if ((recipe as any).balancingTransaction) {
        signTransactionIntents((recipe as any).balancingTransaction, signFn, 'pre-proof');
      }
      return facade.finalizeRecipe(recipe as any);
    },
    submitTx(tx: any) {
      return facade.submitTransaction(tx) as any;
    },
  };

  async function registerForDustGeneration(): Promise<void> {
    const s = await Rx.firstValueFrom(facade.state().pipe(Rx.filter((s) => s.isSynced)));
    if ((s.dust as any).availableCoins.length > 0) return;

    const nightUtxos = (s.unshielded as any).availableCoins.filter(
      (coin: any) => coin.meta?.registeredForDustGeneration !== true,
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
  };
}
