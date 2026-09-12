---
name: zswap-offer-files
description: Constructing, serializing, proving, and matching Zswap Offer Files — the balance-vector-nets-to-zero settlement condition, the ~1 hour expiry, and why the Dealer Node's refresh logic exists. Use when building the settlement path, the dealer warm pool, or quote reveal payloads.
---

# Zswap Offer Files

Zswap is Midnight's **protocol-level atomic swap primitive**. We reuse it for settlement rather than
reimplementing a custom settlement contract — it is audited, it is native, and rewriting it would be
the single riskiest thing we could do.

> **Corrected in place on 2026-09-12** against a real Preprod run — `pnpm run e2e-settle` settled the
> protocol's first complete trade, and `scripts/probe-swap-semantics.ts` pinned the API semantics
> empirically. Sections marked **VERIFIED** below are measured, not modelled. The rest is still a
> working model; keep correcting this file in place where reality differs.

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

### VERIFIED — how you actually build one

You **cannot** build one from raw Zswap primitives. `ledger-v8`'s `ZswapInput` exposes only
`newContractOwned`; there is no public constructor for a user-owned input. The **wallet** must build
it — it holds the secret keys and does coin selection.

```ts
const recipe    = await facade.initSwap(desiredInputs, desiredOutputs, secretKeys, { ttl, payFees: false });
const signed    = await facade.signRecipe(recipe, signFn);   // never hand-roll intent signing
const offerFile = await facade.finalizeRecipe(signed);       // proves AND binds
const bytes     = offerFile.serialize();                     // 728 b64 chars, measured
```

**`initSwap`'s parameter names are misleading — this cost a dedicated probe to settle:**

| Parameter | What it actually means | Delta contributed |
|---|---|---|
| `desiredInputs: Record<RawTokenType, bigint>` | tokens this wallet **SPENDS** (the balancer picks your UTXOs and writes change back to you) | **positive** |
| `desiredOutputs: TokenTransfer[]` | coins **created**, unfunded by this half; for a swap, `receiverAddress` is **your own** address — what you **RECEIVE** | **negative** |

So `desiredInputs {tNIGHT: 1000n}` + `desiredOutputs [{USDM: 41440n → self}]` gives
`{tNIGHT: +1000, USDM: -41440}` — the §2 example below. Measured: `{NIGHT:1000}` with
`[{NIGHT:700→self}]` → `+300`; inputs only → `+1000`; outputs only → `-700`.

Three more things that only a live run tells you:

- **`desiredInputs.unshielded` must be present even when empty** (`{}`). The facade builds an
  unshielded leg only when the key is defined; omit it while supplying unshielded outputs and the
  leg is silently dropped and the call dies with "Unexpected transaction state."
- **Balance-vector keys are tagged objects**, not `RawTokenType` strings:
  `{tag:'unshielded',raw}`, `{tag:'shielded',raw}`, `{tag:'dust'}`. (`ZswapOffer.deltas` *is* keyed
  by `RawTokenType`; `Transaction.imbalances` is not.) Shielded and unshielded balances of the same
  token are **distinct entries that never offset each other**.
- **`SignatureEnabled`'s deserialize marker string is `'signature'`**, not `'signature-enabled'`.
  The wrong one throws a WASM `Invalid signature value.` from inside `Transaction.deserialize`,
  which reads exactly like a corrupt payload.

### VERIFIED — two unproven halves cannot be merged

`Transaction.merge` is the wrong tool for joining two independently-built halves: both land at
intent segment 1 and it refuses with `key (segment_id) collision during intents merge: 1`. And
signatures are bound to a segment id (`Intent.signatureData(segmentId)`), so relocating an intent
invalidates its signature. Use `balanceFinalizedTransaction` instead — see §2a.

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

### VERIFIED — DUST is NOT part of the nets-to-zero check

A fully balanced, ready-to-submit settlement does **not** have an all-zero balance vector. It
carries a deliberate `{tag:'dust'}` surplus, and that surplus **is the fee**. Check nets-to-zero
over the *tradeable* tokens only, and check the DUST surplus separately against the fee.

That was a bug in a *guard*, found only by running against a chain. The checks are as untested as
the code they check.

**Do not gate submission on a fee estimate. Neither source is trustworthy**, and on one real
settlement they disagreed 3x about the same transaction:

| Source | Returned | Why you can't trust it |
|---|---|---|
| `facade.calculateTransactionFee(tx)` | `300000000000001` | Exactly `additionalFeeOverhead` (3e14) + 1 — i.e. precisely what the dust balancer had already provisioned. Gating on it is **vacuous**: it can never fail |
| `tx.fees(LedgerParameters.initialParameters())` | `926290000000001` | `initialParameters()` is a **static default, not the live chain's parameters**. Gating on it refused a settlement the node had already accepted once |

Re-balancing DUST against the merged, proven transaction to close the gap is **not** a workaround:
`balanceFinalizedTransaction(merged, …, { tokenKindsToBalance: ['dust'] })` on an already-dust-
balanced transaction **hung indefinitely** (killed after ~20 min, no output).

So: check only that *some* DUST was provisioned, report both figures, and let the node be the
authority it already is — but capture both numbers plus the per-intent input/output/signature counts
in the rejection message, because a node rejection is an opaque
`1010: Invalid Transaction: Custom error: <n>` and a multi-kilobyte byte dump, naming none of it.

> **`Custom error: 168` means the fee is too low.** Established the hard way: settlements were
> rejected with 168 for hours while looking like flakiness. `additionalFeeOverhead` behaves as a
> **flat floor** on what the DUST balancer provisions — at the documented `3e14` every settlement
> came out provisioned at exactly `300000000000001`, while the real fee had risen to `9.3e14` and
> then `1.17e15`. The one settlement that landed was submitted while the real fee was still under
> the floor. Raising `additionalFeeOverhead` to `3e15` fixed it immediately. Unlike
> `feeBlocksMargin` (an exponent), this is a linear SPECK amount, so raising it is safe.
>
> This is a symptom of provisioning against a static guess. The real fix is reading the chain's live
> `LedgerParameters`.

## 2a. VERIFIED — the taker settles UNILATERALLY

This is the most consequential thing the live run established, and it changes the protocol's threat
model. A dealer's pre-proved, bound Offer File is settleable by the taker **alone**:

```ts
const recipe = await facade.balanceFinalizedTransaction(dealerHalf, takerKeys, { ttl });
const signed = await facade.signRecipe(recipe, takerSignFn);  // signs ONLY the balancing tx
const merged = await facade.finalizeRecipe(signed);
await facade.submitTransaction(merged);
```

The dealer's half already states exactly what it is short of, so the taker's wallet covers that
shortfall from its own coins and routes the dealer's surplus to itself. No counter-half is
negotiated; the dealer takes no further action; the taker never touches the dealer's keys.

**Consequence:** a dealer cannot "stall" a taker who holds a live Offer File — there is nothing left
for the dealer to do. The residual failure mode is narrower: the dealer **spent that inventory
elsewhere first**, so the offer's inputs are already consumed and settlement fails immediately. This
is why Hashflow's RFQ model needs no bonds. It does not make bonds pointless here (Class A is
untouched), but it means Class B is solving a smaller problem than the design assumed. See
`docs/ROADMAP.md`.

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

> **VERIFIED CORRECTION.** The expiry is not an opaque property of the format. It is the **intent
> TTL the builder chooses** (`initSwap`'s `options.ttl`), and it can be read back off a deserialized
> offer. One hour is our default, not a law. So account against the offer's own absolute
> `expiresAt`, never against `provedAt + 3600` — `canBackQuote` in `offers.ts` takes an absolute
> expiry for exactly this reason.

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

**First real numbers, Preprod + local proof server** (`pnpm run e2e-settle`, 2026-09-12):

| Step | Measured |
|---|---|
| Offer File build + sign + prove + bind | **7 ms** |
| `commitQuote` (prove + balance + submit + confirm) | **18.8 s** (also 24.4 s, 24.6 s) |
| Settle (balance + prove + submit) | **16.9 s** |

**Do not read the 7 ms as vindication of the warm pool.** That offer was purely *unshielded*, and
unshielded offers are signature-authorized — they carry **no ZK proof at all**. Proving cost lives
in the *shielded* leg, which has not been measured, because Preprod has no second asset to build a
shielded leg with. The warm pool's premise is still unmeasured.

What the numbers do establish: **the chain-confirmation legs dominate**, at ~17–25 s each. The
latency to attack is the commit→confirm→reveal round trip, not proving.

M2 task 2.8 remains open for the shielded/warm-pool numbers.

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
- [ ] **Tradeable** balance vector verified to net to zero client-side before submitting — DUST
      excluded from that check, and submission never gated on a fee estimate (see §2)
- [ ] Expiry accounted against the offer's own absolute `expiresAt`, never `provedAt + 3600`
- [ ] Settlement built with `balanceFinalizedTransaction`, not `Transaction.merge`
- [ ] No latency claims published beyond the measured table in §5
