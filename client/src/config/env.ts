// Build-time configuration (import.meta.env).

/** Where a DataPorts bundle reads from. The app always runs 'live'; 'fixture' exists only in tests. */
export type DataSource = 'fixture' | 'live';

export interface ClientEnv {
  network?: string;
  relays?: string[];
  contractAddress?: string;
  indexerHttp?: string;
  indexerWs?: string;
  dev: boolean;
}

export function readEnv(): ClientEnv {
  const e = import.meta.env;
  return {
    network: e.VITE_NETWORK || undefined,
    relays: e.VITE_RELAYS
      ? e.VITE_RELAYS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    contractAddress: e.VITE_CONTRACT_ADDRESS || undefined,
    indexerHttp: e.VITE_INDEXER_HTTP || undefined,
    indexerWs: e.VITE_INDEXER_WS || undefined,
    dev: Boolean(e.DEV),
  };
}
