// Build-time configuration (import.meta.env) plus the one runtime switch: the data source.

export type DataSource = 'fixture' | 'live';

export interface ClientEnv {
  network?: string;
  dataSource?: DataSource;
  relays?: string[];
  contractAddress?: string;
  indexerHttp?: string;
  indexerWs?: string;
  enableCircuits: boolean;
  dev: boolean;
}

export function readEnv(): ClientEnv {
  const e = import.meta.env;
  const source = e.VITE_DATA_SOURCE;
  return {
    network: e.VITE_NETWORK || undefined,
    dataSource: source === 'fixture' || source === 'live' ? source : undefined,
    relays: e.VITE_RELAYS
      ? e.VITE_RELAYS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    contractAddress: e.VITE_CONTRACT_ADDRESS || undefined,
    indexerHttp: e.VITE_INDEXER_HTTP || undefined,
    indexerWs: e.VITE_INDEXER_WS || undefined,
    enableCircuits: e.VITE_ENABLE_CIRCUITS === 'true',
    dev: Boolean(e.DEV),
  };
}

const DATA_SOURCE_KEY = 'pyron:data-source';

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

function sessionStore(): SessionLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** `?data=fixture|live` wins and is remembered for the tab; then the tab's earlier choice; then
 *  VITE_DATA_SOURCE; then fixture in dev and live in a production build. */
export function resolveDataSource(search: string, env: ClientEnv, store: SessionLike | undefined = sessionStore()): DataSource {
  const param = new URLSearchParams(search).get('data');
  if (param === 'fixture' || param === 'live') {
    try {
      store?.setItem(DATA_SOURCE_KEY, param);
    } catch {
      // Storage blocked: the URL still decides for this page.
    }
    return param;
  }
  try {
    const saved = store?.getItem(DATA_SOURCE_KEY);
    if (saved === 'fixture' || saved === 'live') return saved;
  } catch {
    // fall through
  }
  return env.dataSource ?? (env.dev ? 'fixture' : 'live');
}
