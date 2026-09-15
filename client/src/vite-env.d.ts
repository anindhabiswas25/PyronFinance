/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** preprod | preview. Mainnet is not selectable. */
  readonly VITE_NETWORK?: string;
  /** fixture | live. `?data=` in the URL overrides it for the tab. */
  readonly VITE_DATA_SOURCE?: string;
  /** Comma-separated relay gossip URLs, replacing the network's defaults. */
  readonly VITE_RELAYS?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_INDEXER_HTTP?: string;
  readonly VITE_INDEXER_WS?: string;
  /** "true" runs contract circuits from the browser (unverified; docs/ROADMAP.md). */
  readonly VITE_ENABLE_CIRCUITS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
