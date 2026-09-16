// Indexer GraphQL over HTTP, without the SDK (no WASM): raw contract state hex, transactions, tip.
// Queries confirmed against the Preprod indexer (api/v4) on 2026-09-15.

import type { IndexedTransaction } from '../ports';

export class IndexerError extends Error {
  constructor(
    message: string,
    readonly reason: 'network' | 'http' | 'graphql' | 'timeout',
  ) {
    super(message);
    this.name = 'IndexerError';
  }
}

export async function gql<T>(url: string, query: string, variables: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new IndexerError(`The indexer did not answer within ${timeoutMs / 1000} s`, 'timeout');
    throw new IndexerError(`Can't reach the indexer: ${(err as Error).message}`, 'network');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new IndexerError(`The indexer answered HTTP ${res.status}`, 'http');
  const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new IndexerError(`Indexer error: ${payload.errors.map((e) => e.message).join('; ')}`, 'graphql');
  return payload.data as T;
}

/** Block timestamps come back in milliseconds (observed on Preprod and Preview). */
export function toSecs(timestamp: number): number {
  return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
}

export async function queryContractStateHex(
  url: string,
  address: string,
): Promise<{ stateHex: string; height: number; timestamp: number } | undefined> {
  // No offset argument: the hosted indexers' offset:null bug (indexer skill §2).
  const data = await gql<{ contractAction?: { state: string; transaction: { block: { height: number; timestamp: number } } } }>(
    url,
    `query LATEST($address: HexEncoded!) { contractAction(address: $address) { state transaction { block { height timestamp } } } }`,
    { address },
  );
  const a = data.contractAction;
  if (!a) return undefined;
  return { stateHex: a.state, height: a.transaction.block.height, timestamp: toSecs(a.transaction.block.timestamp) };
}

export async function queryTipHeight(url: string): Promise<number> {
  const data = await gql<{ block: { height: number } }>(url, `query { block { height } }`);
  return data.block.height;
}

export async function queryTransaction(url: string, by: { hash: string } | { identifier: string }): Promise<IndexedTransaction | undefined> {
  const data = await gql<{
    transactions?: Array<{ hash: string; block: { height: number }; identifiers?: string[]; transactionResult?: { status: string } }>;
  }>(
    url,
    `query TX($offset: TransactionOffset!) {
      transactions(offset: $offset) {
        hash block { height }
        ... on RegularTransaction { identifiers transactionResult { status } }
      }
    }`,
    { offset: by },
  );
  const tx = data.transactions?.[0];
  if (!tx) return undefined;
  return { hash: tx.hash, identifiers: tx.identifiers ?? [], status: tx.transactionResult?.status, blockHeight: tx.block.height };
}
