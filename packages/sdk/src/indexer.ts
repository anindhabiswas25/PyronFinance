// Manual "latest state" queries that avoid the offset:null bug on hosted indexers
// (preview/preprod) — see indexer SKILL.md §2. The SDK default `queryContractState()` without an
// explicit offset hits this bug; always use these helpers instead of the bare provider method
// for "give me the latest state."

import { ContractState } from '@midnight-ntwrk/compact-runtime';

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
