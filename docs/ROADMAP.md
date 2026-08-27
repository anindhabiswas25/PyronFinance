# Roadmap & Status

> **Re-read this file at the start of every session before doing any work.**
> It is the live record of what is done, what is in progress, and what decisions are still open.

**Last updated:** 2026-08-28 — M2.1–2.3 (relay node, shared schema, encrypted reveal channel) built
and tested in simulation (191 tests total: 122 from M1 + 69 new). Stopped for confirmation before
2.4/2.5 per scope. M1 status below is unchanged from the prior session: contract **executed and
tested in simulation** (122 tests). Six defects found and fixed, two of which made the protocol
non-functional. Tasks 1.0–1.6, 1.8, 1.10 complete; 1.9 complete in simulation; 1.7 and on-chain 1.9
remain blocked on a funded Preprod wallet + local proof server.

---

## Status

| Milestone | Scope | Status |
|---|---|---|
| **Pass 1** | Planning artifacts: `docs/`, `CLAUDE.md`, `.claude/skills/` | ✅ **Complete** |
| **M1** | Core protocol contract on Preprod | 🟡 Contract executed & tested in simulation (122 tests, 11 circuits); on-chain deploy blocked on funded wallet + proof server |
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
| 1.1 | Toolchain: Compact compiler, Docker proof server, pnpm + Turborepo skeleton | ✅ pnpm + turbo (now actually installed — `turbo.json` was previously dead config) + vitest + root tsconfig; Docker proof server not started (needed for 1.7+) |
| 1.2 | Ledger + structs + domain-separated derivations | ✅ `contracts/src/OTCProtocol.compact` |
| 1.3 | Bonding circuits: `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` | ✅ Compiles; not yet run against live Preprod |
| 1.4 | Quote circuits: `commitQuote`, `openSettlementChallenge`, `recordSettlement` | ✅ Compiles; not yet run against live Preprod |
| 1.5 | Fraud circuits: `submitFraudProofMismatch`, `submitFraudProofTimeout`, `slashBond` | ✅ Compiles; not yet run against live Preprod |
| 1.6 | `attachDisclosureNote` (contract side only; client flow is M3) | ✅ Compiles |
| 1.7 | Deploy + init scripts, Preprod config, faucet funding | 🟡 Code-complete, typechecked (`scripts/deploy.ts`, `scripts/init.ts`, `scripts/fund.ts`) — **never executed**, blocked on a funded wallet |
| 1.8 | `packages/sdk` — bonding, quote commit/reveal, fraud proofs, Zswap offer helpers | ✅ Code-complete, fully typechecked against real installed packages — bonding/quotes/fraud verified; Zswap offer construction (`offers.ts`) is a documented stub pending a live proof server |
| 1.9 | Scripted E2E test: bond → commit → mismatched reveal → fraud proof → slash verified | ✅ **In simulation** (`contracts/test/fraud.test.ts`) incl. negative cases; on-chain run still blocked on 1.7 |
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
- **None of the wallet/deploy/transaction-submission path has been executed once.** Everything from
  `createHeadlessWallet` onward — wallet sync, balancing, proving, submission — is verified only by
  reading the installed `.d.ts` files and getting the types to line up, not by running it. A live run
  against a funded wallet and a running proof server could still surface real bugs the type system
  can't catch (e.g. runtime behavior of `WalletFacade.init`'s factory functions, whether the
  `signTransactionIntents` bug-workaround from the skill still applies to this version).
- `packages/sdk/src/offers.ts` (Zswap Offer File construction) is an intentional stub — the exact
  ledger-v8 offer-construction call sequence needs a running proof server to pin down safely; building
  it blind against types alone was judged too likely to be silently wrong for something this
  security-sensitive (a malformed Offer File either fails safely or, worse, appears to work until
  settlement). Flagged rather than guessed.

**Blocked on network access:** 1.7 and 1.9 need a funded Preprod wallet seed (the Preprod faucet
hit its 24h rate limit on 2026-08-27) and a running local proof server
(`docker run -p 6300:6300 midnightnetwork/proof-server`), neither available in this environment.
Not fabricating credentials or skipping this — flagging it for the owner. Once both exist:
`pnpm generate-seed` → fund the printed address → `pnpm deploy` → `pnpm init` → `pnpm e2e-fraud`.

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

## Decisions still open

| Question | Needed by | Notes |
|---|---|---|
| `MIN_BOND` sizing and design | M2 (2.9) | Flat floor vs. per-quote notional cap; the cap leaks quote size |
| `MIN_CHALLENGE_BOND` | M2 | Must price griefing without excluding small takers |
| Whether `commitQuote` may see quote size | M2 (2.9) | Required by the notional-cap design; a real privacy tradeoff |
| Binding `recordSettlement` to a Zswap tx hash | Post-M4 | Closes the self-attested settled-counter gap (`CONTRACTS.md` §5.2) |
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
