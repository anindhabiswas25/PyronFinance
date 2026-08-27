# @otc/relay-node

A standalone relay node for the Midnight OTC Protocol's gossip network — see
[`docs/RELAY.md`](../../docs/RELAY.md) for the normative wire spec this implements.

**Anyone can run one.** This is not a hosted service the protocol depends on; it holds no funds,
has no on-chain identity, and the only thing it's trusted for is liveness (see `docs/ARCHITECTURE.md`
Pillar 3). Run as many as you like, on your own infrastructure, with no registration.

## What it does

- Gossips `rfq` / `quote_ref` / `cancel` / `peer_announce` messages over WebSocket (`/gossip`),
  with content-addressed dedup, TTL-bounded propagation, per-peer rate limits, and a misbehavior
  score for persistent offenders.
- Serves `GET /health` and `GET /rfqs?pair=&since=` for clients that prefer polling over an open
  socket.
- Optionally offers a store-and-forward mailbox (`POST`/`GET /mailbox/:takerEncPk`) for dealers
  behind NAT who can't accept inbound reveal connections. The relay only ever holds an opaque
  ciphertext blob it cannot decrypt (see `docs/RELAY.md` §4) — this is enforced by never parsing
  `ciphertext`, not by policy.
- **Never sees a priced quote reveal.** Reveals travel point-to-point (or via the opaque mailbox)
  and are never gossiped, dedup'd, or logged in plaintext by this node.

## Run it

```sh
pnpm --filter @otc/relay-node start
```

## Configuration

All environment-variable driven. No required cloud dependencies, no database — state is
in-memory and expiring by design, so a restart loses nothing that matters.

| Var | Default | Meaning |
|---|---|---|
| `RELAY_PORT` | `8787` | HTTP + WebSocket listen port |
| `RELAY_PEERS` | (empty) | Comma-separated bootstrap peer endpoints, e.g. `wss://relay-a.example/gossip,wss://relay-b.example/gossip` |
| `RELAY_MAX_MSG_BYTES` | `65536` | Max frame size; larger frames are rejected |
| `RELAY_ENABLE_MAILBOX` | `false` | Set to `true` to serve the store-and-forward mailbox endpoints |
| `RELAY_PAIRS` | (empty) | Comma-separated pairs this node advertises (informational) |

## Development

```sh
pnpm --filter @otc/relay-node typecheck
pnpm test   # runs the whole workspace's vitest suite, including packages/relay-node/test
```

`src/schema.ts` is the single source of truth for the wire format, shared with `@otc/sdk`. If you
need to change the wire format, update `docs/RELAY.md` in the same change — the doc is normative,
this code is not.
