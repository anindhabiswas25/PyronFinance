# Prompt — implement `apps/web`

Paste everything below the line into a fresh Claude Code session opened at the repo root.
Design reference (all screens): https://claude.ai/code/artifact/e24c3b0f-f369-4340-afd0-645d43bf15aa
Plan reference (flows, page specs, open questions): https://claude.ai/code/artifact/12e028de-f4a1-440b-a5c7-56f0430977c1

---

You are implementing the web frontend (`apps/web`) of the Midnight OTC Protocol — working name
**Pyron** — a sealed-quote OTC venue. Dealers post a bond, seal a price on-chain as a commitment,
then reveal it encrypted to one taker; the taker compares revealed quotes in their own browser and
settles one via Zswap. Work in phases, stop at every gate, and keep code and `docs/` in agreement.

## 0. Before writing any code

1. Read, in order: `CLAUDE.md`, `docs/ROADMAP.md` (whole file), `docs/FRONTEND.md`,
   `docs/ARCHITECTURE.md`, `docs/RELAY.md` §3–§6, `docs/CONTRACTS.md` §2, §5, §7,
   `docs/DISCLOSURE.md`, `docs/DEALER-NODE.md` §3 and §5, `docs/GRANT.md` risks 2–3.
2. Read the SDK surface you will call: `packages/sdk/src/{relay-client,quotes,reveal-channel,offers,
   terms,bonding,fraud,disclosure,indexer,domain,schnorr,contract,wallet}.ts` and
   `packages/relay-node/src/schema.ts`.
3. Load the project skills as each topic comes up: `react-wallet-connector`, `1am-wallet`,
   `midnight-js`, `indexer`, `zswap-offer-files`, `commit-reveal-schemes`, `midnight-security`.
4. Confirm the live deployment address from `deployments/preprod.json` (currently
   `c85b6b93…6b34`, 9 circuits, Class B removed).
5. Reply with a short plan for Phase 0 only, then start it.

## 1. Non-negotiables (from the docs — violating any of these is a bug, not a trade-off)

- **No order book, depth chart, price ladder or streaming book.** Not behind a flag. There is no
  book to render (`FRONTEND.md`).
- **No price before reveal.** The receive field on the request form shows no estimate, no "≈",
  no reference price. The sealed screen has no price column, not even masked.
- **Price comparison happens only in the taker's client**, on verified reveals. Nothing
  price-related goes to any server, relay, analytics, log or URL.
- **Relays are untrusted.** Every `quote_ref` is verified against the chain
  (`verifyQuoteRef`) before it renders as verified. Refuse to publish an RFQ with fewer than 2
  connected relays (`InsufficientRelaysError`); show the relay count at all times (amber at 1, red
  at 0).
- **"Could not verify" ≠ "verified false".** An indexer failure renders as an error state
  ("Can't reach the chain — quotes paused"), never as an empty or rejected list.
- **Every reveal passes all checks before display:** `verifyReveal(reveal, onChainCommitment,
  quotePk, onChainNotional)` AND `offerMatchesTerms` (the Offer File pays exactly the revealed terms).
- **A seal mismatch is escalated, not hidden:** it becomes a "Submit fraud proof" action showing
  the payout (60 % beneficiary + 10 % prover; the taker proving their own fraud receives 70 %).
- **Slashed dealers are never filtered out.** Show the record; the taker decides. No badges, stars,
  "verified dealer" labels or allowlists.
- **Class B no longer exists.** No challenge bond, no "dealer has not settled" screen, no
  `challenged` state. A failed settlement because the dealer's offer coins were spent shows
  "Publish failure evidence" and "Pick another quote".
- **Takers are ephemeral:** a fresh X25519 key (`generateEncKeypair`) and fresh `rfqId` per RFQ,
  never reused.
- **Disclosure notes are opt-in**, default off, and only a hash goes on-chain.
- **Dealer UI:** the Reveal button does not exist until the commit is visible on the indexer; the
  nonce, terms and Offer File are persisted before the commit transaction is submitted; validity is
  capped at 900 s in the UI.
- **No hosted backend.** The app talks to: the wallet (DApp Connector), the indexer, relays the user
  configures, and static ZK assets. Nothing else.
- **Public pages read the chain, never a relay.** The chain stores no prices, so public pages never
  show one.
- **Numbers are decimal strings / bigint end to end.** Never `Number` for amounts; 6 decimals
  (`PRICE_DECIMALS`, `SIZE_DECIMALS`).

## 2. What the code actually is today (verify, then plan around it)

- **The SDK is Node-only in several places**, so it cannot be imported by Vite as is:
  - `reveal-channel.ts` and `disclosure.ts` use `node:crypto` ChaCha20-Poly1305 and `Buffer`.
  - `relay-client.ts` uses the `ws` package API (`ws.on`, `ws.terminate`) and `Buffer`.
  - `quotes.ts` uses `Buffer.compare`.
  - `contract.ts` resolves ZK assets with `node:path` from the filesystem.
  - `wallet.ts` / `providers.ts` build a seed-based `HeadlessWallet` with a level private-state
    provider; `offers.settleFromOffer` calls `WalletFacade.balanceFinalizedTransaction`.
  - `indexer.ts` is `fetch`-based (browser-safe) but imports `ledger-v8` (WASM).
- `pnpm-workspace.yaml` only lists `packages/*` — add `apps/*`.
- Browser wallets expose the DApp Connector API: `balanceSealedTransaction` (for completing a swap
  from a sealed transaction), `balanceUnsealedTransaction` (contract calls), `makeIntent`,
  `makeTransfer`, `submitTransaction`, `getUnshieldedBalances`, `getDustBalance`,
  `getConfiguration`, `getProvingProvider`. **It gives no coin control.**
- Settlement acceptance depends on the node's time-to-dismiss rule (`checkTimeToDismiss`,
  `queryLedgerParameters`): every accepted settlement had one unshielded input per side and ~3 DUST
  spends. Many small coins can make a valid trade unsettleable (`ROADMAP.md` S5).
- Measured Preprod timings (use for copy, never promise faster): `commitQuote` 19–25 s (53 s on a
  degraded network); settlement 17–24 s; commit→indexer visibility 0.2–0.7 s; two-dealer RFQ →
  settled ≈ 80 s.

## 3. Phase 0 — make the browser able to trade (GATE)

Goal: prove the taker path works in a real browser wallet before building screens on it.

**0.1 Browser-safe SDK entry.**
- Add a shared AEAD module on `@noble/ciphers` (`chacha20poly1305`) and use it in both
  `reveal-channel.ts` and `disclosure.ts`. Replace `Buffer` with `Uint8Array` helpers throughout the
  modules the web app imports.
- **Byte-for-byte parity:** before changing anything, capture test vectors (fixed keys and nonces)
  from the current Node implementation; the new implementation must produce identical ciphertexts
  and decrypt old ones. All existing tests (`pnpm test`) must pass unchanged.
- Make `RelayAggregator` take an injectable socket factory (browser `WebSocket` vs `ws`), keeping
  its current behaviour and tests.
- Add `packages/sdk/src/browser.ts` exporting only browser-safe modules, plus a `"browser"` /
  conditional export in `package.json`. Don't break the Node scripts.
- Add a browser `ChainReader` over the indexer (the existing `indexerChainReader` if it is
  already browser-safe).

**0.2 Settlement probe page** (`apps/web/src/dev/SettleProbe.tsx`, dev-only route).
- Connect Lace (and 1AM if installed) through the DApp Connector.
- Receive a real reveal from a running Dealer Node on Preprod (`pnpm --filter @otc/dealer-node
  start` with `taker-pinger`-style RFQ), decrypt it, verify it, deserialize the Offer File.
- `balanceSealedTransaction(offerHex)` → run `checkTimeToDismiss` locally with live parameters →
  `submitTransaction`. Record: accepted or rejected, node error code (`nodeErrorCode`), merged size,
  input/DUST counts, timings.
- Try the "prepare wallet" idea: a `makeTransfer` self-transfer that merges coins, then re-check.
  Record whether it changes the input count.

**0.3 Contract calls from the browser.** Confirm one browser-proved circuit end to end
(`attachDisclosureNote` or `releaseExpiredQuote`) with ZK assets served statically (fetch-based
zk-config provider) and the wallet's proving provider. Note prover-key sizes (largest ≈ 6 MB) and
load them lazily.

**Gate — stop here.** Write results into `docs/ROADMAP.md` (new rows under M2, and resolve or update
the open decisions: browser settlement, coin control, SDK browser entry, Lace vs 1AM). Report to the
owner in the format of §11 and wait for confirmation. If `balanceSealedTransaction` cannot settle an
Offer File, do not build Phase 1's settle step on an assumption — surface it.

## 4. Stack and project setup (Phase 1 start)

- `apps/web`: React 18, Vite, TypeScript (strict), Tailwind CSS, Zustand, React Router. Match
  `FRONTEND.md`; don't silently change the stack (e.g. React 19) — ask.
- `lucide-react` icons at `strokeWidth={1.7}`, 16/20 px. No emoji in UI.
- Fonts: Archivo (display, `font-stretch: 112.5%`), IBM Plex Sans (UI text), IBM Plex Mono
  (hashes, routes, rates). Self-host via `@fontsource` packages — no Google Fonts request at
  runtime.
- Code-split: wallet connector, `ledger-v8` WASM and prover assets load only on routes that need
  them. Public pages must render without any wallet code.
- Config per network in `apps/web/src/config/networks.ts` (indexer HTTP/WS, contract address,
  default relays, pair table from `PAIR_CODES`, USDM token per network from `assets.ts`).
  Preprod default pair `tNIGHT/TESTUSD` labelled as a test pair; Preview/Mainnet `tNIGHT/USDM`.
- Scripts wired into turbo: `dev`, `build`, `typecheck`, `test`, `test:e2e`.

## 5. Design system (implement exactly; tokens as CSS variables consumed by Tailwind)

Dark is default; light is a user toggle ("System / Dark / Light").

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0D1220` | `#F3F4F7` | page ground |
| `--s1` | `#131A2A` | `#FFFFFF` | cards |
| `--s2` | `#1A2338` | `#ECEEF3` | selected rows, inputs, secondary buttons |
| `--line` | `#27314A` | `#D4D8E2` | control borders |
| `--line2` | `#1E2740` | `#E2E5EC` | dividers, card borders |
| `--tx` | `#E7EAF3` | `#141A29` | text; primary button fill |
| `--mu` | `#8C95AD` | `#566078` | secondary text |
| `--dim` | `#626B85` | `#7B849A` | tertiary text, labels |
| `--seal` | `#E39B62` | `#B0602C` | anything sealed / in progress |
| `--ok` | `#4FC7A4` | `#1E876A` | verified, settled, best |
| `--bad` | `#EF6F6C` | `#C4423F` | fraud, slashed, failure |
| `--warn` | `#E3BE5C` | `#95700F` | caution, record warnings |

Soft fills are the same hue at 12–13 % alpha (`--okbg` etc.). Copper is never a primary button.

- **Type scale:** 44 / 30 / 26 / 22 / 19 / 15 / 14 / 13.5 / 12.5 / 10.5 (uppercase labels, 0.09em
  tracking). Tabular numerals on every number.
- **Radii:** cards 12, buttons 9 (small 7), inputs 10, chips 5.
- **Controls:** primary/secondary buttons 44 px, small 34 px, pills 34 px; page gutter 40 px;
  content max-width 1280 px.
- **Motion:** hover 120 ms; enter 220 ms (new rows slide 4 px + fade from a copper tint);
  state change 260 ms ease-out; skeleton shimmer 1.4 s. `prefers-reduced-motion` → fades only.
- **Status is always text + form, never color alone:** chips carry words ("On-chain", "Checking
  chain", "2 slashes").

## 6. Information architecture — 10 pages, 6 overlays

| # | Route | Page | Wallet |
|---|---|---|---|
| 1 | `/trade` | Trade (states: request → sealed → compare → settle) | yes |
| 2 | `/trade/:quoteId` | Trade receipt | public view; private details on this device |
| 3 | `/me` | My trades | device-local |
| 4 | `/deal` | Become a dealer | no |
| 5 | `/desk` (tabs `?tab=overview|quotes|bond|rfq|keys`) | Desk | dealer key |
| 6 | `/` | Venue | no |
| 7 | `/activity` | Activity | no |
| 8 | `/dealers` | Dealers | no |
| 9 | `/dealers/:dealerCmt` | Dealer profile | no |
| 10 | `/verify` (tabs `check`, `note`) | Verify | no (wallet only to submit a proof) |

Overlays (no route change, Esc closes, focus returns to the trigger): Connect wallet, Wallet
readiness, Transaction tray (`T`), Relays, Submit fraud proof, Attach disclosure note.

Global top bar: logo · Trade · Activity · Dealers · Desk · Verify · network pill · relays pill ·
tray pill (when anything is in flight) · wallet pill / Connect.

## 7. Page specifications

Match the design canvas. Everything below is behaviour the canvas can't show.

### 7.1 `/trade` — one route, a state machine, no reloads

State machine (Zustand `rfq` slice), persisted to `sessionStorage` on every transition so a refresh
restores it (the per-RFQ X25519 secret included; clear it when the RFQ is terminal):

```
idle → requesting → sealed → revealed → settling → settled
                                   ↘ failed{ reason: 'inputs-spent' | 'wallet-shape' | 'expired' | 'rejected', code? }
       (any) → cancelled
```

Stepper: Request · Sealed · Compare · Settle. Back steps back without losing data.

**Request.** Sell/Buy segmented; amount (decimal string, ≤ 6 dp, blocks invalid input as typed);
pair picker (`/` shortcut); receive field shows the lock + "Price revealed after dealers seal";
Advanced: quote window (1 / 2 / 5 min, default 2 — commits take 20–45 s), minimum dealer bond
(sent as `minBond`), disclosure recipient (off). Wallet readiness row (network, balance, DUST
available; coin-shape warning if Phase 0 found a usable check). Side panel: dealers bonded for the
pair, largest quotable size (max bond × 20), median bond — all from the chain. Submit
(`Enter`) → `publishRfq` to all connected relays.

**Sealed.** Countdown ring for the RFQ window (fixed, never extended). One row per `quote_ref`:
`Checking chain` (skeleton) → `On-chain` + bond + settled/slashed, or dropped with a logged reason.
Poll the mailbox (`GET /mailbox/:takerEncPk` on every `replyTo` relay) every 2 s; decrypt and verify
reveals as they arrive. Late rows slide in. "Compare N now" when ≥ 1 reveal is verified; auto-advance
when the window closes. Right rail: relays with "heard N" counts; an event log with real timestamps
("0f7a…91 seal confirmed · block …").
Empty result: "No dealer answered in 2:00." → Ask again · Become a dealer.

**Compare — comparative analysis** (the most important screen; see canvas "01 Trade · Compare").

Definitions (put the math in `apps/web/src/lib/compare.ts`, bigint-based, unit-tested):
- *Valid quote*: verified reveal, unresolved, `validUntil > now`.
- *You receive / You pay*: `counterAmountFor(terms)` formatted at 6 dp. Taker **selling** base →
  "You receive", best = max. Taker **buying** base → "You pay", best = min.
- *vs best*: absolute difference and basis points,
  `bps = round((amount / best − 1) × 10 000)`, signed from the taker's point of view (worse is
  negative). Best row shows a "Best" chip.
- *Rate*: `price` from the terms, 5 significant decimals.
- *Median*: median amount over valid quotes (even count → mean of the middle two, rounded toward the
  taker's worse side).
- *Spread between quotes*: best vs worst valid quote, bps and absolute.
- *Bond · % of trade*: `bondAmount / notional × 100`, 1 dp, with a thin bar capped at 100 %.
  Bar color: ≥ 50 % ok, 20–50 % neutral, < 20 % warn.
- *Record*: `settled · slashed` from the chain; `failed` = count of published failure evidence.
  **Until an evidence store exists (open decision), render `—` with a tooltip, never a fake 0.**
- *Offer check*: run `checkTimeToDismiss` on the dealer's half alone with live ledger parameters,
  plus its unshielded input count (`inputsOf`). Show "1 coin · fits" or "3 coins · too heavy". Do
  **not** balance every quote against the wallet to compute this — balancing books coins and the
  connector cannot revert it. The merged check runs once, for the selected quote, in Settle.
- *Valid for*: `validUntil − now` countdown plus a thin bar of remaining ÷ (validUntil − firstSeen).
  At zero: row greys, button becomes "Expired", row stays for reference.

Layout, top to bottom:
1. Stepper + RFQ chip ("Sell 50,000 tNIGHT → USDM") + window status.
2. Title "Compare quotes", one-line count ("4 prices opened, 3 still valid, 1 failed its seal"),
   sort segmented: Most received (default) · Largest bond · Longest validity.
3. Summary strip, 5 cells: Best received · Median of valid quotes · Spread between quotes · First to
   expire · Checked on-chain (N of M).
4. Fraud banner per seal mismatch (excluded from every statistic) with "Submit proof · receive X".
5. **Strip plot** "Where the quotes land": one horizontal axis in the counter asset; a dot per
   quote labelled with the dealer; median as a dashed line; best filled `--ok`; selected filled
   `--tx`; expired hollow `--dim`; mismatches not plotted. Axis spans min–max of plotted amounts
   padded 10 % and rounded to nice ticks; labels never overlap (stagger vertically when closer than
   90 px). SVG with theme tokens via `style`, `role="img"` and an `aria-label` listing every value.
6. **Comparison table**, columns: rank (keyboard `1`–`9`) · Dealer (+ record chip) · You receive ·
   vs best · Rate · Bond · % of trade · Settled · slashed · failed · Offer check · Valid for ·
   Select. Selected row: `--s2` fill + 1 px inset border. Caution chips: `slashed > 0` →
   "N slashes"; bond % < 10 → "Small bond"; best price AND weakest record → inline caution line
   under the row.
7. Bottom split:
   - **Pairwise comparison** (default: selected vs best; the user can pin any two rows with
     `Shift`+click): rows You receive · Bond · Record · Valid for · Offer check, with a Difference
     column, plus one plain-language sentence generated from the numbers — e.g. "Choosing 0f7a…91
     gives up 23.00 USDM (1.10%) for a dealer with 8.7× the bond and no slashes." Never
     editorialize beyond the numbers.
   - **Settle card** for the selected quote: amounts, the four passed checks, "Settle · about 20 s"
     (`Enter`), and "Take best price instead" when the selection isn't best.
8. Footnote explaining Offer check and Bond %.

Live-update rule: never reorder rows while the pointer is over the table or a row is selected. Show
a "1 new quote · Re-sort" pill instead. New rows enter with the 220 ms highlight.

**Settle.** Checklist that advances on real events: offer coins still unspent (indexer) → wallet
balanced the offer (`balanceSealedTransaction`) → passes the network's validation limit
(`checkTimeToDismiss`, show "19.6 of 20.7 ms") → submitting (show elapsed, "usually 17–24 s") →
confirmed. The tray takes over if the user navigates away. Outcomes:
- settled → `/trade/:quoteId`;
- inputs spent → "This quote can't settle — the coins behind it were spent in tx … at …, before the
  quote expired. You lost nothing." · Publish evidence · Take N from <next best valid quote>;
- wallet shape → "Your wallet needs one prep step" with the measured numbers and "Merge coins,
  then settle" (only if Phase 0 proved it works; otherwise explain and link to docs);
- node rejection → the code and its plain meaning (`nodeErrorCode`), never a raw byte dump.

### 7.2 `/trade/:quoteId` — Receipt
Public block (from chain): quote id, dealer, size, settlement tx, block, note status. Private block
("Only on this device"): price, amount received, other quotes, request key note. Label the public
status **"Resolved"** unless a settlement tx is known locally — the contract cannot distinguish
settled from released (open decision). Attach disclosure note → overlay → `sealNote` →
`attachDisclosureNote` → offer the blob as a file.

### 7.3 `/me` — My trades
IndexedDB, encrypted with WebCrypto AES-GCM. Key source is an open decision (a passphrase, or a
key derived via wallet `signData`); implement behind an interface, default to passphrase, and
surface the decision. Filters All/Settled/Failed/Expired; export JSON; delete all with confirm.

### 7.4 `/deal` — Become a dealer
Two paths (Dealer Node recommended with the three real commands from
`packages/dealer-node/README.md`; browser quoting with its caveats). Bond calculator from
`minBondForNotional`. Slash split bar 60/10/30 in the user's numbers. Timing facts: quotes ≤ 15 min,
release after 1 h grace, withdrawal 24 h with no live quotes.

### 7.5 `/desk` — Desk (tabs)
- **Overview:** status banner, bond + headroom (× 20), live quotes, answered vs skipped RFQs, alerts
  mirrored from the node README's alert table, coins ready per side vs `ladder_coins`. Node-sourced
  numbers require a local, read-only node status endpoint — **not built yet**: add it to
  `packages/dealer-node` only after owner approval; until then render chain-sourced data and a
  "Connect your node" empty state.
- **Quotes:** all quotes by state; bulk "Release expired" (`releaseExpiredQuote`, permissionless);
  after any release failure, re-read the chain before showing an error (live releases reported code
  104 while landing).
- **Bond:** post / top up / request withdrawal / withdraw as one timeline; blocked actions say why
  and when.
- **Manual quote:** incoming RFQs list; price input → taker amount; validity 5/10/15; cap check
  `notional ≤ bond × 20`; binding warning in the dealer's own numbers; step 1 Commit (persist
  nonce/terms/offer to IndexedDB **before** submit) → step 2 Reveal only after indexer visibility.
  Offer File via `makeIntent(…, { payFees: false })` — verify this in Phase 0.3 or defer the tab.
- **Keys:** dealer key generation/import, encrypted at rest, forced backup download before first
  bond. Key custody in the browser is an open decision; implement only after the owner confirms.

### 7.6 Public pages
- `/` Venue: headline, the four-step explanation, chain totals, not-an-AMM/book/API row, contract
  address, links (run a relay, dealer node).
- `/activity`: resolved (settled/released), slashed, new bonds, withdrawal requests; filters; live via
  indexer subscription; totals (resolved, slashed, burned, bonded). No price column.
- `/dealers`: every bonded key; Active / Withdrawing / Slashed; sortable; "No record" for new keys.
- `/dealers/:dealerCmt`: full commitment with copy, stats, bond-over-time step chart, recent quotes
  with outcomes, published evidence.
- `/verify`: paste or load a signed reveal / failure evidence → checklist verdict → submit proof;
  Note tab → `verifyNote` with the six checks listed; wrong key message "This note isn't addressed to
  this key."

## 8. State, data and persistence

- Zustand slices: `wallet`, `network`, `relays`, `rfq`, `quotes` (per-quote verification state with
  reason), `settlement`, `tray`, `dealer`, `feed`, `prefs`.
- Chain reads: indexer HTTP for state (`queryLatestContractState` + the compiled contract's
  `ledger()` decoder), WS subscriptions for the feed. Cache with a short TTL; never cache a
  rejection caused by indexer lag (mirror `RelayAggregator.collect`'s rule).
- Relays: user-editable list (localStorage), defaults per network, health from `GET /health`.
- Never store prices, reveals or keys in `localStorage` in plaintext.

## 9. Copy rules

Write from the user's side: "seal", "price", "bond", "record" — not "commitment hash",
"persistentCommit", "notional". Hashes are truncated `abcd…ef` with copy-on-click. Every error says
what happened and the next step. No apologies. No latency promises beyond the measured ranges.

## 10. Quality bar

- **Accessibility:** keyboard-complete (`/`, `Enter`, `1`–`9`, `Shift`+click compare, `T` tray,
  `Esc`); visible focus rings; timers have text equivalents and `aria-live="polite"` updates at most
  every 10 s; sealed→revealed never relies on color or motion alone.
- **Responsive:** designed for ≥ 1280 px; fully usable at 1024 px; the taker flow (request, compare
  as stacked cards, settle) works at 390 px.
- **Performance:** public pages ship without wallet/WASM code; LCP < 2.5 s on a warm CDN.
- **Tests:** vitest for `compare.ts` (bps rounding, median, best by side, bigint formatting), the RFQ
  reducer (every transition incl. refresh restore), and crypto parity; component tests for Compare
  (sorting, live-insert pill, expired rows, fraud exclusion); Playwright e2e against two local relays
  (`packages/relay-node`) with a mocked `ChainReader` and fixture reveals; one manual Preprod run per
  phase, recorded in `ROADMAP.md` with timings.
- `pnpm typecheck` and `pnpm test` green at every commit.

## 11. Phases, gates and reporting

- **Phase 0** (§3) → gate.
- **Phase 1 — M2 tasks 2.5 and 2.7:** app shell, design tokens, top bar, overlays (wallet, readiness,
  tray, relays), `/trade` all states including Compare and failure outcomes, `/desk?tab=rfq` manual
  quote. **Done when:** a real two-dealer RFQ on Preprod is requested, compared and settled from the
  browser, and a manual browser quote is committed and revealed. Update `ROADMAP.md` (2.5, 2.7, M2
  status) → gate.
- **Phase 2 — M3 task 3.8 and the rest:** `/activity`, `/trade/:quoteId` with disclosure attach,
  `/verify` (both tabs), `/dealers`, `/dealers/:cmt`, `/`, `/deal`, `/me`, remaining Desk tabs.
  **Done when:** a settled trade's note is attached from the receipt and opened on `/verify` by the
  recipient only; the feed shows a live slash from `pnpm run e2e-fraud`. Update `ROADMAP.md` → gate.

At each gate report: what was built (files), what ran live (with tx hashes and timings), what
failed and why, which open decisions were hit, and exactly what you need from the owner. Do not
start the next phase without confirmation.

## 12. Keep the docs true

- Update `docs/FRONTEND.md` as you build: remove the Class B screen, add the comparative-analysis
  spec above, fix Screen 4 (no prices in the feed), add the 10-page IA and overlays.
- Record every new constraint you discover (wallet API behaviour, browser proving limits) in
  `docs/ROADMAP.md`, and in the relevant `.claude/skills/*/SKILL.md` in place.
- Surface, don't decide: failure-evidence storage, dealer key custody in the browser, `/me`
  encryption key source, Lace vs 1AM, node status endpoint, "resolved" vs "settled" labelling.

## 13. Do not

Build an order book or depth view · show estimated prices · add a backend, database or analytics ·
trust relay data for anything public · hide slashed dealers · add a challenge/Class B flow · reuse
taker keys · use floats for amounts · reorder rows under the user's cursor · promise timings you
haven't measured · change the stack or contract without asking.
