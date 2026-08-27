---
name: zswap-offer-files
description: Constructing, serializing, proving, and matching Zswap Offer Files — the balance-vector-nets-to-zero settlement condition, the ~1 hour expiry, and why the Dealer Node's refresh logic exists. Use when building the settlement path, the dealer warm pool, or quote reveal payloads.
---

# Zswap Offer Files

Zswap is Midnight's **protocol-level atomic swap primitive**. We reuse it for settlement rather than
reimplementing a custom settlement contract — it is audited, it is native, and rewriting it would be
the single riskiest thing we could do.

> **This is a working model, not a substitute for the SDK docs.** Verify signatures and exact APIs
> against `@midnight-ntwrk` packages during M1/M2, and correct this file in place where reality
> differs.

---

## 1. What an Offer File is

A **locally-proved, serializable, transferable partial transaction.** One party constructs it, proves
it on their own machine, and hands the bytes to a counterparty.

Its defining property, and the reason this protocol is possible at all:

> **An Offer File can be posted anywhere.** A Discord channel, a Telegram group, a shared namespace,
> an HTTP endpoint. It is inert bytes until someone matches it.

Our relay layer is simply the well-specified version of "posted anywhere" (`docs/RELAY.md`), and our
reveal channel is the point-to-point version of it. **We are not inventing a transport mechanism; we
are specifying one Midnight already intended.**

An Offer File contains: inputs being spent, outputs being created, the resulting **balance vector**,
a ZK proof that the construction is valid, and an **expiry**.

---

## 2. The settlement condition: balance vector nets to zero

This is the whole matching rule, and it is worth internalizing precisely because it explains why no
matching engine is needed or possible.

Each Offer File carries a **balance vector** — a per-token-type signed quantity of what it is short
or long.

```
Dealer's offer:   { tNIGHT: +1000, USDM: -41440 }     (giving tNIGHT, wanting USDM)
Taker's offer:    { tNIGHT: -1000, USDM: +41440 }     (giving USDM, wanting tNIGHT)
                  ─────────────────────────────────
Combined:         { tNIGHT:     0, USDM:      0 }     ✓ settles atomically
```

**A transaction is valid iff the combined balance vector is exactly zero for every token type.**

Consequences that shape the whole protocol:

- **Settlement is all-or-nothing.** No partial fills. A taker takes the whole quote or none of it —
  which is why the RFQ carries a fixed `size` and dealers quote that size.
- **Matching is arithmetic, not search.** Two Offer Files either net to zero or they don't. There is
  no "best match" to compute, no book to walk, no priority rules.
- **More than two parties can combine.** Any set of Offer Files netting to zero settles. We use two,
  but the primitive is more general.
- **Non-matching offers just fail** — no funds move, no partial state.

> **This is why there is no matching engine and no CLOB.** Not merely because Midnight lacks shared
> private state (though it does — see `docs/ARCHITECTURE.md`), but because *matching is not the hard
> part*. Netting to zero is a check, not a search. The hard part is making the dealer's quote
> **binding before settlement** — which is what our contract does and Zswap does not.

---

## 3. Lifecycle

```
  1. CONSTRUCT   dealer builds offer: give X of A, want Y of B
  2. PROVE       local proof server (Docker, :6300).  SLOW — the hot-path problem
  3. SERIALIZE   → bytes → base64 for transport
  4. TRANSPORT   in this protocol: inside the encrypted point-to-point reveal, never gossiped
  5. MATCH       taker builds the complementary offer; balance vector nets to zero
  6. SUBMIT      combined transaction goes on-chain, settles atomically
  7. RECORD      dealer calls recordSettlement(quoteId) → settled counter +1
```

**Step 2 is why the Dealer Node has a warm pool.** Proving cannot happen inside a quote response
without unacceptable latency.

**Step 4 is a hard boundary.** The Offer File carries the price. It goes only to the one taker who
requested it, encrypted. **Never gossip an Offer File** — a broadcast Offer File is a broadcast price,
and competing dealers would read every quote. See `docs/RELAY.md` §4.

---

## 4. The ~1 hour expiry — and why refresh logic exists

**Offer Files expire in roughly one hour.** This is the single most operationally significant
constraint on the protocol, and it is the reason `packages/dealer-node` exists as a keeper rather
than a request handler.

The problem: a dealer wants a **standing quote** — continuously available liquidity. But every Offer
File backing it dies within the hour, and re-proving takes real time. Without automation, a dealer's
liquidity silently evaporates.

### The warm pool

The Dealer Node maintains pre-proved Offer Files at ladder points around the current mid, refreshed
before expiry (`docs/DEALER-NODE.md` §5):

- Refresh every `refresh_secs` (default 1800 s — **half** the expiry, so one missed cycle is
  survivable).
- Discard anything within `expiry_margin` (default 900 s) of expiring; re-prove replacements.
- Re-prove eagerly when the mid moves beyond `spread_bps / 2` — a warm pool priced off a stale mid is
  worse than an empty one.

### The rule that must never be violated

```
offerFile.remainingLife  >  validity_secs + settlement_margin
       (e.g.  > 600 + 300 = 900 s remaining before it may back a new quote)
```

**Committing to a quote backed by an Offer File that expires mid-window guarantees the dealer cannot
settle, which guarantees a slash.** The dealer is bound on-chain for `validity_secs`; if the backing
Offer File dies inside that window, the taker challenges and the entire bond is slashed.

This is the sharpest way expiry can hurt a dealer, and it is entirely preventable by enforcing the
inequality above at quote time. **Enforce it in `offers.ts`, not by convention.**

---

## 5. Proving latency — the open empirical question

Local proof generation is slow, and our commit-then-reveal flow adds a chain confirmation on top:

```
decide price → build offer → PROVE → commit tx → AWAIT CONFIRMATION → reveal
                             ^^^^^                ^^^^^^^^^^^^^^^^^^
                             slow                 chain-bound
```

**We do not yet know the real end-to-end number on Preprod.** Measuring it is M2 task 2.8.

Mitigations, in order of preference:

1. **Warm pool** — amortize proving out of the hot path entirely. Primary strategy.
2. **Ladder granularity** — more pre-proved price points means more likely to have a usable one, at
   the cost of more proving work in the background.
3. **Shorter validity windows** — reduce the dealer's exposure while bound, at the cost of giving
   takers less time to compare.

> **No latency claim goes in `docs/GRANT.md` or any external material until M2 measures it.** If the
> number is bad, it gets published as a bad number. This is an explicit commitment in `GRANT.md`
> risk 2.

---

## 6. Integration points

**In the reveal payload** (`docs/RELAY.md` §4) — the Offer File rides inside the encrypted plaintext:

```jsonc
{ "pair": "tNIGHT/USDM", "side": "sell", "price": "0.0412", "size": "1000.0",
  "nonce": "<hex32>",         // opens the on-chain commitment
  "offerFile": "<base64>",    // the pre-proved Zswap Offer File
  "expiresAt": 1756300900 }
```

**In the commitment** — commit to the **terms** (`[pair, side, price, size]`), not to the Offer File
bytes. Offer File serialization may not be canonical, and a non-canonical encoding would make an
honest dealer's reveal fail to open their own commitment — slashing them for nothing. Terms are
stable and canonical; bytes are not.

**In the SDK** — `packages/sdk` wraps construction, proving, serialization, and matching so neither
the dealer node nor the web app touches Zswap primitives directly.

---

## 7. Amount encoding

**All amounts are decimal strings on the wire, never JSON numbers.** IEEE-754 doubles silently lose
precision on realistic notionals, and a rounding discrepancy between a dealer's client and a taker's
surfaces as an unexplained settlement failure — a balance vector that doesn't quite net to zero, with
no obvious cause. Parse to exact integer base units at the boundary and keep them exact throughout.

---

## 8. Checklist

- [ ] Offer Files proved **ahead of time** in the warm pool, never in the quote hot path
- [ ] `remainingLife > validity_secs + settlement_margin` enforced before backing any quote
- [ ] Refresh cadence ≤ half the expiry window
- [ ] Re-prove on mid moves beyond `spread_bps / 2`
- [ ] Offer Files travel **only** point-to-point encrypted — never gossiped
- [ ] Commitment covers **terms**, not serialized Offer File bytes
- [ ] Amounts are decimal strings / exact integers — never floats
- [ ] Balance vector verified to net to zero client-side before submitting
- [ ] No latency claims published before M2 measurement
