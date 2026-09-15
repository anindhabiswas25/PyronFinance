// Protocol events from the indexer: subscribe to contractActions over graphql-ws, decode each
// action's state, and diff it against the previous one (derive-events.ts).
//
// Derived events are cached in IndexedDB per network + contract, with the last decoded state, so a
// second visit replays from the cache and resumes from the last height instead of from deployment.

import { createClient } from 'graphql-ws';
import { deriveEvents } from '../derive-events';
import type { AsyncStore, EventUpdate, LedgerView, ProtocolEvent } from '../ports';
import { AsyncQueue } from '../../lib/async-queue';
import { loadDecoder } from './decode';
import { queryContractStateHex, queryTipHeight, toSecs } from './indexer-http';

const CACHE_VERSION = 1;

interface EventCache {
  version: number;
  contract: string;
  height: number;
  /** Transactions already processed at `height` — the resumed subscription re-delivers that block. */
  txHashesAtHeight: string[];
  stateHex: string;
  dealers: string[];
  events: ProtocolEvent[];
}

interface RawAction {
  __typename: string;
  state: string;
  entryPoint?: string;
  transaction: { hash: string; block: { height: number; timestamp: number } };
}

export interface FollowOptions {
  indexerHttp: string;
  indexerWs: string;
  contract: string;
  cacheKey: string;
  store: AsyncStore;
  fromHeight?: number;
  deployHeight?: number;
  signal?: AbortSignal;
  onDealers?(dealers: Set<string>): void;
}

const IDLE_MS = 1500;

export async function* followContractEvents(o: FollowOptions): AsyncGenerator<EventUpdate> {
  const decode = await loadDecoder();
  const dealers = new Set<string>();
  let prev: LedgerView | undefined;
  let prevHex: string | undefined;
  let height = o.fromHeight ?? o.deployHeight ?? 0;
  let seenAtHeight = new Set<string>();
  let all: ProtocolEvent[] = [];

  const cached = o.fromHeight === undefined ? await o.store.get<EventCache>(o.cacheKey).catch(() => undefined) : undefined;
  if (cached && cached.version === CACHE_VERSION && cached.contract === o.contract) {
    for (const d of cached.dealers) dealers.add(d);
    prevHex = cached.stateHex;
    prev = decode(cached.stateHex, dealers);
    height = cached.height;
    seenAtHeight = new Set(cached.txHashesAtHeight);
    all = cached.events;
    o.onDealers?.(dealers);
    yield { events: cached.events, height: cached.height, live: false };
  }

  // "Caught up" means replay has reached the contract's most recent action. (An idle timeout is not
  // enough: the first replayed action can take seconds to arrive, and an early "live" would show an
  // empty feed as if the contract had no history.)
  const [tip, latest] = await Promise.all([queryTipHeight(o.indexerHttp), queryContractStateHex(o.indexerHttp, o.contract)]);
  const lastActionHeight = latest?.height ?? 0;
  const queue = new AsyncQueue<RawAction>();
  const client = createClient({ url: o.indexerWs, retryAttempts: 3, lazy: true });
  const unsubscribe = client.subscribe<{ contractActions: RawAction }>(
    {
      query: `subscription ACTIONS($address: HexEncoded!, $offset: BlockOffset) {
        contractActions(address: $address, offset: $offset) {
          __typename state
          transaction { hash block { height timestamp } }
          ... on ContractCall { entryPoint }
        }
      }`,
      variables: { address: o.contract, offset: { height } },
    },
    {
      next: (msg) => {
        if (msg.errors?.length) queue.fail(new Error(`Indexer subscription error: ${msg.errors.map((e) => e.message).join('; ')}`));
        else if (msg.data?.contractActions) queue.push(msg.data.contractActions);
      },
      error: (err) => queue.fail(err instanceof Error ? err : new Error(`Indexer subscription closed: ${JSON.stringify(err)}`)),
      complete: () => queue.end(),
    },
  );
  const abort = () => queue.end();
  o.signal?.addEventListener('abort', abort);

  let live = false;
  let lastSave = 0;
  const save = async () => {
    if (!prevHex) return;
    const record: EventCache = {
      version: CACHE_VERSION,
      contract: o.contract,
      height,
      txHashesAtHeight: [...seenAtHeight],
      stateHex: prevHex,
      dealers: [...dealers],
      events: all,
    };
    await o.store.set(o.cacheKey, record).catch(() => undefined);
    lastSave = Date.now();
  };

  try {
    while (!o.signal?.aborted) {
      const first = await queue.next(IDLE_MS);
      if (first === undefined) {
        if (queue.closed) break;
        if (!live && height >= lastActionHeight) {
          live = true;
          yield { events: [], height: Math.max(height, tip), live: true };
        }
        continue;
      }
      const batch: ProtocolEvent[] = [];
      let action: RawAction | undefined = first;
      while (action) {
        const h = action.transaction.block.height;
        const dup = h === height && seenAtHeight.has(action.transaction.hash);
        if (!dup) {
          if (h !== height) seenAtHeight = new Set();
          seenAtHeight.add(action.transaction.hash);
          height = h;
          const next = decode(action.state, dealers);
          for (const k of next.bonds.keys()) dealers.add(k);
          const events = deriveEvents(prev, next, {
            typename: action.__typename,
            entryPoint: action.entryPoint,
            txHash: action.transaction.hash,
            height: h,
            timestamp: toSecs(action.transaction.block.timestamp),
          });
          batch.push(...events);
          prev = next;
          prevHex = action.state;
        }
        action = queue.size > 0 && batch.length < 500 ? await queue.next() : undefined;
      }
      if (height >= lastActionHeight) live = true;
      all = all.concat(batch);
      o.onDealers?.(dealers);
      if (batch.length || live) yield { events: batch, height, live };
      if (Date.now() - lastSave > 5000 || live) await save();
    }
  } finally {
    o.signal?.removeEventListener('abort', abort);
    unsubscribe();
    await save();
    void client.dispose();
  }
}
