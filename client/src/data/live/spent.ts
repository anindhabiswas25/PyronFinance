// Whether unshielded coins have been spent, from the indexer. The v4 API has no lookup by coin
// (intentHash:outputIndex), only the `unshieldedTransactions` subscription by owner address. So this
// replays the owner's history until the indexer reports it has caught up, and collects every spend.
// An offer's coins belong to the dealer, whose history is short; the cost is one short replay.

import { createClient } from 'graphql-ws';

interface SpentUtxo {
  intentHash: string;
  outputIndex: number;
}

type Event =
  | { __typename: 'UnshieldedTransaction'; transaction: { id: number; hash: string }; spentUtxos: SpentUtxo[] }
  | { __typename: 'UnshieldedTransactionsProgress'; highestTransactionId: number | null };

const norm = (h: string) => h.replace(/^0x/, '').toLowerCase();

/** Every coin the address has spent, mapped to the spending transaction's hash. Throws on timeout
 *  or a subscription error: the caller reports "couldn't check", never "unspent". */
export async function spentByOwner(indexerWs: string, address: string, timeoutMs = 30_000): Promise<Map<string, string>> {
  const spent = new Map<string, string>();
  const client = createClient({ url: indexerWs, retryAttempts: 1, lazy: true });
  let lastId = -1;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the indexer did not replay ${address.slice(0, 20)}… within ${timeoutMs / 1000} s`)), timeoutMs);
      const done = (err?: Error) => {
        clearTimeout(timer);
        unsubscribe();
        if (err) reject(err);
        else resolve();
      };
      const unsubscribe = client.subscribe<{ unshieldedTransactions: Event }>(
        {
          query: `subscription SPENT($address: UnshieldedAddress!) {
            unshieldedTransactions(address: $address) {
              __typename
              ... on UnshieldedTransaction { transaction { id hash } spentUtxos { intentHash outputIndex } }
              ... on UnshieldedTransactionsProgress { highestTransactionId }
            }
          }`,
          variables: { address },
        },
        {
          next: (msg) => {
            if (msg.errors?.length) return done(new Error(msg.errors.map((e) => e.message).join('; ')));
            const ev = msg.data?.unshieldedTransactions;
            if (!ev) return;
            if (ev.__typename === 'UnshieldedTransaction') {
              lastId = Math.max(lastId, ev.transaction.id);
              for (const s of ev.spentUtxos ?? []) spent.set(`${norm(s.intentHash)}:${s.outputIndex}`, norm(ev.transaction.hash));
            } else if (ev.highestTransactionId === null || ev.highestTransactionId <= lastId) {
              done();
            }
          },
          error: (err) => done(err instanceof Error ? err : new Error(`indexer subscription closed: ${JSON.stringify(err)}`)),
          complete: () => done(),
        },
      );
    });
    return spent;
  } finally {
    void client.dispose();
  }
}

export function coinRef(intentHash: string, outputNo: number): string {
  return `${norm(intentHash)}:${outputNo}`;
}
