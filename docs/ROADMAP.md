# Roadmap & Status

> **Re-read this file at the start of every session before doing any work.**
> It is the live record of what is done, what is in progress, and what decisions are still open.

**Last updated:** 2026-09-13 — **M1 complete. M2 task 2.6 settled the protocol's first complete
trade on-chain** (`pnpm run e2e-settle`), `offers.ts` is no longer a stub, and the open question
"can the taker settle unilaterally from a pre-proved Offer File?" is answered: **yes**.

**Update 2026-09-13 (later the same day) — S5 is RESOLVED, and S4 was wrong.** `Custom error: 168`
is not a fee at all. It is the node's **time-to-dismiss** anti-DoS rule (`MalformedError::FeeCalculation`
→ `OutsideTimeToDismiss`), established from node 1.0.2 / ledger 8.1.2 source and confirmed against
the live node in both directions. A **two-asset settlement then landed on Preprod through the full
protocol path** (`pnpm run e2e-settle`, settled counter 1). See S5. Also done this session: **2.4**
multi-relay aggregation with client-side chain verification, and **2.9** real bond sizing in the
contract (redeployed to Preprod). **2.8** shielded-offer latency: see task 2.8.

Previously this paragraph read: *"The settled trade was one-asset … the two-asset settlement is
blocked by an unidentified node rejection with four candidate causes already ruled out."* Kept for
the record; the resolution is in S5.

**M1 is complete on Preprod.** The contract is deployed, verified by
indexer read-back, and `pnpm run e2e-fraud` has executed the full fraud path on-chain: bond posted →
quote committed → deliberately mismatched reveal → fraud proof → **bond slashed to 0, dealer
deactivated, slashed counter 1, quote resolved**. Tasks 1.0–1.10 are all done, including 1.7 and the
on-chain half of 1.9, which had been blocked since 2026-08-27.

```
preprod  c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34   (Class B removed, 9 circuits, 2026-09-14 — current; init + e2e-fraud pass)
preprod  f365d5622e2609e007416eb6c5966ce9d96517787cdb032ac6fdc1d301414cf5   (2.9 bond sizing, 2026-09-13 — superseded 2026-09-14; an abandoned A6 test bond of 75 and one live quote remain on it)
preprod  539d3ea689983058059137f4c6d0ee234ae29b585f7f222919a2013800ee2225   (M1, superseded: pre-2.9 circuits)
preview  e35b4547d59c7132c021753344d662d445b739af0e78cc39bc771e58fd05d1fa   (Class B removed, 9 circuits, 2026-09-14 — current; init + e2e-fraud pass)
preview  c4d65ea5f5c92ca3666f1fce82827c8afe03fe78a53bfdac342b98e7659303c4   (2.9 bond sizing, 2026-09-14 — superseded the same day by the Class B removal)
preview  f25703438d00441deadba817aa60e42637f304598b3f90e15ca5cfb9e9a74c04   (pre-2.9 circuits — superseded 2026-09-14)
```

~~**The Preview deployment does not match the current compiled contract.**~~ **Resolved 2026-09-14
(task A1):** `deploy` → `init` (7/7 fresh-state checks) → `e2e-fraud` all ran against Preview; the
fraud path slashed a bond on the redeployed contract (bond 0, inactive, slashed 1, quote resolved).

Five defects stood between "the wallet path compiles and typechecks" and "it works against a chain."
None were caught by `tsc` or the 211-test simulation suite; each required a live run. This is the
same lesson as the six simulator defects below, one level further out — see "Compilation is not
verification", which now extends to "a green simulation suite is not chain integration."

| # | Defect | Why it stayed hidden |
|---|---|---|
| W1 | `facade.start()` never called — `WalletFacade.init()` only wires sub-wallets, it does not begin syncing | `waitForSync()` hung forever; no error, just one `isSynced:false` event |
| W2 | dust wallet OOM: 3.0.0 hardcodes `batchSize = 10` + 4 ms spacing; applied ~306 ev/s vs ~430 ev/s inbound, so the queue grew unbounded | Looked like "needs more RAM" — died at 47 s on 2 GB **and** at 26 min on 6 GB |
| W3 | `costParameters` became required in dust 4.x | Typechecks; throws `undefined (reading 'feeBlocksMargin')` mid-balance, only with a synced funded wallet |
| W4 | `DustWalletState.walletBalance()` → `.balance()` | Reached via `as any`, so the rename threw ~20 min into a run, after a submitted tx |
| W5 | Stale local `signTransactionIntents()` workaround, kept after the SDK bug it worked around was fixed, and it never signed dust registrations | Node rejected `postBond` with `1010: Invalid Transaction: Custom error: 192` (`InputsSignaturesLengthMismatch`). Invisible to deploy, which moves no unshielded funds — only a `receiveUnshielded` circuit exposes it |

**First real performance numbers** (partial input to 2.8): proof generation **0.691 s**; cold wallet
sync **~20 min** (~1.5 M events from genesis) vs **~8 s** restored from a snapshot. The cold-sync cost
is why `packages/sdk/src/wallet-state.ts` exists.

---

## Status

| Milestone | Scope | Status |
|---|---|---|
| **Pass 1** | Planning artifacts: `docs/`, `CLAUDE.md`, `.claude/skills/` | ✅ **Complete** |
| **M1** | Core protocol contract on Preprod | ✅ **Complete** — deployed to Preprod, fraud proof slashes a bond on-chain (`pnpm run e2e-fraud`) |
| **M2** | Relay node + minimal RFQ flow on Preprod | 🟡 2.1–2.4 built and tested; **2.6 two-asset settlement executed on-chain** (S5 resolved); **2.9 bond sizing live on Preprod**; 2.8 shielded latency measured **and a shielded offer settled on-chain (A5)**; **Preview redeployed + e2e-fraud passing (A1)**; bond lifecycle on-chain in progress (A6: `topUpBond` ✅, release/withdraw timelocked); **two-wallet settlement on-chain with exact deltas verified (A2)**; **two competing dealers over two live relays, verified against the live indexer, better quote settled on-chain (A3) — M2 definition of done met except the UI**; real USDM (A4) **blocked on a human bridging tUSDM to Preview** — the Preview wallet holds none (2026-09-14); **web client built (2026-09-15, branch `client-all-pages`, `client/`): 2.5 and 2.7 UI done; no browser settlement, browser circuit or `makeIntent` quote has run live yet, so M2 stays open on them** (see "Web client" below) |
| **M3** | Dealer Node + disclosure | ✅ **Complete 2026-09-14 — awaiting owner confirmation before M4.** Open decisions below are surfaced, not decided. ~~🟡 In progress (owner-approved start 2026-09-14).~~ 3.1–3.4, 3.6, 3.7, 3.9 built and tested offline (config/identity, crash-consistent journal, warm pool + reserve, commit→reveal state machine, disclosure); live adapters + `start` written; **3.5 removed with Class B**; 3.10 README written, 30-min validation pending; **first live settlement + disclosure round-trip done (run #3, 09:00Z)**; **unattended multi-expiry run done (run #3, 08:20–10:24Z, 9/9 RFQs with a warm offer answered, two renewals)** — M3 DoD met; **3.10 timed end to end on a fresh wallet (4 operator-facing defects fixed)** |
| **M4** | Mainnet readiness | ⬜ Not started |

Legend: ⬜ not started · 🟡 in progress · ✅ complete · 🔴 blocked

**Stop for confirmation from the project owner after each milestone before starting the next.**

---

## M1 — Core protocol contract (Preprod)

Build and deploy `OTCProtocol.compact` per `docs/CONTRACTS.md`.

| # | Task | Status |
|---|---|---|
| 1.0 | **Resolve the Schnorr polyfill risk** (`CONTRACTS.md` §9.1) — blocks 1.5 | ✅ Resolved — works, needs a range-checked reduction gadget (see below) |
| 1.1 | Toolchain: Compact compiler, Docker proof server, pnpm + Turborepo skeleton | ✅ pnpm + turbo + vitest + root tsconfig; proof server running (`midnightntwrk/proof-server:8.1.0` — see image warning above) |
| 1.2 | Ledger + structs + domain-separated derivations | ✅ `contracts/src/OTCProtocol.compact` |
| 1.3 | Bonding circuits: `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` | ✅ `postBond`, **`topUpBond`** and **`requestBondWithdrawal`** executed on Preprod (A6, 2026-09-14); `withdrawBond` pending the 24 h timelock (due 2026-09-14T21:31Z) |
| 1.4 | Quote circuits: `commitQuote`, ~~`openSettlementChallenge`~~, `recordSettlement` | ✅ `commitQuote`, `recordSettlement` (one-argument form) and **`releaseExpiredQuote`** executed on Preprod; `openSettlementChallenge` removed with Class B |
| 1.5 | Fraud circuits: `submitFraudProofMismatch`, `submitFraudProofTimeout`, `slashBond` | ✅ `submitFraudProofMismatch` executed on Preprod and slashed a real bond; timeout path still simulation-only |
| 1.6 | `attachDisclosureNote` (contract side only; client flow is M3) | ✅ Compiles |
| 1.7 | Deploy + init scripts, Preprod config, faucet funding | ✅ **Executed.** `fund` → `deploy` → `init` all ran on Preprod; `init` passes all 7 fresh-state checks. Adds `pnpm run status` for wallet/DUST/deployment visibility |
| 1.8 | `packages/sdk` — bonding, quote commit/reveal, fraud proofs, Zswap offer helpers | ✅ Code-complete, fully typechecked against real installed packages — bonding/quotes/fraud verified; Zswap offer construction (`offers.ts`) is a documented stub pending a live proof server |
| 1.9 | Scripted E2E test: bond → commit → mismatched reveal → fraud proof → slash verified | ✅ **On-chain on Preprod** (`pnpm run e2e-fraud`): bond → 0, active → false, slashed → 1, quote resolved. Negative cases remain in simulation (`contracts/test/fraud.test.ts`) |
| 1.10 | Resolve `CONTRACTS.md` §9.2–9.5; update `.claude/skills/compact-contracts/SKILL.md` in place | ✅ Done — all five items resolved (see skill file §4, §9) |

**All 10 circuits compile cleanly and generate real prover/verifier keys** (`contracts/managed/otc-protocol/`).
As predicted, `submitFraudProofMismatch` is the largest circuit (6.0 MB prover key vs. 3.1 MB for a
typical bonding circuit) — Schnorr verification plus the challenge-reduction range check.

**What "code-complete" means here, precisely — read before trusting this at face value:**

- The Schnorr signer/verifier in `packages/sdk/src/schnorr.ts` is not just typechecked — it was run
  and **cross-verified against the actual compiled `schnorr.compact` circuit**: an SDK-signed
  signature was fed into the real compiled `verifyTest` circuit and accepted, and a tampered one was
  correctly rejected. This is the highest-confidence part of the SDK.
- `packages/sdk` and all of `scripts/` pass a full `tsc --noEmit` against the actually-installed
  `@midnight-ntwrk/*` packages (not just against the skill's documented examples, which turned out to
  be stale in several places — see `.claude/skills/midnight-js/SKILL.md` §12.5 for the corrections
  found: `WalletFacade.init`'s real factory-function construction pattern, `levelPrivateStateProvider`'s
  new at-rest-encryption requirement, `PublicKey.address` vs. `.toAddress()`, and others).
- **The wallet/deploy/transaction path has now been executed on Preprod** (2026-09-12), superseding
  this section's original warning that it never had been. That warning called its shot exactly:
  it predicted live runs "could still surface real bugs the type system can't catch (e.g. runtime
  behavior of `WalletFacade.init`'s factory functions, whether the `signTransactionIntents`
  bug-workaround from the skill still applies to this version)." **Both** named suspicions were
  real — W1 and W5 in the defect table at the top of this file.
- `packages/sdk/src/offers.ts` (Zswap Offer File construction) **was** an intentional stub —
  **resolved 2026-09-12 under task 2.6**, built for real and executed on-chain. The judgement that
  kept it a stub was correct: building it blind against types alone would have been silently wrong.
  `initSwap`'s `desiredInputs` reads equally well as "spend" or "receive", and the stub's
  `proofServerUrl`-and-no-wallet signature was the wrong shape entirely — a user-owned `ZswapInput`
  has no public constructor, so the wallet must build the half. See task 2.6 below.

**Previously blocked on network access — RESOLVED 2026-09-12.** A funded Preprod wallet and a local
proof server both now exist, and the full sequence has been run:
`pnpm generate-seed` → fund the printed address → `pnpm run fund` → `pnpm run deploy` →
`pnpm run init` → `pnpm run e2e-fraud`. Use `pnpm run status` at any point to see NIGHT balance,
DUST balance and the current deployment.

Two things that cost real time and are easy to repeat:

- **Fund the address `pnpm run print-address` prints**, not a browser-wallet address. The first
  faucet request went to a different wallet; the tx succeeded, so nothing looked wrong until an
  indexer query showed this wallet had zero UTXOs.
- **The faucet is CAPTCHA-gated** (Cloudflare Turnstile on `POST /drips`). It cannot be scripted;
  a human has to request funds.

**Proof server image — get this exactly right:**

```bash
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v
```

- The org is **`midnightntwrk`** (no "e"), not `midnightnetwork`. Both exist on Docker Hub.
  `midnightnetwork/proof-server` is an unrelated, stale repo whose `latest` is 7.0.0-rc.1 from
  2026-01-12; this doc named it until 2026-09-12. Pointing ledger-v8 8.x at it produces no error —
  the server accepts the `/prove` POST, logs "Starting to process request", then spins at 100% CPU
  on ~33 MB of RSS indefinitely until the client times out. It looks exactly like slow proving.
- Pin the tag to the **ledger-v8 minor version** (`packages/sdk/package.json`). The image tracks
  ledger releases: ledger-v8 8.1.2 → `proof-server:8.1.0` (no 8.1.2 image is published). Bumping
  ledger-v8 without bumping this is the same silent hang.
- The trailing `midnight-proof-server -v` command is required.

### Defects found by executing the contract (2026-08-28)

The contract had only ever been *compiled*. A `compact-runtime` simulator suite (122 tests, no
wallet/proof server/deployment needed — see `compact-contracts` SKILL.md §10) found six defects.
**Every one of them compiled cleanly and passed `tsc --noEmit`.**

| # | Defect | Consequence | Status |
|---|---|---|---|
| D1 | `commitQuote`'s validity cap was **inverted** (`!blockTimeGte(validUntil - 900)`) | Rejected every spec-compliant quote; accepted only over-long ones | ✅ Fixed |
| D11 | `Map<K, Counter>` does **not** auto-vivify, contrary to the comment in `postBond` | `recordSettlement` and `slashBond` threw for every dealer — **slashing never worked at all** | ✅ Fixed (`insertDefault`) |
| D2 | `recordSettlement` refunded the challenge bond to the dealer **commitment**, not an address | Refund sent to a key nobody holds | ✅ Fixed — added `recipient` param |
| D3 | `liveQuotes` never decremented for expired-unsettled quotes | `withdrawBond` asserts `liveQuotes == 0`, so **honest dealers could never withdraw their bond** | ✅ Fixed — new `releaseExpiredQuote` |
| D4 | Fraud circuits never released `liveQuotes` / `openChallenges` | Permanent counter drift, bond unwithdrawable after a slash | ✅ Fixed |
| D5 | `attachDisclosureNote` accepted any 32 bytes as a `tradeId` | `DISCLOSURE.md`'s "provably tied to one settled trade" was **false** | ✅ Fixed |

Contract is now **11 circuits** (was 10): `releaseExpiredQuote` added. `recordSettlement` gained a
`recipient` parameter — a breaking signature change, propagated to `packages/sdk/src/fraud.ts`.

**Three Compact constraints not anticipated by `CONTRACTS.md`** (all recorded in
`compact-contracts` SKILL.md §4):

1. **No `<now>` read inside a circuit.** Compact can only *compare* against block time.
   `requestBondWithdrawal` and `openSettlementChallenge` take a caller-supplied `now`, bounded to
   within `TIME_SLACK` (300 s) of chain time. **New parameter vs. `CONTRACTS.md` §5.1/§5.2 —
   flagged for review**, and `TIME_SLACK` is an untuned guess.
2. **No division operator at all** (`/` is a parse error). `slashBond` uses a witness supplying
   pre-divided shares, range-checked in-circuit by multiplication.
3. **No module-scope `const`** (parse error). Constants are now nullary `pure circuit`s rather than
   literals inlined at each call site.

**Still unverified — do not claim these as done:** real ZK proof generation, transaction balancing
and submission, wallet flow, indexer round-trips, on-chain deployment, and Zswap offer construction.
Simulation validates *contract logic*, not chain integration. That is exactly why 1.7 and the
on-chain half of 1.9 stay open.

**Definition of done:** on Preprod, a test dealer can post a bond and commit a quote, and a scripted
fraud-proof test correctly slashes the bond on a deliberately mismatched reveal. No frontend.

**Task 1.0 is a genuine gate.** In-circuit Jubjub Schnorr verification currently exists only as a
hand-written polyfill, not in the Compact stdlib. Class-A fraud proofs depend on it entirely. If it
does not compile against the current compiler, the design falls back to challenge-based detection for
both fraud classes — a materially weaker guarantee that must be disclosed in `GRANT.md` rather than
quietly absorbed. **Do this first; do not build around it.**

---

## M2 — Relay node + minimal RFQ flow (Preprod)

| # | Task | Status |
|---|---|---|
| 2.1 | `packages/relay-node` per `docs/RELAY.md`: envelope, validation, gossip, dedup, rate limits | ✅ Built and tested in simulation — see below |
| 2.2 | `schema.ts` shared between relay-node and SDK | ✅ `packages/relay-node/src/schema.ts`; relay-node depends on `@otc/sdk`'s `schnorr.ts` for signing/encoding, not the reverse |
| 2.3 | Point-to-point encrypted reveal channel (+ optional mailbox) | ✅ Built and tested in simulation — see below |
| 2.4 | Multi-relay aggregation in SDK, with chain verification of every reference | ✅ `packages/sdk/src/relay-client.ts` (`RelayAggregator`, `verifyQuoteRef`, `indexerChainReader`). 20 tests over real relay sockets, with the compiled contract simulator as the chain; 15 of them are negative cases (each a lie a relay or dealer can tell). **Not yet run against a live indexer or remote relays** — see below |
| 2.5 | Frontend: Screen 1 (RFQ), Screen 2 (sealed bids), Screen 3 (comparison) | 🟡 **UI built 2026-09-15** — `/trade`: swap-card request → sealed → compare → settle → receipt, every check from `taker-pinger.ts` in the browser, tested against fixture adapters. **No settlement from a browser wallet has landed yet** |
| 2.6 | Zswap settlement path from the taker's selection | ✅ **Two-asset settlement on-chain** on Preprod through the full protocol path (bond → commit → encrypted reveal verified against on-chain notional → unilateral taker settlement → `recordSettlement`, settled counter 1). S5 resolved. Still one wallet in both roles |
| 2.7 | Frontend: Screen 5 (manual dealer commit/reveal) | 🟡 **UI built 2026-09-15** — `/desk?tab=rfq`: wallet `makeIntent` offer checked (sealed, matches terms, time-to-dismiss) → journaled before `commitQuote` → reveal only after indexer visibility. **Not run live; whether a wallet's `makeIntent` returns a sealed, settleable half is unverified** |
| 2.8 | **Measure real proof-generation + commit latency on Preprod** | ✅ **Shielded offer proving measured** (`pnpm run probe-shielded-latency`): cold 6.4 s, steady-state median 3.1 s per offer, and **no speedup from concurrency**. Table below. Ladder sizing against these numbers is M3 |
| 2.9 | Decide `MIN_BOND` design: flat floor vs. per-quote notional cap (`CONTRACTS.md` §7) | ✅ Decided 2026-09-12, **implemented 2026-09-13**: `commitQuote(…, notional)` enforces `notional <= bond * 20`; `openSettlementChallenge` enforces `max(floor, 2%)`. `PLACEHOLDER_*` removed. Redeployed to Preprod; `e2e-settle` and `e2e-fraud` rerun against it. Challenge-bond **floor amount still open** (M4 4.1) |

**What "built and tested in simulation" means here, precisely** — same discipline M1 used
(§ "Compilation is not verification" below):

- `packages/relay-node` (2.1/2.2) is exercised by 60 tests: canonical-JSON/id determinism
  including adversarial cases (reordered keys, unicode, id/body mismatch), every RELAY.md §5
  rejection path individually, seen-set loop termination, TTL decrement, never-echo-to-sender,
  rfq/quote_ref retention + expiry sweeps, per-type rate limiting, misbehavior banning, two- and
  three-node in-process gossip convergence, **and** a real end-to-end test spinning up two actual
  `startRelayServer` instances on real sockets and gossiping a message between them over a live
  WebSocket connection (`packages/relay-node/test/server.test.ts`) — not just the in-process fakes.
  It has **not** been run against real internet peers, TLS (`wss://`), or any sustained/adversarial
  load — the rate-limit and misbehavior-score constants are placeholders, not tuned.
- `packages/sdk/src/reveal-channel.ts` (2.3) is exercised by 9 tests covering exactly the negative
  cases CLAUDE.md called out: the intended taker decrypts and recovers the exact plaintext; a
  different party (wrong taker key, or correct taker key with a wrong claimed dealer key) fails
  with a typed `RevealDecryptError`; a ciphertext tampered in the tag or in the body fails the AEAD
  check; and a simulated mailbox operator holding only the raw wire bytes cannot decrypt them.
  ChaCha20-Poly1305 uses Node's native `node:crypto` cipher (not a JS polyfill); X25519/HKDF use
  `@noble/curves`/`@noble/hashes`, matching the audited-pure-JS-dependency bar CLAUDE.md set for
  `blake2b256`.
- **Genuinely unverified, do not claim otherwise:** no real relay has been run as a long-lived
  process, no third party has attempted to write an independent conforming node from `RELAY.md`
  alone (the actual test of Pillar 3's "protocol, not our backend" claim), and the mailbox/reveal
  path has never been exercised against a real Dealer Node or real Offer File — those need M3.

**Gap resolved during 2.1–2.3, surfaced rather than silently decided:** RELAY.md described
`quote_ref`/`cancel` signature verification as something a relay does ("drop and penalize" on an
invalid signature), but a relay only ever sees `dealerCmt` (a one-way hash) and — per the
untrusted-relay invariant — must not read the chain to resolve it to a public key. A relay
therefore cannot cryptographically verify these signatures at all, only their shape (192 hex
chars). `RELAY.md` §2/§5 now say this explicitly; real verification stays the client's job per
§3.2 step 3, unchanged from the original design intent.

**Pre-existing uncommitted change found, not made by this session:** `packages/sdk/src/wallet.ts`
has an uncommitted diff (deferred sync — `waitForSync()` no longer runs at construction time, so
`createHeadlessWallet` doesn't block on an unfunded address's sync) left on this branch from
before this session started. It's unrelated to M2 and was left untouched and uncommitted — flagging
it here so it isn't mistaken for dropped work.

### Task 2.6 — the settlement path, built and executed (2026-09-12)

`packages/sdk/src/offers.ts` was M1's last documented stub. It is now real, and
`pnpm run e2e-settle` has run the complete happy path on Preprod: bond posted → Offer File built,
signed, proved and bound → quote committed → honest reveal delivered point-to-point encrypted →
**taker settled the Offer File** → `recordSettlement`. Verified by indexer read-back: `settled` 1,
`slashed` 0, `quote.resolved` true, `bond.amount` 1 and `bond.active` true (untouched), and
`bond.liveQuotes` back to 0. This is the first complete trade the protocol has executed.

**Phase 0 first, and it earned its place.** `WalletFacade.initSwap`'s `desiredInputs` reads either
way, and a wrong guess yields an offer that looks correct and fails at settlement — so it was
determined empirically (`scripts/probe-swap-semantics.ts`, kept in the repo) before anything was
built on it:

- `desiredInputs` = tokens this wallet **SPENDS** → positive delta. `desiredOutputs` = coins
  **created**, unfunded by this half, `receiverAddress` being your own address → negative delta,
  i.e. what you **RECEIVE**. Measured: `{NIGHT:1000}` + `[{NIGHT:700→self}]` → `+300`.
- `desiredInputs.unshielded` must be **present even when empty** (`{}`). The facade builds an
  unshielded leg only when the key is defined; omitting it while supplying unshielded outputs drops
  the leg and dies with "Unexpected transaction state."
- Balance-vector keys are **tagged objects** (`{tag:'unshielded',raw}` / `{tag:'shielded',raw}` /
  `{tag:'dust'}`), not `RawTokenType` strings. Shielded and unshielded balances of the same token
  are distinct entries and do not offset each other.
- Two independently-built **unproven** halves cannot be merged: both land at intent segment 1 and
  `merge` refuses with "key (segment_id) collision during intents merge: 1". That dead end is what
  led to `balanceFinalizedTransaction`, which is the correct API and the one the answer below rests on.

**Defects this found — same discipline as W1–W5, all of them past `tsc` and a green suite:**

| # | Defect | Why it stayed hidden |
|---|---|---|
| S1 | `SignatureEnabled`'s deserialize marker is `'signature'`, not `'signature-enabled'` | Wrong marker surfaces as a WASM `Invalid signature value.` from inside `Transaction.deserialize` — reads like a corrupt payload, not a wrong argument |
| S2 | The nets-to-zero guard checked the **DUST** entry too, and refused every valid settlement | A ready-to-submit settlement deliberately carries a DUST surplus — that surplus *is* the fee. Only a live run has a fee |
| S3 | Submission gated on a fee estimate at all — **neither available estimate is trustworthy** | `facade.calculateTransactionFee` returned `300000000000001`, which is `additionalFeeOverhead` (3e14) + 1 — exactly what the dust balancer had already provisioned, so the check is vacuous and can never fail. `tx.fees(LedgerParameters.initialParameters())` returned `926290000000001` for the *same* transaction, but those are static defaults rather than the live chain's parameters, and gating on them refused a settlement the node had already accepted. The guard now reports both and hard-fails only when **no** DUST was provisioned |

S2 and S3 were both guards **this session wrote**, and both would have been invisible without the
chain. Noted because the pattern is the lesson: the checks are as untested as the code they check.
S3 is also a correction to this session's own first fix — "use `facade.calculateTransactionFee`"
was written into these docs before a second live run showed that number to be the configured
overhead echoed back, not a fee.

**A dead end worth recording so nobody re-walks it:** closing the fee gap by re-balancing DUST
against the merged, proven transaction —
`balanceFinalizedTransaction(merged, …, { tokenKindsToBalance: ['dust'] })` — **hangs
indefinitely** on an already-dust-balanced transaction. Killed after ~20 minutes with no output.

### S4 — ~~`Custom error: 168` is an UNDERPAID FEE~~ — WRONG, corrected by S5 below

> **SECOND CORRECTION, 2026-09-13.** The heading of this section was false, and so is its first
> claim below that "for the one-asset settlement, 168 was genuinely an underpaid fee." 168 is
> `MalformedError::FeeCalculation`, raised when the ledger's **time-to-dismiss** check fails. An
> underpaid fee is a different code (138). The live fee on this chain is **1 SPECK**. Read S5 for
> the evidence. The original text is left intact below, because the way it went wrong is the lesson:
> it was built on the one variable that was being changed (`additionalFeeOverhead`), while the
> variable that mattered (how many UTXOs and DUST coins each run happened to select) was never
> recorded. **What made the one-asset settlement start passing after the overhead change is NOT
> established.** Those transactions no longer exist to measure.
>
> Original heading: *"`Custom error: 168` is an UNDERPAID FEE, and the default `additionalFeeOverhead`
> no longer covers Preprod"*.

The single most useful thing this task learned, because it looked exactly like flakiness for hours.

After the first settlement landed, every later run was rejected with an opaque
`1010: Invalid Transaction: Custom error: 168` and a multi-kilobyte byte dump naming nothing. The
diagnosis came from making `settleFromOffer` report its own numbers on rejection:

```
fee 300000000000001, DUST provisioned 300000000000001,
ledger-default fee estimate 1173940000000001, 6985 bytes
structure: seg1.guaranteed: 1 in / 1 out / 1 sig;
           seg2.guaranteed: 0 in / 1 out / 0 sig;
           seg3.dust: 2 spend(s)
```

The structure was correct — the dealer's half at segment 1, the taker's balancing half at segment 2,
DUST at segment 3, signature counts matching input counts. **The fee was not.** `additionalFeeOverhead`
in `packages/sdk/src/wallet.ts` was the skill's documented `3e14`, and the DUST balancer treats it as
a flat floor: every settlement came out provisioned at exactly `300000000000001` SPECKs, that value
plus one. Meanwhile ledger-v8's own estimate for the same transaction was `926290000000001`, and
`1173940000000001` an hour later — **the required fee was rising past the floor.**

The one settlement that landed was submitted while the real fee was still under `3e14`. That is the
whole explanation for "worked once, never again," and it is why it presented as flakiness.

**Fix: `additionalFeeOverhead` raised** (`packages/sdk/src/wallet.ts`). Unlike `feeBlocksMargin` —
an exponent the ledger explicitly warns about — this is a linear SPECK amount, so raising it only
buys headroom.

Observed on real submissions:

| Provisioned | Ledger estimate | Ratio | Tx size | Result |
|---|---|---|---|---|
| 3e14 | 9.26e14 | 0.32x | 6985 B | ❌ rejected (168) |
| 3e15 | 1.17e15 | 2.56x | 6985 B | ✅ **accepted** (one-asset) |
| 3e15 | 1.76e15 | 1.70x | 10609 B | ❌ rejected (168) — two-asset |
| 1e16 | 1.76e15 | 5.67x | 10608 B | ❌ rejected (168) — two-asset |

**CORRECTION, recorded rather than quietly edited away.** The first three rows suggested a tidy
story — "the node wants headroom over the bare fee, and the bigger two-asset transaction outgrew the
floor" — and that story was written into this file before the fourth row existed. **The fourth row
refutes it.** At 1e16 the provision is 5.67x ledger-v8's estimate and 4.5x its `feesWithMargin(5)`
figure of 2.21e15, and the node still rejects. So:

- For the **one-asset** settlement, 168 was genuinely an underpaid fee, and raising the floor fixed
  it. That result stands and is reproducible.
- For the **two-asset** settlement, 168 has a **different, still-unidentified cause.** It is not the
  fee, and it is not a signature/input mismatch (defect W5's shape): the per-intent dump shows
  `seg1.guaranteed: 3 in / 2 out / 3 sig; seg2.guaranteed: 1 in / 2 out / 1 sig; seg3.dust: 3
  spend(s)` — counts match on both segments.

Two data points make a slope, and a slope makes a story. This one was wrong, and it was wrong in the
most seductive way available: it explained the data it was built from.

### S5 — the TWO-ASSET settlement: RESOLVED 2026-09-13

**Status: resolved.** The cause is identified from source, reproduced offline, confirmed against the
node in both directions, and a two-asset settlement has landed on-chain.

**What 168 is.** Preview and Preprod run **node 1.0.2** (`system_version` RPC → `1.0.2-eb71e64e`),
tag `node-1.0.2`, which pins **midnight-ledger `=8.1.2`**, the same ledger this SDK uses.

- `ledger/src/versions/common/types.rs`: `MalformedError::FeeCalculation => 168`.
- `conversions.rs`: every `MalformedTransaction::FeeCalculation(..)` maps to it.
- ledger `verify.rs`: raised when `self.fees(params, /*enforce_time_to_dismiss*/ true)` fails.
- `FeeCalculationError` has two cases, `BlockLimitExceeded` and **`OutsideTimeToDismiss`** (`structure.rs`
  `cost()`). The transaction's modelled `validation_cost` (compute ÷ `parallelism_factor` 4) plus
  its guaranteed `application_cost` must not exceed `max(time_to_dismiss_per_byte × size,
  min_time_to_dismiss)`. Live values are **2 µs/byte** and a **15 ms** floor.

**Why nothing local caught it.** The dust wallet sizes fees with `feesWithMargin`, which calls
`cost(params, false)` with time-to-dismiss **not enforced**. `offers.ts`'s second opinion used
`initialParameters()`, which is also unenforced and whose cost constants differ from the live chain's.
The live chain's fee, meanwhile, is `fees(live, true) = 1 SPECK`: live `overall_price` is ~5.4e-18,
against 10 in `initialParameters()`. **No DUST provision could ever have fixed this**, which is why 1e16 did not.

**Evidence** (`pnpm run probe-fee-calc` runs the node's check locally against live `LedgerParameters`
read from the indexer, then optionally submits):

| Run | Merged shape | Size | Dismiss cost | Allowed | Local | **Node** |
|---|---|---|---|---|---|---|
| A | two-asset; dealer 3 in; taker 1 in; DUST 3 | 10528 B | 26.6 ms | 20.9 ms | FAIL | **rejected** |
| B | two-asset; dealer **1 in**; taker 1 in; DUST 3; give 400 | 10342 B | 19.6 ms | 20.7 ms | PASS | **accepted — `SUCCESS`, block 2522557** |
| A′ | two-asset; dealer 4 in; taker 2 in; DUST 4 | 13688 B | 33.0 ms | 27.4 ms | FAIL | **rejected, `Custom error 168`** |
| e2e | full protocol path, give 400 (new contract) | — | — | — | PASS (guard) | **accepted; settled counter 1** |

Run B's settlement tx hash is `8b6d787294b95b9aa65b35af048c8984b25947c1c580c9d417db7701ea03209f`
(Preprod indexer, `transactionResult.status: SUCCESS`).

**What the four ruled-out hypotheses missed, and the "structural difference" too.** The problem was
never the second asset, and never unshielded inputs on both sides. With the same fragmented wallet,
the **one-asset** merged settlement also fails the check (25.9 ms vs 20.4 ms allowed). What decides
it is **how many UTXOs coin selection pulls in**. Each unshielded input adds signature verification
and UTXO-tree application cost; each DUST spend adds a proof verification. That depends on the
wallet's coin fragmentation, not on the trade. The Preprod wallet had fragmented into many small
UTXOs over repeated runs, and the dealer half alone reached 4 inputs, which **already fails on its
own** (932 B, 17.7 ms vs 15 ms). No taker could have settled that offer.

**Two things this does NOT establish.** (1) Why raising `additionalFeeOverhead` appeared to fix
the one-asset case in S4. (2) Whether overhead affects the DUST spend count: runs at 3e15 and 1e13
both spent 3 DUST coins. Do not infer either.

**What changed in code:**
- `checkTimeToDismiss(tx, liveParams)` in `offers.ts`, and `queryLedgerParameters` in `indexer.ts`.
- `settleFromOffer` gates submission on the node's rule when given `ledgerParameters`. It fails
  locally with the numbers, not with an opaque 1010.
- `buildAndProveOffer` refuses a dealer half that already fails the rule. That half is unsettleable,
  and quoting behind it binds the dealer to a trade that cannot happen.
- `e2e-settle` passes live parameters and supports `E2E_GIVE_UNITS`.

**Consequence for the Dealer Node (M3):** a warm pool must back offers with **few, large UTXOs**,
and should consolidate fragmented inventory, not just track its value. See `DEALER-NODE.md` §5.

**Recurrence, 2026-09-14 — twice, both caught by the local guard before submission.** After the Class B
redeploy, `e2e-settle` (one wallet, both roles) hit the rule again on the same fragmented wallet:

| Attempt | Wallet tNIGHT coins | Merged shape | Size | Dismiss cost | Allowed | Verdict |
|---|---|---|---|---|---|---|
| 1 | 249, 500, 400, 24, …, large | dealer 3 in / 2 out; taker 2 in; DUST 3 | 10588 B | 27.3 ms | 21.2 ms | FAIL (local) |
| 2 | 749 (merged), large | dealer 2 in / 2 out; taker 2 in; DUST 2 | 7454 B | 21.5 ms | **15.0 ms (floor)** | FAIL (local) |
| 3 | **one** tNIGHT coin; TESTUSD {16576, 24864, 999958560} | dealer **1 in**; taker **2 in** (16576 + 24864 = exactly the 41440 owed); DUST 2 | 7328 B | 18.1 ms | 15.0 ms (floor) | FAIL (local) |
| 4 | **one** tNIGHT coin; **one** TESTUSD coin (both consolidated) | dealer 1 in; taker 1 in | — | — | — | PASS (local) → **accepted on-chain; settled counter 1** |

**A2 (two distinct wallets), attempt 1 — the minimal shape, refused by 0.1 ms.** Dealer (main wallet,
consolidated) half `1 in / 1 out`; taker (fresh faucet wallet, a single tNIGHT coin and a single DUST
coin) `1 in / 2 out`; **1 DUST spend**; 4187 B. Local verdict: **15.098 ms against the 15.000 ms floor
— FAIL.** One input per side is therefore *not* sufficient on its own.

Compare S5 Run B, also one input per side but with **3 DUST spends**: 10342 B, 19.6 ms against 20.7 ms,
accepted. Across those two rows, the two extra DUST spends added ~4.5 ms of modelled cost but ~6.1 KB of
size, i.e. ~12 ms of allowance. **Hypothesis, from two data points and not established:** each DUST
spend buys more allowance than it costs, so a very compact settlement can fail where a larger one of
the same input count passes — the opposite of intuition. S4 is the standing warning about a slope
drawn through two points; this needs a controlled measurement (same trade, varying DUST spend count)
before anything is built on it. Next step: resubmit the same shape bypassing the local gate
(`E2E_FORCE_SUBMIT=1`) to record the node's own verdict at this margin.

**A2 attempt 2 (forced past the local gate): the node REJECTED it.** Same shape, 4271 B, local 15.098 ms
vs 15.000 ms. The local model and the node agree even 0.1 ms from the boundary. The Custom error code
was **not captured**: `settleFromOffer` kept only the facade's top-level "Transaction submission error"
message, and the code sits in nested fields (the same trap `probe-fee-calc` had already worked around).
Fixed: `nodeErrorCode()` now digs it out of every rejection. It is very likely 168, but that is inferred,
not observed, so it is not recorded as 168.

**Booked coins persist across restarts and leak — found when A2 attempt 3 (roles swapped) found the
main wallet with 0 TESTUSD.** `pnpm run wallet-coins` listed its two TESTUSD coins (41440 and 999958560)
as **PENDING** in a fresh process, both unspent on-chain. Read from `wallet-sdk-unshielded-wallet`:
building a transaction moves inputs to `pendingUtxos`; `Serialization.js` writes that set into the
snapshot; `UnshieldedState.applyUpdate` clears a pending coin only when the chain shows it spent; there
is no TTL expiry. The A2 script had called `wallet.waitForSync()` — which **saves** a snapshot — while its
offer was booked, then died at settlement, twice. **Correction recorded in place:** `DEALER-NODE.md`
§3.1 and `journal.ts` had said a restart *loses* bookings; the opposite is true. Fixes: the dealer node
reverts dead offers from their journaled bytes on startup (`facade.revertTransaction`); the A2 script
syncs without saving while an offer is booked; `reset-unshielded-state` recovers a wallet whose leaked
offers' bytes are gone.

**Reset verified on the live wallet (2026-09-14).** `reset-unshielded-state` backed up the snapshot and
discarded its unshielded part (2 pending coins). The next start logged the SDK's own per-sub-wallet
fallback (`unshielded restore failed … syncing from genesis`), re-synced unshielded coins in ~40 s, and
`wallet-coins` then listed both TESTUSD coins (41440, 999958560) **AVAILABLE, 0 pending**. Diagnosis
confirmed end to end: the coins were stranded by a persisted booking, never spent.

**A2 attempt 3 (roles swapped, after the reset): refused again — and it refutes the hypothesis above as
stated.** Fresh wallet dealing (1 in), main wallet taking (1 in), **2 DUST spends**, 7189 B: **17.357 ms**
against the 15.000 ms floor — *worse* than the 1-spend shape (15.098 ms). ~~Each DUST spend buys more
allowance than it costs, so a very compact settlement can fail where a larger one passes.~~ The extra
spend added ~2.3 ms of cost, but 7.2 KB × 2 µs is still under the floor, so it bought nothing.

**Revised model — fits all six recorded shapes, still UNTESTED as a model:** above the ~7.5 KB where the
size-based allowance clears the 15 ms floor, each DUST spend adds ~2.9 KB (~5.8 ms of allowance) for
~2.3 ms of cost; below it, a spend is pure cost. A 1-in/1-in unshielded settlement then fails with 1
or 2 DUST spends and passes with 3 — which is what both accepted 1-in/1-in settlements had. It would
also explain S4's unexplained observation: raising `additionalFeeOverhead` makes the DUST balancer spend
more coins. Controlled test running (same trade, same wallet, only `additionalFeeOverhead` varied,
local verdicts, nothing submitted) before anything is built on it.

**Controlled test of the revised model (2026-09-14, `probe-fee-calc`, local verdicts, nothing submitted).**
Same two-asset trade, same consolidated main wallet (one tNIGHT coin, one input per side), only
`additionalFeeOverhead` varied:

| Overhead | DUST spends | Merged size | Compute | Allowance | Verdict |
|---|---|---|---|---|---|
| 3e15 | 3 | 10267 B | 19.616 ms | 20.534 ms | PASS (0.9 ms margin) |
| 3e16 | **4** | 13256 B | 21.876 ms | 26.512 ms | PASS (4.6 ms margin) |
| 3e17 | 3 | 10271 B | 19.616 ms | 20.542 ms | PASS |

The 3→4 step added +2.26 ms of compute and +2989 B (≈ +6 ms of allowance) — the per-spend figures the
model predicted from uncontrolled runs. **Supported:** above the floor, each DUST spend widens the
margin. **Operating rule, with its evidence:** a compact one-input-per-side unshielded settlement fails
at 1 DUST spend (15.1 vs 15.0, node-confirmed) and 2 (17.4 vs 15.0), and passes at 3 and 4. **Caveats:**
this wallet could not produce 1- or 2-spend shapes itself, so those points come from other wallets; and
`additionalFeeOverhead` is not a reliable dial — the spend count depends on the wallet's DUST coin
values (3e17 still spent 3). **Consequence:** a fresh faucet wallet holds one DUST coin, so as a taker
it cannot reach 3 spends and cannot settle this pair — which is exactly what blocked A2. Whether a
wallet can raise its own DUST coin count (split tNIGHT, register each piece) is the next test.

**Can a wallet raise its own DUST coin count? Yes (2026-09-14, `split-for-dust`, taker wallet).** A
self-transfer split the single 999,999,950 tNIGHT coin into 3 × 100,000 plus change (tx `4e60640d…`,
SUCCESS). DUST coins went **2 → 5**. Two observations recorded as observed, not explained:
- The split outputs were reported **already DUST-registered** by the wallet's own metadata
  ("registered 0 new"). That contradicts the caveat written into `inventory.ts` earlier today
  (that a transfer's new UTXOs are unregistered); the caveat is struck there. Whether generation
  really continues on them is inferred from the metadata, not measured.
- The wallet's DUST balance fell ~5.87 DUST across that one transfer (20.93 → 15.07). The live fee is
  ~1 SPECK, so this is not the fee; its cause is not established.

**A2 COMPLETE (2026-09-14) — the first settlement between two distinct wallets.** Dealer = main wallet,
taker = second wallet after `split-for-dust` (5 DUST coins). Both halves one input. Settlement tx
`c7b6ec70c6cc1b1a890b32862d7aac6491fb3485893f98b12e18be0628369c5e`, block 2536687, **SUCCESS**. Verified
from the indexer's own record of that transaction, not from wallet balances:

| Wallet | Spent | Created | Delta |
|---|---|---|---|
| dealer `mn_addr_preprod1u726…` | TESTUSD 41440 | tNIGHT 1000 | **+1000 tNIGHT, −41440 TESTUSD** |
| taker `mn_addr_preprod1e7wg…` | tNIGHT 100000 | TESTUSD 41440, tNIGHT 99000 (change) | **−1000 tNIGHT, +41440 TESTUSD** |

Contract read-back on `c85b6b93…`: quote resolved, dealer settled counter **1**, bond **50 untouched**,
`liveQuotes` 0. The taker paid its own DUST and never held the dealer's keys; the dealer never held the
taker's. `recordSettlement` then stalled behind repeated `Wallet.Sync` failures and the watchdog killed
the process after 20 silent minutes — but read-back shows it had already landed. What it took, in
order: one coin per asset on each side, and a taker with enough DUST coins to spend ~3.

**A3 COMPLETE (2026-09-14) — M2's definition of done, minus the UI.** `pnpm run e2e-rfq-2dealers` on
Preprod: two `relay-node` processes, two dealers (distinct bonds, dealer keys, quote keys and reveal
keys, backed by one wallet), one taker (second wallet). Timeline:

| t | Event |
|---|---|
| +0.5 s | relays up and peered |
| +59 s / +85 s | dealer A / dealer B bonded (50 each) |
| +85.3 s | taker published the RFQ to both relays; A received it via :18787, B via :18788 |
| +107.6 s | dealer B commit confirmed (22.3 s); **visible on the indexer 726 ms later**; quote_ref gossiped, reveal mailboxed |
| +130.8 s | dealer A commit confirmed (22.5 s); visible on the indexer 237 ms later |
| +136.4 s | taker aggregated **2 verified, 0 rejected**, each quote received via **both** relays |
| +137.5 s | both reveals verified against the chain and against their Offer Files; client-side comparison chose B (41.52) over A (41.44) |
| +165.4 s | settlement `1b95ba27760da897c5c703430284e684cb8a704f164710e23a376c13f31d70ed` **SUCCESS** |
| +192.4 s | dealer B recorded the settlement |

All ten checks passed: better price won; winner settled 1, resolved, liveQuotes 0; loser still live with
liveQuotes 1; both bonds untouched; taker received exactly 41520 TESTUSD and paid exactly 1000 tNIGHT;
gossip crossed both relays. The losing quote is released by the **taker** (permissionless) after
2026-09-13T22:32:27Z.

**What 2.4's first live-indexer run taught.** Commit → indexer visibility was 237–726 ms, well inside a
client's polling interval, so the aggregator's old rejection-caching defect (fixed earlier today) would
rarely have bitten at this lag — the fix stays, because Preprod's indexer has also stalled for tens of
seconds. The chain-confirmation legs (~22 s per commit, ~28 s submit+index for the settlement) dominate
the ~2.5-minute cycle; relays, verification and reveal delivery are sub-second.

**A6 — the bond lifecycle on-chain (2026-09-14, `pnpm run e2e-lifecycle`, contract `c85b6b93…`).**

| Phase | Circuit | Read-back |
|---|---|---|
| bonded | `postBond` 50 | submitted |
| bonded | **`topUpBond`** 25 | bond.amount 75 |
| bonded | `commitQuote` (left to expire) | quote `6c0c1974…` live, liveQuotes 1 |
| bonded | `releaseExpiredQuote` inside the grace period | **refused** by local circuit execution ("Fraud-proof grace period still open") |
| released | **`releaseExpiredQuote`** after validUntil + 3600 s | quote resolved, liveQuotes 0 |
| released | **`requestBondWithdrawal`** | withdrawRequested 1789334949, active false |
| withdrawn | `withdrawBond` | **pending the 24 h timelock** — resume with `pnpm run e2e-lifecycle` after 2026-09-14T21:31:09Z; the script checks tNIGHT rises by exactly the bond |

A first lifecycle on the pre-Class-B contract `f365…` was abandoned at "bonded" when the recompile
changed every prover key (see the compact-contracts skill): its 75-unit test bond and one quote remain
there. `attachDisclosureNote` is exercised on-chain by the M3 run's taker driver.

**M3 first unattended run — partial, 2026-09-13T21:30–21:48Z; killed by host memory pressure.** Dealer Node
(`bin.ts start`, main wallet, dealer `4fc729d4…`, bond 100) plus `taker-pinger` (second wallet) over the two
long-lived relays. What ran live:

| Cycle | RFQ → verified on live indexer | Reveal | Offer File | Dealer journal |
|---|---|---|---|---|
| 1 | 31 s, via 2 relays | buy 0.001 @ 41.315680 | expires 22:30:39Z; **matches terms** | committed → announced → revealed |
| 2 | 26 s, via 2 relays | buy 0.001 @ 41.315680 | expires 22:31:40Z; **matches terms** | committed → announced → revealed |

At 21:48:23Z the host ran low on memory and the harness killed the background jobs. The node took the
**graceful path** live: SIGTERM → pool halted → "the journal keeps every live quote for the next start";
the run script's trap removed both wallet locks. No settlement had been attempted (the driver settles every
4th cycle). **The M3 definition of done is therefore NOT met yet** — it needs a run across several expiry cycles.

Three things the run exposed:
1. **Defect — inventory counted twice.** After the second quote the pool logged `reserve-blocked … balance 0,
   committed 82632` and stopped refilling. `liveInventory` returned the wallet's *available* balance, which
   already excludes coins booked by our offers, and the pool then subtracted those offers again. Fixed:
   balance = available + pending.
2. **Design fact — an offer books a WHOLE coin.** The 41,316 TESTUSD bid booked the wallet's large TESTUSD
   coin outright (smallest-first selection). N concurrent quotes need N coins of roughly rung size.
   Consolidation (fewer inputs per half) and splitting (more concurrent quotes) pull in opposite directions;
   the inventory target is a **ladder of rung-sized coins**, not one big coin. `DEALER-NODE.md` §5.2 to be
   updated with the pool's split keeper.
3. **The live guard held.** The sell rung was refused every tick ("offer half spends 2 coins"), so the node
   never quoted an unsettleable half.

Operational: the host's memory (a ~4 GB Docker VM beside several ~300 MB wallet processes) is a real
constraint on unattended runs here; the next run is launched detached so a harness kill cannot stop it.

**M3 unattended run #2 — started 2026-09-14T06:16Z (in progress).** Launched detached (own process group) so
a harness memory kill cannot stop it. Before it, on restart from run #1's journal, the node's recovery
did exactly what §3.1 now says: `recover` → 2 releases, both landed on-chain; `unbook` reverted both dead
offers; the pool warmed. Cycle 1: RFQ 06:16:38.8Z → offer taken 06:16:39.0Z → commit confirmed and
announced and revealed by 06:17:02.7Z (24 s).

Two things recorded as they are, not explained:
- **The TESTUSD ladder split hung.** `split-for-dust` (SPLIT_TOKEN=TESTUSD, 6 × 60,000) logged only its
  "before" line (coins 83,040 and 999,834,000) and was killed by the watchdog after 900 s of silence —
  no transaction was logged, and the restarted node found no stuck coins. Cause unknown. So this run
  quotes from **two** TESTUSD coins: with each offer booking a whole coin for up to an hour, at most two
  buy quotes can be live at once, and some 15-minute cycles are expected to go unanswered. That limit
  is itself what the run measures.
- **Detaching worked.** At ~06:48Z the host again ran low on memory and the harness killed its background
  jobs — but the detached Dealer Node and taker driver kept running; only a heartbeat timer died.
- **The two-coin limit showed up live, as predicted.** Cycles 1 and 2 were quoted and expired unsettled
  after their 300 s window; cycle 3 (06:46:39Z) was ignored — "no warm offer for this side and size" —
  because both TESTUSD coins stayed booked by offers that expire at 07:16/07:17Z. The keeper that splits
  toward `ladder_coins` was written in response (`inventory-plan.ts`) and is not loaded by this run.
- **Cosmetic:** `[unbook] released coins booked by 2 dead offer(s)` repeats on every start for the same
  already-reverted offers — reverting an unbooked offer is a no-op, but the count misleads.

**M3 run #2 stopped (owner decision, 2026-09-14T07:00Z); run #3 started with the ladder keeper.** Run #2
answered cycles 1–2 and ignored 3–4 — at best ~2 answered requests per hour from two coins, which cannot
demonstrate a standing quote. Stopped with SIGTERM (graceful halt). Run #3 restarts the node after both
Offer Files expire (07:16:27Z, 07:17:28Z), so startup un-books their coins and the new keeper
(`inventory-plan.ts`, `ladder_coins` 4) can split TESTUSD into rung-sized coins before quoting. Same driver:
13 cycles × 15 min, settle every 4th verified quote, disclosure round-trip on each settlement.

**M3 run #3 started 2026-09-14T07:18:49Z — the ladder keeper's first live use.** Startup, in order:
`recover` → both run-#2 quotes `await-release` (grace period still open — correct); `unbook` freed the dead
offers' coins; then the keeper split **both** assets towards `ladder_coins` 4 — tNIGHT (3 in / 3 out, which
also absorbed the dust coins) and TESTUSD (2 in / 3 out), each logged "2 backing coin(s) < target 4". For
the first time in any run **both rungs warmed**: buy @ 41.315680 and **sell @ 41.564320**. The sell rung had
been refused every tick of runs #1 and #2 ("offer half spends 2 coins"). Taker driver started 07:20:07Z;
the node took the buy offer for cycle 1 immediately.

**M3 run #3 — two live defects, node stopped 07:29:36Z, fixed and restarted.** Cycle 1 had completed
(verified on-chain after 31 s via both relays; reveal matched its terms; offer live to 08:19Z). Then:
1. **False invalidation alarm → self-halt.** At 07:26:57Z the node began logging, every 15 s, an ALERT for
   each of run #2's two quotes — "offer inputs spent by another transaction: this node invalidated its own
   live quote" — and halted its pool. Those Offer Files had **expired** (07:16/07:17Z); startup freed their
   coins and the keeper then split them. Spending a dead offer's coins is ordinary inventory reuse. `watch()`
   and `recover()` did not check `offerExpiresAt`. Fixed: only a spend before the Offer File expires counts
   as invalidation.
2. **Keeper churn.** "split … 1 in / 1 out" every tick (07:27:19Z, 07:28:19Z): the plan asked for one 1,500
   piece and smallest-first selection funded it from an existing 1,500 coin — a real transaction, spending
   DUST, changing nothing. Fixed: a split's total must exceed the sum of all smaller coins, forcing the
   largest coin in.
Both fixes carry tests built from the exact live shapes (88 dealer-node tests pass).

After the 07:31Z restart the fixes held (0 ALERTs; the tNIGHT split went 3 in → 4 out, adding coins) — and
two more live problems appeared, fixed in turn:
3. **The ladder target ignored coins held by live offers.** "3 backing coin(s) < target 4" each tick: every
   warm offer books a whole backing coin, so the keeper kept splitting to replace coins that were merely in
   use. Fixed: target = `ladder_coins` − offers currently giving that token.
4. **The keeper starved quotes of DUST — and cost cycle 2.** Back-to-back keeper splits each booked a DUST coin
   for their fee until confirmed; a split failed "Insufficient Funds: could not balance dust" (07:34:47Z) and
   cycle 2's `commitQuote` failed (07:35:11Z). This is `DEALER-NODE.md` §5's reserve concern biting through
   **DUST coins**, not unshielded coins. Fixed: the keeper skips unless ≥ 2 DUST coins are free, and submits
   at most one transaction per tick. Node stopped 07:36:08Z and restarted with all four fixes.

A keeper rejection had also been logged with no node code ("Transaction submission error"); keeper
self-transfers now carry `nodeErrorCode()` like settlements do.

After the 07:36Z restart the DUST fix held (0 ALERTs, no failed commits, one keeper transaction per tick),
and one more loop appeared:
5. **Merge/split oscillation on tNIGHT.** 07:38Z merge "5 coins > 4" (3 in → 1 out), 07:39Z split "2 backing
   coin(s) < target 3" (2 in → 5 out), 07:40Z merge again. The count-based merge ignored the ladder, and the run
   config had `consolidate_above` 4 — at the ladder target — so a split tripped a merge that destroyed backing
   coins. Fixed: a count-based merge may only consume surplus backing coins beyond the target, and config now
   rejects `consolidate_above ≤ ladder_coins + 1`. Also seen, not explained: one TESTUSD split logged 2 in → 2 out.

6. **The keeper invalidated a live quote — a TRUE alarm, traced on the indexer.** After the 07:43Z restart
   the node alerted that cycle 1's quote `16f11a9f…` (Offer File settleable until 08:19:57Z) had its input
   spent, and halted. Evidence: the journal records that offer's only input as `a83d6079…:1` (61,974
   TESTUSD); the indexer shows the keeper's TESTUSD split at **07:41:06Z** spent exactly that coin. The earlier
   keeper split at 07:34:12Z had correctly avoided `:1` (spending `:0` and `:2`), so the booking held within
   that process and was lost somewhere across the 07:36 stop/restart — **how, exactly, is not established.**
   What is established is the design error: the keeper's exclusion list shaped the *plan*, but the wallet
   selects the *inputs*, smallest-first over whatever it considers available. So a live offer's coin was
   protected only by the wallet's booking. Fixed with a last-moment invariant: every keeper self-transfer's
   real inputs (`inputsOf(tx)`) are checked against every coin a live offer, pool offer or recovery hostage
   depends on, and nothing is submitted on overlap. The alarm itself behaved exactly as designed — it caught
   the node double-spending its own quote and stopped quoting; it now fires once per quote, not every 15 s.

7. **A successful release reported as a failure.** After the restart, the node released the expired
   quote `16f11a9f…`: `releaseExpiredQuote` landed in block 2543615 at 08:25:24Z (tx `fa787986…`), but
   the wallet surfaced a submission failure with node code 104 at 08:25:35Z, and the next watch pass —
   seeing the quote resolved while the journal still said `expired` — alerted "resolved by another
   party". The taker pinger never releases quotes, so the alert was false. Why the wallet reported 104 for
   a transaction that landed is not established. Fixed by trusting the chain: after any release
   failure the node re-reads the quote, and a resolved quote is journaled `released`.

Seven defects in one run, each invisible to the offline suite — the keeper had only ever been tested as a pure
planner, never as a loop acting on a wallet that changes under it. Same lesson as S2/S3: the guards and keepers
are as untested as the code they protect until they run against a chain. The taker driver kept
running through the stop, so cycles missed while the node was down are recorded as unanswered.

**M3 run #3, after the 08:20:38Z restart — first live settlement and disclosure round-trip (2026-09-14).**
Relays do not replay: cycle 7's RFQ (08:20:08Z) predates the node's relay connection (08:21:01Z) and went
unanswered. From cycle 8 on, verified by the pinger against the chain:

| Cycle | Quote | Verified after | Outcome |
|---|---|---|---|
| 8 | `df77ede1…` | 26 s | reveal matches offer (buy 0.001 @ 41.315680) |
| 9 | `a354db7d…` | 26 s | reveal matches offer |
| 10 | `08a89df5…` | 31 s | **settled** tx `cad6f3b5…` status SUCCESS (09:00:08Z); dealer node journaled `settled`, then `recorded`; on-chain dealer settled counter **1**; **disclosure note attached on-chain, intended recipient verifies, a different key refused (AEAD)** |

The last-moment keeper guard held on its first live use: the keeper's split at 09:00:49Z (identifier
`00f8b377…`, hash `e104d51c…`) spent `c31d1819…:1` (20,658) and `2d3d770e…:2` (the large coin), while the
still-settleable quotes are backed by `2d3d770e…:1` (cycle 8) and `8c9cc584…:1` (cycle 9) — checked on the
indexer. **Disclosure round-trip: done.** **Still open for the M3 DoD:** the standing quote held unattended
across multiple Offer File expiry cycles (first expiry since the restart is 09:21:02Z).

**M3 run #3 — closed 2026-09-14T10:24:43Z. The node held its standing quotes unattended for 2 h 04 min
across multiple Offer File expiry cycles.** From the 08:20:38Z start to the SIGTERM stop, with no operator
action:

- **Every RFQ that reached a warm offer was answered: 9 of 9**, each committed, gossiped via both relays,
  revealed and verified on-chain by the taker in 26–36 s (driver 1, cycles 8–13; driver 2, cycles 1, 3, 4).
  Two RFQs were not: cycle 7 arrived before the node's relay connection (relays do not replay), and driver
  2's cycle 2 is item 3 below.
- **Offer File renewal:** the node discarded and rebuilt the standing sell offer within its expiry margin at
  **09:06:03Z** and again at **09:51:03Z**, the second offer being the first one's replacement.
  Buy offers were consumed by quotes and rebuilt each cycle; coins booked by expired offers came back as
  inventory (e.g. the TESTUSD coin freed at ~10:01Z, buy offer warm 10:02:03Z).
- **Quote lifecycle:** four expired quotes were released on-chain by the node (08:25, 09:34, 09:49,
  10:19Z); one settled, was recorded, and carried a disclosure note (09:00Z, above).
- **No halt, no invalidation, no keeper refusal.** One keeper transaction (09:00:49Z split), checked on
  the indexer against live offers' coins.

Three findings, all non-fatal:

1. **Every release was reported as a failure, and every one had landed (4 of 4).** Blocks 2543615,
   2544306, 2544456 and 2544756; in each case the wallet reported `1010: Invalid Transaction: Custom
   error: 104` ~6–11 s after the block, and the next watch pass raised a false "resolved by another
   party" alert. Systematic, not intermittent. Handled since `9e2b599` (the node re-reads the chain after
   a failed release); **why the wallet re-reports a landed transaction as 104 is not established.**
2. **`ladder_coins`, not `max_live_quotes`, is the per-side concurrency limit.** 09:46–10:02Z: a one-sided
   taker filled all four TESTUSD coins with booked offers and the buy side logged "Insufficient funds"
   for 16 minutes while the risk limit (6) allowed more. Startup warning since `4cb8ec6`; README and
   DEALER-NODE.md corrected.
3. **An RFQ was judged once, on arrival.** Driver 2's cycle 2 (10:00:04Z, open until ~10:09Z) arrived with
   no free coin; a buy offer was warm at 10:02:03Z but the RFQ was never looked at again. Fixed in
   `d53fd5d`: such RFQs are kept and re-offered after each pool tick while ≥ 60 s remain.

**M3 definition of done:** standing quote held unattended across multiple Offer File expiry cycles on
Preprod ✅; a settled trade's disclosure note round-trips ✅. The fixes in `9e2b599`, `4cb8ec6` and
`d53fd5d` were committed during the run and have not yet run live.

**3.10 — the operator README timed on a brand-new wallet, 2026-09-14T10:08–11:31Z.** A fresh `git clone`
of `harden-m1`, a newly generated seed, and a new dealer key, following `packages/dealer-node/README.md`
step by step. The faucet was replaced by a transfer from the main wallet (500 tNIGHT, 1,000,000 TESTUSD);
nothing else was pre-seeded.

| Step | Time |
|---|---|
| clone + `pnpm install` + `pnpm run compact` | 16 s (warm pnpm store) |
| generate seed + address | 4 s |
| funding (transfer, faucet stand-in) | 63 s |
| `fund`: first wallet sync | **~28.5 min** |
| `fund`: DUST registration | 35 s |
| `gen-key` | 3 s |
| consolidate | 10 s |
| `bond 100` | 24 s (bond 100, active, read back on-chain) |
| `start` → both offers warm | 65 s |
| taker RFQ → quote verified | 26 s (quote `b495644d…`, via 2 relays) |
| settlement | tx `3e43c82d…` SUCCESS, 53 s after the RFQ |
| `recordSettlement` | landed 11:31:02Z, **11.5 min** after settlement: DUST-starved |

The new dealer `3556af8c…` ended at bond 100, active, settled 1, slashed 0. The disclosure note was not
exercised for this dealer: the taker driver gives up after 10 minutes waiting for the record, and the record
took 11.5 (disclosure itself is proven above, run #3 cycle 10).

**Four operator-facing defects, none visible to the M3 runs** (which all ran from the repo root, on
long-lived wallets funded with tNIGHT first):

1. **DUST registration failed on a wallet holding a second token.** `registerForDustGeneration` passed
   every unshielded coin; the SDK aborted with `Wallet.Other: Token of a non-Night type received` after
   the 28-minute sync. Fixed `d5dc0a8` (tNIGHT coins only).
2. **The bond step began a second full sync.** The wallet snapshot directory was cwd-relative: `fund`
   (repo root) saved it where `bond` (`packages/dealer-node`) did not look. Fixed `5f4d461` (workspace
   root from any directory).
3. **A hex private-state password passed our check and failed at `bond`.** The store requires 3 of 4
   character classes and says so only on first open, after the sync. Fixed `fc5bc06` (checked before the
   wallet is created; README states the rule).
4. **A young wallet could not afford to record its first trade.** The keeper's 1→4 tNIGHT split at start
   spent DUST that `recordSettlement` then lacked; the node logged the failure every 15 s for 11.5
   minutes. Fixed `63450db` (keeper defers while a record or release is owed; failures log once, then
   every 20th); README "What takes time" now says so.

**Verdict on the 30-minute target:** met for operator work, and it takes minutes. Not met for wall-clock time on a new
wallet: the first sync is ~28.5 min, and for the next ~30 minutes DUST limits how fast the node can record trades. Both are the network, and
the README now says so with numbers.

Attempt 4 settled on `c85b6b93…` — tx id `0012b050ee60e69a2bd8ebc06e15c116e6eaffcd5a4110cffdaeb8ef1c5800032c`,
settle 22.0 s, `commitQuote` 53.4 s — with bond untouched and `liveQuotes` back to 0. It is also the first
settlement on the Class-B-removed contract, and the first live execution of the one-argument
`recordSettlement(quoteId)`. The consolidation diagnosis above is confirmed by the only variable changed.

**Attempt 3 is the important one: the TAKER's wallet decides it too.** The dealer half was already a
single coin, and the taker side — smallest-first again — paid with two fragments that summed to the
exact amount owed. Three unshielded inputs in a compact (~7 KB) merged settlement already exceed the
15 ms floor. The only accepted shape on record is one input on each side. Consequences:
- **A taker client must consolidate before settling**, not only the dealer node. A fragmented taker
  cannot take even a perfectly shaped quote. This belongs in the SDK's settlement path and in the
  frontend (FRONTEND.md), not just in `DEALER-NODE.md`.
- A dealer can pre-check its own half, but it cannot know the taker's wallet. `settleFromOffer`'s local
  check is what protects the taker from a pointless submission; it has refused all three.

Two things this adds to S5:
- **The cause is now read from source, not inferred.** `wallet-sdk-capabilities` `Balancer.js`
  `chooseCoin` sorts a token's coins ascending by value and `doBalance` keeps adding the smallest until
  the imbalance is covered. So an offer spends exactly one coin only when **no coin of that token is
  smaller than its give amount**. Merging "some" small coins is not enough (attempt 2).
- **Fewer DUST spends can make it worse.** Attempt 2 was smaller, so its size-based allowance fell to
  the 15 ms floor while its input/signature cost barely moved. The allowance is `max(2 µs × bytes,
  15 ms)`, and a compact transaction sits on the floor.

`scripts/consolidate.ts` now defaults to merging down to one coin, and the Dealer Node's pool is
designed around smallest-first selection (`DEALER-NODE.md` §5). Each failed attempt left one live,
unsettled quote on `c85b6b93…` under a throwaway dealer key; they are releasable after the grace period.

---

*The original S5 write-up follows unchanged. Its analysis was careful and still wrong about where
to look, so it is kept.*

**Original status: blocked, cause unknown.** Everything up to submission works. The test token exists, is
minted, and is spendable; the two-asset offer builds with exactly the right balance vector; the
quote commits; the reveal verifies; the merged vector nets to zero in tradeable tokens. The node
rejects the final submission with `1010: Invalid Transaction: Custom error: 168`.

What the two-asset offer produces, which is the shape the whole protocol is about:

```
{ unshielded tNIGHT: +1000, unshielded TESTUSD: -41440 }
```

That is `zswap-offer-files` SKILL.md §2's tNIGHT/USDM example down to the numbers.

**Ruled out by measurement, not by argument** — recorded so the next session starts past them:

| Hypothesis | How it was killed |
|---|---|
| Underpaid fee | Provisioned `1e16` = **5.67x** ledger-v8's estimate (1.76e15) and **4.5x** its `feesWithMargin(5)` (2.21e15). Still rejected |
| TESTUSD is not really spendable | A plain TESTUSD self-transfer was **accepted on-chain** (`pnpm run probe-testusd`). It is an ordinary UTXO |
| Signature/input count mismatch (defect W5's shape) | Per-intent dump: `seg1: 3 in / 2 out / 3 sig; seg2: 1 in / 1 out / 1 sig`. Counts match |
| Signatures invalidated by segment renumbering during merge | Verified offline against `Intent.signatureData(n)` for every segment (`pnpm run probe-merge-sigs`): seg1's signatures are VALID at 1 and invalid elsewhere, seg2's is VALID at 2. And the balancing tx is **already at segment 2 before the merge** — nothing is renumbered |

**The one structural difference that remains,** and the place to look next: in the *accepted*
one-asset settlement the taker's balancing half was `0 in / 1 out / 0 sig` — it only ever created an
output. In the two-asset case the taker must **spend** TESTUSD to pay, so both halves carry signed
unshielded inputs. No merged settlement with unshielded inputs on *both* sides has ever been
accepted by this node. Whether that is a real ledger constraint, a `balanceFinalizedTransaction`
limitation, or something else entirely is **not established** — and the tempting inference that it
is a constraint is exactly the kind of story S4's correction warns about.

Error code 168 is defined in the Midnight node runtime and cannot be resolved locally. **Asking
upstream what 168 means is now the cheapest available next step, and probably the right one** —
four rounds of hypothesis-and-measure have cost far more than one answer would.

Probes kept in the repo, all of which submit nothing except where noted:
`pnpm run probe-swap` (initSwap semantics), `pnpm run probe-testusd` (spendability — this one DOES
submit), `pnpm run probe-merge-sigs` (offline signature verification).

Three follow-ups this leaves open:

- **`3e15` is a measured-once value, not a tuned one.** It clears today's fee by ~2.5x. It is not a
  ceiling anyone has reasoned about, and it should be revisited alongside `MIN_BOND` at M4.
- **A flat overhead floor is the wrong shape.** The right fix is reading the chain's live
  `LedgerParameters` rather than over-provisioning against a static guess; `initialParameters()` is
  not them.
- **Two hypotheses were tested and are WRONG** — recorded so nobody re-walks them. (a) *Stale coin
  selection*: the bond spends the smallest UTXO first, so offer construction might pick a spent coin.
  Building the offer before the bond (so `initSwap` books its inputs) is correct regardless and was
  kept, but it did not fix 168. (b) *Stale dust TTL*: the dust intent's TTL matched the offer's
  expiry exactly, to the second.

### Reliability: the path works, but Preprod is unreliable underneath it

The settlement path is now reproducible — it ran clean again after the fee fix. What is **not**
reliable is the network under it. During this session Preprod's indexer served a trivial
`{ block { height } }` query in **30.8 s**, and several runs logged `Wallet.Sync` failures from all
three sub-wallets at startup, before any protocol step; one run hung ~20 minutes with no output and
had to be killed, and a later `recordSettlement` stalled for over ten minutes after its settlement
had already been accepted on-chain.

None of that is protocol behaviour, but it sets the floor on what a dealer node can promise.
**`DEALER-NODE.md`'s challenge-response timing assumes the operator can see the chain and act within
a window** — worth revisiting at M3 against these numbers rather than against optimistic ones.

**Known limits — do not overstate this result.**

- **One asset, not two.** Preprod has only native unshielded tNIGHT; USDM does not exist there, and
  no substitute is obtainable — shielded tNIGHT genuinely *is* a separate balance-vector entry
  (probe 6 builds `{unshielded:+1000, shielded:-900}` cleanly), but neither the wallet SDK nor
  ledger-v8 exposes any unshielded → shielded conversion, so a faucet-funded wallet can never
  acquire a shielded balance to pay with. The settled offer was therefore `{unshielded tNIGHT:
  +1000}`, and `terms.ts` carries a clearly-marked Preprod-only `tNIGHT/tNIGHT` pair for it. The
  nets-to-zero rule is per-token-independent arithmetic, so the two-asset case differs only by
  having a second entry — **but that is an argument, not a live run.** See the open decision below.
- **One wallet, both roles**, as `e2e-fraud.ts` already does. The settling side never touches the
  dealer's keys (`signRecipe` on a `FINALIZED_TRANSACTION` recipe signs only the *balancing*
  transaction), so the mechanism does not depend on it — but a genuinely two-wallet run has not
  happened, and the taker would need its own DUST to submit.
- `topUpBond`, `requestBondWithdrawal`, `withdrawBond`, `openSettlementChallenge`,
  `releaseExpiredQuote`, `submitFraudProofTimeout` and `attachDisclosureNote` **remain unexecuted
  on-chain** regardless of green tests.

**Noise, not a defect:** every on-chain call logs `Failed to upsert history entry … Cannot read
properties of undefined (reading 'upsert')` from `wallet-sdk-dust-wallet`'s transaction-history
code. It is non-fatal and does not affect balances or submission. Untriaged.

### Task 2.8 — first settlement-path latency numbers (Preprod, local proof server)

Measured by `pnpm run e2e-settle`, three runs. **These are real numbers and the bad one is
published as a bad number**, per `GRANT.md` risk 2.

| Step | Measured |
|---|---|
| Offer File build + sign + prove + bind | **7–16 ms** |
| `commitQuote` (prove + balance + submit + confirm) | **18.8 s** (also 23.2 s, 24.4 s, 24.6 s) |
| Settle (balance + prove + submit) | **16.9 s**, and **23.6 s** on the reproduced run |
| Deploy proof (from M1) | 0.691 s |

Both a first and a reproduced run are included; the spread between them is network, not work.

**The 7 ms deserves scrutiny, not celebration.** A purely *unshielded* offer carries no ZK proof at
all — unshielded offers are signature-authorized, and proving cost lives in the *shielded* leg. So
this number says almost nothing about a real tNIGHT/USDM offer, and it does **not** vindicate the
warm pool; it does not test it. The warm pool's premise (proving is too slow for the quote hot path)
is still unmeasured for a shielded offer, and remains an M3 question.

What the numbers *do* say clearly: the chain-confirmation legs dominate, at ~17–25 s each. The
commit→confirm→reveal round trip the design already flagged as chain-bound is the real latency, not
proving.

**Additional on-chain legs, 2026-09-13 (Preprod, new 2.9 contract):** `commitQuote` **53.2 s**
(bad; during the same window Preprod's indexer was timing out on connect). Two-asset settle
(balance + prove + submit) **22.0 s**. Mints of the shielded test token 21.7 s and 25.0 s; a third
mint stalled behind `Wallet.Sync` failures for over 8 minutes before its coin appeared.

### Task 2.8 — SHIELDED offer proving, measured 2026-09-13

Every number above was for an unshielded offer, which carries no ZK proof. To measure a real one,
`contracts/src/TestShieldedToken.compact` (testnet scaffolding) mints shielded coins to the wallet.
`scripts/probe-shielded-latency.ts` then times `initSwap` → `signRecipe` → `finalizeRecipe` for an
offer giving 1000 shielded units for 400 unshielded tNIGHT. That offer's vector is
`{shielded:+1000, unshielded tNIGHT:-400}`, with the shielded Zswap offer present. Local proof
server `midnightntwrk/proof-server:8.1.0` in Docker on the developer's Apple-silicon Mac, one run.

| Offer | initSwap | sign | prove + bind | **Total** | Size |
|---|---|---|---|---|---|
| Unshielded baseline (same run) | 5 ms | 4 ms | 5 ms | **14 ms** | 666 B |
| Shielded, cold (first proof) | 22 ms | 1 ms | 6438 ms | **6461 ms** | 10503 B |
| Shielded, sequential ×5 | 24–36 ms | 2–3 ms | 2884–3710 ms | **median 3136 ms** (min 2915, max 3737) | 10503 B |
| Shielded, 2 requested concurrently | 54–55 ms | 2–3 ms | 3530 / 5806 ms | **5864 ms wall for 2** | 10503 B |

What this says:

- **Proving is ~200× the unshielded cost and dominates offer construction** — ~3 s steady state, ~6.5 s
  cold. The warm pool's premise ("proving is too slow for the quote hot path") is **confirmed** for
  shielded offers. It was never true for unshielded ones.
- **Concurrency buys nothing.** Two offers requested in parallel took 5.9 s wall, the same as two in
  sequence. The proof server serialises. A warm pool refills at **~3 s per offer, full stop**, so a
  ladder of N price points costs ~3N s to refill on one proof server. A 20-point ladder is ~1 minute
  of proving per refresh or mid move. Scaling that means more proof servers, not more requests.
- **A shielded half is ~16× the size of an unshielded one** (10.5 KB vs 666 B). Time-to-dismiss
  (S5) allows more for larger transactions, but the shielded offer's proof-verification cost was
  **not** checked against it here. **Unmeasured — check before quoting a shielded pair.**
- **Chain confirmation still dominates end to end.** A ~3 s proof sits beside a 19–53 s
  `commitQuote`. The latency to attack is still the commit→confirm→reveal round trip.

### Task 2.8 / A5 — a SHIELDED offer checked against time-to-dismiss, and SETTLED on-chain (2026-09-14)

`pnpm run probe-shielded-settle` (`PROBE_SUBMIT=1` to submit), Preprod, one wallet in both roles.
Dealer half gives 1000 shielded TSU for 400 unshielded tNIGHT; the taker balances it unilaterally.

| Transaction | Size | Structure | Modelled compute / read | Allowance | Local verdict | **Node** |
|---|---|---|---|---|---|---|
| Dealer half (shielded) | 10503 B | seg1: 0 in / 1 out; Zswap offer present | 7.9 ms / 3.7 ms | ≈21.0 ms | PASS (fee 1) | — |
| Merged settlement | 28354 B | seg1: 0/1; seg2: 2 in / 1 out / 2 sig; 4 DUST spends; Zswap offer present | 30.8 ms / 12.0 ms | ≈56.7 ms | PASS (fee 1) | **accepted, `SUCCESS`, block 2535898** |

Settlement tx hash `fbba11eca3b7dc75c7e54c72fb57d372984ea270c5b4efff673233bddeca8f83` (indexer read-back).

What this establishes:
- **The shielded leg settles on-chain**, through `balanceFinalizedTransaction`, unilaterally. That was
  the last piece of the settlement path that had never run.
- **The shielded half is not the time-to-dismiss risk the size difference suggested.** A proof is
  expensive to verify, but it is also large, and the allowance scales with bytes (2 µs/byte). The
  merged transaction nearly triples in size (the taker's balancing adds its own shielded output
  proof), and its allowance grows with it. What still decides pass/fail is the unshielded input,
  signature and DUST-spend count — the same lever as S5.
- The local check agreed with the node again.

Limits: one run, one wallet, one shape; the taker side here spent 2 unshielded inputs and 4 DUST
coins. A more fragmented taker wallet would eat the headroom (43 ms of cost against 57 ms allowed —
roughly 25%), so the S5 rule of few, large UTXOs still applies. Proving took 3.9 s per side.

Limits of the latency run above: one machine, one run, one offer shape (one shielded input and one unshielded output). None
of those offers was settled; they were built, proved and reverted. The live pair, tNIGHT/USDM, is
unshielded on both legs, so this measures the protocol's *capacity* for shielded pairs, not the
current one.

**Definition of done:** one full sealed-bid RFQ cycle — including at least two competing dealer
commitments — runs end to end on Preprod and is demoable.

Task 2.8 gates every performance claim in `GRANT.md`. No latency figure goes in any external
material beyond the measured table above.

### Web client (`client/`) — built 2026-09-15, merged into `harden-m1`, NOT yet run live with a wallet

**Owner decisions (2026-09-15):** build the whole client without waiting on the Phase 0 browser gate;
"backend" means relays + indexer + wallet (no hosted server); live data only in the UI (fixtures stay in
the test suite); real contract circuits from the browser; dealer keys encrypted in the browser with a
forced backup; `/me` history encrypted under a passphrase. `FRONTEND.md` describes what was built.

All 10 pages and 6 overlays exist. Offline evidence after the merge: 154 client tests (unit, component,
fixture trade scenarios, and the live relay adapter against two real relay-node servers), 30 files /
407 repo tests, typecheck clean, one runtime WASM bundled.

**Merge note (2026-09-15):** `client-all-pages` fast-forwarded into `harden-m1`. On the main checkout
the SDK's offline circuit tests then failed with `expected instance of ContractOperation`: a stale
`packages/sdk/node_modules` from an older install nested `onchain-runtime-v3` 3.1.1 beside the
lockfile's root 3.1.0, so the contract and midnight-js built state with different runtime instances.
The lockfile holds only 3.1.0 (the clean layout the 3.10 fresh-clone Dealer Node run used), so the
nested directory was removed and the tests pass. Symptom to recognise: any "expected instance of"
error from the runtime WASM means two copies are loaded.

**Spent-coin pre-check, run against Preprod (2026-09-15).** The v4 indexer has no lookup by coin, only
`unshieldedTransactions` by owner address, so the client reads each offer input's owner
(`offerInputsOf` → `addressFromKey`), encodes the address (`encodeMidnightBech32m`, checked against
`wallet-sdk-address-format`) and replays that owner's history to the progress marker
(`client/src/data/live/spent.ts`). Replaying the main dealer wallet took 31 s and returned 103 spent
coins, exactly one of them spent by the A2 settlement `c7b6ec70…` — the dealer's single TESTUSD input
recorded above. Settle's first stage and `/verify`'s coin check now use it; an indexer that can't
answer reads "couldn't check", never "unspent". Added in the SDK:
`browser-contract.ts` (`prepareOtcCall`: the real compiled contract through midnight-js
`createUnprovenCallTx`, fetched ZK assets, in-memory witnesses) and `bech32m.ts` (wallet keys to hex
without `Buffer`, checked against `wallet-sdk-address-format`). `postBond` builds an unproven
transaction through that path offline; contract refusals and witness failures surface with their own
messages. The browser dealer identity matches `dealer-node/src/identity.ts` exactly.

**Genuinely unverified — do not claim otherwise:**
- A settlement from a browser wallet (`/trade` → Settle).
- ~~Any contract circuit proved, balanced and submitted by a browser wallet.~~ **Done 2026-09-15**
  (`scripts/browser-e2e`, `circuit` phase): `/dev/circuits` released quote `88d5b6d8…` through the
  client's browser path with an injected DApp Connector backed by the taker wallet. The circuit ran in the
  page against indexer state; proof server check 21 ms, prove 1.5 s; `balanceUnsealedTransaction` 2.4 s;
  submit 16.9 s; block 2563236; quote resolved on read-back. A real extension (1AM, Lace) has still not
  run it: this proves the client's code, not an extension's.
- The `trade`, `note`, `fraud` and `desk` phases (settlement, disclosure attach, fraud proof, manual
  quote from the browser). Not run yet: another session was running its own Dealer Node on the main
  wallet, and the harness refuses to share it.
- Whether 1AM or Lace `makeIntent` returns a sealed, settleable Offer File (`/desk` manual quote).


Browser checks that did run (2026-09-15, `pnpm --filter @otc/client test:e2e`): every route renders its
heading with no page errors and no horizontal overflow, and passes axe WCAG 2.1 AA, on desktop and a 390 px
phone (30/30). It found two real defects, both fixed: the 404 page had no `<h1>`, and `/deal`'s command
blocks scrolled sideways without being keyboard-focusable. These runs used the live indexer with no
wallet or relays, so they check rendering and accessibility, not trading.

**Trade flow + notification centre (2026-09-16, owner request).** A defect in the existing client came
first: the trade loop lived in the `/trade` page, so **leaving `/trade` stopped the trade**. No quotes were
collected and no reveals were opened, while the window kept running. The loop now runs in the shell
(`app/TradeRuntime.tsx`) and the SDK still loads only once a trade is active or `/trade` is open.
`features/trade/notify.ts` turns the trade state into notification-centre entries (the table is in
`FRONTEND.md` "Notifications"). The transaction tray is merged into the same drawer. Compare asks for a
wallet before settling instead of failing at the wallet stage. Owner decisions: one bell (tray merged);
quote actions open Compare with the quote selected and **never settle directly**; in-app only, no OS
notifications. Offline evidence: 25 files / 178 client tests (was 154), including every rule, the
reconciling store, and a fixture trade that keeps running on `/activity`, toasts "ready to compare", and
returns to Compare from the centre. Typecheck clean. **Not run against live relays or a live indexer.**

**Landing page (2026-09-16, owner request).** The `landing-page` branch's Next.js page is ported into the
client at `/`, outside the app shell; **Launch App** opens `/trade`, and Venue moves to `/venue`. Its CSS
is scoped (`.pl`, root scale under `html.pl-html`) so the 1vw scale can't leak into the terminal, fonts
are self-hosted, and the waitlist form, which had no backend but promised a reply, is replaced by Launch
App. Evidence: typecheck and build clean, the landing chunk imports no SDK, and a component test checks
the link to `/trade` and that the root scale is removed on arrival. `routes.spec.ts` gained the landing and a
Launch App test, but **the Playwright e2e suite was not run** for this change. Found on the way: a local
`client/.env.local` now sets `VITE_NETWORK=preview`, which fails 5 wallet-connecting component tests; with
`VITE_NETWORK=preprod` the suite passes.

---

## M3 — Dealer Node + disclosure

| # | Task | Status |
|---|---|---|
| 3.1 | `packages/dealer-node` skeleton, TOML config, key management | ✅ `config.ts` (validates at startup; refuses float amounts, secrets, <2 relays, unsafe margins, TESTUSD on mainnet), `identity.ts` (one 0600 secret; derived quote + reveal keys; never overwrites), `bin.ts` gen-key/bond/status/start |
| 3.2 | Warm-pool Offer File management + refresh loop (`DEALER-NODE.md` §5) | ✅ offline — `pool.ts`: ladder, expiry margin, mid-move re-prove, stale-mid hard stop, serial refill, value reserve designed from the SDK's smallest-first coin selection (read from source), `max_offer_inputs`; consolidation keeper + SDK `inventory.ts` (used live to fix three S5 recurrences) |
| 3.3 | Crash-consistent quote journal (nonce persisted **pre**-commit) | ✅ `journal.ts`: append-only, checksummed, fsync'd; torn tail truncated, mid-file corruption refused; `recover()` tested at all three crash points; never records a settlement when offer inputs were spent elsewhere |
| 3.4 | Automated commit → reveal state machine | ✅ offline — `quoting.ts` (every transition and failure tested); `live.ts` adapters incl. indexer `unshieldedTransactions` subscription for settlement detection. **Live run pending** |
| ~~3.5~~ | ~~Challenge-response loop (`DEALER-NODE.md` §6)~~ | **Removed** with Class B (owner decision 2026-09-14) |
| 3.6 | Bond monitoring, `halt_on_slash`, risk caps | ✅ offline — in `quoting.ts`/`pool.ts`: bond active/amount watched, halt on slash, `max_size`, cumulative `max_total_notional`, bond × 20 cap, `minimum_balance`, inventory floor. `auto_topup` parsed but not acted on yet |
| 3.7 | Disclosure: named-recipient shape (`0x0001`) attach + decrypt in SDK | ✅ `packages/sdk/src/disclosure.ts`; encodings fixed in `DISCLOSURE.md`. On-chain attach runs in `taker-pinger` (pending) |
| 3.8 | Frontend: Screen 4 (settled trades feed) + disclosure note affordance | 🟡 **UI built 2026-09-15** — `/activity` from the indexer (slashes first-class, no price column), Attach disclosure note from the receipt, Open a note on `/verify`. **Browser attach not run live** |
| 3.9 | Disclosure test suite — **including the negative cases** (`DISCLOSURE.md` test plan 4, 5, 7) | ✅ items 1–7 against the compiled contract in the simulator |
| 3.10 | Operator quickstart README; validate the 30-minute target with a fresh operator | ✅ **Timed end to end on a brand-new Preprod wallet, 2026-09-14 (see below).** Operator work is minutes; the first wallet sync is ~28.5 min. Three operator-facing bugs found and fixed on the way. Not measured: the CAPTCHA faucet wait and a cold pnpm store. ~~`packages/dealer-node/README.md` written. **Clean-checkout run, 2026-09-14 (partial):** clone → install → config → `gen-key` worked from nothing in 4 s (warm pnpm store — not representative of a fresh machine). It exposed a real gap: a clean clone has **no prover keys** (`*.prover` is git-ignored), so nothing could be proved; the README now installs Compact 0.30.0 and runs `pnpm run compact` (**20 s**). Compilation is **deterministic**: recompiled keys were byte-identical to the committed verifier keys (the deployed contract's) and to the developer's prover keys. Still to time: faucet/DUST wait, consolidation, bond, start~~ |

**Definition of done:** a Dealer Node instance holds a standing quote alive unattended across
multiple Offer File expiry cycles; a settled trade's disclosure note round-trips (attach → decrypt by
the intended party only) in a test script.

---

## M4 — Mainnet readiness

| # | Task | Status |
|---|---|---|
| 4.1 | Finalize `MIN_BOND` and `MIN_CHALLENGE_BOND` for real-value NIGHT | ⬜ |
| 4.2 | Confirm slashed-funds split (60/10/30) survives review at real value | ⬜ |
| 4.3 | Settlement asset set to USDM where applicable | ⬜ |
| 4.4 | Mainnet config for contract, relay node, and dealer node | ⬜ |
| 4.5 | **Document the Preprod → Mainnet DUST gap** in `ARCHITECTURE.md` (registration/generation) | ⬜ |
| 4.6 | Onboard real third-party Dealer Node operators outside the test environment | ⬜ |
| 4.7 | Security review of the slashing path before real value is at risk | ⬜ |

**Definition of done:** contract and both node types run against Mainnet config, and
`docs/ARCHITECTURE.md` documents the gap between Preprod test funds and Mainnet's real
DUST-generation/registration process.

---

## Decisions made

| Decision | Value | Where |
|---|---|---|
| Bond asset | tNIGHT (Preprod) → NIGHT (Mainnet) | `CONTRACTS.md` |
| Slashed-funds split | 60% wronged taker / 10% fraud prover / 30% burned | `CONTRACTS.md` §2 |
| Full vs. partial slash | Full bond, dealer deactivated | `CONTRACTS.md` §5.3 |
| Disclosure at M3 | Named recipient (`0x0001`) only; others deferred, field reserved | `DISCLOSURE.md` |
| First pair | tNIGHT/USDM, generic pair encoding | `CONTRACTS.md` |
| Class-B fraud detection | Optimistic challenge + taker challenge bond | `ARCHITECTURE.md` |
| **Bond sizing** | Per-quote notional cap, `k = 20` (bond >= 5% of notional). No flat `MIN_BOND` floor | `CONTRACTS.md` §7 |
| **`commitQuote` may see quote size** | Yes. Not a new leak: RFQ gossip already publishes `size` and `rfqId` is already on-chain, so size is already derivable. Price stays sealed | `CONTRACTS.md` §7 |
| **`MIN_CHALLENGE_BOND`** | `max(floor, 2% of notional)`. Corrects `FRONTEND.md`'s 25%-of-notional example | `CONTRACTS.md` §7a |
| **Taker CAN settle unilaterally from a pre-proved Offer File** | **Yes — demonstrated on-chain.** See the finding below; it changes what Class B is *for* | `ROADMAP.md` (this file), `offers.ts` |
| **Class B** | **Removed (owner, 2026-09-14)** after the research below. Contract is 9 circuits; `recordSettlement(quoteId)`; no challenge bonds; task 3.5 and `DEALER-NODE.md` §6 dropped. Residual risk (dealer spends the offer's inputs first) is handled by immediate settlement, an input pre-check and publicly verifiable failure evidence, and disclosed in `GRANT.md` risk 3 | `OTCProtocol.compact`, `ARCHITECTURE.md`, `GRANT.md` |
| **Web client scope** (owner, 2026-09-15) | Build all pages now, not gated on Phase 0; no hosted backend; live data only in the UI; contract circuits run from the browser wallet | `FRONTEND.md`, `client/` |
| **Dealer key custody in the browser** (owner, 2026-09-15) | Encrypted in IndexedDB under a passphrase (PBKDF2-SHA256 600k, AES-GCM) with the quote journal; every action blocked until a backup is confirmed | `client/src/features/desk` |
| **`/me` history key source** (owner, 2026-09-15) | Passphrase (same vault), not a wallet signature | `client/src/lib/crypto-store.ts` |
| **Trade notifications** (owner, 2026-09-16) | One notification centre (transaction tray merged in); quote actions open Compare with the quote selected, never settle directly; in-app only, no OS notifications | `FRONTEND.md` "Notifications", `client/src/features/trade/notify.ts` |

## Decisions still open

| Question | Needed by | Notes |
|---|---|---|
| Binding `recordSettlement` to a Zswap tx hash | Post-M4 | Closes the self-attested settled-counter gap (`CONTRACTS.md` §5.2) |
| ~~**What Class B is still for, given unilateral settlement works**~~ **DECIDED 2026-09-14: removed** (see "Decisions made") | M2/M3 | **The underlying question is ANSWERED — see the finding below.** What is now open is the consequence: how much of `openSettlementChallenge` / `submitFraudProofTimeout` / challenge bonds / `DEALER-NODE.md` §6 survives, and whether the remaining failure mode ("dealer spent that inventory elsewhere first") is better handled by challenges or by something cheaper. **Not decided here** — it touches `ARCHITECTURE.md`, `CONTRACTS.md` and `DEALER-NODE.md`, and is the owner's call. Surfaced 2026-09-12 |
| ~~Second asset for a genuine two-token settlement~~ | — | **Closed 2026-09-13.** Option (b) was taken (`TestToken.compact`), and a two-asset settlement has now landed on-chain (S5). Real USDM on Preview remains untested because the wallet holds none; bridging it needs a human |
| **Should an under-declared `notional` be slashable?** | M3 | `commitQuote` cannot tie the declared notional to the hidden sealed size. It is caught client-side today (`verifyReveal`, `verifyQuoteRef`). A signed reveal that opens the commitment but whose size ≠ on-chain notional is objectively provable, so `submitFraudProofMismatch` *could* slash it. That changes the slashing rule. **Surfaced 2026-09-13, not decided** (`CONTRACTS.md` §7) |
| **Challenge-bond floor amount** | M4 (4.1) | The formula `max(floor, 2%)` is implemented; the floor is 1 base unit (inert) on testnet. Also depends on the Class-B decision above |
| Sybil-resistant relay discovery | Post-M4 | `peer_announce` is spammable; stake-weighting would reintroduce permissioning |
| Pairs beyond tNIGHT/USDM | M4 | Encoding is generic; adding pairs should be config only |
| **`recordSettlement` without a `challengeId` while a challenge is open** | M2 | Resolves the quote but leaves the challenge open, so a timeout proof can still slash a dealer who genuinely settled. The Dealer Node must always pass the `challengeId` (`DEALER-NODE.md` §6). A contract-side fix needs challenge-by-quote lookup, which the current `Map` keying can't express — surfaced 2026-08-28 |
| **`attachDisclosureNote` accepts a note on a quote that never SETTLED** | M3 (3.7) | Its guard is `quotes.lookup(tid).resolved`, and `resolved` is also set by `releaseExpiredQuote` (expired, untraded) and by both fraud proofs (slashed). So a note can be attached to a quote that was released or slashed. `DISCLOSURE.md`'s claim "provably tied to one specific **settled** trade" is therefore stronger than the contract: the chain proves "tied to one resolved quote". Closing it needs a distinct settled flag (e.g. a `Quote.settled` field set only by `recordSettlement`), which is a contract change and still dealer-attested (§5.2). Found while writing `e2e-lifecycle` (A6), 2026-09-14. **Surfaced, not decided** |
| ~~**The taker never checks that the Offer File delivers the revealed terms**~~ **Fixed in the SDK 2026-09-14 (B3/B4)** | M3 | Found designing the warm pool's pricing. `verifyReveal` proves the terms open the commitment and are signed; nothing compared the Offer File's balance vector to those terms, so a dealer could reveal honest terms with an Offer File paying less, and the taker's settlement executes the **offer**, not the terms. Class A cannot catch it (terms and commitment agree). Fix: `counterAmountFor` (canonical rounding, against the dealer) + `offerMatchesTerms` in `offers.ts`, called by every taker flow before settling. Whether such a reveal should be **slashable** is a contract question (the signed reveal commits to terms, not the offer bytes, by design — `zswap-offer-files` SKILL §6). **Surfaced, not decided** |
| **Slash arithmetic overflow (D7)** | M4 (4.1) | `b.amount * 6000` can overflow `Uint<128>` for absurd bond sizes. Unreachable at realistic values; settle alongside `MIN_BOND` |
| **Fraud proofs have no upper time bound** | M2 | `submitFraudProofMismatch` can be submitted arbitrarily late while a quote stays unresolved. `releaseExpiredQuote` lets a dealer close their own window after `PROOF_GRACE_PERIOD`, which bounds it in practice, but nothing forces it |
| `TIME_SLACK` (300s) for caller-supplied `now` in `requestBondWithdrawal`/`openSettlementChallenge` | M1 (surfaced) | Not pre-approved — needed because Compact can't read block time as a value, only compare against it. A caller-supplied, chain-bounded `now` was the only viable design found; 300s is a placeholder guess, not tuned |
| **Where published failure evidence lives** | M2 | The taker can save evidence (signed reveal + Offer File) and anyone can check it on `/verify`, but nothing publishes it, so every dealer's "failures" renders unknown. Needs a destination that doesn't make a relay or server a trusted source |
| **Dealer Node status endpoint** | M3 | `/desk` shows only chain facts; warm offers, coins ready and answered RFQs need a local read-only endpoint on the node. Not built |
| **Mailbox read is destructive** | M2 | `Mailbox.take()` deletes on read; the client persists reveals first. A reload between fetch and persist loses them. Changing it is a wire change |
| **Browser quoting via `makeIntent`** | M2 (2.7) | The DApp Connector's only swap-building call. If a wallet returns an unproven or unbound intent, browser quoting can't produce an Offer File a taker can settle, and 2.7 falls back to the Dealer Node |
| **Dealer keys are stored per network** | M4 | The vault lives in the network's storage namespace, so a key used on Preprod and Preview is set up twice. Harmless on testnets; decide before Mainnet |

---

## Finding: the taker CAN settle unilaterally (2026-09-12)

The question this roadmap said would be "answered by building `offers.ts`, not by further design
discussion" has been answered by building `offers.ts`. **Yes. The taker settles alone.**

The mechanism, verified on-chain:

1. The dealer builds a half via `facade.initSwap`, **signs it, proves it and binds it**
   (`signRecipe` → `finalizeRecipe`) before ever quoting. The result is a `FinalizedTransaction`:
   inert, serializable bytes — 728 base64 characters for the settled offer.
2. Those bytes ride inside the encrypted point-to-point reveal and reach exactly one taker.
3. The taker calls `facade.balanceFinalizedTransaction(dealerHalf, takerKeys, { ttl })`. The
   dealer's half already states exactly what it is short of, so the taker's wallet covers that
   shortfall from its own coins and routes the dealer's surplus to itself. **No counter-half is
   negotiated and the dealer takes no further action.**
4. `signRecipe` on a `FINALIZED_TRANSACTION` recipe signs only the *balancing* transaction and
   leaves the dealer's proved half untouched — so the taker never needs, and never gets, the
   dealer's keys.

**What this means for Class B.** Class B exists for "dealer silently fails to honor a live quote."
If the taker holds a complete, pre-proved, bound half, the dealer *cannot* stall: there is nothing
left for the dealer to do. The residual failure is narrower and different in kind — **the dealer
spent that inventory elsewhere first**, so the offer's inputs are already consumed and the
settlement simply fails. That is not "refusing to honor a quote"; it is double-spending one's own
warm-pool inventory, and it is detectable by the taker immediately rather than after a timeout.

This is exactly the reason Hashflow's RFQ model needs no bonds. It does **not** make our bonds
pointless — Class A (commitment mismatch) is untouched, and the double-spend case still wrongs a
taker who relied on a live quote — but it does mean `openSettlementChallenge`,
`submitFraudProofTimeout`, challenge bonds and `DEALER-NODE.md` §6 are now solving a materially
smaller problem than the design assumed. **Surfaced, not decided** (see "Decisions still open").

Two honest caveats on the demonstration: it ran with one wallet playing both roles, and with a
one-asset offer. Neither affects the mechanism above — the balancing draws on the caller's own coins
and signs only the caller's own half either way — but neither has been run with two distinct wallets
or two distinct assets. See task 2.6's limits.

---

## Research: what Class B is still for (2026-09-14) — RECOMMENDATION, not a decision

The owner asked for research before deciding §"What Class B is still for". Findings, in order of weight:

**1. The current challenge can be dismissed without settling.** `recordSettlement(quoteId, some(challengeId),
recipient)` checks only that the caller owns the quote, the quote is unresolved, and the challenge
matches it (`OTCProtocol.compact`). It never checks that a settlement happened — it cannot, the contract
does not see Zswap (§5.2). So a dealer who double-spent the offer's inputs answers the challenge with
one transaction, collects the taker's challenge bond, and is never slashed. **Class B as built does
not punish the one failure unilateral settlement leaves open.** What it still does is slash a dealer
who fails to answer within 600 s — an honest dealer during a chain stall (Preprod has stalled
10+ min), or one who calls `recordSettlement` without the `challengeId` (open item above).

**2. The residual failure is real and gets exploited.** A dealer who keeps the offer's coins spendable
holds a free option for the reveal→settlement window (~20–60 s measured): if the market moves, spend
the inputs first and the taker's settlement fails. That is last-look by another name. The one large
public measurement of exactly this pattern — Polymarket, where off-chain-matched orders settle later
on-chain — found 1.95 M reverted settlements over Aug 2025–May 2026, **50.2% deliberate**, including
"balance drain" front-running and "cancel the losing positions after the outcome is known", with
≥$1.49 M realised attacker profit. What fixed most of it was **escrow** (a platform deposit wallet cut
daily reverts from ~8% to 0.3%), not reputation (arXiv 2606.16852).

**3. Nobody bonds this away.** Hashflow's makers may custody funds outside the pool and a quote then
fails on-chain if balance or allowance is gone; Hashflow handles it with an **allowlist** and
off-chain penalties (docs.hashflow.com). 0x RFQ lets makers cancel on-chain and treats balance/allowance
griefing as "difficult to defend against". Both lean on permissioning, which this protocol rejects.

**4. There is no known on-chain proof of "spent elsewhere".** No Compact primitive observed (compiler
0.30.0 toolchain notes, stdlib as used here) lets a circuit query unshielded UTXO or nullifier state,
so "these inputs were spent by another transaction before `validUntil`" cannot be checked in a
circuit today. Not proven impossible — not found.

**Options, re-evaluated:**

| Option | Stops the double-spend option? | Cost | Constitution fit |
|---|---|---|---|
| (a) Keep challenges | **No** (finding 1) | Node challenge loop, UTXO reserve, honest-dealer liveness slashing | Fits, but protects nothing it claims |
| (a′) Keep, but make the response require proof of settlement | Only if a circuit can verify a Zswap settlement — same blocker as (b) | Contract change | Fits |
| (b) Spent-inputs fraud proof | Yes, if buildable | Blocked on finding 4 | Fits |
| (c) Remove Class B | No (but neither does (a)) | Contract/SDK/docs deletion; residual risk disclosed in GRANT.md | Fits |
| (d) Escrowed quotes: dealer locks the inventory in the contract, taker fills through a circuit | **Yes** — the Polymarket fix | Settlement moves into the contract and the executed amounts become public | **Conflicts** with "Zswap settles, don't reimplement settlement" and with price privacy at settlement |

**Recommendation: (c), plus off-chain accountability, with (b) kept as a research item.**
- Remove `openSettlementChallenge`, `submitFraudProofTimeout`, challenge bonds, the floor, `DEALER-NODE.md`
  §6 and task 3.5. They cannot slash a cheating dealer (finding 1), but they can slash an honest one.
- Taker client: settle immediately on a verified reveal, and check the offer's inputs are still
  unspent (indexer) right before submitting.
- **Publicly checkable failure evidence, no identity:** a failed taker publishes the dealer-signed reveal plus
  the Offer File. Anyone can verify the signature under the on-chain `quotePk`, read the offer's inputs,
  and check on the indexer that those inputs were spent in a different transaction before `validUntil`.
  Clients fold that into the dealer's track record beside settled/slashed. This is reputation, which is weaker than slashing, and GRANT.md must say so.
- Binding `recordSettlement` to a Zswap tx hash (post-M4) makes the settled counter mean something, and is
  the piece that would also unlock (a′) if a circuit can ever verify it.

**Owner decision still required.** Until it is made, M3 builds 3.1–3.4, 3.6 and 3.7 and does not build 3.5.

Sources: [arXiv 2606.16852 — Ghost Fills on Polymarket](https://arxiv.org/html/2606.16852v1) ·
[Hashflow market-making docs](https://docs.hashflow.com/hashflow/market-making/getting-started-api-v3) ·
[0x Protocol 4.1 docs](https://docs.0xprotocol.org/en/latest/basics/functions.html) ·
[Midnight ledger concepts](https://docs.midnight.network/concepts/ledgers)

---

## The mainnet second asset

`contracts/src/TestToken.compact` is **testnet scaffolding and must never reach Mainnet.**
`scripts/deploy-test-token.ts` hard-refuses `MN_NETWORK=mainnet`, and the `tNIGHT/TESTUSD` entry in
`packages/sdk/src/terms.ts` is marked Preprod-only. Deleting the *use* is not enough; the
deployment must not exist.

**The good news, and it is the reason the test token was worth building:** nothing in the
settlement path knows what it is trading. `SwapLeg.token` is a bare `RawTokenType`, `offers.ts`
never names an asset, and the balance-vector check is per-token arithmetic. The TESTUSD run pushed a
**non-native, contract-derived token type** through construction, proving, binding, the encrypted
reveal, `balanceFinalizedTransaction` and submission without a single line of asset-specific code.
So Mainnet's second leg is **a token type in config**, not a rewrite.

What actually has to happen for M4 (task 4.3):

1. **Obtain the real asset's `RawTokenType` on Mainnet** and put it in config beside the pair code.
2. **Add the Mainnet pair code** to `PAIR_CODES` and remove `tNIGHT/TESTUSD`.
3. **Re-run the equivalent of `e2e-settle`** against it. Nothing here is proven for Mainnet.

### USDM is real, and the pair assumption checks out (verified 2026-09-13)

The Pass 1 assumption that this protocol's first pair is tNIGHT/USDM was inherited, never checked.
**It is now checked, and it holds** — better than expected:

- **USDM is Cardano's fiat-backed stablecoin**, issued by **Moneta Digital** (formerly Mehen
  Finance), a US-regulated MSB, FinCEN-registered and MiCA-compliant, backed 1:1 by USD deposits
  and money-market funds.
- **It is live on Midnight**, moving natively between Cardano and Midnight over a VIA Labs
  lock-and-mint bridge — not a wrapper asset.
- **On Midnight it is an UNSHIELDED LEDGER TOKEN**, not a contract-internal balance map. An
  independent developer write-up pays with it via a "native unshielded USDM transfer via
  `wallet.transferTransaction`", and deliberately keeps it out of contract custody ("unshielded
  token custody inside a contract buys nothing here and costs a lot of circuit complexity").
  **That is exactly the shape `TestToken.compact` mints**, which is what makes TESTUSD a faithful
  stand-in rather than a convenient fiction — and it means the settlement path already built is the
  right one for the real asset.

Identifiers (Midnight mainnet):

```
USDM token color (RawTokenType)  8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b
USDM gateway contract            65023744190a4fc7c8ac9a3dfbc8cfc28f63d2aaa431ceda1d88fdb9a096a6a1
decimals                         6
```

**"Token color" is Zswap's word for a token type** — the same 64-hex `RawTokenType` that
`SwapLeg.token` takes. The Mainnet second leg really is one config value.

**USDM uses 6 decimals, matching `terms.ts`'s `PRICE_DECIMALS`/`SIZE_DECIMALS`, and tNIGHT's Star is
1e6 too.** So the hardcoded-decimals concern does not bite for this pair. It stays a latent bug for
any future pair whose legs disagree — decimals are a per-asset property treated as a global
constant — but it does not block tNIGHT/USDM.

### The network trap: Midnight PREPROD is not a USDM network

**This repo runs on Midnight Preprod. USDM is not there.** The bridge supports two pairings, and
the naming collides in the worst possible way:

| Pairing | Cardano side | **Midnight side** | USDM token color |
|---|---|---|---|
| testnet | **Preprod** | **Preview** | `003bacd9a361ba0d425e408776020e40271375e8b8de42d73eec046a44947d73` |
| mainnet | Mainnet | mainnet | `8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b` |

"Preprod" is the **Cardano** side of the testnet pairing; the **Midnight** side is **Preview**.
Reading "Preprod" and assuming it means our network is the obvious mistake, and it would surface
only after wiring a token type that does not exist on the chain we are on.

Consequences:

- **TestToken stays necessary** — it is the only way to get a second asset on Midnight Preprod,
  where the contract, the funded wallet and every script currently live.
- **Testing against real USDM means moving to Midnight Preview**: redeploy `OTCProtocol`, fund from
  the Preview faucet, bridge tUSDM from Cardano Preprod, resync. Milestone-sized, not a config flip.
- **It would not dodge S5.** USDM on Preview is an unshielded ledger token exactly like TESTUSD, so
  a two-asset settlement there has the same shape now being rejected with `168`. Moving networks
  buys a *real* asset, not a fix.

### Still open

- ~~**The shielded leg is unexercised.**~~ **Measured 2026-09-13** (task 2.8 above): a shielded offer
  proves in ~3.1 s steady state, 6.4 s cold, and the proof server does not parallelise. Settling a
  shielded offer on-chain is still unexercised.

---

## Notes for future sessions

- **The MidSwap reference project is not present on this machine.** Deploy-script and
  witness-provider patterns are drawn from the bundled Midnight skills (`example-locker-dapp`,
  `midnight-js`, `example-zk-loan-application`) instead. If MidSwap becomes available, revisit
  `.claude/skills/midnight-deployment/SKILL.md`.
- **Drift alarm:** if the build starts pulling matching or price-comparison logic into Compact, stop
  and flag it. That is drift from the spec, not an optimization.
- **Compilation is not verification.** Six defects — including two that made the protocol
  non-functional — compiled cleanly and passed `tsc --noEmit`. Run circuits through the
  `compact-runtime` simulator (`contracts/test/harness.ts`) before believing anything about them.
  `pnpm test` needs no wallet, proof server or network.
- Update `.claude/skills/*/SKILL.md` **in place** whenever contract work reveals a Compact constraint
  those files do not capture.
