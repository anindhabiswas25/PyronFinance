// The only data interfaces pages use. Pages never import live or fixture code directly; they get
// these from DataProvider, which picks live or fixture adapters.
//
// Every import from @otc/sdk/browser here is type-only and erased at build time, so this module
// never pulls the SDK (or its WASM) into a public page.
//
// Identifiers are lowercase hex strings at this boundary (serialisable, comparable); adapters convert
// to and from Uint8Array. Amounts are bigint.

import type {
  AggregationResult,
  ChainBond,
  ChainReader,
  RevealMessage,
  RfqBody,
  checkTimeToDismiss,
} from '@otc/sdk/browser';
import type { KeyMaterialProvider, ProvingProvider } from '@midnight-ntwrk/dapp-connector-api';
import type { Clock } from '../design/clock';
import type { DataSource } from '../config/env';
import type { NetworkConfig } from '../config/networks';

export type Hex = string;

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

export interface BondView {
  dealerCmt: Hex;
  amount: bigint;
  /** The dealer's quote-signing key, in the runtime's own point shape (verification needs it). */
  quotePk: ChainBond['quotePk'];
  /** Unix seconds; 0n when no withdrawal was requested. */
  withdrawRequested: bigint;
  liveQuotes: bigint;
  active: boolean;
}

export interface QuoteView {
  quoteId: Hex;
  dealerCmt: Hex;
  commitment: Hex;
  validUntil: bigint;
  rfqId: Hex;
  notional: bigint;
  resolved: boolean;
}

export interface NoteView {
  tradeId: Hex;
  ciphertextHash: Hex;
  policyTag: number;
  recipientHint: Hex;
}

/** The contract's ledger as plain data. */
export interface LedgerView {
  bonds: ReadonlyMap<Hex, BondView>;
  /** Counters for every dealer key the view knows, including dealers whose bond was withdrawn
   *  (the contract keeps their counters; the ledger's counter maps are not iterable, so the adapter
   *  reads them for keys it learned from bonds and from event history). */
  settled: ReadonlyMap<Hex, bigint>;
  slashed: ReadonlyMap<Hex, bigint>;
  quotes: ReadonlyMap<Hex, QuoteView>;
  notes: ReadonlyMap<Hex, NoteView>;
  burnedTotal: bigint;
}

export interface LedgerSnapshot {
  view: LedgerView;
  /** Block height of the contract state the view was decoded from. */
  height: number;
}

export interface DealerView {
  dealerCmt: Hex;
  bond?: BondView;
  settled: bigint;
  slashed: bigint;
  /** False when the chain has never seen this key (no bond, no counters). */
  known: boolean;
}

interface EventBase {
  /** `${txHash}:${n}` — stable across replays. */
  id: string;
  txHash: Hex;
  height: number;
  /** Unix seconds. */
  timestamp: number;
  entryPoint: string;
}

export type ProtocolEventBody =
  | { kind: 'bond-posted'; dealerCmt: Hex; amount: bigint; maxQuote: bigint }
  | { kind: 'bond-topped-up'; dealerCmt: Hex; delta: bigint; amount: bigint }
  | { kind: 'withdrawal-requested'; dealerCmt: Hex; requestedAt: bigint; withdrawableAt: bigint }
  | { kind: 'bond-withdrawn'; dealerCmt: Hex; amount: bigint }
  | { kind: 'quote-sealed'; dealerCmt: Hex; quoteId: Hex; rfqId: Hex; commitment: Hex; notional: bigint; validUntil: bigint }
  | { kind: 'quote-settled'; dealerCmt: Hex; quoteId: Hex; notional: bigint }
  | { kind: 'quote-released'; dealerCmt: Hex; quoteId: Hex; notional: bigint }
  | { kind: 'bond-slashed'; dealerCmt: Hex; quoteId?: Hex; amount: bigint; taker: bigint; prover: bigint; burned: bigint }
  | { kind: 'note-attached'; tradeId: Hex; dealerCmt?: Hex; policyTag: number }
  | { kind: 'unrecognized'; detail: string };

export type ProtocolEvent = EventBase & ProtocolEventBody;
export type ProtocolEventKind = ProtocolEvent['kind'];

export interface EventUpdate {
  /** Events derived since the previous update, oldest first. */
  events: ProtocolEvent[];
  /** Highest block height processed. */
  height: number;
  /** True once replay has caught up with the chain tip. */
  live: boolean;
}

export interface IndexedTransaction {
  hash: Hex;
  identifiers: string[];
  status: string | undefined;
  blockHeight: number;
}

export type LedgerParameters = Parameters<typeof checkTimeToDismiss>[1];

export type InputSpent = { spent: boolean; byTx?: Hex } | 'unsupported';

export interface ChainPort {
  snapshot(): Promise<LedgerSnapshot>;
  quote(quoteId: Hex): Promise<QuoteView | undefined>;
  dealer(dealerCmt: Hex): Promise<DealerView>;
  /** Replays protocol events from `fromHeight` (default: the contract's deployment) and then follows
   *  the chain. Throws when the indexer fails; the caller shows an error, never an empty list. */
  events(options?: { fromHeight?: number; signal?: AbortSignal }): AsyncIterable<EventUpdate>;
  transaction(by: { hash: Hex } | { identifier: string }): Promise<IndexedTransaction | undefined>;
  ledgerParameters(): Promise<{ height: number; params: LedgerParameters }>;
  inputSpent?(intentHash: Hex, outputNo: number): Promise<InputSpent>;
  /** For verifyQuoteRef / RelayAggregator. May load the SDK lazily on first use. */
  chainReader(): ChainReader;
}

// ---------------------------------------------------------------------------------------------
// Relays
// ---------------------------------------------------------------------------------------------

export interface RelayHealth {
  ok: boolean;
  peers?: number;
  version?: string;
  latencyMs?: number;
  checkedAt: number;
  error?: string;
}

export interface RelayState {
  url: string;
  connected: boolean;
  health?: RelayHealth;
}

export interface IncomingRfq {
  envelopeId: Hex;
  body: RfqBody;
  receivedAt: number;
  relays: string[];
}

export interface RelayPort {
  /** Opens (or re-opens) connections to exactly these relays. */
  connect(urls: string[]): Promise<RelayState[]>;
  status(): RelayState[];
  onStatus(listener: (states: RelayState[]) => void): () => void;
  health(url: string): Promise<RelayHealth>;
  /** Throws an InsufficientRelaysError-shaped error below two connected relays. */
  publishRfq(body: RfqBody): void;
  collect(rfq: RfqBody): Promise<AggregationResult>;
  /** GET {base}/mailbox/{takerEncPk}. Every returned message is persisted to sessionStorage
   *  before this resolves — the relay deletes on read. */
  fetchMailbox(base: string, takerEncPk: Hex): Promise<RevealMessage[]>;
  /** RFQs heard on the connected relays (dealer desk). */
  incomingRfqs(): IncomingRfq[];
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------------------------

export interface WalletInfo {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  supported: boolean;
  unsupportedReason?: string;
}

export interface WalletConfig {
  indexerUri: string;
  indexerWsUri: string;
  substrateNodeUri: string;
  networkId: string;
}

export interface WalletHistoryEntry {
  txHash: Hex;
  status: 'pending' | 'confirmed' | 'finalized' | 'discarded' | string;
}

export interface WalletPort {
  readonly kind: DataSource;
  discover(): WalletInfo[];
  connect(rdns: string, networkId: string): Promise<void>;
  disconnect(): void;
  connected(): boolean;
  config(): Promise<WalletConfig>;
  address(): Promise<string>;
  balances(): Promise<Record<string, bigint>>;
  dust(): Promise<{ cap: bigint; balance: bigint }>;
  /** Serialized Transaction<SignatureEnabled, Proof, Binding> hex in, balanced tx hex out. */
  balanceSealed(txHex: string): Promise<string>;
  balanceUnsealed(txHex: string): Promise<string>;
  /** Resolves void: identifiers come from the transaction that was submitted. */
  submit(txHex: string): Promise<void>;
  history(page: number, size: number): Promise<WalletHistoryEntry[]>;
  status(): Promise<{ connected: boolean; networkId?: string }>;
  provingProvider(keys: KeyMaterialProvider): Promise<ProvingProvider>;
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

/** Synchronous, bigint-safe key/value (sessionStorage, localStorage). */
export interface SyncStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(prefix?: string): string[];
}

/** IndexedDB. Only encrypted payloads (keys, trade history) and public caches (events) go here. */
export interface AsyncStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export interface StoragePort {
  session: SyncStore;
  local: SyncStore;
  idb: AsyncStore;
}

// ---------------------------------------------------------------------------------------------
// Capabilities and the bundle
// ---------------------------------------------------------------------------------------------

export interface Capabilities {
  settleInBrowser: 'unverified' | 'verified' | 'off';
  circuitsInBrowser: boolean;
  inputSpentLookup: boolean;
}

export interface DataPorts {
  source: DataSource;
  network: NetworkConfig;
  chain: ChainPort;
  relays: RelayPort;
  wallet: WalletPort;
  storage: StoragePort;
  capabilities: Capabilities;
  clock: Clock;
}
