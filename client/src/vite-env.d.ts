/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** preprod | preview. Mainnet is not selectable. */
  readonly VITE_NETWORK?: string;
  /** Comma-separated relay gossip URLs, replacing the network's defaults. */
  readonly VITE_RELAYS?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_INDEXER_HTTP?: string;
  readonly VITE_INDEXER_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
