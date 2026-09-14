# Prompt — build every page of the web app, client-side, in `client/`

Paste everything below the line into a fresh Claude Code session opened at the repo root
(branch `harden-m1` or a branch cut from it).

Design reference (all screens): https://claude.ai/code/artifact/e24c3b0f-f369-4340-afd0-645d43bf15aa
Earlier specs this builds on: `docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md` (full spec) and
`docs/prompts/PHASE-1-TAKER-TRADE-PROMPT.md` (taker flow, Phase 0 corrections).

---

You are building the complete web client of the Midnight OTC Protocol (working name **Pyron**), a
sealed-quote OTC venue: dealers post a bond, seal a price on-chain as a commitment, reveal it
encrypted to one taker; the taker compares revealed quotes in the browser and settles one via Zswap.

**This session builds all 10 pages and 6 overlays as a client-side app in a top-level `client/`
folder.** Everything runs in the browser: no backend, no server rendering, no database. Pages read
the chain through the indexer, talk to relays over WebSocket/HTTP, and act through the user's
wallet extension. Every page also runs on a deterministic **fixture** data source, so the whole UI
can be built, tested and demoed while live browser settlement is still unproven (§2).

## 0. Read before doing anything

1. `CLAUDE.md` and `docs/ROADMAP.md` in full.
2. `docs/prompts/FRONTEND-IMPLEMENTATION-PROMPT.md` §1 (non-negotiables), §5 (design tokens),
   §6 (IA), §7 (page specs), §9–§10. Then `docs/prompts/PHASE-1-TAKER-TRADE-PROMPT.md` §1–§3
   (facts and corrections from Phase 0). **Where this prompt differs, this prompt wins.**
3. `docs/FRONTEND.md`, `docs/ARCHITECTURE.md`, `docs/RELAY.md` §1–§6, `docs/CONTRACTS.md` §2, §5,
   §7, §8, `docs/DISCLOSURE.md`, `docs/DEALER-NODE.md` §2–§5, `docs/GRANT.md` risks 3–6.
4. Code:
   - `apps/web/` (moves to `client/` in §3): `vite.config.ts` (runtime pinning — keep it),
     `src/dev/SettleProbe.tsx` (the proven-in-code taker loop: RFQ → verify → mailbox → decrypt →
     `verifyReveal` → opposite-side check → `offerMatchesTerms` → offer check →
     `balanceSealedTransaction` → merged check → `submitTransaction` → indexer confirm → dealer record).
   - `packages/sdk/src/browser.ts` — the **only** SDK entry the client may import.
   - `packages/sdk/src/{relay-client,reveal-channel,quotes,offers,terms,bonding,fraud,disclosure,indexer,assets,domain}.ts`.
   - `packages/relay-node/src/{schema,server,mailbox}.ts`.
   - `contracts/managed/otc-protocol/contract/index.d.ts` — the `Ledger`, `Bond`, `Quote`, `NoteRef`
     types and the 9 circuits.
   - `scripts/taker-pinger.ts` (taker + disclosure loop), `scripts/e2e-fraud.ts` (fraud proof),
     `scripts/e2e-lifecycle.ts` (bond lifecycle) — the Node references for every action a page takes.
   - `node_modules/@midnight-ntwrk/dapp-connector-api/dist/api.d.ts` (4.0.1) — the real wallet API.
5. Skills when relevant: `react-wallet-connector`, `1am-wallet`, `indexer`, `midnight-js`,
   `zswap-offer-files`, `commit-reveal-schemes`, `midnight-security`.
6. Reply with a short plan of §13's step 1 only, then start.

## 1. Non-negotiables

- **No order book, depth chart or price ladder.** There is no book (`FRONTEND.md`).
- **No price before reveal**, anywhere. Public pages never show a price: the chain stores none.
- **Price comparison only in the taker's browser**, on verified reveals. Nothing price-related is sent
  to any server, relay, log, analytics or URL.
- **Relays are untrusted:** every `quote_ref` passes `verifyQuoteRef` before it renders as verified;
  refuse to publish an RFQ with fewer than 2 connected relays; the relay count is always visible.
- **"Couldn't verify" is a different state from "rejected"**; an indexer outage is an error state,
  never an empty list.
- **Every reveal passes `verifyReveal` (with on-chain notional), the opposite-side check and
  `offerMatchesTerms`** before it can be selected.
- **Seal mismatches are escalated** as a fraud-proof action with the payout (60 % beneficiary, 10 %
  prover; a taker proving their own fraud gets 70 %).
- **Slashed dealers are never hidden.** No badges, stars, scores, "verified dealer" labels or
  allowlists.
- **No Class B:** no challenge bonds, no "dealer has not settled" state.
- **Fresh X25519 key and `rfqId` per RFQ.** Disclosure notes are opt-in, default off.
- **Amounts are `bigint` or decimal strings end to end.** Never `Number`.
- **Fixture data is always labelled.** In fixture mode a persistent "Sample data" banner is visible on
  every page, and nothing fixture-sourced can be mistaken for chain data.

## 2. Where things stand (verified 2026-09-15 — re-check before relying on it)

**Committed:** `@otc/sdk/browser` (noble AEAD with parity tests, injectable relay socket,
`nativeTokenRaw()`, `RfqBody`/`QuoteRefBody` types); `apps/web` scaffold (Vite 5, React 18, TS
strict, wasm + top-level-await plugins, `vite.config.ts` pinning `compact-runtime`,
`onchain-runtime-v3`, `ledger-v8` to the SDK's copies so only one runtime WASM is bundled);
relay CORS (`06fdc52`, `RELAY.md` §1); the rewritten `SettleProbe` (`045f24f`).
`pnpm typecheck` clean, 212 SDK + relay tests pass, `apps/web` builds.

**Not proven:** no browser settlement has landed. A live gate run is in progress in another session:
two local relays (`:18787`, `:18788`) and a Vite dev server (`:5173`) are running, a Dealer Node bond
is being attempted, and the main Preprod wallet hit `values inserted non-linearly into zswap/dust
commitment tree` sync failures and had its DUST and shielded snapshot parts reset
(`scripts/reset-unshielded-state.ts`, uncommitted). **Do not stop, restart or reuse those processes,
do not touch `.wallet-state/`, `packages/dealer-node/dealer.toml` or `secrets/`, and do not commit the
uncommitted script.** Use port **5174** for this session's dev server and test relays on other ports.

**Not available from a browser yet:** contract circuit calls (task 0.3 never ran): `postBond`,
`topUpBond`, `requestBondWithdrawal`, `withdrawBond`, `commitQuote`, `recordSettlement`,
`releaseExpiredQuote`, `submitFraudProofMismatch`, `attachDisclosureNote`. They need a
fetch-based zk-config provider, the wallet's `getProvingProvider`, `balanceUnsealedTransaction` and a
browser private-state provider. See §8.

**Facts every page relies on:** relays send CORS; `Mailbox.take()` deletes on read (persist reveals
before use); dealer reveals sit only on the dealer's signed `dealerEndpoint`; no public relays exist
(local `ws://127.0.0.1:18787/gossip`, `:18788`); `submitTransaction` resolves `void` (derive
identifiers from the merged tx, as `SettleProbe` does with `merged.identifiers()` and
`waitForTransaction`); the connector exposes no coin counts; `getDustBalance()` is `{ cap, balance }`;
the RFQ `side` is the taker's, reveal terms carry the dealer's (taker sells ⇔ `terms.side === 'buy'`
⇔ receives `counterAmountFor(terms)`); Preprod pair `tNIGHT/TESTUSD`, TESTUSD token
`53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc`, contract
`c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34`; Preview/Mainnet use USDM from
`assets.ts`. Timings for copy: commit 19–25 s (53 s degraded), settlement 17–24 s, RFQ → settled ≈ 80 s.

## 3. Step 1 — move `apps/web` to `client/`

- `git mv apps/web client`. If `apps/` is then empty, remove it and replace `"apps/*"` with
  `"client"` in `pnpm-workspace.yaml`. Rename the package `@otc/client`.
- Fix `client/vite.config.ts`: the SDK modules path becomes `../packages/sdk/node_modules`. Keep the
  pinning and its comment. Set `server.port` 5174 with `strictPort`.
- `pnpm install`, then confirm `pnpm --filter @otc/client build` produces **one**
  `midnight_onchain_runtime_wasm_bg` and no externalized-module warnings.
- Update every `apps/web` reference: `CLAUDE.md` (repo layout and doc map),
  `docs/ARCHITECTURE.md`, `docs/RELAY.md`, `docs/FRONTEND.md`,
  `.claude/skills/midnight-deployment/SKILL.md`, and the code comments in
  `packages/sdk/src/{browser,reveal-channel,relay-client,relay-client-node,offers,aead}.ts`. In the two
  older prompt files add a one-line note at the top ("`apps/web` moved to `client/` on …") instead of
  rewriting their history.
- Commit: "Move the web app to client/".

## 4. Stack and structure

Add: `react-router-dom` v6, `zustand`, `tailwindcss` + PostCSS, `lucide-react`,
`@fontsource-variable/archivo`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`,
`graphql-ws` (indexer subscriptions), `idb-keyval` (IndexedDB). Dev: `vitest`,
`@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`.
Keep React 18. Ask before adding anything else.

```
client/
  index.html  vite.config.ts  tailwind.config.ts  postcss.config.js  .env.example
  src/
    main.tsx
    app/           router.tsx, AppShell.tsx, providers.tsx, NotFound.tsx, ErrorBoundary.tsx
    config/        networks.ts, env.ts
    design/        tokens.css, theme.ts, primitives/ (Button, Chip, Card, Segmented, Pill, Kbd,
                   Stepper, Skeleton, Countdown, Hash, Amount, Table, Tabs, Dialog, Drawer, Toast,
                   EmptyState, ErrorState, StatTile, Banner)
    data/
      ports.ts     ChainPort, RelayPort, WalletPort, StoragePort, Capabilities
      live/        chain.ts, events.ts, relays.ts, wallet.ts, storage.ts
      fixtures/    scenario.ts, chain.ts, relays.ts, wallet.ts, dataset.ts
      DataProvider.tsx   picks live or fixture per VITE_DATA_SOURCE and ?data=
    lib/           compare.ts, format.ts, bigint-json.ts, time.ts, side.ts, evidence.ts, crypto-store.ts
    state/         wallet.ts, network.ts, relays.ts, rfq.ts, quotes.ts, settlement.ts, tray.ts,
                   dealer.ts, prefs.ts
    features/
      venue/  trade/  receipt/  portfolio/  deal/  desk/  activity/  dealers/  verify/
    overlays/      ConnectWallet, WalletReadiness, TransactionTray, Relays, SubmitFraudProof,
                   AttachDisclosureNote
    dev/           SettleProbe.tsx (route /dev/settle-probe, DEV only)
  test/            unit/, components/, e2e/
```

Scripts: `dev`, `build`, `typecheck`, `test`, `test:e2e`, `preview`. Wire `build`, `typecheck`
and `test` into turbo, and make the root `pnpm test` include `client` (add the pattern to the root
`vitest.config.ts` or run the client suite from the root script; the client suite uses jsdom).
Route-level code splitting: public pages must render without loading `@otc/sdk/browser` or any WASM;
`/trade`, `/verify`, `/desk` load them lazily behind a "Loading the verifier…" skeleton.

## 5. Design system

Implement exactly (CSS variables on `:root` for dark, the default, and `[data-theme="light"]`;
Tailwind `theme.extend` maps to the variables; System/Dark/Light toggle stored in localStorage):

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0D1220` | `#F3F4F7` | ground |
| `--s1` | `#131A2A` | `#FFFFFF` | cards |
| `--s2` | `#1A2338` | `#ECEEF3` | selected rows, inputs, secondary buttons |
| `--line` | `#27314A` | `#D4D8E2` | control borders |
| `--line2` | `#1E2740` | `#E2E5EC` | dividers, card borders |
| `--tx` | `#E7EAF3` | `#141A29` | text, primary button fill |
| `--mu` | `#8C95AD` | `#566078` | secondary text |
| `--dim` | `#626B85` | `#7B849A` | labels, tertiary |
| `--seal` | `#E39B62` | `#B0602C` | sealed / in progress |
| `--ok` | `#4FC7A4` | `#1E876A` | verified, settled, best |
| `--bad` | `#EF6F6C` | `#C4423F` | fraud, slashed, failure |
| `--warn` | `#E3BE5C` | `#95700F` | caution |

Soft fills are the same hue at 12–13 % alpha. Type: Archivo (display, `font-stretch: 112.5%`),
IBM Plex Sans (UI), IBM Plex Mono (hashes, routes, rates), scale 44/30/26/22/19/15/14/13.5/12.5/10.5,
uppercase labels with 0.09em tracking, tabular numerals everywhere. Radii: cards 12, buttons 9 (small
7), inputs 10, chips 5. Controls 44 px (small 34). Gutter 40 px, content max-width 1280 px. Motion:
hover 120 ms, enter 220 ms, state change 260 ms ease-out, skeleton 1.4 s; `prefers-reduced-motion`
reduces to fades. State is always text plus form, never color alone. Match the design canvas's
layouts; where the canvas and this prompt disagree (readiness row, Offer check), this prompt wins.

## 6. Data layer

### 6.1 Ports (`src/data/ports.ts`) — pages never import live or fixture code directly

```ts
interface ChainPort {
  snapshot(): Promise<LedgerView>;                  // bonds, quotes, notes, settled, slashed, burnedTotal
  quote(id: Uint8Array): Promise<ChainQuote | undefined>;
  dealer(cmt: Uint8Array): Promise<ChainDealer>;
  events(opts: { fromHeight?: number }): AsyncIterable<ProtocolEvent>;   // §6.3
  transaction(by: { hash: string } | { identifier: string }): Promise<IndexedTransaction | undefined>;
  ledgerParameters(): Promise<{ height: number; params: LedgerParameters }>;
  inputSpent?(intentHash: string, outputNo: number): Promise<{ spent: boolean; byTx?: string } | 'unsupported'>;
  chainReader(): ChainReader;                      // for verifyQuoteRef / RelayAggregator
}
interface RelayPort { connect(); status(); health(url); publishRfq(body); collect(rfq);
                      fetchMailbox(base, takerEncPk): Promise<RevealMessage[]>; close(); }
interface WalletPort { discover(); connect(rdns, networkId); config(); address(); balances(); dust();
                       balanceSealed(txHex); balanceUnsealed(txHex); submit(txHex); history(p, n);
                       status(); provingProvider(keys) }
interface StoragePort { session; local; idb }       // bigint-safe JSON everywhere
interface Capabilities { settleInBrowser: 'unverified' | 'verified' | 'off';
                         circuitsInBrowser: boolean; inputSpentLookup: boolean }
```

`LedgerView` wraps the compiled contract's `ledger(state.data)` (iterate `bonds`, `quotes`, `notes`;
read `settled`/`slashed` counters and `burnedTotal`).

### 6.2 Live adapters
- **Chain:** `queryLatestContractState` + the contract's `ledger()`; `indexerChainReader`;
  `queryTransaction`/`waitForTransaction`; `queryLedgerParameters`. Short TTL cache (2 s); never
  cache a failure. Prefer the wallet's `getConfiguration()` indexer URIs when connected; warn when they
  differ from `networks.ts`.
- **Relays:** `RelayAggregator` with `socketFactory: (u) => new WebSocket(u)`; `GET /health` every
  30 s; mailbox fetch persists every returned message to `sessionStorage` before returning it.
- **Wallet:** DApp Connector per `api.d.ts`: discover `window.midnight` entries (`name`, `icon`,
  `apiVersion`, `rdns`; accept major 4), `connect(networkId)`, `hintUsage`, `getConnectionStatus`
  polled every 10 s, defensive handling of wallets that don't return the declared shapes (1AM's
  `makeTransfer`).
- **`inputSpent`:** implement with the indexer `transactions { unshieldedSpentOutputs { intentHash
  outputIndex } }` data if a practical lookup exists; otherwise return `'unsupported'` and let Settle
  classify failures after the fact.

### 6.3 Protocol events (Activity, dealer profile, desk history)
Subscribe with `graphql-ws` to
`contractActions(address, offset: { height })` selecting `__typename`, `state`,
`transaction { hash block { height timestamp } }` and `... on ContractCall { entryPoint }`. Derive
events by decoding each action's `state` and diffing against the previous one:

| `entryPoint` | Event |
|---|---|
| `postBond` | Bond posted (dealer, amount, max quote = amount × 20) |
| `topUpBond` | Bond topped up (dealer, delta) |
| `requestBondWithdrawal` | Withdrawal requested (withdrawable at `withdrawRequested` + 24 h) |
| `withdrawBond` | Bond withdrawn |
| `commitQuote` | Quote sealed (quoteId, dealer, notional, validUntil) |
| `recordSettlement` | Quote resolved as settled (settled counter +1) |
| `releaseExpiredQuote` | Quote released, no trade |
| `submitFraudProofMismatch` | Bond slashed (amount, burned delta from `burnedTotal`) |
| `attachDisclosureNote` | Disclosure note attached (tradeId, policyTag) |

Replay from the contract's deploy height (find it once from the earliest action and store it in
`networks.ts` or IndexedDB), cache derived events in IndexedDB keyed by network + contract, resume
from the last height, and verify entry-point names against the compiled contract rather than trusting
this table.

### 6.4 Fixtures
- `dataset.ts`: 23 dealers (active, withdrawing, slashed, "no record"), bond histories, ~120 events
  over 14 days, notes, totals. All values internally consistent (counters match events, bonds ≥
  notional ÷ 20).
- `scenario.ts`: a scripted, clock-driven RFQ with a speed factor (`?speed=10`): relays connect → commits
  confirm at +22 s / +45 s / +47 s → reveals → one seal mismatch → one quote expiring. Named outcomes via
  `?scenario=happy|inputs-spent|wallet-shape|rejected|no-quotes|indexer-down|one-relay`.
- The fixture wallet exposes the same `WalletPort` and never pretends to be a real extension.
- Reveals and offers in fixtures are built with the real SDK functions (`sealQuote`, `buildReveal`,
  `encryptReveal`) so verification code paths run for real; only chain and wallet are simulated.

## 7. Pages and overlays

Build in the order of §13. For every page: loading skeleton, empty state, error state with a next
step, fixture and live modes, keyboard access, 390 px layout, and the acceptance criteria below.

### 7.1 `/` Venue (public)
Hero ("Quotes a dealer can't take back.", two CTAs), live totals from `LedgerView`
(resolved quotes, bonded dealers, total bonded, bonds slashed, burned), the four-step explanation,
"not an AMM / not a book / not a hosted API", recent events (5), contract address with copy, links to
run a relay and a dealer node. **Accept:** renders with no wallet and no WASM; totals equal
fixture/ledger values.

### 7.2 `/activity` (public)
Totals strip; filters All · Trades · Slashes · Releases · Bonds; pair filter; live indicator with
block height; table When · Event · Dealer · Size · Details · Tx. Slash rows show the payout split and
burn. **No price column.** **Accept:** new events stream in without reordering what the user is
reading ("N new events" pill); indexer down shows an error with retry.

### 7.3 `/dealers` (public)
Search by commitment prefix; tabs All/Active/Withdrawing/Slashed with counts; sort by bond, settled,
slashed, failures, last quote; columns Dealer · Status · Bond · Largest quote (×20) · Settled ·
Slashed · Failures · Last quote. "No record" for zero settled. Failures column shows "—" with a
tooltip until an evidence source exists. **Accept:** slashed dealers present in "All"; sort is stable.

### 7.4 `/dealers/:dealerCmt` (public)
Full commitment with copy; status; stat tiles; bond-over-time step chart (SVG, tokens, labelled
axes, endpoint marker); recent quotes with outcome chips; published evidence section; footnote that
the settled count is dealer-recorded and the bond is the guarantee. **Accept:** unknown commitment →
"No dealer with this key has bonded"; chart and table agree with events.

### 7.5 `/trade` (taker; one route, state machine, no reloads)
Implement exactly `PHASE-1-TAKER-TRADE-PROMPT.md` §5.6–§5.7 and the Compare definitions in
`FRONTEND-IMPLEMENTATION-PROMPT.md` §7.1: Request (truthful readiness: network, balance of the given
asset, DUST, relays), Sealed (countdown ring, verification rows, event log, "Compare N now"), Compare
(summary strip, fraud banner, strip plot, comparison table with Offer check = dismiss check on the
dealer half + input count, pairwise panel with generated sentence, settle card; never reorder under
the pointer), Settle (real stages; outcomes settled / inputs-spent with "Save evidence" and "Take next
best" / wallet-shape / rejected with node code / expired). `lib/compare.ts` is bigint-only and fully
unit-tested. RFQ state persists to `sessionStorage` (the per-RFQ secret key too, wiped at terminal).
While `Capabilities.settleInBrowser === 'unverified'`, the Settle button shows a one-line notice
("Browser settlement is still being verified on Preprod") but still works in live mode.
**Accept:** the fixture scenarios all reach their named outcome; a reload in Sealed and in Compare
restores the screen with reveals intact.

### 7.6 `/trade/:quoteId` Receipt
Public block from the chain (quote, dealer, size, settlement tx if known, block, note status) and
"Only on this device" block (price, received, other quotes). Label **Resolved** from chain alone,
**Settled** only with a local settlement tx. Waiting state "Waiting for the dealer to record this
trade" (poll ≤ 10 min). Attach disclosure note → overlay (§8 gating). **Accept:** opening the URL on
another device shows the public block only, with no error.

### 7.7 `/me` My trades
IndexedDB, encrypted with WebCrypto AES-GCM under a passphrase-derived key (PBKDF2, 600k iterations);
key source is an open decision, so keep it behind `lib/crypto-store.ts`. Filters, export JSON, delete
all with typed confirmation. **Accept:** wrong passphrase shows "That passphrase doesn't unlock this
history" and changes nothing.

### 7.8 `/deal` Become a dealer (public)
Two paths (Dealer Node recommended, with the three commands from `packages/dealer-node/README.md`;
browser quoting with caveats), bond calculator (`minBondForNotional`), 60/10/30 slash split in the
user's numbers, timing facts (quotes ≤ 15 min, release after 1 h, withdrawal 24 h with no live quotes),
the coin-shape warning from the README. **Accept:** calculator uses bigint and matches the SDK.

### 7.9 `/desk` Desk (tabs `?tab=overview|quotes|bond|rfq|keys`)
Opens by dealer commitment (entered or derived from a loaded key); read-only views need no key.
- **Overview:** status, bond + headroom, live quotes, pending releases, alerts derived from chain state
  (withdrawal pending, quotes releasable, bond inactive/slashed); node-sourced metrics render a
  "Connect your node" empty state (no node status endpoint exists).
- **Quotes:** all quotes by state with countdowns; "Release expired" (permissionless).
- **Bond:** timeline Post → Top up → Request withdrawal → Withdraw with each blocked action's reason
  and time.
- **Manual quote:** incoming RFQs from relays, price → taker amount, validity 5/10/15 min, cap check,
  binding warning in the dealer's numbers, step 1 Commit (persist nonce/terms/offer to IndexedDB
  before submit) → step 2 Reveal only after indexer visibility.
- **Keys:** generate/import dealer key, encrypted at rest, forced backup download before first use.
All write actions follow §8. **Accept:** every blocked action says why and when.

### 7.10 `/verify` (public; tabs `check`, `note`)
**Check a quote:** paste or load a signed reveal or saved evidence → checklist verdict (signature
under on-chain key, opens seal, unresolved, inside 1 h window, or spent-inputs evidence against the
indexer) → payout breakdown → Submit fraud proof (§8). **Open a note:** blob + trade id + recipient
key → `verifyNote` with all six checks listed; wrong key → "This note isn't addressed to this key."
Nothing leaves the browser. **Accept:** fixture tampered blob fails both the AEAD and hash checks.

### 7.11 Overlays
Connect wallet · Wallet readiness · Transaction tray (`T`; persists across routes and reloads; each
entry shows real stages and links) · Relays (list, health, latency, add/remove, min 2 warning) ·
Submit fraud proof (payout, time, confirm) · Attach disclosure note (recipient key, field checklist,
"only a hash goes on-chain", download blob). Dialog behaviour: Esc closes, focus trapped and returned.

### 7.12 Global
Top bar (logo · Trade · Activity · Dealers · Desk · Verify · network pill · relays pill · tray pill ·
wallet pill/Connect · theme), 404 page, error boundary with "Reload" and "Copy error details" (no
remote reporting), fixture banner, network switcher (preprod/preview; mainnet disabled with reason).
Keyboard: `/` pair search on Trade, `Enter`, `1`–`9`, `Shift`+click, `T`, `Esc`.

## 8. Actions that need contract circuits in the browser

| Action | Page | Circuit |
|---|---|---|
| Submit fraud proof | Compare, Verify | `submitFraudProofMismatch` |
| Attach disclosure note | Receipt | `attachDisclosureNote` |
| Post / top up / request withdrawal / withdraw | Desk › Bond | `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` |
| Commit quote, record settlement, release | Desk › Manual quote, Quotes | `commitQuote`, `recordSettlement`, `releaseExpiredQuote` |

Build the complete UI and flow for each. Execution goes through one module,
`src/data/live/circuits.ts`, that attempts the browser path (fetch-based zk config served from
`contracts/managed/otc-protocol/{keys,zkir}` via Vite static assets loaded lazily, wallet
`getProvingProvider`, `balanceUnsealedTransaction`, `submitTransaction`, a browser private-state
provider holding `dealerSecretKey`/`takerAddress` witnesses in memory). Gate it with
`Capabilities.circuitsInBrowser`, default **false** in live mode:
- false → the action button is replaced by an explanation ("Browser signing for this action isn't
  available yet") plus the equivalent CLI command from the repo scripts, prefilled with the values on
  screen. No fake success.
- true (set by `VITE_ENABLE_CIRCUITS=true`) → run it for real.
- fixture mode → simulated with realistic stages.
Try `releaseExpiredQuote` (smallest, permissionless) live once if a funded browser wallet is
available; record the result. Do not try any bond-moving circuit live in this session.

## 9. State and persistence
Zustand slices listed in §4, `persist` to `sessionStorage` for trade state and to localStorage only for
preferences and the relay list. Bigint-safe serializer. Never store prices, reveals or keys in
localStorage. Dealer keys and trade history only in encrypted IndexedDB.

## 10. Copy
User's words: seal, price, bond, record, relay. Hashes truncated `abcd…ef` with copy. Errors say what
happened and the next step; no apologies; no timing promises beyond the measured ranges. "Resolved" vs
"Settled" per §7.6.

## 11. Quality bar
- Accessibility: WCAG 2.2 AA contrast in both themes; keyboard-complete; visible focus; `aria-live`
  countdowns throttled to 10 s; charts have `role="img"` and full labels.
- Responsive: designed ≥ 1280 px, usable at 1024 px; Trade, Receipt, Verify and Activity usable at
  390 px (tables become stacked rows).
- Performance: public routes ship without WASM; initial JS for `/` under 200 kB gzip.
- Security: strict CSP meta for production build (self, indexer and relay origins from config,
  `wasm-unsafe-eval`); no third-party requests except configured indexer and relays; no analytics.

## 12. Tests
- **Unit:** `compare.ts` (best by side, bps rounding, median odd/even, spread, bond %, single quote, all
  expired), `side.ts`, `format.ts`, bigint JSON, RFQ reducer (all transitions, cancel, reload restore),
  event derivation from action/state pairs for all 9 entry points, bond calculator, crypto-store
  wrong-passphrase.
- **Component:** Compare (sorting, new-quote pill, expired rows, fraud exclusion), relays pill
  thresholds, Desk blocked-action reasons, Verify checklists.
- **E2E (Playwright, fixture mode):** every page loads and passes an axe check; each `?scenario=`
  reaches its outcome; reload mid-trade; theme toggle; 390 px smoke test.
- **E2E (live relays, fake wallet):** two real `packages/relay-node` servers started in-process on
  free ports, fixture `ChainPort`, SDK-built reveals mailboxed to them: RFQ → compare → settle (fake
  wallet) → receipt.
- Gates at every commit: `pnpm typecheck`, `pnpm test`, `pnpm --filter @otc/client build`.

## 13. Work order — commit after each step, report at the end (§16)

1. Move to `client/` (§3).
2. Tooling, design tokens, primitives, AppShell, router with all routes stubbed, fixture banner,
   error boundary, theme.
3. Data ports, fixture dataset and scenario, live chain adapter, event derivation, DataProvider.
4. Public pages: Venue, Activity, Dealers, Dealer profile, Become a dealer.
5. Wallet and relay layers, overlays (Connect, Readiness, Tray, Relays).
6. Trade (all states) and Receipt; SettleProbe moved under `/dev`.
7. My trades, Verify (both tabs), Desk (all tabs), fraud-proof and disclosure overlays, `circuits.ts`
   gating.
8. Tests to the §12 bar, accessibility pass, docs (§14).

If a step shows that the docs are wrong or a non-negotiable can't be met, stop and report rather than
working around it.

## 14. Docs to update
- `docs/FRONTEND.md`: 10-page IA and overlays, the Compare spec, readiness correction, Offer check,
  Save evidence, "Resolved" vs "Settled", circuit gating, fixture mode; remove the Class B screen and
  prices from the feed.
- `docs/ROADMAP.md`: M2 tasks 2.5/2.7 and M3 task 3.8 as "UI built; live browser settlement / circuits
  unverified" (do **not** mark them done), a short "client/" note, and new open decisions: browser
  circuit execution, failure-evidence destination, `/me` key source, dealer key custody in the browser,
  node status endpoint, mailbox destructive read, event replay start height.
- `CLAUDE.md` repo layout for `client/`.

## 15. Do not
Build a backend, server rendering, database, analytics or error reporting · show any price before
reveal or on public pages · build an order book · rank dealers by a score · add a Class B flow · use
`Number` for amounts · import SDK files other than `@otc/sdk/browser` · change the contract, the relay
wire format or `Mailbox.take()` · run bond-moving circuits live · touch the running relays, Vite server,
bond process, wallet snapshots, `dealer.toml`, `secrets/` or the uncommitted
`scripts/reset-unshielded-state.ts` · mark roadmap tasks done without a live run · change the stack
without asking.

## 16. Final report
1. Pages and overlays built, each with fixture ✓/✗ and live ✓/✗/gated.
2. What ran live (network, wallet, relays, tx hashes, timings), and what did not.
3. Test results (counts, axe results, bundle sizes per route).
4. Docs changed.
5. Open decisions hit, as questions for the owner.
6. What the owner should do next, in order.
