# Roadmap & Status

> **Re-read this file at the start of every session before doing any work.**
> It is the live record of what is done, what is in progress, and what decisions are still open.

**Last updated:** 2026-09-12 — **M1 is complete on Preprod.** The contract is deployed, verified by
indexer read-back, and `pnpm run e2e-fraud` has executed the full fraud path on-chain: bond posted →
quote committed → deliberately mismatched reveal → fraud proof → **bond slashed to 0, dealer
deactivated, slashed counter 1, quote resolved**. Tasks 1.0–1.10 are all done, including 1.7 and the
on-chain half of 1.9, which had been blocked since 2026-08-27.

```
preprod  539d3ea689983058059137f4c6d0ee234ae29b585f7f222919a2013800ee2225
```

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
| **M2** | Relay node + minimal RFQ flow on Preprod | 🟡 2.1–2.3 built and tested in simulation (191 tests); 2.4–2.9 not started, blocked per scope below |
| **M3** | Dealer Node + disclosure | ⬜ Not started |
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
| 1.3 | Bonding circuits: `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` | ✅ `postBond` executed on Preprod; the other three still simulation-only |
| 1.4 | Quote circuits: `commitQuote`, `openSettlementChallenge`, `recordSettlement` | ✅ `commitQuote` executed on Preprod; challenge/settlement still simulation-only |
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
- `packages/sdk/src/offers.ts` (Zswap Offer File construction) is **still an intentional stub**, and
  is now the largest remaining piece of unwritten M1-adjacent code. The blocker it cited (no running
  proof server) is gone, so this can and should be built for real — it gates 2.6 settlement. Building
  it blind against types alone was judged too likely to be silently wrong for something this
  security-sensitive (a malformed Offer File either fails safely or, worse, appears to work until
  settlement). Flagged rather than guessed.

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
| 2.4 | Multi-relay aggregation in SDK, with chain verification of every reference | ⬜ Not started — blocked on a live indexer per CLAUDE.md scope note |
| 2.5 | Frontend: Screen 1 (RFQ), Screen 2 (sealed bids), Screen 3 (comparison) | ⬜ Not started — blocked on a wallet |
| 2.6 | Zswap settlement path from the taker's selection | ⬜ |
| 2.7 | Frontend: Screen 5 (manual dealer commit/reveal) | ⬜ |
| 2.8 | **Measure real proof-generation + commit latency on Preprod** | ⬜ |
| 2.9 | Decide `MIN_BOND` design: flat floor vs. per-quote notional cap (`CONTRACTS.md` §7) | ⬜ |

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

**Definition of done:** one full sealed-bid RFQ cycle — including at least two competing dealer
commitments — runs end to end on Preprod and is demoable.

Task 2.8 gates every performance claim in `GRANT.md`. Until it produces a number, no latency figure
goes in any external material.

---

## M3 — Dealer Node + disclosure

| # | Task | Status |
|---|---|---|
| 3.1 | `packages/dealer-node` skeleton, TOML config, key management | ⬜ |
| 3.2 | Warm-pool Offer File management + refresh loop (`DEALER-NODE.md` §5) | ⬜ |
| 3.3 | Crash-consistent quote journal (nonce persisted **pre**-commit) | ⬜ |
| 3.4 | Automated commit → reveal state machine | ⬜ |
| 3.5 | Challenge-response loop (`DEALER-NODE.md` §6) | ⬜ |
| 3.6 | Bond monitoring, `halt_on_slash`, risk caps | ⬜ |
| 3.7 | Disclosure: named-recipient shape (`0x0001`) attach + decrypt in SDK | ⬜ |
| 3.8 | Frontend: Screen 4 (settled trades feed) + disclosure note affordance | ⬜ |
| 3.9 | Disclosure test suite — **including the negative cases** (`DISCLOSURE.md` test plan 4, 5, 7) | ⬜ |
| 3.10 | Operator quickstart README; validate the 30-minute target with a fresh operator | ⬜ |

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

## Decisions still open

| Question | Needed by | Notes |
|---|---|---|
| Binding `recordSettlement` to a Zswap tx hash | Post-M4 | Closes the self-attested settled-counter gap (`CONTRACTS.md` §5.2) |
| **Does a pre-proved Offer File let the taker settle unilaterally?** | M2 (2.6) | If the dealer's reveal carries a complete, pre-proved half of the Zswap swap, the taker can settle without the dealer acting — and most of Class B (challenges, `submitFraudProofTimeout`, challenge bonds) becomes dead weight. Hashflow's RFQ needs no bonds at all for exactly this reason. What would remain is not "dealer stalls" but "dealer spent that inventory elsewhere first." **Answered by building `offers.ts`, not by further design discussion.** Surfaced 2026-09-12 |
| Sybil-resistant relay discovery | Post-M4 | `peer_announce` is spammable; stake-weighting would reintroduce permissioning |
| Pairs beyond tNIGHT/USDM | M4 | Encoding is generic; adding pairs should be config only |
| **`recordSettlement` without a `challengeId` while a challenge is open** | M2 | Resolves the quote but leaves the challenge open, so a timeout proof can still slash a dealer who genuinely settled. The Dealer Node must always pass the `challengeId` (`DEALER-NODE.md` §6). A contract-side fix needs challenge-by-quote lookup, which the current `Map` keying can't express — surfaced 2026-08-28 |
| **Slash arithmetic overflow (D7)** | M4 (4.1) | `b.amount * 6000` can overflow `Uint<128>` for absurd bond sizes. Unreachable at realistic values; settle alongside `MIN_BOND` |
| **Fraud proofs have no upper time bound** | M2 | `submitFraudProofMismatch` can be submitted arbitrarily late while a quote stays unresolved. `releaseExpiredQuote` lets a dealer close their own window after `PROOF_GRACE_PERIOD`, which bounds it in practice, but nothing forces it |
| `TIME_SLACK` (300s) for caller-supplied `now` in `requestBondWithdrawal`/`openSettlementChallenge` | M1 (surfaced) | Not pre-approved — needed because Compact can't read block time as a value, only compare against it. A caller-supplied, chain-bounded `now` was the only viable design found; 300s is a placeholder guess, not tuned |

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
