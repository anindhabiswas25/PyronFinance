#!/usr/bin/env node
// Standalone relay node entrypoint — `pnpm --filter @otc/relay-node start`. Configuration is
// environment-variable driven, per docs/RELAY.md §7: RELAY_PORT, RELAY_PEERS, RELAY_MAX_MSG_BYTES,
// RELAY_ENABLE_MAILBOX, RELAY_PAIRS. No required cloud dependencies, no database.

import { startRelayServer } from './server.js';

const port = Number(process.env.RELAY_PORT ?? 8787);
const peers = (process.env.RELAY_PEERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const maxMsgBytes = process.env.RELAY_MAX_MSG_BYTES ? Number(process.env.RELAY_MAX_MSG_BYTES) : undefined;
const enableMailbox = process.env.RELAY_ENABLE_MAILBOX === 'true';
const pairs = (process.env.RELAY_PAIRS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const server = startRelayServer({ port, peers, maxMsgBytes, enableMailbox, pairs });

console.log(
  `[relay-node] listening on :${port} (gossip=/gossip, mailbox=${enableMailbox}, bootstrap peers=${peers.length})`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[relay-node] ${sig} received, shutting down`);
    server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
