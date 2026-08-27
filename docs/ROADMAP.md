# Roadmap & Status

> **Re-read this file at the start of every session before doing any work.**
> It is the live record of what is done, what is in progress, and what decisions are still open.

**Last updated:** 2026-08-28 — M1 tasks 1.0–1.6, 1.8, and 1.10 complete; 1.7/1.9 code-complete and
fully typechecked but blocked on execution (funded Preprod wallet + local proof server — see M1
section below).

---

## Status

| Milestone | Scope | Status |
|---|---|---|
| **Pass 1** | Planning artifacts: `docs/`, `CLAUDE.md`, `.claude/skills/` | ✅ **Complete** |
| **M1** | Core protocol contract on Preprod | 🟡 Contract + SDK + scripts code-complete and typechecked; execution blocked on funded wallet + proof server |
| **M2** | Relay node + minimal RFQ flow on Preprod | ⬜ Not started |
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
| 1.1 | Toolchain: Compact compiler, Docker proof server, pnpm + Turborepo skeleton | ✅ pnpm/turbo skeleton in place; Docker proof server not yet started (needed for 1.7+) |
| 1.2 | Ledger + structs + domain-separated derivations | ✅ `contracts/src/OTCProtocol.compact` |
| 1.3 | Bonding circuits: `postBond`, `topUpBond`, `requestBondWithdrawal`, `withdrawBond` | ✅ Compiles; not yet run against live Preprod |
| 1.4 | Quote circuits: `commitQuote`, `openSettlementChallenge`, `recordSettlement` | ✅ Compiles; not yet run against live Preprod |
| 1.5 | Fraud circuits: `submitFraudProofMismatch`, `submitFraudProofTimeout`, `slashBond` | ✅ Compiles; not yet run against live Preprod |
| 1.6 | `attachDisclosureNote` (contract side only; client flow is M3) | ✅ Compiles |
| 1.7 | Deploy + init scripts, Preprod config, faucet funding | 🟡 Code-complete, typechecked (`scripts/deploy.ts`, `scripts/init.ts`, `scripts/fund.ts`) — **never executed**, blocked on a funded wallet |
| 1.8 | `packages/sdk` — bonding, quote commit/reveal, fraud proofs, Zswap offer helpers | ✅ Code-complete, fully typechecked against real installed packages — bonding/quotes/fraud verified; Zswap offer construction (`offers.ts`) is a documented stub pending a live proof server |
| 1.9 | Scripted E2E test: bond → commit → mismatched reveal → fraud proof → slash verified | 🟡 Script written (`scripts/e2e-fraud.ts`), typechecked — **never executed**, blocked on 1.7 |
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

**Two implementation findings not anticipated by `CONTRACTS.md`'s pseudocode** — both required for the
contract to compile at all, recorded here plus in the skill file (§4, §9):

1. **No `<now>` read inside a circuit.** Compact can only *compare* against block time
   (`blockTimeGte`), never read it as a value. `requestBondWithdrawal` and
   `openSettlementChallenge` now take a caller-supplied `now: Uint<64>` parameter, bound to within a
   300-second `TIME_SLACK` of actual chain time via a two-sided `blockTimeGte` check. **This is a new
   parameter not in the original circuit signatures in `CONTRACTS.md` §5.1/§5.2 — flagging for
   review**, not a silent decision.
2. **No division operator in Compact at all** (`/` is a parse error, confirmed against the compiler).
   `slashBond`'s 60/10/30 split now uses a witness (`computeSlashShares`) that supplies the
   pre-divided shares, verified in-circuit via multiplication and a tight two-sided inequality — the
   same range-checked-division technique the Schnorr fix required.

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
| 2.1 | `packages/relay-node` per `docs/RELAY.md`: envelope, validation, gossip, dedup, rate limits | ⬜ |
| 2.2 | `schema.ts` shared between relay-node and SDK | ⬜ |
| 2.3 | Point-to-point encrypted reveal channel (+ optional mailbox) | ⬜ |
| 2.4 | Multi-relay aggregation in SDK, with chain verification of every reference | ⬜ |
| 2.5 | Frontend: Screen 1 (RFQ), Screen 2 (sealed bids), Screen 3 (comparison) | ⬜ |
| 2.6 | Zswap settlement path from the taker's selection | ⬜ |
| 2.7 | Frontend: Screen 5 (manual dealer commit/reveal) | ⬜ |
| 2.8 | **Measure real proof-generation + commit latency on Preprod** | ⬜ |
| 2.9 | Decide `MIN_BOND` design: flat floor vs. per-quote notional cap (`CONTRACTS.md` §7) | ⬜ |

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
| `TIME_SLACK` (300s) for caller-supplied `now` in `requestBondWithdrawal`/`openSettlementChallenge` | M1 (surfaced) | Not pre-approved — needed because Compact can't read block time as a value, only compare against it. A caller-supplied, chain-bounded `now` was the only viable design found; 300s is a placeholder guess, not tuned |

---

## Notes for future sessions

- **The MidSwap reference project is not present on this machine.** Deploy-script and
  witness-provider patterns are drawn from the bundled Midnight skills (`example-locker-dapp`,
  `midnight-js`, `example-zk-loan-application`) instead. If MidSwap becomes available, revisit
  `.claude/skills/midnight-deployment/SKILL.md`.
- **Drift alarm:** if the build starts pulling matching or price-comparison logic into Compact, stop
  and flag it. That is drift from the spec, not an optimization.
- Update `.claude/skills/*/SKILL.md` **in place** whenever contract work reveals a Compact constraint
  those files do not capture.
