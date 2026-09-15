# Frontend Specification

**Stack:** React 18 + Vite 5 + TypeScript (strict) + Tailwind CSS + Zustand + React Router 6, in
`client/` (`@otc/client`). Wallets through the Midnight DApp Connector API (4.x: 1AM, Lace). All chain
and relay work goes through `@otc/sdk/browser`, the only SDK entry the client may import.

**No backend.** The client talks to four things only: the user's wallet extension, a Midnight indexer,
the relays the user configures, and the static ZK assets it serves itself. There is no server of ours,
no database, no analytics.

**Live data only.** The app always reads the real chain, relays and wallet (owner decision 2026-09-15).
Deterministic fixture adapters exist for the test suite only (`client/test/fixtures`), injected through
`PortsFactoryContext`; nothing sample-sourced can reach a user.

---

## UX models, and the one we reject

**Paradigm's request → quote → take** is the closest analogue: a taker states an intent, dealers
respond, the taker picks one. Discrete, bilateral, no continuous book.

**CoW Swap / 1inch single-intent simplicity** is the interaction standard: state what you want once in a
swap card, then wait while the protocol works. The user is never asked to manage an order.

### Explicitly ruled out: the order-book depth view

**Do not build a live depth chart, a bid/ask ladder, or a streaming order book.** Not as a
"nice-to-have," not behind a flag.

This is a correctness constraint, not a style choice. **There is no book to render.** Midnight has no
shared private state, so hidden orders cannot be aggregated or matched (`ARCHITECTURE.md`). During the
sealed phase, prices exist only in each dealer's memory. A depth view would have to be fabricated from
fake data or leaked pre-reveal prices: the first is a lie and the second breaks the protocol.

The UI makes sealed-ness *legible* rather than hiding it behind a trading-screen metaphor.

---

## Non-negotiables (violating one is a bug)

- No price before reveal, anywhere. Public pages never show a price: the chain stores none.
- Price comparison happens only in the taker's browser, on verified reveals. Nothing price-related is
  sent to a relay, a log, a URL or anywhere else.
- Relays are untrusted. Every `quote_ref` passes `verifyQuoteRef` before it renders as verified; an RFQ
  is refused below two connected relays; the relay count is always visible (amber at 1, red at 0).
- "Couldn't verify" is a different state from "rejected": an indexer outage is an error state, never an
  empty or rejected list.
- Every reveal passes `verifyReveal` (with the on-chain notional), the opposite-side check and
  `offerMatchesTerms` before it can be selected.
- A seal mismatch is escalated as a fraud-proof action with its payout, never hidden.
- Slashed dealers are never filtered out. No badges, scores, stars or "verified dealer" labels.
- No Class B: no challenge bond, no "dealer has not settled" screen (removed 2026-09-14).
- A fresh X25519 key and `rfqId` per RFQ. Disclosure notes are opt-in.
- Amounts are `bigint` or decimal strings end to end, never `Number`.
- Every state is text plus form, never colour or motion alone.

---

## Information architecture — 10 pages, 6 overlays

| Route | Page | Needs | Code |
|---|---|---|---|
| `/` | Venue: what the protocol is, live chain totals, recent events | nothing | `features/venue` |
| `/activity` | Protocol events from the indexer: bonds, seals, settlements, releases, **slashes first-class**, notes. No price column | nothing | `features/activity` |
| `/dealers` | Every dealer key: status, bond, largest quote (×20), settled, slashed, failures (unknown) | nothing | `features/dealers` |
| `/dealers/:dealerCmt` | One dealer: stats, bond-over-time chart, recent quotes, evidence note | nothing | `features/dealers` |
| `/trade` | Taker flow: request → sealed → compare → settle | wallet to settle | `features/trade` |
| `/trade/:quoteId` | Receipt: public block from the chain, private block from this device | nothing | `features/receipt` |
| `/me` | My trades, encrypted under a passphrase | this device | `features/portfolio` |
| `/deal` | Become a dealer: Dealer Node path, bond calculator, slash split, timings | nothing | `features/deal` |
| `/desk` (`?tab=overview\|quotes\|bond\|rfq\|keys`) | Dealer desk | dealer key to act | `features/desk` |
| `/verify` (`?tab=check\|note`) | Check a signed reveal or evidence; open a disclosure note | nothing (wallet to submit a proof) | `features/verify` |

Overlays (no route change; Esc closes; focus trapped and returned): Connect wallet · Wallet readiness ·
Transaction tray (`T`, survives reloads) · Relays · Submit fraud proof · Attach disclosure note.

Top bar: logo · Trade · Activity · Dealers · Desk · Verify · network · relays pill · tray pill · wallet ·
theme. Dev only: `/dev/settle-probe`, `/dev/circuits`.

Public pages render without the SDK or its WASM; `/trade`, `/verify` and `/desk` load them lazily.

---

## `/trade` — the swap card and what follows

One route, one state machine (`state/rfq.ts`), persisted to `sessionStorage` so a reload in Sealed or
Compare restores the screen with reveals intact. Stepper: Request · Sealed · Compare · Settle.

**Request (swap card).** "You sell / You receive" or "You pay / You buy"; the ⇅ button flips the side
and puts what the taker gives on top. The counter leg shows only a lock and "Price revealed after
dealers seal": no estimate, no "≈", no spinner. Advanced: quote window (1/2/5 min), minimum dealer bond,
disclosure note (off; attached later from the receipt). Readiness lists only what the connector can
truthfully report: network, balance of the asset given, DUST, relays ≥ 2. Coin fragmentation surfaces at
Settle, from the merged transaction's time-to-dismiss check. Side panel: dealers bonded, largest quotable
size, median bond, all from the chain.

**Sealed.** Fixed countdown (never extended). One row per `quote_ref`: checking → on-chain with bond and
record, or dropped with its reason. Reveals are fetched from each quote's signed `dealerEndpoint` mailbox
and **persisted before decrypting**, because the relay deletes on read. "Compare N now" once one verifies.

**Compare.** Definitions live in `lib/compare.ts` (bigint only, unit-tested): best by the taker's side,
vs-best in bps, median of valid quotes, spread, bond as % of trade, offer check (time-to-dismiss on the
dealer's half alone plus its input count, never balancing every quote against the wallet), validity bar.
Summary strip · fraud banner per seal mismatch (excluded from every statistic) · strip plot · comparison
table · pairwise panel with a sentence generated from the numbers · settle card. Rows never reorder under
the pointer or while one is selected; a "new quote · Re-sort" pill appears instead. The failures column
renders "—" (unknown), never a fake 0, until published evidence has a source.

**Settle.** Real stages: offer coins unspent (skipped where the indexer can't answer) → wallet balances
the sealed offer → the merged transaction passes the network's validation limit → submit → indexer
confirmation. Outcomes: settled → receipt; inputs spent → "Save evidence" and take the next quote; wallet
shape (would be code 168) → nothing submitted; node rejection → code and plain meaning; expired.

**Receipt.** Public block from the chain; "Only on this device" block with price and amounts. The status
reads **Resolved** from the chain alone and **Settled** only with a settlement transaction on this device,
because the contract cannot tell a settled quote from a released one.

---

## Contract actions from the browser

`src/data/live/circuits.ts` + `@otc/sdk/browser` (`browser-contract.ts`) run every circuit from the
connected wallet, with each stage in the transaction tray:

1. **prepare** — the circuit runs on this device (midnight-js `createUnprovenCallTx`) against the
   indexer's latest contract and Zswap state, with witnesses held in memory for the one call;
2. **prove** — the wallet's `getProvingProvider`, fed ZK assets the app serves at `/zk/otc-protocol`;
3. **balance** — `balanceUnsealedTransaction`, which adds inputs and pays DUST;
4. **submit** — `submitTransaction` (resolves void; identifiers come from the balanced transaction);
5. **confirm** — the indexer shows the transaction.

After a submit or confirm failure the app reads the chain before reporting: live releases have been
reported by the wallet as node code 104 while landing. Wallet keys reach midnight-js as hex (its bech32m
path needs Node's `Buffer`).

| Action | Where | Circuit |
|---|---|---|
| Submit fraud proof | Compare banner, `/verify` | `submitFraudProofMismatch` |
| Attach disclosure note | Receipt | `attachDisclosureNote` |
| Post / top up / request withdrawal / withdraw | `/desk?tab=bond` | `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` |
| Commit quote, record settlement, release | `/desk?tab=rfq`, `?tab=quotes` | `commitQuote`, `recordSettlement`, `releaseExpiredQuote` |

**Submit fraud proof.** Checked against the chain first, as the circuit will check it (signed by the
on-chain quote key, does not open the seal, quote unresolved), so a refused proof is never sent. Shows the
split in the dealer's bond: 60 % to the wronged taker, 10 % to the prover, 30 % burned; the connected
wallet is both, so it receives 70 %.

**Attach disclosure note.** Sealed to one recipient's X25519 key. The sealed note is saved as a file
before the transaction is sent; only its hash, the policy tag and a recipient hint go on-chain.

---

## `/verify`

**Check a quote.** Paste or load a signed reveal or saved failure evidence. Each check is its own line:
quote on-chain, same dealer, signed by the on-chain quote key, opens the seal, size matches the sealed
notional, unresolved, validity window, and (for evidence) whether the offer's coins were spent. A signed
price that doesn't open its seal leads to the fraud-proof overlay.

**Open a note.** Decrypts with the recipient's key (kept in the tab only) and lists DISCLOSURE.md's
checks separately. A wrong key reads "This note isn't addressed to this key." A note that decrypts but
isn't backed by the chain is shown as a claim, not evidence.

---

## `/desk` — dealer desk

Any dealer key can be opened read-only. Acting needs the dealer's own key.

- **Keys.** Generate or import (the Dealer Node's 64-hex key file works as is). Derived exactly as the
  node derives it: `dealerCmt`, quote key, reveal key. Stored in IndexedDB with the quote journal,
  encrypted under a passphrase (PBKDF2-SHA256, 600,000 iterations; AES-GCM). **Every action stays blocked
  until a backup is downloaded and confirmed** (owner decision 2026-09-15).
- **Overview.** Status, bond and headroom (×20), live quotes, settled and slashed, and alerts derived from
  the chain (withdrawal pending, quotes releasable, quotes in grace, bond slashed). Node metrics render
  "Connect your node": the Dealer Node has no status endpoint.
- **Quotes.** Every quote by outcome with countdowns; release expired quotes one at a time or in bulk
  (permissionless, one hour after expiry); record settlement behind a confirmation.
- **Bond.** Post → Top up → Request withdrawal → Withdraw as one timeline. Each blocked action says why and,
  where time decides it, when (`features/desk/rules.ts`, mirroring the contract's assertions).
- **Manual quote.** Incoming RFQs; price → taker amount; validity 5/10/15 min; bond cap and the binding
  warning in the dealer's own numbers. Step 1: the wallet builds the Offer File (`makeIntent`), which is
  checked (sealed, pays exactly the terms, passes time-to-dismiss); the nonce, terms and offer are written
  to the encrypted journal **before** `commitQuote` is submitted. Step 2, **offered only once the indexer
  shows the seal:** gossip the signed `quote_ref` and post the encrypted reveal to the mailbox.

---

## `/me`

Trades taken from this browser, per network: settled, failed, expired. Encrypted under a passphrase
(owner decision 2026-09-15). A trade that finishes while the history is locked waits in the tab and is
merged on unlock. A wrong passphrase reads "That passphrase doesn't unlock this history" and changes
nothing. Export JSON (unencrypted, and says so). Delete all behind a typed confirmation.

---

## Cross-cutting

**Data ports** (`src/data/ports.ts`): `ChainPort`, `RelayPort`, `WalletPort`, `CircuitPort`,
`StoragePort`. Pages never import an adapter. Identifiers are lowercase hex at this boundary; amounts
are bigint.

**Storage.** `sessionStorage`: trade state (including the per-RFQ secret, wiped at a terminal state),
reveals, receipts, the tray. `localStorage`: preferences and the relay list only. IndexedDB: encrypted
dealer vault, encrypted trade history, and public event caches. Never a price or key in plaintext
localStorage.

**Latency honesty.** Progress shows real stages. Copy uses only measured Preprod ranges: commit 19–25 s
(53 s degraded), settlement 17–24 s, RFQ → settled about 80 s.

**Empty states carry the cold-start message.** No dealer answering is the expected early condition; it
links to `/deal`.

**Accessibility.** Keyboard-complete (`/` pair, `Enter`, `1`–`9`, `Shift`+click, `T`, `Esc`); visible
focus; countdown announcements throttled to 10 s; charts have `role="img"` with every value in the label
and a table alternative; tables become stacked rows below 768 px.

---

## Not yet run live (2026-09-15)

- A settlement from a browser wallet (`/trade` Settle).
- Any contract circuit from a browser wallet. First check: `/dev/circuits` releases an expired Preprod
  quote.
- Offer Files from the wallet's `makeIntent` (`/desk` manual quote): whether a wallet returns a sealed,
  settleable half is unverified.

See `docs/ROADMAP.md` for the open decisions this UI depends on.
