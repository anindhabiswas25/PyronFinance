// Shared chain configuration — every component (SDK scripts, relay-node, dealer-node)
// reads the same MN_ env vars, per docs/DEALER-NODE.md and the midnight-deployment skill.
// Committed .env.<network> files hold endpoints only, never seeds or keys — see .gitignore.

export type NetworkId = 'undeployed' | 'preview' | 'preprod' | 'mainnet';

export interface ChainConfig {
  network: NetworkId;
  indexerHttp: string;
  indexerWs: string;
  rpc: string;
  proofServer: string;
  contractAddress?: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.${process.env.MN_NETWORK ?? 'preprod'} to .env ` +
        `and fill in secrets (MN_WALLET_SEED), or export it directly.`,
    );
  }
  return v;
}

// Fail fast at startup — a component that starts with bad config and discovers it at quote
// time can miss a challenge window, which costs the entire bond. See midnight-deployment SKILL.md §2.
export function loadChainConfig(): ChainConfig {
  const network = (process.env.MN_NETWORK ?? 'preprod') as NetworkId;
  const config: ChainConfig = {
    network,
    indexerHttp: required('MN_INDEXER'),
    indexerWs: required('MN_INDEXER_WS'),
    rpc: process.env.MN_RPC ?? '',
    proofServer: process.env.MN_PROOF_SERVER ?? 'http://localhost:6300',
    contractAddress: process.env.MN_CONTRACT_ADDRESS,
  };
  if (network !== 'undeployed' && !config.rpc) {
    throw new Error('MN_RPC is required for any network other than undeployed');
  }
  return config;
}

/** Password for the LevelDB private-state store's at-rest encryption. NOT the wallet seed —
 *  this only protects locally cached witness/private state, never funds. The installed
 *  midnight-js-level-private-state-provider (4.0.2) requires this; the midnight-js skill's
 *  documented example predates it. Must be >= 16 characters. */
export function requirePrivateStatePassword(): string {
  const pw = process.env.MN_PRIVATE_STATE_PASSWORD;
  if (!pw || pw.length < 16) {
    throw new Error(
      'MN_PRIVATE_STATE_PASSWORD is not set or is shorter than 16 characters. This encrypts the ' +
        'local private-state cache at rest — generate one with e.g. `openssl rand -base64 24` and ' +
        'put it in .env (git-ignored).',
    );
  }
  // The store also demands 3 of 4 character classes, but says so only when it is first opened — after a
  // wallet sync. Found 2026-09-14 timing the operator README: a hex password (`openssl rand -hex 16`,
  // lowercase + digits) passed this check and failed at `bond`. Checked here so it fails before any sync.
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) {
    throw new Error(
      `MN_PRIVATE_STATE_PASSWORD must contain at least 3 of: uppercase letters, lowercase letters, digits, ` +
        `special characters (found ${classes}). A hex string does not qualify; \`openssl rand -base64 24\` normally does.`,
    );
  }
  return pw;
}

export function requireWalletSeed(): string {
  const seed = process.env.MN_WALLET_SEED;
  if (!seed) {
    throw new Error(
      'MN_WALLET_SEED is not set. This must come from a local .env (git-ignored) or a secrets ' +
        'manager — never commit a seed. See midnight-deployment SKILL.md §2.',
    );
  }
  return seed;
}
