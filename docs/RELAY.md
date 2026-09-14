# Relay Network — Gossip Protocol Specification

## What the relay is, and what it is not

The relay is a **protocol-level message format that anyone can run a node for.** It is not this
project's hosted backend, and the web client (`client/`) must never depend on a relay that only we operate.

This mirrors Midnight's own design intent for Offer Files: proved locally, serialized, and postable
anywhere — a Discord channel, a Telegram group, a shared namespace. The relay is the well-specified
version of "postable anywhere," with enough structure that clients can find each other.

**The test of whether this is really a protocol:** a third-party developer must be able to write a
compatible node from this document alone, without reading `packages/relay-node`. Everything below is
written to that standard — wire format, IDs, validation rules, and propagation semantics are all
normative here, and the reference implementation is just one conforming node.

### What relays can and cannot see

| Relay operators see | Relay operators never see |
|---|---|
| RFQs: pair, side, size, expiry, taker encryption pubkey | **Any price. Ever.** |
| That dealer X committed to a quote on RFQ Y until time T | Which dealer the taker chose |
| Which of their peers forwarded a message | The contents of any reveal |

**Priced reveals never enter the gossip layer.** Not encrypted-in-gossip, not
encrypted-and-broadcast — they do not enter it at all. A reveal travels point-to-point from the
dealer to the one taker who requested it. This is not merely a privacy nicety: if reveals were
broadcast in any form, a relay operator running a dealer node could harvest the ciphertext volume and
timing of competitors, and dealers would rationally stop quoting. Broadcasting reveals would destroy
the venue.

Relay nodes hold **no funds, have no on-chain identity, and have no privileged role.** A malicious
relay's maximum power is censorship — dropping messages — which is why takers query several.

---

## Trust model

Relays are **untrusted infrastructure**. Every security-relevant claim is verified against the chain
by the client, never taken from a relay.

- A gossiped quote-commitment reference is only a *hint that a commitment exists*. The taker
  independently recomputes `quoteId` and reads the real commitment from the chain. A relay that lies
  about a commitment achieves nothing — the client's chain read overrides it.
- A relay that suppresses messages is defeated by querying multiple relays (§5).
- A relay that injects fake RFQs wastes dealer effort but cannot cause loss; dealers may rate-limit
  by source.

The only thing relays are trusted for is **liveness**, and the only defense needed for liveness is
**multiplicity**.

---

## 1. Transport and framing

- **Transport:** WebSocket (`wss://` in production, `ws://` for local dev). Chosen over libp2p for
  the reference node because a taker's browser must speak it directly with no bridge.
- **Framing:** one JSON object per WebSocket message. UTF-8. No batching.
- **Max message size:** 64 KiB. Nodes MUST reject larger frames.
- **Versioning:** every message carries `v`. Nodes MUST ignore messages whose major version they do
  not implement, and MUST ignore unknown fields rather than erroring — this is what allows the schema
  to be extended without a flag day.

```
ws://<host>:<port>/gossip     peer-to-peer and client connections (same endpoint)
GET  http://<host>:<port>/health    -> { ok, peers, version, uptimeSec }
GET  http://<host>:<port>/rfqs?pair=&since=   -> recent RFQs (for clients that prefer polling)
POST http://<host>:<port>/mailbox/:takerEncPk -> store one opaque reveal blob (§4); 202 on accept
GET  http://<host>:<port>/mailbox/:takerEncPk -> fetch and clear pending blobs for a recipient (§4)
```

**HTTP endpoints MUST allow cross-origin reads so browser takers can use them.** A taker's page is
served from an origin the relay does not know, and a browser refuses to hand it a response without
these headers. Every HTTP response (errors included) MUST carry
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS` and
`Access-Control-Allow-Headers: content-type`, and an `OPTIONS` request to `/health`, `/rfqs` or
`/mailbox/:takerEncPk` MUST be answered `204` with the same headers. The wildcard is safe: a relay
holds only public gossip and ciphertext it cannot read, and uses no cookies or credentials.

The mailbox routes only exist when a node runs with `RELAY_ENABLE_MAILBOX=true` (§7) — a node with
it disabled 404s them. They are deliberately HTTP, not WebSocket gossip: reveal messages must never
enter the gossip layer (§4), so they are never dedup'd, TTL-forwarded, or broadcast the way
`rfq`/`quote_ref`/`cancel`/`peer_announce` are.

---

## 2. Message envelope

Every gossip message shares one envelope:

```jsonc
{
  "v": 1,
  "type": "rfq" | "quote_ref" | "cancel" | "peer_announce",
  "id": "<hex32>",        // content-addressed; see §3
  "ts": 1756300000,       // unix seconds, sender's clock
  "ttl": 8,               // hop budget; decremented on forward, dropped at 0
  "body": { ... },        // type-specific, below
  "sig": "<hex64>"        // optional; REQUIRED for quote_ref and cancel
}
```

**`id` is content-addressed**, not random: `id = blake2b256(canonicalJSON(body))` — a native
256-bit-output BLAKE2b digest (32 bytes), not a wider BLAKE2b variant truncated after the fact (see
below — those are different functions with different internal IVs). Two nodes independently
receiving the same message compute the same `id`, which is what makes
deduplication work without coordination. `canonicalJSON` means keys sorted lexicographically, no
insignificant whitespace, integers without exponents.

`blake2b256`: Node's OpenSSL build exposes `blake2b512`/`blake2s256` but not a 256-bit-output
BLAKE2b (verified 2026-08-28 via `crypto.getHashes()`) — truncating `blake2b512` is **not** the
same function, since BLAKE2b's initialization vector depends on the declared output length. The
reference node uses `@noble/hashes` (pure JS, audited, no native deps) for a real 256-bit BLAKE2b
rather than silently substituting SHA-256 or a truncated BLAKE2b-512.

**`sig` encoding.** `<hex64>` above is shorthand for "a hex-encoded signature blob," not a literal
64-hex-character length — a Jubjub Schnorr signature (an EC point announcement plus a scalar
response) doesn't fit in 32 bytes. The reference encoding is
`announcement.x (32B) || announcement.y (32B) || response (32B)`, hex-encoded to 192 characters
(`encodeSchnorrSignature`/`decodeSchnorrSignature` in `packages/sdk/src/schnorr.ts`, re-exported
from `packages/relay-node/src/schema.ts`).

**What message the `quote_ref`/`cancel` signature is actually over.** This signature never touches
the chain — no circuit ever verifies it — so it is *not* required to use the same message encoding
the contract's in-circuit Schnorr verification uses. The reference implementation signs a single
field element: `reduceToField(blake2b256(canonicalJSON(body)))`. This exists purely so relays and
takers can attribute a message to a dealer key without a chain read; it carries no on-chain
significance and dealers should not assume signing convention parity with reveal signatures (§4)
or any contract circuit.

**A relay cannot cryptographically verify these signatures, only their shape.** RELAY.md's own
"drop and penalize" wording in §5 implies a validity check, but `quote_ref`/`cancel` carry only
`dealerCmt` — a one-way hash of the dealer's quote key (`docs/CONTRACTS.md`) — never the public key
itself, and a relay must not read the chain to resolve `dealerCmt -> quotePk` (untrusted-relay
invariant, `docs/ARCHITECTURE.md` Pillar 3). So a relay validates only that `sig` is present and
correctly shaped (192 hex chars); actual cryptographic verification against the on-chain `quotePk`
is the client's job, per §3.2 step 3. A relay that skipped this and instead cached and trusted a
`quotePk` from prior traffic would be reintroducing exactly the trusted intermediary the untrusted-
relay model rejects.

---

## 3. Message types

### 3.1 `rfq` — taker requests a quote

Broadcast. Unsigned by default: takers are ephemeral and requiring a taker identity would create the
very identity surface this protocol avoids.

```jsonc
{
  "v": 1, "type": "rfq", "id": "<hex32>", "ts": 1756300000, "ttl": 8,
  "body": {
    "rfqId":      "<hex32>",   // taker-generated random; becomes the on-chain rfqId
    "pair":       "tNIGHT/USDM",
    "side":       "buy" | "sell",   // taker's side of the base asset
    "size":       "1000.0",         // decimal string, base asset units — never a float
    "expiry":     1756300300,       // unix secs; dealers must not quote after this
    "takerEncPk": "<hex32>",        // X25519 pubkey; reveals are encrypted to this
    "replyTo":    ["wss://relay-a.example/gossip", "wss://relay-b.example/gossip"],
    "minBond":    "5000"            // optional: dealers below this need not bother
  }
}
```

Notes:
- `size` and all amounts are **decimal strings**, never JSON numbers. IEEE-754 doubles silently lose
  precision on realistic notionals, and a rounding discrepancy between a taker's client and a
  dealer's would surface as an unexplained settlement failure.
- `takerEncPk` is **ephemeral per RFQ.** Reusing it across RFQs would let relays link a taker's
  activity into a profile, which is exactly the linkability the venue is meant to prevent.
- `replyTo` lists relays the taker is listening on, so a dealer reached via one relay can respond via
  another.

### 3.2 `quote_ref` — dealer signals that a sealed commitment exists

Broadcast. **Signed by the dealer's quote key** (the same key registered on-chain in `postBond`), so
relays and takers can attribute it without a chain read.

This message carries **no price**. Its entire purpose is to tell the taker *which chain records to go
read* and *how to reach the dealer for the reveal*.

```jsonc
{
  "v": 1, "type": "quote_ref", "id": "<hex32>", "ts": 1756300010, "ttl": 8,
  "body": {
    "rfqId":      "<hex32>",
    "dealerCmt":  "<hex32>",    // dealer commitment, matches the on-chain key
    "quoteId":    "<hex32>",    // deterministic; taker recomputes and verifies
    "validUntil": 1756300900,
    "txHash":     "<hex32>",    // the commitQuote tx, so the client can confirm inclusion
    "revealVia":  "direct",     // reveal channel; see §4
    "dealerEndpoint": "wss://dealer-a.example/reveal",  // or a relay-mediated mailbox
    "dealerEncPk": "<hex32>"    // X25519 pubkey the taker encrypts its reveal request to
  },
  "sig": "<hex64>"              // Schnorr over canonicalJSON(body), dealer quote key
}
```

**A `quote_ref` is a hint, never evidence.** Receiving one, a taker MUST:
1. Recompute `quoteId = H("otc:quote:v1" ‖ dealerCmt ‖ rfqId ‖ commitment)` from the *on-chain*
   commitment and check it matches.
2. Read `bonds[dealerCmt]` from the chain for the real bond, settled, and slash counts.
3. Verify `sig` against the on-chain `quotePk`.

A client that skips these and trusts the relay's numbers has reintroduced a trusted intermediary and
given up the protocol's actual guarantee.

### 3.3 `cancel` — dealer withdraws before expiry

Signed. Advisory only: **it has no on-chain effect and does not release the dealer from the
commitment.** ~~A dealer who cancels but is challenged inside the validity window is still slashed.~~
(Class B challenges were removed 2026-09-14.) A cancel does not revoke the Offer File the taker
already holds: the taker can still settle it, and a dealer who makes it fail by spending its inputs
leaves attributable failure evidence either way.
This exists so takers do not waste time on quotes the dealer has already replaced, not as an escape
hatch — an off-chain cancel that released an on-chain obligation would be precisely the last-look
loophole this protocol exists to close.

```jsonc
{ "v": 1, "type": "cancel", "id": "<hex32>", "ts": ..., "ttl": 8,
  "body": { "quoteId": "<hex32>", "dealerCmt": "<hex32>" }, "sig": "<hex64>" }
```

### 3.4 `peer_announce` — node discovery

```jsonc
{ "v": 1, "type": "peer_announce", "id": "<hex32>", "ts": ..., "ttl": 3,
  "body": { "endpoint": "wss://relay-c.example/gossip", "pairs": ["tNIGHT/USDM"] } }
```

---

## 4. The reveal channel is NOT the gossip layer

Stated separately because it is the single most important boundary in this document.

After `commitQuote` lands, the dealer sends the priced reveal **directly to the taker**, encrypted to
the `takerEncPk` from the RFQ:

```jsonc
// Sent point-to-point over the dealer's reveal endpoint. NEVER gossiped, NEVER stored by a relay.
{
  "v": 1, "type": "reveal", "quoteId": "<hex32>",
  "ciphertext": "<base64>",   // X25519-ECDH -> ChaCha20-Poly1305, sealed to takerEncPk
  "sig": "<hex64>"            // Schnorr over the PLAINTEXT terms, dealer quote key
}

// Plaintext inside `ciphertext`:
{ "pair": "tNIGHT/USDM", "side": "sell", "price": "0.0412", "size": "1000.0",
  "nonce": "<hex32>",         // the commitment nonce — lets the taker open the commitment
  "offerFile": "<base64>",    // the serialized, locally-proved Zswap Offer File
  "expiresAt": 1756300900 }
```

Two properties make this work:

- **The signature is over the plaintext terms.** This is what makes Class-A fraud proofs possible: a
  signed reveal that does not open the on-chain commitment is a self-contained, non-repudiable proof
  of fraud that anyone can submit. A dealer cannot later claim the taker fabricated it. If reveals
  were unsigned, the entire Class-A slashing path would collapse — anyone could forge a
  "mismatching reveal" and slash an honest dealer.
- **The nonce is inside the ciphertext.** Only the taker can open the commitment, so publishing the
  on-chain commitment leaks nothing about the price.

**Ciphertext framing.** `ciphertext` above is `base64(nonce(12B) || AEAD-ciphertext || tag(16B))` —
X25519 ECDH between the dealer's `dealerEncPk` (advertised in `quote_ref`) and the taker's
`takerEncPk` (from the RFQ), HKDF-SHA256 (`info = "otc:reveal-channel:v1"`) to derive a 32-byte key,
then ChaCha20-Poly1305 with a fresh random 12-byte nonce per message. Reference implementation:
`packages/sdk/src/reveal-channel.ts` (`encryptReveal`/`decryptReveal`).

If a dealer cannot accept inbound connections (a common case behind NAT), a relay MAY offer a
**store-and-forward mailbox**: the relay holds an opaque ciphertext blob addressed to
`takerEncPk` and delivers it. The relay still cannot read it — it holds a sealed box addressed to
someone else. `revealVia: "mailbox"` signals this. **A relay that could read a reveal is a protocol
violation, not a configuration option.**

The mailbox is HTTP, not gossip (§1): `POST /mailbox/:takerEncPk` with the `reveal` message above
as the body stores it; `GET /mailbox/:takerEncPk` returns and clears all pending entries for that
recipient. The relay validates only the outer shape (`type`, `v`, `quoteId` is 32-byte hex,
`ciphertext`/`sig` are non-empty strings) — it never attempts to parse or decrypt `ciphertext`.
Entries are capped per recipient and expire after `MAILBOX_TTL_MS` (90 minutes in the reference
implementation, chosen to span one Offer File refresh cycle, `docs/DEALER-NODE.md` §5, plus slack —
a placeholder, not tuned against real traffic, same status as the M1 `TIME_SLACK` guess).

---

## 5. Propagation and deduplication

Standard epidemic gossip. Deliberately simple — this layer carries no value and needs no consensus.

**On receiving a message:**
1. Reject if `size > 64 KiB`, `v` is an unimplemented major version, or the JSON is malformed.
2. Recompute `id` from `body`. **If it does not match the claimed `id`, drop and penalize the peer**
   — a mismatch means someone is trying to make one message occupy several dedup slots.
3. If `id` is in the seen-set (TTL 15 min), drop silently. This terminates propagation loops.
4. If `type` requires a signature and it is absent or invalid, drop and penalize.
5. Reject if `ts` is more than 120 s in the future or older than the message's own `expiry`.
6. Add to the seen-set; deliver to local subscribers.
7. If `ttl > 0`, decrement and forward to all peers **except the one it arrived from**.

**Rate limits** (per peer, defaults — operators may tighten):

| Type | Limit |
|---|---|
| `rfq` | 10 / min |
| `quote_ref` | 60 / min |
| `cancel` | 60 / min |
| `peer_announce` | 2 / min |

Peers exceeding limits are throttled, then disconnected. Nodes SHOULD keep a simple misbehavior score
and refuse reconnection from persistent offenders.

**Message lifetime:** nodes retain RFQs until `expiry`, and `quote_ref`s until `validUntil`, then drop
them. There is no archival requirement — the chain is the permanent record, and relays are a
best-effort transport for things that expire in minutes.

---

## 6. How a taker aggregates across relays

A taker MUST connect to **at least two relays** (three recommended), and the client MUST surface how
many are connected, because a single-relay taker has silently accepted a censoring intermediary.

Aggregation:

1. Publish the `rfq` to **every** connected relay. Cheap, and defeats a single relay dropping it.
2. Collect `quote_ref`s from all relays into a set keyed by `quoteId`. Duplicates across relays are
   expected and collapse naturally — content-addressed `id`s make this trivial.
3. **Verify every reference against the chain** (§3.2). Relay-sourced fields are hints;
   chain-sourced fields are facts.
4. Union, never intersect. A `quote_ref` seen on one relay and not another is still a valid quote —
   asymmetric propagation is normal, and intersecting would discard honest quotes and amplify
   censorship rather than resist it.
5. **The chain is the tiebreaker for existence.** A commitment that exists on-chain but was never
   gossiped is still valid; a client that has the `quoteId` can settle against it with no relay
   involvement at all. Relays are an optimization for *discovery*, and the protocol degrades to
   direct dealer contact rather than failing.

**Reference implementation (M2 task 2.4):** `RelayAggregator` and `verifyQuoteRef` in
`packages/sdk/src/relay-client.ts`. Points worth copying into any independent client:

- **Refuse, don't warn,** below two connected relays (`InsufficientRelaysError`), and expose
  per-relay connection status.
- **Key received `quote_ref`s by envelope `id`, not by `quoteId`.** A relay that rewrites a genuine
  reference (say, pointing `dealerEndpoint` at itself) produces a different content-addressed `id`.
  Keyed by `quoteId`, whichever copy arrived first would win; keyed by `id`, both are kept, the
  tampered one fails its signature, and the genuine one survives.
- **The signature is what authenticates the off-chain fields.** `dealerEndpoint` and `dealerEncPk`
  are not on the chain; they are trustworthy only because the on-chain `quotePk` signed them.
- **Also check the chain's `notional` equals the RFQ's `size`** (`CONTRACTS.md` §7). Size is public
  already, so this leaks nothing, and it stops a dealer answering an RFQ with a quote for a
  different trade or under-declaring notional to dodge the bond cap.
- **A failing chain read must surface as an error, not a rejection.** "Could not verify" and
  "verified false" are different outcomes, and a client that conflates them lets an indexer outage
  silently empty the quote list.

### Censorship resistance, honestly stated

Multi-relay querying resists *individual* relay censorship. It does not resist a taker who is
network-partitioned, nor a case where every relay a taker knows is run by the same operator. There is
no Sybil-resistant relay discovery mechanism in v1 — `peer_announce` is trivially spammable, and
weighting relays by stake would introduce exactly the permissioned layer we reject. Mitigations
available to a taker today: hardcode relays run by unrelated operators, run your own relay, or
contact dealers directly. This limitation is recorded in `GRANT.md` rather than papered over.

---

## 7. Reference implementation

`packages/relay-node` — standalone Node.js/TypeScript service, runnable by anyone:

```
packages/relay-node/
  src/
    server.ts       # WebSocket + HTTP endpoints
    gossip.ts       # propagation, dedup seen-set, TTL, retention sweeps
    validate.ts     # envelope + per-type schema validation, signature shape checks
    peers.ts        # per-peer rate limiting, misbehavior scoring, ban/reconnect
    mailbox.ts      # optional store-and-forward for opaque reveal blobs
    schema.ts       # wire types, canonicalJSON, id computation — imports packages/sdk/src/schnorr.ts
                     # for signing/encoding so client and node share one signature implementation
    bytes.ts         # hex/bigint plumbing + the blake2b256 wrapper
    bin.ts            # env-var-driven CLI entrypoint (RELAY_PORT, RELAY_PEERS, ...)
  README.md         # run your own relay: pnpm --filter @otc/relay-node start
```

The point-to-point reveal encryption itself (§4) lives in `packages/sdk/src/reveal-channel.ts`,
not `packages/relay-node` — it is dealer/taker-side crypto that never touches a relay's own logic
(a relay only ever forwards or mailboxes an already-opaque blob), so it belongs with the rest of
the client-side quote/reveal flow in the SDK (`quotes.ts`, `fraud.ts`).

`schema.ts` is shared with the SDK so client and node can never drift on the wire format. It is
generated from, and validated against, the definitions in this document — **this file is normative,
the code is not.**

Configuration is environment-variable driven, with no required cloud dependencies and no database:
`RELAY_PORT`, `RELAY_PEERS` (comma-separated bootstrap endpoints), `RELAY_MAX_MSG_BYTES`,
`RELAY_ENABLE_MAILBOX`, `RELAY_PAIRS`. State is in-memory and expiring by design — a relay restart
loses nothing that matters, because nothing that matters lives in a relay.
