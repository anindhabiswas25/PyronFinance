// CircuitPort over the connected browser wallet. Every stage is real: the circuit runs on this device
// against the indexer's latest state, the wallet proves it (getProvingProvider), balances it and pays
// the DUST fee (balanceUnsealedTransaction), and submits it. Confirmation comes from the indexer,
// looked up by the identifiers of the transaction that was submitted, because the connector's
// submitTransaction resolves void.

import type { ChainPort, CircuitPort, CircuitStageId, WalletPort } from '../ports';
import { CircuitError, WalletError, messageOf } from '../../lib/errors';

/** Where the Vite build serves contracts/managed/otc-protocol/{keys,zkir} (vite.config.ts). */
export const ZK_ASSET_PATH = '/zk/otc-protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createLiveCircuits(o: {
  wallet: WalletPort;
  chain: ChainPort;
  contractAddress: string;
  confirmTimeoutMs?: number;
  pollMs?: number;
}): CircuitPort {
  return {
    async run(call, onStage) {
      if (!o.wallet.connected()) throw new WalletError('Connect a wallet first.', 'disconnected');
      const sdk = await import('@otc/sdk/browser');

      async function stage<T>(id: CircuitStageId, fn: () => Promise<T>, detail?: (v: T) => string | undefined): Promise<T> {
        onStage(id, 'active');
        try {
          const value = await fn();
          onStage(id, 'done', detail?.(value));
          return value;
        } catch (err) {
          onStage(id, 'failed', messageOf(err));
          if (err instanceof CircuitError || err instanceof WalletError) throw err;
          throw new CircuitError(messageOf(err), id, sdk.nodeErrorCode(err));
        }
      }

      const config = await o.wallet.config();
      const zkConfig = new sdk.FetchZkConfigProvider(new URL(ZK_ASSET_PATH, window.location.origin).toString());

      const unproven = await stage('prepare', async () => {
        const keys = await o.wallet.shieldedKeys();
        return sdk.prepareOtcCall({
          networkId: config.networkId,
          indexerHttp: config.indexerUri,
          contractAddress: o.contractAddress,
          zkConfig,
          coinPublicKey: keys.coinPublicKey,
          encryptionPublicKey: keys.encryptionPublicKey,
          circuit: call.circuit,
          args: call.args,
          privateState: { dealerSecretKey: call.dealerSecretKey ?? null, takerAddress: call.takerAddress ?? null },
        });
      });

      const proven = await stage('prove', async () => {
        const provider = await o.wallet.provingProvider(zkConfig);
        return sdk.proveOtcCall(unproven, provider as Parameters<typeof sdk.proveOtcCall>[1]);
      });

      const balancedHex = await stage('balance', () => o.wallet.balanceUnsealed(sdk.txToHex(proven)));
      const identifier = await stage('submit', async () => {
        const id = sdk.txIdentifiers(sdk.finalizedTxFromHex(balancedHex))[0];
        if (!id) throw new Error('the balanced transaction has no identifier');
        await o.wallet.submit(balancedHex);
        return id;
      });

      return stage(
        'confirm',
        async () => {
          const deadline = Date.now() + (o.confirmTimeoutMs ?? 10 * 60_000);
          while (Date.now() < deadline) {
            try {
              const tx = await o.chain.transaction({ identifier });
              if (tx) {
                if (tx.status && tx.status !== 'SUCCESS') throw new CircuitError(`The transaction landed with status ${tx.status}.`, 'confirm');
                return { txHash: tx.hash, blockHeight: tx.blockHeight, identifier };
              }
            } catch (err) {
              if (err instanceof CircuitError) throw err;
              // Indexer hiccup: keep waiting until the deadline.
            }
            await sleep(o.pollMs ?? 2000);
          }
          throw new CircuitError('The indexer has not shown this transaction after 10 minutes. It may still land.', 'confirm');
        },
        (r) => `Block ${r.blockHeight}`,
      );
    },
  };
}
