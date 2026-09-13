// Manual "latest state" queries that avoid the offset:null bug on hosted indexers
// (preview/preprod) — see indexer SKILL.md §2. The SDK default `queryContractState()` without an
// explicit offset hits this bug; always use these helpers instead of the bare provider method
// for "give me the latest state."

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { LedgerParameters } from '@midnight-ntwrk/ledger-v8';

function fromHex(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

async function gqlQuery(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`);
  const payload = (await res.json()) as GraphQLResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  return payload.data;
}

export async function queryLatestContractState(
  indexerHttpUrl: string,
  contractAddress: string,
): Promise<ContractState | null> {
  const data = await gqlQuery(
    indexerHttpUrl,
    `query LATEST_STATE($address: HexEncoded!) {
      contractAction(address: $address) { state }
    }`,
    { address: contractAddress },
  );
  const contractAction = data?.contractAction as { state?: string } | undefined;
  return contractAction?.state ? ContractState.deserialize(fromHex(contractAction.state)) : null;
}

/** The chain's LIVE ledger parameters, as of the indexer's latest block — the same source the dust
 *  wallet syncs them from. Not `LedgerParameters.initialParameters()`, which is a static default:
 *  on 2026-09-13 both Preview and Preprod differed from it in every cost-model constant that the
 *  node's time-to-dismiss check uses (docs/ROADMAP.md S5). */
export async function queryLedgerParameters(
  indexerHttpUrl: string,
): Promise<{ height: number; params: LedgerParameters }> {
  const data = await gqlQuery(indexerHttpUrl, `query { block { height ledgerParameters } }`, {});
  const block = data?.block as { height: number; ledgerParameters: string } | undefined;
  if (!block?.ledgerParameters) throw new Error('indexer returned no block ledgerParameters');
  return { height: block.height, params: LedgerParameters.deserialize(fromHex(block.ledgerParameters)) };
}

export interface IndexedTransaction {
  hash: string;
  identifiers: string[];
  status: string | undefined;
  blockHeight: number;
}

/** Looks a transaction up by the identifier `facade.submitTransaction` returns — a 66-hex id, which
 *  is NOT the transaction hash (docs/ROADMAP.md). Returns undefined until the indexer has it. The
 *  `transactionResult.status` is what proves a submission landed: a submit receipt only proves the
 *  node accepted it into the pool. Shape confirmed against the Preprod indexer 2026-09-14. */
export async function queryTransaction(
  indexerHttpUrl: string,
  by: { identifier: string } | { hash: string },
): Promise<IndexedTransaction | undefined> {
  const data = await gqlQuery(
    indexerHttpUrl,
    `query TX($offset: TransactionOffset!) {
      transactions(offset: $offset) {
        hash block { height }
        ... on RegularTransaction { identifiers transactionResult { status } }
      }
    }`,
    { offset: by },
  );
  const txs = data?.transactions as
    | Array<{ hash: string; block: { height: number }; identifiers?: string[]; transactionResult?: { status: string } }>
    | undefined;
  const tx = txs?.[0];
  if (!tx) return undefined;
  return { hash: tx.hash, identifiers: tx.identifiers ?? [], status: tx.transactionResult?.status, blockHeight: tx.block.height };
}

/** Polls `queryTransaction` until the indexer reports the transaction, tolerating the intermittent
 *  connect timeouts Preprod's indexer is known for. */
export async function waitForTransaction(
  indexerHttpUrl: string,
  by: { identifier: string } | { hash: string },
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<IndexedTransaction> {
  const { timeoutMs = 10 * 60_000, intervalMs = 5_000 } = options;
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await queryTransaction(indexerHttpUrl, by);
      if (tx) return tx;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `transaction ${JSON.stringify(by)} not seen by the indexer after ${timeoutMs} ms` +
      (lastErr ? ` (last error: ${(lastErr as Error).message})` : ''),
  );
}

/** Polls for the contract to appear on the indexer after a deploy — indexer lag is typically
 *  2–10s on preprod (indexer SKILL.md §11), never immediate. */
export async function pollForContractState(
  indexerHttpUrl: string,
  contractAddress: string,
  options: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<ContractState | null> {
  const { maxAttempts = 30, intervalMs = 2000 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const state = await queryLatestContractState(indexerHttpUrl, contractAddress);
    if (state) return state;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
