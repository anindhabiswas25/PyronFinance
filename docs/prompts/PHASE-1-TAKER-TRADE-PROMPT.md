# Prompt — Phase 1A: the taker trade flow in `apps/web`

Paste everything below the line into a fresh Claude Code session opened at the repo root
(branch `harden-m1` or a branch cut from it).

Design reference (all screens): https://claude.ai/code/artifact/e24c3b0f-f369-4340-afd0-645d43bf15aa
Full spec this phase implements a slice of: `docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md`

---

You are continuing the web frontend of the Midnight OTC Protocol (working name **Pyron**). Phase 0
made the SDK browser-safe and added a dev-only settle probe. **This session builds Phase 1A: the app
shell and the complete taker flow on `/trade` — request → sealed → compare → settle → receipt —
against real relays, a real Dealer Node and a real browser wallet on Preprod.** The manual dealer
quote screen (Phase 1B) is out of scope for this session.

## 0. Read before doing anything

1. `CLAUDE.md`, then `docs/ROADMAP.md` in full (it is the live record; Phase 0 is not yet recorded
   in it — see §2).
2. `docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md` — §1 (non-negotiables), §5 (design tokens),
   §6 (IA), §7.1 (`/trade` spec and the Compare definitions), §8–§10. That file is the spec; this
   prompt corrects it where Phase 0 learned something (§3 below wins on conflict).
3. `docs/FRONTEND.md`, `docs/RELAY.md` §1, §3, §4, §6, `docs/ARCHITECTURE.md` "End-to-end flow".
4. Code you will build on, in this order:
   - `apps/web/src/dev/SettleProbe.tsx` — the working reference for connect → decrypt → verify →
     deserialize → `checkTimeToDismiss` → `balanceSealedTransaction` → `submitTransaction`.
   - `scripts/taker-pinger.ts` — the complete Node taker loop (RFQ → collect → mailbox → verify →
     `offerMatchesTerms` → settle → wait for the dealer's record). `/trade` is this loop with a UI.
   - `packages/sdk/src/browser.ts` (the only SDK entry `apps/web` may import), `relay-client.ts`,
     `reveal-channel.ts`, `quotes.ts`, `offers.ts`, `terms.ts`, `indexer.ts`, `assets.ts`.
   - `packages/relay-node/src/{schema,server,mailbox}.ts`.
   - `node_modules/@midnight-ntwrk/dapp-connector-api/dist/api.d.ts` (installed 4.0.1) — the real
     wallet API. Never type wallet calls from memory; copy from this file.
5. Skills to load when relevant: `react-wallet-connector`, `1am-wallet`, `indexer`,
   `zswap-offer-files`, `midnight-security`.
6. Reply with a short plan for §4 (Step 1.0) only, then start it.

## 1. Where the code is today (verified 2026-09-14 by reading it and building it)

**Done in Phase 0 (commits `1ee63e6`, `2e74fbb`, `219b0fb`):**
- `@otc/sdk/browser` (`packages/sdk/src/browser.ts`, exported as `"./browser"` pointing at TS
  source). Exports domain, terms, schnorr, quotes, bonding, fraud, indexer, reveal-channel,
  disclosure, aead, types, the pure parts of offers (`offerMatchesTerms`, `checkTimeToDismiss`,
  `inputsOf`, `nodeErrorCode`, `serializeOffer`, `deserializeOffer`, `balanceVectorOf`, …) and the
  relay client (`RelayAggregator`, `verifyQuoteRef`, `indexerChainReader`, `SocketFactory`,
  `WebSocketLike`). **Not exported:** `assets.ts` (USDM table), and nothing re-exports
  `nativeToken()` from `@midnight-ntwrk/ledger-v8`.
- `aead.ts` on `@noble/ciphers` with byte-parity tests (`packages/sdk/test/aead-parity.test.ts`);
  `reveal-channel.ts`/`disclosure.ts` no longer use `node:crypto`/`Buffer`.
- `RelayAggregator` takes `socketFactory` (browser: `(url) => new WebSocket(url)`; Node:
  `nodeSocketFactory` in `relay-client-node.ts`).
- `apps/web`: Vite 5 + React 18 + TS strict, `vite-plugin-wasm` + `vite-plugin-top-level-await`,
  `@midnight-ntwrk/dapp-connector-api@4.0.1`. No router, no Tailwind, no Zustand, no tests yet.
  `App.tsx` mounts only `SettleProbe`. Root `package.json` pins `@swc/core` 1.7.26 (top-level-await
  plugin crash workaround). `pnpm-workspace.yaml` includes `apps/*`.
- `pnpm --filter @otc/web build` passes (~1.2 s). Its output shows three things you must deal with:
  `assert` is externalized for the browser (imported by `@subsquid/scale-codec`, reached through the
  SDK) — it will throw if that code path runs; `midnight_ledger_wasm_bg` is **10.2 MB** and the main
  chunk 517 kB (code-split); **two** `midnight_onchain_runtime_wasm_bg` files (1.32 MB and 1.33 MB)
  are bundled, which suggests two runtime versions — dedupe.

**Proven live with a real 1AM wallet on Preprod:** connect, `getUnshieldedAddress`,
`getConfiguration`, `getUnshieldedBalances`, `getDustBalance` (`{ cap, balance }`), and a
`makeTransfer` self-transfer that the 1AM extension **submitted itself** and whose resolved value
was **not** the declared `{ tx: string }`.

**Not proven, and not recorded in ROADMAP.md:**
- A dealer Offer File settled through `balanceSealedTransaction` + `submitTransaction` from a
  browser wallet (task 0.2's actual goal).
- Whether a merge-coins self-transfer reduces settlement inputs.
- Task 0.3 (a contract circuit proved from the browser). Not needed for 1A; it gates 1B.
- `vite.config.ts` comments cite "docs/ROADMAP.md's Phase 0 gate report" — that section does not
  exist yet.

**Facts about the relay and dealer node that the browser path depends on:**
- `packages/relay-node/src/server.ts` sends **no CORS headers** (`jsonResponse` sets only
  content-type/length; there is no `OPTIONS` handling). A page served from the Vite origin cannot
  read `GET /mailbox/:takerEncPk`, `/health` or `/rfqs`.
- `Mailbox.take()` **deletes** entries when read. A reveal fetched and then lost to a reload is gone.
- The Dealer Node puts every reveal in **one** relay's mailbox: `dealerEndpoint = mailboxBase` =
  its first configured relay's `ws://…/gossip` rewritten to `http://…` (`packages/dealer-node/src/live.ts`).
  Fetch from the signed `quote_ref.dealerEndpoint`, not from your own relay list (this is what
  `taker-pinger.ts` does).
- There are no public relays. Local dev uses `ws://127.0.0.1:18787/gossip` and
  `ws://127.0.0.1:18788/gossip` (`packages/dealer-node/dealer.example.toml`).

**Wallet API facts from the installed `api.d.ts`:**
- `InitialAPI` on `window.midnight[<key>]`: `rdns`, `name`, `icon`, `apiVersion`, `connect(networkId)`.
- `balanceSealedTransaction(tx: hex, { payFees? })` expects a serialized
  `Transaction<SignatureEnabled, Proof, Binding>` — the Offer File's type — and balances "in a
  separate intent".
- `submitTransaction(tx)` resolves **void**. There is no returned id: derive the id/hash from the
  merged transaction you submitted (ledger-v8 `Transaction` — check the installed `.d.ts` for the
  identifiers/hash method) and poll `waitForTransaction(indexer, { identifier })` from `indexer.ts`.
  `getTxHistory(page, size)` returns `{ txHash, txStatus: pending|confirmed|finalized|discarded }`
  and may be used as a second signal.
- `hintUsage(methods)` lets the wallet ask for permissions up front; `getConnectionStatus()` detects
  a dropped connection.
- **No API exposes coins or UTXO counts.** A readiness check cannot know coin fragmentation before
  settling (this corrects the design canvas's "1 tNIGHT coin fits · 5 DUST coins" row — see §3.4).

**Protocol facts for this flow:**
- Preprod pair is `tNIGHT/TESTUSD` (`PAIR_CODES` code 2). TESTUSD token type
  `53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc`
  (`deployments/preprod-test-token.json`). Base leg is the native token (`nativeToken().raw`).
  Preview/Mainnet use `tNIGHT/USDM` from `assets.ts`. Contract: `deployments/preprod.json`
  (`c85b6b93…6b34`).
- **Sides:** the RFQ `side` is the **taker's** side of the base asset (RELAY.md §3.1). Reveal terms
  carry the **dealer's** side. Taker sells base ⇔ `terms.side === 'buy'` ⇔ the taker **receives**
  `counterAmountFor(terms)` (rounded up, in the taker's favour). Taker buys base ⇔
  `terms.side === 'sell'` ⇔ the taker **pays** `counterAmountFor(terms)` (rounded down). Reject a
  reveal whose side is not the opposite of the RFQ's.
- `offerMatchesTerms(offerFile, { dealerSide: terms.side, base: { kind:'unshielded', token: NIGHT,
  amount: encodeTerms(terms)[3] }, counter: { kind:'unshielded', token: COUNTER, amount:
  counterAmountFor(terms) } })` — exactly as `taker-pinger.ts` calls it. The probe skipped it for
  lack of a token table; `/trade` must not.
- Measured timings for copy: commit 19–25 s (53 s degraded), commit → indexer 0.2–0.7 s,
  settlement 17–24 s, two-dealer RFQ → settled ≈ 80 s.

## 2. Non-negotiables for this phase

Everything in `FRONTEND-IMPLEMENTATION-PROMPT.md` §1 applies. The ones this phase can break:
no price before reveal · no order book · every quote verified on-chain before it renders as
verified · "couldn't verify" is a different state from "rejected" · `offerMatchesTerms` before any
settle · refuse to publish an RFQ below 2 connected relays · fresh X25519 key and `rfqId` per RFQ ·
slashed dealers shown, never filtered · no Class B / challenge UI · amounts are bigint/decimal
strings, never `Number` · no backend, no analytics, nothing price-related leaves the browser.

## 3. Corrections to the spec, from Phase 0

1. **Relay CORS is a prerequisite.** Add CORS to `packages/relay-node/src/server.ts`:
   `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
   `Access-Control-Allow-Headers: content-type`, and a `204` response to `OPTIONS` on `/health`,
   `/rfqs` and `/mailbox/*`. Wildcard is safe: the relay holds only public gossip and opaque
   ciphertext. Add a test in `packages/relay-node/test/server.test.ts`. Update `docs/RELAY.md` §1 in
   the same change ("HTTP endpoints MUST allow cross-origin reads so browser takers can use them") —
   RELAY.md is normative and a third-party relay must know this.
2. **The mailbox read is destructive.** Persist every fetched `RevealMessage` to `sessionStorage`
   *before* decrypting or rendering it. Do not change `Mailbox.take()` semantics — that is a wire
   change; record it as an open decision instead.
3. **Offer check** on Compare = `checkTimeToDismiss(dealerHalf, liveParams)` plus
   `inputsOf(dealerHalf).length`, on the dealer's half alone. Never balance every quote against the
   wallet (balancing books coins; the connector cannot revert it).
4. **Wallet readiness can only check what the connector exposes:** network (`getConfiguration().
   networkId`), balance of the asset the taker gives ≥ size (base when selling; an upper-bound
   counter estimate is not allowed — for a buy show "you'll see what you pay after reveal"), DUST
   `balance > 0` with `cap`, relays ≥ 2. Coin fragmentation surfaces only at Settle, from the merged
   local check. Replace the canvas's coin-count row with these truthful checks.
5. **"Publish failure evidence" has no destination yet** (open decision). In 1A the button is
   **"Save evidence"**: a JSON file with the `RevealMessage`, decrypted terms, Offer File, `quoteId`,
   `dealerCmt`, the spending transaction hash if found, and timestamps. Offer it via a Blob download.
6. **"Merge coins, then settle"** ships only if Step 1.0 measures that a wallet self-transfer
   actually reduces the settlement's inputs. Otherwise the wallet-shape failure shows the numbers and
   says what to do in the wallet, with no action button.
7. **The input pre-check** ("offer coins still unspent") needs an indexer lookup the SDK doesn't
   have. Add a browser-safe `queryUnshieldedInputSpent(indexerHttp, intentHash, outputNo)` (or
   similar) to `packages/sdk/src/indexer.ts`, using the indexer GraphQL schema (`indexer` skill;
   `packages/dealer-node/src/live.ts` already subscribes to `unshieldedTransactions`). If the schema
   has no practical lookup, skip the pre-check, classify failures after the fact, and record it.

## 4. Step 1.0 — close the Phase 0 gate (do this first, then stop and report)

1. **CORS** (§3.1), with its test and the RELAY.md edit.
2. **Live settlement from the browser.** Start two relays with mailboxes:
   ```bash
   RELAY_PORT=18787 RELAY_ENABLE_MAILBOX=true RELAY_PEERS=ws://127.0.0.1:18788/gossip pnpm --filter @otc/relay-node start
   RELAY_PORT=18788 RELAY_ENABLE_MAILBOX=true RELAY_PEERS=ws://127.0.0.1:18787/gossip pnpm --filter @otc/relay-node start
   ```
   and a Dealer Node per `packages/dealer-node/README.md` pointed at them (ask the owner which
   funded dealer wallet and `dealer.toml` to use — never invent or print seeds). Extend `SettleProbe`
   so it publishes a real RFQ through `RelayAggregator` with the browser `WebSocket`, collects and
   verifies the `quote_ref`, fetches the reveal from `dealerEndpoint`, runs `offerMatchesTerms`, then
   settles via `balanceSealedTransaction` → local `checkTimeToDismiss` → `submitTransaction`, and
   confirms on the indexer. Taker **sells** a small tNIGHT size (e.g. `0.001`) so the taker wallet
   needs only tNIGHT and DUST. Run it with 1AM and, if installed, Lace.
3. **Measure the merge idea:** run the settle once on a fragmented taker wallet and record the
   merged input count and dismiss verdict; self-transfer; repeat. Record whether it changed.
4. **Fix the build warnings** that could bite at runtime: find what imports `@subsquid/scale-codec`
   (`pnpm why`), confirm whether the `assert` path runs during verify/settle (it will throw if it
   does), and dedupe the duplicate on-chain runtime.
5. **Write the missing Phase 0 gate report** into `docs/ROADMAP.md` (a "Phase 0 — browser" section
   under M2, plus status-table text): what 0.1 changed, what 0.2 proved live (tx hashes, statuses,
   merged shapes, dismiss margins, timings, which wallet), the 1AM `makeTransfer` behaviour, the CORS
   and destructive-mailbox findings, 0.3 still open. Add open decisions: mailbox destructive read,
   failure-evidence destination, coin readiness invisible to the dApp, 1AM vs Lace behaviour
   differences.

**Stop.** Report in the format of §9 and wait for the owner. If `balanceSealedTransaction` cannot
settle an Offer File in a browser wallet, do not build §5's settle step on an assumption.

## 5. Phase 1A build (only after the owner confirms Step 1.0)

### 5.1 Project setup
- Add: `react-router-dom` (v6), `zustand`, `tailwindcss` (+ PostCSS), `lucide-react`,
  `@fontsource/archivo` (variable, with width axis), `@fontsource/ibm-plex-sans`,
  `@fontsource/ibm-plex-mono`. Dev: `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test`.
- Scripts in `apps/web/package.json`: `dev`, `build`, `typecheck`, `test`, `test:e2e`. Either add
  `apps/*/test/**/*.test.{ts,tsx}` to the root `vitest.config.ts` or give `apps/web` its own vitest
  config with `environment: 'jsdom'`; `pnpm test` at the root must still run everything.
- Export from `packages/sdk/src/browser.ts`: `assets.ts` (type-only ledger import, safe) and a
  `nativeTokenRaw()` helper wrapping `nativeToken().raw`. Keep `browser.ts`'s exclusion comments
  accurate.
- `apps/web/src/config/networks.ts`, typed per network: contract address, pair list with base/counter
  token types and decimals, default relays, indexer HTTP/WS (fallback only — prefer the wallet's
  `getConfiguration()` and warn if it disagrees). Read overrides from `import.meta.env`
  (`VITE_NETWORK`, `VITE_RELAYS`, `VITE_CONTRACT_ADDRESS`); commit an `apps/web/.env.example`.
- Move `SettleProbe` behind `/dev/settle-probe`, rendered only when `import.meta.env.DEV`.
- Code-split: `/trade` lazy-loads `@otc/sdk/browser` (and with it the WASM). The shell must render
  before any WASM loads.

### 5.2 Design system
Implement `FRONTEND-IMPLEMENTATION-PROMPT.md` §5 exactly: CSS variables for dark (default) and light
on `:root` / `[data-theme]`, Tailwind `theme.extend` mapped to those variables, the type scale,
radii (cards 12, buttons 9/7, inputs 10, chips 5), control heights (44/34), motion tokens (120/220/
260 ms, `prefers-reduced-motion` → fades only). Build primitives first, each with a test or story:
`Button` (pri/sec/ghost/danger, sm), `Chip` (ok/seal/bad/warn/neutral), `Card`, `Segmented`,
`Pill`, `Kbd`, `Stepper`, `Skeleton`, `Countdown` (text + `aria-live` throttled to 10 s),
`Hash` (truncate `abcd…ef`, copy on click), `Amount` (bigint + decimals → tabular string).

### 5.3 App shell
Top bar per the canvas: logo · Trade · Activity · Dealers · Desk · Verify (links that aren't built
yet go to a simple "Coming in Phase 2" page, not dead links) · network pill · relays pill (count,
amber at 1, red at 0, opens Relays overlay) · tray pill (when anything is in flight) · wallet pill /
Connect. Theme toggle System/Dark/Light (localStorage).

### 5.4 Wallet layer (`src/wallet/`)
- `discoverWallets()` from `window.midnight`, showing `name`, `icon`, `apiVersion`; accept major
  version 4 and label others unsupported.
- `connect(rdns)`: `connect(networkId)` → `hintUsage([...the methods /trade uses])` →
  `getConfiguration()`; refuse, with a clear message, if `networkId` differs from the app's network.
- Poll `getConnectionStatus()` every 10 s; on loss, keep RFQ state and show "Wallet disconnected —
  reconnect to settle".
- A typed `WalletPort` interface (balances, dust, balanceSealed, submit, txHistory, config) so
  tests inject a fake. Handle 1AM's non-conforming `makeTransfer` result defensively, as the probe does.
- Remember the last wallet `rdns` in localStorage; never auto-connect without a user gesture.

### 5.5 Relay layer (`src/relays/`)
- One app-wide `RelayAggregator` per network with `socketFactory: (u) => new WebSocket(u)` and
  `indexerChainReader(indexerHttp, contract)`. Relay list editable in the Relays overlay
  (localStorage), health from `GET /health` every 30 s.
- `collect(rfq)` polled every 2 s while an RFQ is open. Track per-quote first-seen time and relay
  set for the Sealed screen's "heard N" and the event log.
- Mailbox: for each verified quote, `GET ${quote.dealerEndpoint}/mailbox/${rfq.takerEncPk}` every
  2 s until its reveal arrives or the quote expires. **Persist every returned message before anything
  else** (§3.2); messages for other `quoteId`s under the same key are kept too.

### 5.6 State (`src/state/`), Zustand with `persist` to `sessionStorage`
Slices: `wallet`, `network`, `relays`, `rfq`, `quotes`, `settlement`, `tray`, `prefs`.
Use a bigint-safe JSON replacer/reviver. The RFQ reducer is pure and unit-tested:

```
idle → requesting → sealed → revealed → settling → settled
                                   ↘ failed{ reason: 'inputs-spent' | 'wallet-shape' | 'expired' | 'rejected', code?: number, detail }
(any non-terminal) → cancelled
```

Per-quote verification state: `announced` → `checking` → `on-chain` | `rejected{reason}` |
`unverifiable{error}` → (reveal) `decrypting` → `revealed` | `reveal-invalid{reason}` |
`seal-mismatch` (fraud) | `offer-mismatch{reason}`; plus `expired` when `validUntil` passes. The RFQ
secret key lives only in `sessionStorage` and is wiped when the RFQ reaches a terminal state.

### 5.7 `/trade` screens
Follow the canvas and `FRONTEND-IMPLEMENTATION-PROMPT.md` §7.1, with §3's corrections:
- **Request:** the truthful readiness row (§3.4); `publishRfq` with `replyTo` = connected relay URLs,
  `expiry = now + window`, optional `minBond`. Show `InsufficientRelaysError` as the relays pill turning
  red plus inline copy, never a toast.
- **Sealed:** countdown ring; rows per quote state; late rows slide in; "Compare N now"; auto-advance
  at window close; event log with real timestamps; for each commit, link `quote_ref.txHash` and show
  its block height once `queryTransaction({ hash })` returns it. Empty result → "No dealer answered in
  2:00" with Ask again and a link to `/deal` (Phase 2 placeholder).
- **Compare (comparative analysis):** implement `src/lib/compare.ts` exactly per the spec's
  definitions (best by taker side, bps rounding, median, spread, bond % of trade, offer check,
  validity fraction), bigint throughout, 100 % unit-tested including odd/even counts, ties, a single
  quote, all expired, and buy vs sell. Build the summary strip, fraud banner (the fraud *submission*
  needs a browser contract call — show the proof details and payout and link to `/verify`, which is
  Phase 2; don't call the circuit in 1A), strip plot (SVG, theme tokens via `style`, label staggering,
  `role="img"` + full `aria-label`), comparison table, pairwise panel with the generated sentence, and
  settle card. Keyboard: `1`–`9` select, `Shift`+click pins a second row for the pairwise panel,
  `Enter` settles. **Never reorder under the pointer or while a row is selected** — show a
  "N new quotes · Re-sort" pill.
- **Settle:** stages driven by real events — inputs unspent (§3.7, or skipped with a note) →
  `balanceSealedTransaction` → local `checkTimeToDismiss` on the merged tx (show `cost of allowed`
  from the check's numbers) → `submitTransaction` → indexer confirmation. Failure classification:
  local dismiss failure → `wallet-shape`; node rejection → re-check inputs: spent elsewhere →
  `inputs-spent`, otherwise `rejected` with `nodeErrorCode`; `validUntil` passed → `expired`.
  Outcomes exactly as the spec, with "Save evidence" (§3.5) and "Take <next best valid quote>".
- **Receipt (minimal for 1A):** `/trade/:quoteId` showing the settled trade from local state plus
  the settlement tx hash, block and on-chain `quote.resolved` (poll until the dealer records it, as
  the pinger does, up to 10 min, showing "Waiting for the dealer to record this trade"). Label
  **"Resolved"** from the chain and **"Settled"** only with a local settlement tx (open decision).
  Disclosure attach is Phase 2.

### 5.8 Overlays in 1A
Connect wallet · Wallet readiness · Transaction tray (`T`; entries survive navigation and reload) ·
Relays. Esc closes, focus returns to the trigger, focus is trapped inside.

## 6. Tests

- **Unit (vitest):** `compare.ts`; side mapping and `counterAmountFor` usage (taker sell/buy);
  RFQ reducer (every transition, cancel from each state, reload restore from `sessionStorage`);
  bigint JSON round-trip; per-quote state transitions including `unverifiable` vs `rejected`;
  failure classification.
- **Component:** Compare sorting, the new-quote pill (no reorder while selected), expired row
  locking, seal-mismatch exclusion from every statistic, relays pill thresholds.
- **E2E (Playwright):** start two real `packages/relay-node` servers in-process (see
  `packages/relay-node/test/server.test.ts`), inject a fake `WalletPort` through `window.midnight`,
  a `ChainReader` backed by fixtures, and a fixture dealer that posts `quote_ref`s and mailboxes
  reveals built with the SDK (`packages/sdk/test/relay-aggregator.test.ts` shows how). Cover: happy
  path to receipt; one seal mismatch among valid quotes; a reveal whose offer pays less
  (`offerMatchesTerms` fails); indexer outage mid-collect; reload during Sealed and during Compare
  (reveals must survive); one relay down.
- `pnpm typecheck`, `pnpm test`, `pnpm --filter @otc/web build` green at every commit.

## 7. Definition of done (Phase 1A)

On Preprod, from `/trade` in a real browser wallet, with the two local relays and at least one Dealer
Node: request → sealed (verified on-chain) → compare (all checks shown) → settle → receipt, with the
settlement confirmed on the indexer and later recorded by the dealer. If a second funded dealer wallet
is available, run with two competing dealers and settle the better quote (M2's definition of done);
if not, say so in the report. Record tx hashes and per-stage timings in `docs/ROADMAP.md`, update task
2.5's status (M2 stays open until 1B / task 2.7), and update `docs/FRONTEND.md` for everything
Phase 1A changed (Class B screen removed, Compare spec, readiness corrections, Save evidence).

## 8. Do not

Build Phase 1B (manual dealer quote), `/activity`, `/dealers`, `/verify`, `/deal`, `/me` or disclosure
attach · call any contract circuit from the browser · change the contract, the wire format beyond
CORS, or `Mailbox.take()` semantics · add a backend, database, analytics or error-reporting service ·
show an estimated price anywhere · filter or rank dealers by a made-up score · type wallet APIs from
memory · use `Number` for amounts · commit secrets, seeds or `dealer.toml` · start the next phase
without the owner's confirmation.

## 9. Reporting format (at Step 1.0 and at the end of 1A)

1. What was built (files, with one line each).
2. What ran live: network, wallet name/version, relay setup, tx hashes with indexer status, merged
   shapes (inputs, DUST spends, size, dismiss cost vs allowance), per-stage timings.
3. What failed and why, with exact error text and node codes.
4. Doc changes made (`ROADMAP.md`, `RELAY.md`, `FRONTEND.md`).
5. Open decisions hit, stated as questions for the owner.
6. What you need from the owner before continuing.
