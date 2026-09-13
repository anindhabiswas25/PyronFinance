# Reference Dealer Node

> **Updated 2026-09-14.** Class B (settlement challenges) was removed from the protocol, so §6's
> challenge loop no longer exists; the text is kept, struck, for the record. §5's UTXO reserve is now
> designed against the wallet SDK's actual coin selection, read from source. The implementation lives in
> `packages/dealer-node` (config, identity, journal, warm pool, quoting state machine).

## Why this is a first-class deliverable

The single biggest risk to any OTC venue is that **no dealer shows up first.** A venue with no
dealers has nothing to offer takers; a venue with no takers has nothing to offer dealers. Most
trading-protocol proposals wave at this and call it go-to-market.

We treat it as an architectural problem instead. `packages/dealer-node` exists so that becoming a
dealer is **a config file and a bond**, not a development project. If a competent operator cannot go
from `git clone` to a live standing quote in under thirty minutes, this package has failed at its
actual job regardless of how correct it is.

That framing drives real design constraints:

- **Runs unattended.** Quote refresh, bond monitoring, inventory consolidation and crash recovery are
  automatic. An operator who must babysit a terminal is not going to keep quoting.
  ~~Quote refresh, bond monitoring, and challenge response are automatic.~~
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
| Keep inventory settleable | Few, large UTXOs, or no taker's settlement passes the node's time-to-dismiss rule (§5). |
| Never double-spend its own live offer | After a restart the wallet has forgotten which coins back live quotes; the journal has not (§3.1). |
| Monitor bond health | A bond that falls under the configured minimum stops the dealer quoting; a slash halts it. |
| ~~Answer settlement challenges promptly~~ | ~~An unanswered challenge is a slash.~~ Removed with Class B, 2026-09-14. |

---

## 2. Configuration

One TOML file. Everything is explicit; nothing important is defaulted silently. The shipped example is
`packages/dealer-node/dealer.example.toml`; `config.ts` validates it at startup and refuses, among
other things: amounts written as TOML numbers, anything that looks like a secret, fewer than two
relays, validity above 900 s, an `expiry_margin_secs` below `validity_secs + settlement_margin_secs`,
a `refresh_secs` that lets offers age past that margin between ticks, the TESTUSD pair on mainnet, and
the removed `challenge_response_secs`.

```toml
journal_path = "./dealer-journal.log"        # crash-consistent quote journal (§3.1)

[identity]
secret_key_path = "./secrets/dealer.key"     # 0600. Never in the repo. Derives dealer cmt, quote key, reveal key
# wallet_seed_path = "./secrets/wallet.seed" # or MN_WALLET_SEED — never in this file

[network]
network       = "preprod"                    # undeployed | preprod | preview | mainnet
indexer       = "https://indexer.preprod.midnight.network/api/v4/graphql"
indexer_ws    = "wss://indexer.preprod.midnight.network/api/v4/graphql/ws"
rpc           = "https://rpc.preprod.midnight.network"
proof_servers = ["http://localhost:6300"]    # the proof server does not parallelise: add servers for capacity
contract      = "<64-hex OTCProtocol address>"

[relays]
endpoints = ["wss://relay-a.example/gossip", "wss://relay-b.example/gossip"]   # >= 2
use_mailbox   = true                         # or reveal_public = "wss://dealer-a.example/reveal"

[bond]
minimum_balance = "5000"                     # stop quoting below this
auto_topup      = false
topup_target    = "10000"

[reserve]                                    # §5
min_utxos      = 2
min_utxo_value = "1"

[pool]                                       # §5
max_offer_inputs  = 1
consolidate_above = 8

[[quote_policy]]
pair            = "tNIGHT/USDM"
enabled         = true
mid_source      = "manual"                   # manual | external | script — see §4
mid_price       = "0.0412"
spread_bps      = 30
min_size        = "10"
max_size        = "5000"                     # per-quote notional cap
ladder_sizes    = ["10", "1000", "5000"]
inventory_floor = "1000"                     # stop quoting a side below this balance
validity_secs   = 600                        # MUST be <= MAX_QUOTE_VALIDITY (900)
settlement_margin_secs = 300
expiry_margin_secs = 900
refresh_secs    = 1800

[risk]
max_live_quotes    = 20
max_total_notional = "50000"                 # across all live quotes — the contract's cap is per quote
halt_on_slash      = true
# challenge_response_secs = 120              # REMOVED 2026-09-14 with Class B; now rejected at startup
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
        │     inventory above floor? live quotes / total notional under risk caps?
        │     notional within bond × 20? bond >= minimum_balance? not halted?
        │     └─ any fail -> ignore silently (never respond with a reason; a rejection
        │                    reason is free information about our inventory)
        │
        ├─ 2. TAKE A POOLED OFFER  (proved ahead of time — see §5; never proved here)
        │     offer = pool.take(side, size)   // enforces remaining life > validity + margin
        │
        ├─ 3. PERSIST, THEN COMMIT  (on-chain, price still hidden)
        │     nonce = randomBytes(32)                        // FRESH. Never reused.
        │     C     = persistentCommit([pair, side, px, size], nonce)
        │     journal.intent(terms, nonce, offer, inputs)   // fsync'd BEFORE submit (§3.1)
        │     tx    = commitQuote(rfqId, C, now + validity_secs, notional)
        │     └─ await inclusion AND indexer visibility. DO NOT reveal before this.
        │
        ├─ 4. GOSSIP quote_ref (metadata only — no price), signed by the quote key
        │
        ├─ 5. REVEAL  (point-to-point, encrypted to takerEncPk; direct or relay mailbox)
        │
        └─ 6. WATCH until the offer expires
              ├─ settlement containing our offer seen -> recordSettlement()  [settled +1]
              ├─ offer inputs spent by something else -> ALERT: we invalidated our own quote
              └─ validUntil passes unsettled -> after PROOF_GRACE_PERIOD, releaseExpiredQuote()
              ~~├─ challenge opened  -> settle NOW (§6)~~   (Class B removed)
```

### 3.1 Order matters, and getting it backwards is fatal

**Commit must confirm on-chain before the reveal is sent.** If the node reveals first and the commit
transaction then fails — insufficient DUST, a reorg, a dropped tx — the dealer has handed a taker a
signed price with no on-chain commitment behind it. That is not merely a lost trade: the signed
reveal is a durable artifact the dealer cannot retract.

Conversely, a node that commits but crashes before revealing has a live on-chain obligation and no
record of what it promised. **The nonce, terms and Offer File MUST be persisted to disk *before* the
commit transaction is submitted**, so a restarted node can reconstruct and send the reveal.

`packages/dealer-node/src/journal.ts` implements this: append-only JSON lines, a checksum per record,
fsync on every append. Replay truncates a torn final line (that append never completed, so nothing
acted on it) but **refuses** corruption or a sequence gap anywhere else — silently skipping a middle
record could drop the one holding a nonce. `recover()` reconciles each live quote against the chain
on startup:

| Journal state at crash | Chain says | Action |
|---|---|---|
| intent (never submitted) | no quote | resubmit the commit or let it lapse — nonce intact either way |
| submitted | quote present | adopt as committed, **reveal** |
| submitted | no quote, window open | wait; it may still land |
| submitted | no quote, window closed | abandon — nothing is owed |
| committed / announced | live | **reveal** (idempotent for the taker) |
| any live | a settlement containing our offer | record the settlement |
| any live | offer inputs spent by another transaction | **alert** — never record a settlement that did not happen (`recordSettlement` is dealer-attested) |
| any live | resolved by someone else | close; check the bond (a slash halts quoting) |
| expired | — | release after the grace period |

**Hostage inputs.** `initSwap` books an offer's coins only in the wallet's in-memory state, which a
restart discards. The journal stores every offer's input refs, and recovery returns the set of inputs
backing still-settleable offers; the node must keep those coins out of new transactions until the
quotes are terminal, or it double-spends its own live quote.

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
quoting that pair **and empties that pair's warm pool**. A dealer quoting off a stale mid is writing
free options to anyone who noticed before they did.

Prices round against the dealer: bid = floor(mid × (1 − spread)), ask = ceil(mid × (1 + spread)), and
the counter-asset amount in the Offer File is `counterAmountFor(terms)` in `terms.ts` — the same
function the taker checks the offer against (`offerMatchesTerms`).

---

## 5. Offer File refresh, the warm pool, and inventory

Zswap Offer Files carry a **~1 hour expiry**, and proving a shielded one takes ~3 s (cold ~6.5 s) on a
proof server that **does not parallelise** (ROADMAP 2.8). Both facts shape the node.

**The refresh loop** (`packages/dealer-node/src/pool.ts`, `refresh_secs`, default 1800 s):

1. For each enabled pair, keep a **warm pool** of pre-proved Offer Files at each `ladder_sizes` rung,
   on both sides, priced off the current mid.
2. Each tick, discard any Offer File within `expiry_margin_secs` of expiring, and release its coins.
3. Re-prove when the mid moves beyond `spread_bps / 2`; empty the pool on a stale mid (§4).
4. Refill **serially**. A ladder of N rungs per side costs ~3·2N s per refresh per proof server;
   capacity scales by adding `proof_servers`, not by concurrency.
5. **Never hand out an Offer File whose remaining life is under `validity_secs + settlement_margin`.**

```
offerFile.remainingLife  >  validity_secs + settlement_margin
        (e.g.  > 600 + 300 = 900 s remaining before it may back a new quote)
```

### 5.1 How the wallet picks coins — read from source, 2026-09-14

`@midnight-ntwrk/wallet-sdk-capabilities` `dist/balancer/Balancer.js`: `chooseCoin` filters a token's
coins and sorts them **ascending by value**; `doBalance` adds the smallest remaining coin until the
imbalance is covered, then writes the surplus back as a change output. Consequences:

- **An offer spends exactly one coin only when no coin of that token is smaller than its give
  amount.** Merging "some" small coins is not enough (ROADMAP S5 recurrence: 249 + 500 merged into
  749 still produced a 2-input half, and the settlement failed at 21.5 ms against a 15 ms floor).
- A reserve cannot be "the largest coins, left alone": selection takes the smallest first, and a large
  coin is taken whenever the smaller ones run out. The reserve has to be enforced by **value**.
- Booked coins are invisible to later selections for the offer's whole life (observed in 2.6).

### 5.2 The UTXO reserve — designed

The worry this section used to state still stands in shape: **`initSwap` books every coin it selects
for the Offer File's whole life**, so a pool sized to consume the wallet starves the node's own
transactions, with a bare `Wallet.InsufficientFunds` pointing nowhere.

~~This is worse than an inconvenience: **the transaction most likely to be starved is a challenge
response**, which is exactly the one whose failure costs the entire bond.~~ **Superseded:** with Class B
removed there is no challenge response. What the reserve must protect was re-derived from which
transactions actually need what:

| Node transaction | Needs unshielded tNIGHT coins? | Needs DUST? |
|---|---|---|
| `commitQuote`, `recordSettlement`, `releaseExpiredQuote` | **No** — no `receiveUnshielded` | Yes (fee) |
| `postBond`, `topUpBond` | **Yes** — the bond amount | Yes |
| Consolidation self-transfer | Yes — the coins being merged | Yes |
| Offer construction (`initSwap`, `payFees: false`) | Yes — the give amount | **No** — fees are paid by the submitting taker |

So:

- **DUST is never booked by the pool.** The DUST requirement is a floor on balance: at least
  `additionalFeeOverhead` (3 DUST) per concurrent node transaction, since the balancer provisions that
  much per transaction (ROADMAP S4/S5).
- **Unshielded tNIGHT needs a value reserve**, for top-ups and consolidation. The pool refuses to build a
  rung when `balance − reserve − inventory_floor − committed ≥ give` fails, where `committed` counts every
  pooled offer **and every offer handed to a quote that is not yet terminal**. The reserve value is at
  least `topup_target − minimum_balance` when `auto_topup` is on.
- **After a restart**, recovery's hostage inputs are added to `committed` by value until their quotes
  are terminal (§3.1).

Tested in `packages/dealer-node/test/pool.test.ts` before any pool was sized.

### 5.3 Few, large UTXOs — or no taker can settle

Every node enforces a time-to-dismiss rule: a transaction's modelled validation plus guaranteed
application cost must stay under `max(2 µs × size_bytes, 15 ms)`, or it is rejected with `Custom
error: 168`. Every unshielded input in an Offer File adds to that cost, and the taker's balancing adds
its own inputs and DUST spends. Measured on Preprod:

- A dealer half built from **4 small UTXOs** failed the rule **on its own** (932 B, 17.7 ms vs 15 ms).
- A 3-input dealer half produced a merged settlement that failed (26.6 ms vs 20.9 ms), and again on
  2026-09-14 (27.3 ms vs 21.2 ms).
- A 2-input half with a 2-input taker failed at 21.5 ms against the 15 ms floor (2026-09-14).
- The same trade backed by **1 UTXO** settled (19.6 ms vs 20.7 ms, accepted on-chain).
- A **shielded** half (10.5 KB) passes easily, and its merged settlement settled on-chain (A5): size
  grows the allowance as fast as proof verification grows the cost.

Consequences for the node:

- **Check every half before pooling it,** with live `ledgerParameters`, and refuse any half spending more
  than `max_offer_inputs` coins (default 1). A fractional time-to-dismiss headroom was considered and
  dropped: the dealer cannot see the taker's wallet, and the input count is the lever that measurably
  decides the verdict (S5 recurrence: 1-in/2-in failed, 1-in/1-in settled).
- **Consolidate.** `packages/sdk/src/inventory.ts` merges the k smallest coins of a token with an
  exact-sum self-transfer (smallest-first selection then takes exactly those coins, with no change),
  checked against the rule before submitting. The keeper runs it when a token has more than
  `consolidate_above` coins, only while no offer is being built, and re-registers consolidated tNIGHT
  for DUST generation (a new UTXO is not registered, and unregistered NIGHT generates no DUST).
- **Size inventory to the ladder.** With smallest-first selection, the cheapest shape is a wallet with
  no coin smaller than the smallest rung.

---

## 6. ~~Challenge response — the highest-stakes loop~~ — REMOVED 2026-09-14

Class B was removed from the protocol (`ROADMAP.md`, "Research: what Class B is still for"). There is
no challenge to answer. What replaces this loop in the node:

- **Offer invalidation alarm.** If a live offer's inputs are spent by anything other than its own
  settlement, the node has double-spent its own quote. That is publicly attributable (the taker holds
  the signed reveal and the Offer File) and counts against the dealer's track record. The node raises
  a critical alert and stops quoting the pair until an operator clears it. The usual cause is a lost
  wallet booking after a restart, which is why §3.1's hostage inputs exist.
- **Bond monitoring.** A quote resolved on-chain by someone else is checked against the bond; a slash
  with `halt_on_slash = true` stops everything.

The removed design, kept for the record:

> ~~An unanswered settlement challenge is a **full bond slash** (`CONTRACTS.md` §5.3). This loop gets
> priority over everything else in the node. Challenge detected (chain subscription; poll fallback
> every 15 s) → do we have the quote in our journal? → is the quote still within validUntil? → settle
> immediately, then recordSettlement(quoteId, challengeId). Target: challenge_response_secs (120 s),
> i.e. 5x margin on the 600 s window. Answering also returns the taker's challenge bond to us.~~
>
> ~~**Answer even at a loss.** If the market has moved against the quote, honoring it costs the spread;
> failing to honor it costs the entire bond. The node must never be configurable to "decline
> unfavorable challenges" — that option *is* last-look.~~

That last principle survives in a different form: **the node must never be configurable to spend the
coins behind a live quote.** That option is last-look too.

---

## 7. Package layout

```
packages/dealer-node/
  src/
    bin.ts            # entrypoint: gen-key | bond | start
    config.ts         # TOML parse + validation (reject bad config at startup, never at quote time)
    identity.ts       # key file, dealer commitment + quote key + reveal key derivation
    journal.ts        # crash-consistent quote store (nonce + terms + offer persisted PRE-commit) + recover()
    pool.ts           # warm pool: build, refresh, expiry accounting, reserve
    quoting.ts        # RFQ filter -> take offer -> persist -> commit -> gossip -> reveal state machine
    risk.ts           # bond monitoring, halt_on_slash, notional and inventory caps
    disclosure.ts     # named-recipient disclosure notes (DISCLOSURE.md, 0x0001)
    ~~challenges.ts   # the §6 loop~~   (removed with Class B)
  dealer.example.toml
  README.md           # 30-minute quickstart: keys -> bond -> first quote
```

Everything on-chain goes through `packages/sdk`; the dealer node holds no bespoke contract logic.

---

## 8. Operator quickstart (target: under 30 minutes)

See `packages/dealer-node/README.md` for the validated version.

The node logs its dealer commitment on startup. That string is the dealer's entire public
identity — it is what takers see next to a bond size and a settled/slash record, and it is the only
thing that ever appears on-chain about them. **No name, no registration, no approval, at any point in
this sequence.** That is Pillar 1 working as intended.
