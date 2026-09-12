# Reference Dealer Node

## Why this is a first-class deliverable

The single biggest risk to any OTC venue is that **no dealer shows up first.** A venue with no
dealers has nothing to offer takers; a venue with no takers has nothing to offer dealers. Most
trading-protocol proposals wave at this and call it go-to-market.

We treat it as an architectural problem instead. `packages/dealer-node` exists so that becoming a
dealer is **a config file and a bond**, not a development project. If a competent operator cannot go
from `git clone` to a live standing quote in under thirty minutes, this package has failed at its
actual job regardless of how correct it is.

That framing drives real design constraints:

- **Runs unattended.** Quote refresh, bond monitoring, and challenge response are automatic. An
  operator who must babysit a terminal is not going to keep quoting.
- **Safe by default.** Ships with conservative spreads, a hard notional cap, and an inventory floor.
  A misconfigured dealer node should quote too little, never too much.
- **Standalone.** Node.js service, no browser, no wallet extension, no hosted dependency. It talks to
  a Midnight node, a proof server, and whatever relays it is configured with.

---

## 1. Responsibilities

| Responsibility | Why the node, not the chain |
|---|---|
| Hold and refresh standing quotes | Offer Files expire (~1 h). Keeping a quote live is inherently an off-chain keeper job. |
| Compute prices from a policy | The chain must never see a price pre-reveal — that is the whole mechanism. |
| Post sealed commitments on-chain | Binds the dealer before reveal. |
| Reveal point-to-point to takers | Must not be visible to competing dealers or relays. |
| Answer settlement challenges promptly | **An unanswered challenge is a slash.** This is the highest-stakes loop in the node. |
| Monitor bond health | A bond that falls under `MIN_BOND` silently stops the dealer quoting. |

---

## 2. Configuration

One TOML file. Everything is explicit; nothing important is defaulted silently.

```toml
[identity]
# Dealer secret key. Derives the on-chain dealer commitment AND the quote-signing key
# (different domain separators — see CONTRACTS.md §3).
secret_key_path = "./secrets/dealer.key"     # 0600. Never in the repo.

[network]
network       = "preprod"                    # undeployed | preprod | preview | mainnet
indexer       = "https://indexer.preprod.midnight.network/api/v4/graphql"
rpc           = "https://rpc.preprod.midnight.network"
proof_server  = "http://localhost:6300"      # local Docker proof server
contract      = "0x..."                      # deployed OTCProtocol address

[relays]
endpoints = [
  "wss://relay-a.example/gossip",
  "wss://relay-b.example/gossip",
]
reveal_listen = "0.0.0.0:7420"               # inbound reveal requests
reveal_public = "wss://dealer-a.example/reveal"
use_mailbox   = false                        # true if behind NAT (see RELAY.md §4)

[bond]
minimum_balance = "5000"                     # stop quoting below this
auto_topup      = false                      # if true, top up from wallet to target
topup_target    = "10000"

# One block per pair. Adding a pair is config, not code.
[[quote_policy]]
pair            = "tNIGHT/USDM"
enabled         = true
mid_source      = "manual"                   # manual | external | script — see §4
mid_price       = "0.0412"                   # used when mid_source = "manual"
spread_bps      = 30                         # 0.30% each side
max_size        = "5000"                     # per-quote notional cap, base units
min_size        = "10"
inventory_floor = "1000"                     # stop quoting a side below this balance
validity_secs   = 600                        # quote window; MUST be <= MAX_QUOTE_VALIDITY (900)
refresh_secs    = 1800                       # re-prove Offer Files this often (< ~1 h expiry)

[risk]
max_live_quotes        = 20
max_total_notional     = "50000"             # across all live quotes
halt_on_slash          = true                # stop everything if slashed — investigate first
challenge_response_secs = 120                # answer challenges within this (window is 600)
```

**`validity_secs` is a real risk dial, not a tuning knob.** A long window is a free option written to
the market: the dealer is bound to a price while it moves. Short windows are safer for the dealer and
worse for takers who need time to compare. 600 s is a compromise; volatile pairs should go lower.

---

## 3. The automated commit-then-reveal flow

```
   RFQ arrives (from any connected relay)
        │
        ├─ 1. FILTER
        │     pair enabled? size in [min_size, max_size]? RFQ not expired?
        │     inventory above floor? live quotes / notional under risk caps?
        │     └─ any fail -> ignore silently (never respond with a reason; a rejection
        │                    reason is free information about our inventory)
        │
        ├─ 2. PRICE
        │     mid  = resolve(mid_source)
        │     px   = side == "buy" ? mid * (1 - spread) : mid * (1 + spread)
        │
        ├─ 3. BUILD + PROVE OFFER FILE
        │     offer = buildZswapOffer(pair, side, px, size)
        │     proved = await proofServer.prove(offer)        // SLOW — see §5
        │
        ├─ 4. COMMIT  (on-chain, price still hidden)
        │     nonce = randomBytes(32)                        // FRESH. Never reused.
        │     C     = persistentCommit([pair, side, px, size], nonce)
        │     tx    = commitQuote(rfqId, C, now + validity_secs)
        │     └─ await inclusion. DO NOT reveal before this confirms. (§3.1)
        │
        ├─ 5. REVEAL  (point-to-point, encrypted to takerEncPk)
        │     sig  = schnorrSign(quoteKey, [pair, side, px, size])
        │     send { ciphertext: seal(terms, nonce, offerFile), sig } -> taker only
        │
        ├─ 6. GOSSIP quote_ref (metadata only — no price)
        │
        └─ 7. WATCH until validUntil
              ├─ taker settles     -> recordSettlement()  [settled counter +1]
              ├─ challenge opened  -> settle NOW (§6)
              └─ window expires    -> release reserved inventory, decrement liveQuotes
```

### 3.1 Order matters, and getting it backwards is fatal

**Commit must confirm on-chain before the reveal is sent.** If the node reveals first and the commit
transaction then fails — insufficient DUST, a reorg, a dropped tx — the dealer has handed a taker a
signed price with no on-chain commitment behind it. That is not merely a lost trade: the signed
reveal is a durable artifact the dealer cannot retract.

Conversely, a node that commits but crashes before revealing has a live on-chain obligation and no
record of what it promised. **The nonce and terms MUST be persisted to disk *before* the commit
transaction is submitted**, so a restarted node can reconstruct and send the reveal. Losing the nonce
means being unable to honor a live quote, which means a slash.

This crash-consistency requirement is why the node keeps a small local journal rather than holding
quote state in memory.

---

## 4. Pricing sources

`mid_source` is deliberately pluggable, and deliberately *not* an on-chain oracle — the protocol has
no opinion on fair value (`CONTRACTS.md` §1).

| Source | Behavior | Use |
|---|---|---|
| `manual` | Fixed `mid_price` from config; SIGHUP reloads | Testing, M2/M3 demos, thin markets |
| `external` | Poll an HTTP endpoint returning `{ "mid": "0.0412", "ts": ... }` | Production dealers with their own pricing |
| `script` | Execute a local command, read `mid` from stdout | Escape hatch for arbitrary pricing infrastructure |

**Staleness is a hard stop, not a warning.** If a mid is older than `refresh_secs / 2`, the node stops
quoting that pair. A dealer quoting off a stale mid is writing free options to anyone who noticed
before they did — the exact failure mode this protocol punishes with slashing.

---

## 5. Offer File refresh and the expiry problem

Zswap Offer Files carry a **~1 hour expiry**, and proving one is slow enough that it cannot be done
on demand inside a quote response. Both facts shape the node.

**The refresh loop** (`refresh_secs`, default 1800 s — half the expiry, so one missed cycle is
survivable):

1. For each enabled pair, maintain a **warm pool** of pre-proved Offer Files at ladder points around
   the current mid.
2. On each tick, discard any Offer File within `expiry_margin` (default 900 s) of expiring, and
   re-prove replacements.
3. Re-prove eagerly on a mid move beyond `spread_bps / 2` — a warm pool priced off a stale mid is
   worse than an empty one.
4. **Never serve an Offer File whose remaining life is under `validity_secs + settlement_margin`.**
   Committing to a quote backed by an Offer File that expires mid-window guarantees the dealer cannot
   settle, which guarantees a slash.

**A warm pool holds its inputs hostage — reserve UTXOs for the node's own transactions.** Found on
Preprod while building 2.6, not anticipated here: `initSwap` **books every coin it selects** in local
wallet state for the entire life of the Offer File. A pool sized to consume the wallet's UTXOs
therefore starves the node's own on-chain operations — `postBond`, `topUpBond`, `recordSettlement`,
and a challenge response all move funds and do their own coin selection. The observed failure was a
bare `Wallet.InsufficientFunds` from deep in the wallet SDK, with nothing pointing at the warm pool
as the cause.

This is worse than an inconvenience: **the transaction most likely to be starved is a challenge
response**, which is exactly the one whose failure costs the entire bond. A node that cannot answer
a challenge because its own warm pool consumed its coins gets slashed for being well-stocked.

So the pool needs an explicit reserve — a minimum count and value of unshielded UTXOs never
available to offer construction, sized to cover the node's worst-case concurrent on-chain
obligations. Not yet designed; **do not size a warm pool before this exists.**

**Back offers with FEW, LARGE UTXOs — or no taker can settle them.** Found resolving ROADMAP S5
(2026-09-13). Every node enforces a time-to-dismiss rule. A transaction's modelled validation and
guaranteed-application cost must stay under `max(2 µs × size_bytes, 15 ms)`; if not, it is rejected
with `Custom error: 168`. Every unshielded input in an Offer File adds to that cost, and the taker's
balancing adds its own inputs and DUST spends on top. Measured on Preprod:

- A dealer half that coin selection built from **4 small UTXOs** failed the rule **on its own**
  (932 B, 17.7 ms vs 15 ms). No taker could ever have settled it.
- A 3-input dealer half produced a merged settlement that failed (26.6 ms vs 20.9 ms).
- The same trade backed by **1 UTXO** settled (19.6 ms vs 20.7 ms, accepted on-chain).

Consequences for the node:

- **Check every half before pooling it.** Call `buildAndProveOffer` with live `ledgerParameters`;
  it refuses a half that already fails. Passing that check is necessary, not sufficient — keep
  headroom for the taker's side.
- **Inventory fragmentation is a liveness risk, not bookkeeping.** Change outputs from every
  settlement fragment the wallet. The node should consolidate small UTXOs into large ones during
  quiet periods, as a keeper task alongside refresh.
- **This interacts with the reserve above.** Consolidation is itself a transaction that books
  coins. Schedule it so it never competes with a pending challenge response.

That last rule is the one that converts "expiry is an annoyance" into "expiry is handled." The
constraint the node enforces at all times:

```
offerFile.remainingLife  >  validity_secs + settlement_margin
        (e.g.  > 600 + 300 = 900 s remaining before it may back a new quote)
```

**Proof-generation latency is the open empirical question.** Commit-then-reveal adds a proof and a
chain round-trip between "dealer decides a price" and "taker sees it." We do not yet know the real
end-to-end number on Preprod. Until M2 measures it, **no latency claims go into any grant material**
(`GRANT.md`). If it proves too slow for competitive quoting, the warm-pool ladder is the mitigation —
pre-proving amortizes the cost out of the hot path — and its adequacy is exactly what M2 tests.

---

## 6. Challenge response — the highest-stakes loop

An unanswered settlement challenge is a **full bond slash** (`CONTRACTS.md` §5.3). This loop gets
priority over everything else in the node.

```
  Challenge detected (chain subscription; poll fallback every 15 s)
        │
        ├─ Do we have the quote in our journal?
        │    NO  -> CRITICAL alert. We are bound to a quote we cannot reconstruct.
        │           Operator must intervene within CHALLENGE_WINDOW (600 s).
        │
        ├─ Is the quote still within validUntil?
        │    NO  -> the challenge is invalid; it cannot mature. Log and ignore.
        │
        └─ YES -> settle immediately, then recordSettlement(quoteId, challengeId)
                  Target: challenge_response_secs (120 s), i.e. 5x margin on the 600 s window.
                  Answering also returns the taker's challenge bond to us.
```

Design notes:

- **Answer even at a loss.** If the market has moved against the quote, honoring it costs the spread;
  failing to honor it costs the entire bond. The node must never be configurable to "decline
  unfavorable challenges" — that option *is* last-look, and building it would defeat the protocol.
- **`halt_on_slash = true` by default.** A slash means something is wrong — bad config, a bug, a
  compromised key. Continuing to quote compounds the loss.
- **Chain subscription with a polling fallback.** A missed subscription event is a lost bond, so the
  node does not rely on push delivery alone.

---

## 7. Package layout

```
packages/dealer-node/
  src/
    index.ts          # entrypoint, config load, graceful shutdown
    config.ts         # TOML parse + validation (reject bad config at startup, never at quote time)
    identity.ts       # key load, dealer commitment + quote key derivation
    bond.ts           # postBond / topUp / monitor; halts quoting under minimum
    pricing/          # manual | external | script mid sources, staleness enforcement
    offers.ts         # warm pool: build, prove, refresh, expiry accounting
    quoting.ts        # RFQ filter -> price -> commit -> reveal state machine
    journal.ts        # crash-consistent quote store (nonce + terms persisted PRE-commit)
    challenges.ts     # the §6 loop
    relay.ts          # multi-relay client (shares schema.ts with relay-node)
    reveal.ts         # point-to-point encrypted reveal server / mailbox client
  dealer.example.toml
  README.md           # 30-minute quickstart: keys -> bond -> first quote
```

Everything on-chain goes through `packages/sdk`; the dealer node holds no bespoke contract logic.

---

## 8. Operator quickstart (target: under 30 minutes)

```bash
pnpm --filter dealer-node gen-key         # writes ./secrets/dealer.key (0600)
docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v   # local proving
# fund the wallet from https://faucet.preprod.midnight.network
cp dealer.example.toml dealer.toml        # set contract address + mid_price
pnpm --filter dealer-node bond --amount 10000
pnpm --filter dealer-node start
```

The node logs its dealer commitment on startup. That string is the dealer's entire public
identity — it is what takers see next to a bond size and a settled/slash record, and it is the only
thing that ever appears on-chain about them. **No name, no registration, no approval, at any point in
this sequence.** That is Pillar 1 working as intended.
