# Midnight OTC Protocol

**Open protocol infrastructure, not a company's trading product.**

> ## ⚠️ Start every session by re-reading `docs/ROADMAP.md`
> It is the live record of milestone status, decisions made, and decisions still open.
> Do not start work without it. Re-read the relevant `docs/*.md` before each milestone,
> and update the ROADMAP status table after finishing one.

---

## The problem

Bilateral OTC trading has a structural integrity problem: **last-look abuse.** A dealer quotes a
price, then re-prices or refuses once the market moves against them, because nothing binds them to
the quote. TradFi fixes this with centralized clearing, legal contracts, and reputational
gatekeeping — all of which require the identity disclosure a privacy-preserving venue exists to
avoid.

Midnight makes another answer possible: **bind dealers to their quotes cryptographically and
economically, not legally.** Post a bond. Seal the quote as a commitment before revealing a price. If
the reveal doesn't match the commitment, or a dealer won't honor a live quote, anyone can submit a
fraud proof and slash the bond — automatically, permissionlessly, with no admin adjudicating and no
identity ever required.

---

## The three pillars

1. **Permissionless bonded dealer entry.** Post a bond, start quoting. No approval, no allowlist, no
   gatekeeper. Dealers exist on-chain only as a key commitment. Public settled/slash counters give
   takers a track record without anyone having vetted anybody. Bond withdrawal is timelocked so a
   dealer can't defect and exit before a fraud proof lands.

2. **Sealed commit-reveal quote auctions, with slashing.** Dealers post a hash commitment on-chain
   *before* revealing a price, then reveal point-to-point and encrypted to the taker only —
   never broadcast, so competitors can't copy or undercut. Two fraud classes:
   **Class A** (commitment mismatch) is objectively provable from a dealer-signed reveal and slashable
   by anyone. ~~**Class B** (silently failing to honor a live quote) leaves no on-chain trace, so a
   taker converts it into one via an on-chain settlement challenge with a bond; an unanswered
   challenge is slashable by anyone.~~ **Class B was removed (owner decision, 2026-09-14).** A
   taker holding the dealer's pre-proved Offer File settles alone, so a dealer cannot stall; the
   residual failure (the dealer spends the offer's inputs first) could not be punished by a
   challenge whose answer was self-attested. It is handled by immediate settlement, an input
   pre-check, and publicly verifiable failure evidence feeding the dealer's track record — see
   `docs/ROADMAP.md` "Research: what Class B is still for".

3. **Decentralized relay network + programmable disclosure.** The relay is a gossip *message format*
   anyone can run a node for — not our hosted backend. RFQs and commitment references gossip; priced
   reveals never enter the gossip layer at all. Disclosure is a generic
   `(ciphertextHash, policyTag)` primitive, not a hardcoded auditor key.

Plus: **the reference Dealer Node** (`packages/dealer-node`) ships as a first-class deliverable —
the cold-start problem answered in the architecture, not deferred to go-to-market.

---

## On-chain / off-chain split — do not deviate

| Responsibility | Where | Why |
|---|---|---|
| Bond posting/withdrawal, settlement & slash counters | **On-chain** (`OTCProtocol.compact`) | Public verifiability makes trust cryptoeconomic, not administrative |
| Sealed quote commitment hashes + validity windows | **On-chain** | Binds a dealer before reveal — the anti-last-look mechanism |
| Fraud proof submission and slashing | **On-chain** | Must be permissionlessly triggerable by anyone, no trusted arbitrator |
| Disclosure policy note attachment | **On-chain** | Must be provably tied to one specific settled trade |
| RFQ routing, quote-commitment gossip | **Off-chain** (relay network) | No shared private state exists between users on Midnight — not a design choice |
| Priced quote reveal (dealer → taker) | **Off-chain, point-to-point, encrypted** | Must not be visible to competing dealers or relay operators |
| Trade proof and settlement | **Zswap** (protocol primitive) | Reuse the audited atomic-swap primitive; don't reimplement settlement |
| Quote liveness / refresh before expiry | **Off-chain** (Dealer Node keeper) | Works around the ~1 h Offer File expiry |

---

## What this is NOT — do not build these

- **Not a whitelist/allowlist.** No admin approves dealers. No privileged key exists in the contract.
- **Not a CLOB.** Midnight has no shared private state, so hidden orders cannot be matched in a
  circuit. No matching engine.
- **Not an AMM.** No pool, no curve, no LP tokens.
- **Not a hosted API.** The relay is a protocol anyone can implement from `docs/RELAY.md`.

> **🚨 Drift alarm.** If the build starts pulling *matching* or *price-comparison* logic into
> Compact — **stop and flag it.** Price comparison happens in the taker's client, on revealed quotes,
> off-chain. The chain never sees a price it can compare.

---

## Repo layout

```
docs/                    Source of truth. Defer to these; update them if a build decision changes them.
contracts/               OTCProtocol.compact + managed compiler output
packages/sdk/            Bonding, quote commit/reveal, fraud proofs, Zswap offer construction
packages/relay-node/     Standalone gossip node — runnable by anyone
packages/dealer-node/    Reference dealer client — standing quotes, auto-refresh, commit→reveal
apps/web/                React 18 + Vite + TS + Tailwind + Zustand; Lace via DApp Connector API
.claude/skills/          Project skills — update IN PLACE when Compact reveals new constraints
```

**Tooling:** pnpm workspaces + Turborepo. Compact + local Docker proof server. Preprod first.

---

## Documentation map

| File | Contents |
|---|---|
| `docs/ROADMAP.md` | **Read first, every session.** Milestone status, open decisions |
| `docs/ARCHITECTURE.md` | Pillars, actors, split table, end-to-end + fraud flows, system diagram |
| `docs/CONTRACTS.md` | `OTCProtocol.compact` spec: ledger, circuits, slashing rule, non-goals |
| `docs/RELAY.md` | Normative gossip wire format and propagation rules |
| `docs/DEALER-NODE.md` | Reference dealer client: config, commit→reveal, refresh, challenges |
| `docs/DISCLOSURE.md` | Programmable disclosure primitive and policy shapes |
| `docs/FRONTEND.md` | UI spec (and the explicitly rejected order-book pattern) |
| `docs/GRANT.md` | Narrative, differentiation, honest risk statement |

---

## Settled decisions

- **Bond asset:** tNIGHT (Preprod) → NIGHT (Mainnet)
- **Slashing:** full bond, split 60% wronged taker / 10% fraud prover / 30% burned; dealer deactivated
- **Disclosure at M3:** named-recipient only; richer policies deferred, `policyTag` field reserved now
- **First pair:** tNIGHT/USDM with generic pair encoding

Open decisions are tracked in `docs/ROADMAP.md`. **Surface them; don't silently decide.**

---

## Working agreements

- Milestones run **in order**, and **stop for the owner's confirmation** before starting the next.
- Update `docs/ROADMAP.md`'s status table after finishing each milestone.
- Update `.claude/skills/*/SKILL.md` **in place** when contract work reveals a Compact constraint they
  don't capture.
- The `docs/` files are the source of truth. If a build decision contradicts one, **update the doc** —
  don't let code and spec drift.
- **The MidSwap reference project is not on this machine.** Deploy-script and witness-provider
  patterns come from the bundled Midnight skills instead.
