# Frontend Specification

**Stack:** React 18 + Vite + TypeScript + Tailwind CSS, Zustand for state, Lace via the Midnight
DApp Connector API. All chain and relay interaction goes through `packages/sdk`.

---

## UX models, and the one we reject

**Paradigm's request → quote → take** is the closest analogue to what we are building: a taker states
an intent, dealers respond, the taker picks one. Discrete, bilateral, no continuous book.

**CoW Swap / 1inch single-intent simplicity** is the interaction standard to hold ourselves to: state
what you want once, then wait while the protocol works. The user is never asked to manage an order.

### Explicitly ruled out: the order-book depth view

**Do not build a live depth chart, a bid/ask ladder, or a streaming order book.** Not as a
"nice-to-have," not behind a flag.

This is not a stylistic preference — it is a correctness constraint. **There is no book to render.**
Midnight has no shared private state, so hidden orders cannot be aggregated or matched
(`ARCHITECTURE.md`). During the sealed phase, prices genuinely do not exist anywhere except in each
dealer's local memory. A depth view would have to be fabricated from either fake data or leaked
pre-reveal prices — the first is a lie and the second breaks the protocol's core guarantee.

The UI must make sealed-ness *legible* rather than hiding it behind a familiar trading-screen
metaphor. A user who thinks they are looking at a book will misread everything else on the screen.

---

## Screen 1 — RFQ request

Single-intent. One decision per screen, no order-management surface.

```
┌──────────────────────────────────────────────────────────┐
│  Request a quote                                         │
│                                                          │
│   You sell   [ 1000.00 ]  [ tNIGHT ▾ ]                   │
│                    ⇅                                     │
│   You buy    [   ~ ~ ~  ]  [ USDM  ▾ ]                   │
│              Price is revealed after dealers commit      │
│                                                          │
│   ▸ Advanced                                             │
│       Quote window     [ 5 min ▾ ]                       │
│       Minimum dealer bond  [ 5,000 ▾ ]                   │
│       Disclosure note      [ None ▾ ]                    │
│                                                          │
│   Relays  ●●●  3 connected                               │
│                                                          │
│            [   Request quotes   ]                        │
└──────────────────────────────────────────────────────────┘
```

- **The buy field shows no estimate.** Not a spinner, not a "≈" placeholder from some reference
  price. There is no price yet, and inventing one trains users to expect a number that the protocol
  cannot honestly provide.
- **Relay count is always visible.** A taker connected to one relay has silently accepted a censoring
  intermediary (`RELAY.md` §6). One connected relay renders amber with a tooltip; zero renders red
  and blocks submission.
- **Minimum dealer bond** filters which dealers bother responding. Default surfaces the tradeoff:
  higher floor → better-collateralized dealers, fewer quotes.
- **Disclosure note** defaults to `None`. Attaching one is a deliberate act, never a default
  (`DISCLOSURE.md`).

---

## Screen 2 — Sealed bids incoming

The screen that carries the protocol's central idea. Its job is to convey: *dealers are locking
themselves to prices they cannot take back, and nobody — including us — can see those prices yet.*

```
┌──────────────────────────────────────────────────────────┐
│  Sealed bids incoming                                    │
│                                                          │
│         ┌────────────────────────┐                       │
│         │   Revealing in  0:23   │                       │
│         └────────────────────────┘                       │
│                                                          │
│   4 dealers have committed                               │
│                                                          │
│   🔒  dealer 0xab…3f    bond 12,400   ✓ on-chain          │
│   🔒  dealer 0x71…c2    bond  8,000   ✓ on-chain          │
│   🔒  dealer 0x0d…91    bond 45,000   ✓ on-chain          │
│   🔒  dealer 0xe4…07    bond  5,200   ✓ on-chain          │
│                                                          │
│   Each dealer is bound to their committed price.         │
│   Prices are sealed until the timer ends — not even      │
│   this app can see them yet.                             │
│                                                          │
│                          [ Cancel request ]              │
└──────────────────────────────────────────────────────────┘
```

- **Locks, bonds, and verification status only.** No price column, not even blurred or masked — a
  masked price implies a value is present and withheld, when in fact none exists client-side.
- **`✓ on-chain` is a real verification, not decoration.** It appears only after the client has
  recomputed `quoteId` and read the commitment from the chain (`RELAY.md` §3.2). Relay-sourced rows
  awaiting confirmation show `⋯ verifying`; rows that fail verification are dropped with a logged
  reason.
- **Bond is the trust signal at this stage** — it is the only meaningful information available before
  reveal, and putting it here teaches users to read it.
- Late commitments append with a subtle highlight. The timer does not extend: a fixed window is what
  prevents a dealer from waiting out competitors.

---

## Screen 3 — Post-reveal comparison

Price and track record on the same row, deliberately. Judging a quote by price alone is exactly the
mistake this protocol exists to correct.

```
┌────────────────────────────────────────────────────────────────────────┐
│  4 quotes revealed · valid for 4:52                                    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ▸ 0x0d…91          41.44 USDM            BEST PRICE              │  │
│  │   bond 45,000 · 312 settled · 0 slashed          ✓ verified      │  │
│  │                                            [ Select ]            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ▸ 0xab…3f          41.20 USDM                                    │  │
│  │   bond 12,400 · 87 settled · 0 slashed           ✓ verified      │  │
│  │                                            [ Select ]            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ▸ 0xe4…07          41.90 USDM      ⚠ 2 slashes                   │  │
│  │   bond 5,200 · 14 settled · 2 slashed            ✓ verified      │  │
│  │                                            [ Select ]            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ✗ 0x71…c2       COMMITMENT MISMATCH                              │  │
│  │   Revealed price does not open their on-chain commitment.        │  │
│  │   This is provable fraud.        [ Submit fraud proof → earn 10% ]│ │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  Sorted by: [ Price ▾ ]   ⓘ Highest price is not always the best trade │
└────────────────────────────────────────────────────────────────────────┘
```

- **Every row is independently verified before display:** signature valid under the on-chain
  `quotePk`, `persistentCommit(terms, nonce)` equals the on-chain commitment, quote still inside
  `validUntil`.
- **A mismatched reveal is not hidden — it is escalated.** It becomes an actionable fraud-proof
  affordance with the 10% prover bounty stated (`CONTRACTS.md` §2). This is the protocol's
  enforcement mechanism reaching the user interface: a taker who was defrauded is one click from
  slashing the dealer, and permissionless enforcement stops being an abstraction.
- **Slash history is a visible warning, not a filter.** We do not hide slashed dealers — that would
  be the allowlist we explicitly rejected (`ARCHITECTURE.md`). We surface the record and let the
  taker decide. A dealer with 2 slashes offering the best price is a legitimate choice; it should
  just be an *informed* one.
- **⚠ Best price + weak record** shows an inline caution when the top-priced quote also has the
  thinnest bond or a slash history.
- **Expiry countdown is prominent.** Past `validUntil` the dealer is no longer bound, `Select`
  disables, and the row greys out.

### Settlement, and what happens when a dealer stalls

After `Select`, the client attempts Zswap settlement. If the dealer does not complete it:

```
┌──────────────────────────────────────────────────────────┐
│  Dealer has not settled                                  │
│                                                          │
│  0xab…3f committed to this price and has not settled.    │
│  You can open an on-chain challenge. They have 10        │
│  minutes to settle or their bond is slashed.             │
│                                                          │
│  Challenge bond    20 tNIGHT  (2% of trade)              │
│    · Returned if they fail to settle (you were right)    │
│    · Forfeited to the dealer if they do settle           │
│                                                          │
│      [ Open challenge ]        [ Walk away ]             │
└──────────────────────────────────────────────────────────┘
```

The forfeit condition must be stated plainly, before the click. This is the anti-griefing mechanism
(`CONTRACTS.md` §5.2), and a user who does not understand they can lose the challenge bond will feel
cheated by correct protocol behavior.

**The bond scales with notional (`CONTRACTS.md` §7a): `max(floor, 2% of notional)`.** Show the
percentage next to the amount, as above — a taker needs to see that it is proportional, not a flat
toll. This example previously showed 250 tNIGHT on a 1,000 tNIGHT trade; at 25% of notional that
priced small takers out of enforcing their own trades, which would have quietly made Class-B
protection a large-taker-only feature and handed small takers back the last-look exposure this
protocol exists to remove.

---

## Screen 4 — Settled trades feed

Public, no wallet required. This is the protocol's transparency surface and the first thing a
prospective dealer or taker will look at to judge whether the venue is real.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Settled trades                          [ All pairs ▾ ]  [ Live ● ]   │
│                                                                        │
│  2m ago   1,000 tNIGHT → 41,440 USDM   dealer 0x0d…91   📄 note        │
│  8m ago     250 tNIGHT → 10,310 USDM   dealer 0xab…3f                  │
│  14m ago  ⚡ SLASH  dealer 0x71…c2  ·  12,000 tNIGHT slashed            │
│           commitment mismatch · proof 0x4a…8b                          │
│  21m ago  5,000 tNIGHT → 206,900 USDM  dealer 0x0d…91   📄 note        │
│                                                                        │
│  ─────────────────────────────────────────────────────────────────     │
│  Protocol totals   1,284 settled · 3 slashed · 41,200 tNIGHT burned    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Slash events are first-class feed items**, not hidden in a sub-tab. A visible slash is the
  protocol working, and it is the single most persuasive artifact the venue can show. Each links to
  the fraud proof transaction.
- **`📄 note`** indicates an attached disclosure note. Anyone can see one exists; only the intended
  recipient can decrypt it (`DISCLOSURE.md`).
- **Burned total** is displayed because it is the visible cost of collusion resistance
  (`CONTRACTS.md` §2) and is otherwise invisible.
- Everything here is read from the chain via the indexer. **No relay is trusted for this view** — a
  transparency surface sourced from an untrusted intermediary would be worthless.

---

## Screen 5 — Dealer commit/reveal response

For dealers quoting manually. Most volume should come from `packages/dealer-node`; this screen exists
so a human can quote without running infrastructure, and so the flow is inspectable during
development.

```
┌──────────────────────────────────────────────────────────┐
│  Incoming RFQ                              expires 3:41  │
│                                                          │
│  Taker wants to sell   1,000 tNIGHT for USDM             │
│                                                          │
│  Your price   [ 41.44 ]  USDM per 1,000                  │
│  Valid for    [ 10 min ▾ ]   (max 15 min)                │
│                                                          │
│  Your bond 45,000 · 312 settled · 0 slashed              │
│                                                          │
│  ⚠ Committing binds you. If you do not settle within     │
│    the validity window, your entire 45,000 bond can be   │
│    slashed by anyone.                                    │
│                                                          │
│            [ Commit sealed quote ]                       │
└──────────────────────────────────────────────────────────┘
```

Then, strictly after on-chain confirmation:

```
┌──────────────────────────────────────────────────────────┐
│  ✓ Commitment confirmed on-chain     tx 0x8c…12          │
│                                                          │
│  Step 2 — reveal your price to the taker                 │
│  Sent point-to-point and encrypted. No other dealer      │
│  or relay can see it.                                    │
│                                                          │
│            [ Reveal to taker ]                           │
└──────────────────────────────────────────────────────────┘
```

- **The reveal button does not exist until the commit transaction confirms.** Revealing before
  confirmation hands the taker a signed price with no commitment behind it — a durable artifact the
  dealer cannot retract (`DEALER-NODE.md` §3.1). Enforce this in the UI, not just in the node.
- **The binding warning states the full downside in the dealer's own numbers** before the commit
  click. A dealer who did not understand that "sealed quote" means "slashable obligation" must not be
  able to discover it by being slashed.
- **The nonce is persisted to local storage before the commit tx is submitted**, so a browser refresh
  between commit and reveal does not leave the dealer bound to a quote they can no longer open.
- `Valid for` is capped at `MAX_QUOTE_VALIDITY` (15 min) by the contract; the UI enforces it early
  rather than surfacing a failed transaction.

---

## Cross-cutting

**State (Zustand slices):** `wallet` · `rfq` (lifecycle: `idle → requesting → sealed → revealed →
settling → settled|failed|challenged`) · `quotes` (with per-quote verification status) · `dealer` ·
`feed`.

**Verification is a UI-layer responsibility.** Every quote reaches the screen with an explicit
verification state, and unverified quotes never render as if verified. `packages/sdk` returns
verification results rather than booleans, so failures can be shown with a reason.

**Latency honesty.** Commit-then-reveal involves proof generation and chain confirmation, and the
real Preprod timing is not yet known (`DEALER-NODE.md` §5). Progress states must reflect actual
stages — `proving`, `submitting`, `confirming`, `revealing` — rather than a generic spinner, and no
countdown should promise a duration we have not measured.

**Empty states carry the cold-start message.** No dealers responding is the expected early condition,
not an error. That state should link to the Dealer Node quickstart: the person staring at an empty
RFQ screen is precisely the person best positioned to become the first dealer.

**Accessibility:** the sealed → revealed transition must not rely on color or motion alone; timer
states need text equivalents; slash warnings need semantic markup, not just an emoji.
