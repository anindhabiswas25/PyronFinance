// OTCProtocol circuits from a browser wallet (docs/ROADMAP.md task 0.3). The Node path
// (contract.ts, providers.ts) reads ZK assets from disk, proves on a proof server and balances with a
// headless wallet. In a browser:
//   - ZK assets are fetched over HTTP (FetchZkConfigProvider);
//   - the circuit runs locally against the contract and Zswap state read from the indexer;
//   - the wallet proves (getProvingProvider), balances and pays the fee (balanceUnsealedTransaction)
//     and submits. Those three steps are the caller's, so each is a visible stage.
//
// Keys are handed to midnight-js as hex, never bech32m: its bech32m parsing uses Node's Buffer.

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { CostModel, LedgerParameters, Transaction, ZswapChainState, type FinalizedTransaction, type UnprovenTransaction } from '@midnight-ntwrk/ledger-v8';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type PrivateStateProvider,
  type ProverKey,
  type PublicDataProvider,
  type VerifierKey,
  type WalletProvider,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';
import { Contract, type ProvableCircuits } from '../../../contracts/managed/otc-protocol/contract/index.js';
import { otcWitnesses } from './witnesses.js';
import { emptyPrivateState, type OTCPrivateState } from './private-state.js';
import { OTCPrivateStateId, type OTCCircuits } from './types.js';
import { bytesToHex, hexToBytes } from './aead.js';
import { queryLedgerParameters } from './indexer.js';
import { midnightKeyToHex } from './bech32m.js';

/** The arguments a circuit takes after its context, e.g. `[quoteId]` for releaseExpiredQuote. */
export type OtcCircuitArgs<K extends OTCCircuits> = ProvableCircuits<OTCPrivateState>[K] extends (context: never, ...args: infer A) => unknown ? A : never;

// ---------------------------------------------------------------------------------------------
// ZK assets over HTTP
// ---------------------------------------------------------------------------------------------

/** Reads `${base}/keys/<circuit>.prover|.verifier` and `${base}/zkir/<circuit>.bzkir`. Also usable as
 *  the wallet's KeyMaterialProvider; a key location with a path prefix resolves by its last segment.
 *  Successful loads are cached (prover keys reach 6 MB); failures are not. */
export class FetchZkConfigProvider extends ZKConfigProvider<OTCCircuits> {
  private readonly cache = new Map<string, Promise<Uint8Array>>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
  ) {
    super();
  }

  private load(dir: 'keys' | 'zkir', location: string, ext: string): Promise<Uint8Array> {
    const name = String(location).split('/').pop();
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) return Promise.reject(new Error(`not a circuit key location: ${location}`));
    const path = `${dir}/${name}.${ext}`;
    let pending = this.cache.get(path);
    if (!pending) {
      const loading = (async () => {
        const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/${path}`);
        if (!res.ok) throw new Error(`ZK asset ${path} could not be loaded (HTTP ${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
      })();
      pending = loading;
      this.cache.set(path, loading);
      loading.catch(() => {
        if (this.cache.get(path) === loading) this.cache.delete(path);
      });
    }
    return pending;
  }

  getZKIR(circuitId: OTCCircuits): Promise<ZKIR> {
    return this.load('zkir', circuitId, 'bzkir').then(createZKIR);
  }
  getProverKey(circuitId: OTCCircuits): Promise<ProverKey> {
    return this.load('keys', circuitId, 'prover').then(createProverKey);
  }
  getVerifierKey(circuitId: OTCCircuits): Promise<VerifierKey> {
    return this.load('keys', circuitId, 'verifier').then(createVerifierKey);
  }
}

// ---------------------------------------------------------------------------------------------
// Providers createUnprovenCallTx needs, and nothing more
// ---------------------------------------------------------------------------------------------

export type CallPublicState = [ZswapChainState, ContractState, LedgerParameters];

function stripHex(hex: string): Uint8Array {
  return hexToBytes(hex.replace(/^0x/, ''));
}

/** The latest contract and Zswap state from the indexer, without the offset:null query the stock
 *  provider sends (indexer skill §2), and without its Apollo/WebSocket dependencies. */
export async function queryCallPublicState(indexerHttpUrl: string, contractAddress: string): Promise<CallPublicState> {
  const [res, { params }] = await Promise.all([
    fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query CALL_STATE($address: HexEncoded!) { contractAction(address: $address) { state zswapState } }`,
        variables: { address: contractAddress },
      }),
    }),
    queryLedgerParameters(indexerHttpUrl),
  ]);
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`);
  const payload = (await res.json()) as { data?: { contractAction?: { state?: string; zswapState?: string } }; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join('; '));
  const action = payload.data?.contractAction;
  if (!action?.state || !action.zswapState) throw new Error(`the indexer has no state for contract ${contractAddress}`);
  return [ZswapChainState.deserialize(stripHex(action.zswapState)), ContractState.deserialize(stripHex(action.state)), params];
}

function inMemoryPrivateState(): PrivateStateProvider<typeof OTCPrivateStateId, OTCPrivateState> {
  const states = new Map<string, OTCPrivateState>();
  const unsupported = async (): Promise<never> => {
    throw new Error('private state export/import is not available in the browser call path');
  };
  let scope = '';
  return {
    setContractAddress(address) {
      scope = address;
    },
    async set(id, state) {
      states.set(`${scope}:${id}`, state);
    },
    async get(id) {
      return states.get(`${scope}:${id}`) ?? null;
    },
    async remove(id) {
      states.delete(`${scope}:${id}`);
    },
    async clear() {
      states.clear();
    },
    async setSigningKey() {},
    async getSigningKey() {
      return null;
    },
    async removeSigningKey() {},
    async clearSigningKeys() {},
    exportPrivateStates: unsupported,
    importPrivateStates: unsupported,
    exportSigningKeys: unsupported,
    importSigningKeys: unsupported,
  };
}

let compiled: ReturnType<typeof makeCompiledContract> | undefined;
function makeCompiledContract() {
  // The assets path is never read in this path: ZK assets come from the FetchZkConfigProvider.
  return CompiledContract.make('OTCProtocol', Contract).pipe(
    CompiledContract.withWitnesses(otcWitnesses),
    CompiledContract.withCompiledFileAssets('otc-protocol'),
  );
}

// ---------------------------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------------------------

export interface PrepareOtcCallOptions<K extends OTCCircuits> {
  networkId: string;
  indexerHttp: string;
  contractAddress: string;
  zkConfig: ZKConfigProvider<OTCCircuits>;
  /** The wallet's shielded coin and encryption public keys, as hex or bech32m. */
  coinPublicKey: string;
  encryptionPublicKey: string;
  circuit: K;
  args: OtcCircuitArgs<K>;
  /** Witness inputs: `dealerSecretKey` for dealer circuits, `takerAddress` for the fraud-proof bounty. */
  privateState?: Partial<OTCPrivateState>;
  /** Overrides the indexer read (tests run circuits against simulator state). */
  publicState?: () => Promise<CallPublicState>;
}

/** Runs the circuit locally and returns the unproven transaction. Throws the circuit's own assertion
 *  message when it refuses (e.g. "Fraud-proof grace period still open"). */
export async function prepareOtcCall<K extends OTCCircuits>(o: PrepareOtcCallOptions<K>): Promise<UnprovenTransaction> {
  setNetworkId(o.networkId as Parameters<typeof setNetworkId>[0]);
  const privateStateProvider = inMemoryPrivateState();
  privateStateProvider.setContractAddress(o.contractAddress);
  await privateStateProvider.set(OTCPrivateStateId, { ...emptyPrivateState(), ...o.privateState });
  const coinPublicKey = midnightKeyToHex(o.coinPublicKey, 'shield-cpk');
  const encryptionPublicKey = midnightKeyToHex(o.encryptionPublicKey, 'shield-epk');
  const readState = o.publicState ?? (() => queryCallPublicState(o.indexerHttp, o.contractAddress));

  const publicDataProvider = {
    queryZSwapAndContractState: readState,
    queryContractState: async () => (await readState())[1],
  } as unknown as PublicDataProvider;
  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    balanceTx: () => Promise.reject(new Error('the browser wallet balances this transaction')),
  } as unknown as WalletProvider;

  compiled ??= makeCompiledContract();
  try {
    // midnight-js's generics do not compose with compiler-generated contracts (1am-wallet skill §12);
    // the options are typed by PrepareOtcCallOptions above instead.
    const data = await createUnprovenCallTx(
      { zkConfigProvider: o.zkConfig, publicDataProvider, walletProvider, privateStateProvider } as never,
      { compiledContract: compiled, contractAddress: o.contractAddress, circuitId: o.circuit, args: o.args, privateStateId: OTCPrivateStateId } as never,
    );
    return (data as { private: { unprovenTx: UnprovenTransaction } }).private.unprovenTx;
  } catch (err) {
    throw withRootCause(err);
  }
}

/** midnight-js wraps a throwing witness as "Error executing circuit '…'" and keeps the reason in
 *  `cause`. Put the innermost reason in the message, where a UI shows it. */
function withRootCause(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  let root: unknown = err;
  for (let depth = 0; depth < 8 && root instanceof Error && root.cause !== undefined; depth++) root = root.cause;
  const reason = root instanceof Error ? root.message : typeof root === 'string' ? root : undefined;
  if (!reason || err.message.includes(reason)) return err;
  return new Error(`${err.message}: ${reason}`, { cause: err });
}

/** Proves with the wallet's proving provider (the pattern confirmed with 1AM, 1am-wallet skill §3). */
export function proveOtcCall(tx: UnprovenTransaction, provider: Parameters<UnprovenTransaction['prove']>[0]) {
  return tx.prove(provider, CostModel.initialCostModel());
}

export function txToHex(tx: { serialize(): Uint8Array }): string {
  return bytesToHex(tx.serialize());
}

/** A balanced, ready-to-submit transaction as returned by the wallet. */
export function finalizedTxFromHex(hex: string): FinalizedTransaction {
  return Transaction.deserialize('signature', 'proof', 'binding', stripHex(hex));
}

/** Identifiers the indexer knows a transaction by (the connector's submitTransaction returns none). */
export function txIdentifiers(tx: FinalizedTransaction): string[] {
  return tx.identifiers().map(String);
}
