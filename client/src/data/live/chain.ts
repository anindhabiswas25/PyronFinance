// ChainPort over a public indexer. Reads contract state over HTTP, decodes it with a lazily loaded
// decoder, caches the snapshot for 2 s, and never caches a failure (a failed read must surface as
// "couldn't verify", and the next read must try again).

import type { ChainReader } from '@otc/sdk/browser';
import type { AsyncStore, ChainPort, DealerView, LedgerSnapshot } from '../ports';
import { loadDecoder } from './decode';
import { IndexerError, queryContractStateHex, queryTransaction } from './indexer-http';
import { followContractEvents } from './events';
import { coinRef, spentByOwner } from './spent';

export interface LiveChainOptions {
  networkId: string;
  indexerHttp: string;
  indexerWs: string;
  contractAddress: string;
  deployHeight?: number;
  store: AsyncStore;
  ttlMs?: number;
}

export function createLiveChain(options: LiveChainOptions): ChainPort {
  const o = { ...options };
  const ttl = o.ttlMs ?? 2000;
  const knownDealers = new Set<string>();
  let cached: { at: number; value: Promise<LedgerSnapshot> } | undefined;
  let reader: Promise<ChainReader> | undefined;
  // One replay per owner serves every coin checked together (an offer's inputs share an owner).
  const spends = new Map<string, { at: number; value: Promise<Map<string, string>> }>();

  function snapshot(): Promise<LedgerSnapshot> {
    if (cached && Date.now() - cached.at < ttl) return cached.value;
    const value = (async () => {
      const [raw, decode] = await Promise.all([queryContractStateHex(o.indexerHttp, o.contractAddress), loadDecoder()]);
      if (!raw) throw new IndexerError(`The indexer has no contract at ${o.contractAddress} on ${o.networkId}`, 'graphql');
      return { view: decode(raw.stateHex, knownDealers), height: raw.height };
    })();
    const entry = { at: Date.now(), value };
    cached = entry;
    value.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return value;
  }

  return {
    snapshot,
    async quote(quoteId) {
      return (await snapshot()).view.quotes.get(quoteId);
    },
    async dealer(dealerCmt): Promise<DealerView> {
      knownDealers.add(dealerCmt);
      const { view } = await snapshot();
      const bond = view.bonds.get(dealerCmt);
      const settled = view.settled.get(dealerCmt);
      const slashed = view.slashed.get(dealerCmt);
      return { dealerCmt, bond, settled: settled ?? 0n, slashed: slashed ?? 0n, known: Boolean(bond || settled !== undefined || slashed !== undefined) };
    },
    events(options = {}) {
      return followContractEvents({
        indexerHttp: o.indexerHttp,
        indexerWs: o.indexerWs,
        contract: o.contractAddress,
        cacheKey: `events:${o.networkId}:${o.contractAddress}`,
        store: o.store,
        deployHeight: o.deployHeight,
        fromHeight: options.fromHeight,
        signal: options.signal,
        onDealers: (d) => {
          for (const k of d) knownDealers.add(k);
        },
      });
    },
    transaction: (by) => queryTransaction(o.indexerHttp, by),
    async ledgerParameters() {
      const sdk = await import('@otc/sdk/browser');
      return sdk.queryLedgerParameters(o.indexerHttp);
    },
    // The indexer API (v4) has no lookup of an unshielded output by intentHash:outputIndex, so the coin
    // is found among its owner's spends (spent.ts).
    async inputSpent(intentHash, outputNo, owner) {
      if (!owner) return 'unsupported';
      const sdk = await import('@otc/sdk/browser');
      const address = sdk.encodeMidnightBech32m('addr', o.networkId, sdk.hexToBytes(owner.replace(/^0x/, '')));
      let entry = spends.get(address);
      if (!entry || Date.now() - entry.at > 5000) {
        const value = spentByOwner(o.indexerWs, address);
        const fresh = { at: Date.now(), value };
        entry = fresh;
        spends.set(address, fresh);
        value.catch(() => {
          if (spends.get(address) === fresh) spends.delete(address);
        });
      }
      const byTx = (await entry.value).get(coinRef(intentHash, outputNo));
      return byTx ? { spent: true, byTx } : { spent: false };
    },
    useIndexer(http, ws) {
      if (http === o.indexerHttp && ws === o.indexerWs) return;
      o.indexerHttp = http;
      o.indexerWs = ws;
      cached = undefined;
      reader = undefined;
      spends.clear();
    },
    chainReader(): ChainReader {
      const get = () => {
        reader ??= import('@otc/sdk/browser')
          .then((sdk) => sdk.indexerChainReader(o.indexerHttp, o.contractAddress))
          .catch((err) => {
            reader = undefined;
            throw err;
          });
        return reader;
      };
      return {
        quote: async (id) => (await get()).quote(id),
        dealer: async (cmt) => (await get()).dealer(cmt),
      };
    },
  };
}
