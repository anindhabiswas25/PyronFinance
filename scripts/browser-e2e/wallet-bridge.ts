// A DApp Connector (dapp-connector-api 4.x) served from Node by one of the project's headless wallets,
// so the real web client can be driven end to end on Preprod without a browser extension.
//
// Every method does what the live scripts already proved on-chain with the same wallet:
//   balanceSealedTransaction   -> facade.balanceFinalizedTransaction + signRecipe + finalizeRecipe (settleFromOffer)
//   balanceUnsealedTransaction -> facade.balanceUnboundTransaction + signRecipe + finalizeRecipe (walletProvider.balanceTx)
//   submitTransaction          -> facade.submitTransaction
//   makeIntent                 -> buildAndProveOffer (initSwap + signRecipe + finalizeRecipe, payFees false)
//   getProvingProvider         -> the proof server's /check and /prove with the compiled contract keys
//
// What this does NOT test: a real extension's own behaviour (1AM's makeTransfer shape, Lace's prompts,
// how either proves). It tests everything the client does with a conforming wallet.

import { inspect } from 'node:util';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { ChainConfig } from '../../packages/sdk/src/config.js';
import type { HeadlessWallet } from '../../packages/sdk/src/wallet.js';
import { zkConfigPath } from '../../packages/sdk/src/contract.js';
import { buildAndProveOffer, type TokenKind } from '../../packages/sdk/src/offers.js';

// ── Wire encoding shared with inject.ts: bigint and Uint8Array survive JSON ─────────────────────
const BIG = '$bigint';
const BYTES = '$bytes';

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const raw = key === '' ? v : this[key];
    if (typeof raw === 'bigint') return { [BIG]: raw.toString() };
    if (raw instanceof Uint8Array) return { [BYTES]: Buffer.from(raw).toString('hex') };
    return v;
  });
}

export function decodeWire<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === BIG) return BigInt(v[BIG]);
      if (keys.length === 1 && keys[0] === BYTES) return new Uint8Array(Buffer.from(v[BYTES], 'hex'));
    }
    return v;
  }) as T;
}

const fromHex = (h: string) => new Uint8Array(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export interface WalletBridge {
  /** Handles one call from the page: `argsText` is encodeWire(args); returns encodeWire({ok, value|error}). */
  call(method: string, argsText: string): Promise<string>;
  readonly calls: Array<{ method: string; ms: number; ok: boolean; error?: string }>;
}

export function createWalletBridge(wallet: HeadlessWallet, chain: ChainConfig, log: (m: string) => void): WalletBridge {
  const proving = httpClientProvingProvider(chain.proofServer, new NodeZkConfigProvider(zkConfigPath));
  const synced = () => Rx.firstValueFrom(wallet.facade.state().pipe(Rx.filter((s) => s.isSynced)));
  const calls: WalletBridge['calls'] = [];

  const handlers: Record<string, (...args: any[]) => Promise<unknown>> = {
    async getConfiguration() {
      return { indexerUri: chain.indexerHttp, indexerWsUri: chain.indexerWs, substrateNodeUri: chain.rpc, networkId: chain.network };
    },
    async getConnectionStatus() {
      return { status: 'connected', networkId: chain.network };
    },
    async hintUsage() {
      return undefined;
    },
    async getUnshieldedAddress() {
      return { unshieldedAddress: wallet.unshieldedAddress };
    },
    async getShieldedAddresses() {
      await synced();
      return {
        shieldedAddress: '',
        shieldedCoinPublicKey: wallet.walletAndMidnightProvider.getCoinPublicKey(),
        shieldedEncryptionPublicKey: wallet.walletAndMidnightProvider.getEncryptionPublicKey(),
      };
    },
    async getUnshieldedBalances() {
      return (await synced()).unshielded.balances;
    },
    async getShieldedBalances() {
      return {};
    },
    async getDustBalance() {
      const balance = (await synced()).dust.balance(new Date());
      return { balance, cap: balance };
    },
    async getTxHistory() {
      return [];
    },
    async balanceSealedTransaction(txHex: string) {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(txHex));
      const recipe = await wallet.facade.balanceFinalizedTransaction(tx as never, wallet.secretKeys, { ttl: new Date(Date.now() + 30 * 60_000) });
      try {
        const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
        const finalized = await wallet.facade.finalizeRecipe(signed);
        return { tx: toHex(finalized.serialize()) };
      } catch (err) {
        await wallet.facade.revert(recipe).catch(() => undefined);
        throw err;
      }
    },
    async balanceUnsealedTransaction(txHex: string) {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', fromHex(txHex));
      const finalized = await wallet.walletAndMidnightProvider.balanceTx(tx as never);
      return { tx: toHex((finalized as unknown as ledger.FinalizedTransaction).serialize()) };
    },
    async submitTransaction(txHex: string) {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(txHex));
      await wallet.facade.submitTransaction(tx as never);
      return undefined;
    },
    async makeIntent(inputs: Array<{ kind: TokenKind; type: string; value: bigint }>, outputs: Array<{ kind: TokenKind; type: string; value: bigint; recipient: string }>) {
      if (inputs.length !== 1 || outputs.length > 1) throw new Error('the test wallet builds swap halves with one input leg and at most one output leg');
      if (outputs[0] && outputs[0].recipient !== wallet.unshieldedAddress) throw new Error('the test wallet only builds halves that pay itself');
      const offer = await buildAndProveOffer({
        wallet,
        give: { kind: inputs[0].kind, token: inputs[0].type, amount: BigInt(inputs[0].value) },
        want: outputs[0] ? { kind: outputs[0].kind, token: outputs[0].type, amount: BigInt(outputs[0].value) } : undefined,
      });
      return { tx: Buffer.from(offer.offerFileBase64, 'base64').toString('hex') };
    },
    async proverCheck(preimage: Uint8Array, keyLocation: string) {
      return proving.check(preimage, keyLocation);
    },
    async proverProve(preimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint) {
      return proving.prove(preimage, keyLocation, overwriteBindingInput ?? undefined);
    },
    async signData() {
      throw new Error('the test wallet does not sign data');
    },
  };

  return {
    calls,
    async call(method, argsText) {
      const started = Date.now();
      const handler = handlers[method];
      try {
        if (!handler) throw new Error(`the test wallet has no method ${method}`);
        const value = await handler(...decodeWire<unknown[]>(argsText));
        calls.push({ method, ms: Date.now() - started, ok: true });
        if (!method.startsWith('get') && method !== 'hintUsage') log(`[wallet] ${method} ok in ${Date.now() - started} ms`);
        return encodeWire({ ok: true, value });
      } catch (err) {
        // Keep nested fields: the node's "Custom error: N" code lives there, and the client digs it out.
        const error = `${(err as Error)?.message ?? String(err)} ${inspect(err, { depth: 8, breakLength: Infinity })}`.slice(0, 20_000);
        calls.push({ method, ms: Date.now() - started, ok: false, error: error.slice(0, 300) });
        log(`[wallet] ${method} FAILED in ${Date.now() - started} ms: ${error.slice(0, 400)}`);
        return encodeWire({ ok: false, error });
      }
    },
  };
}
