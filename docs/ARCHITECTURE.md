# Midnight OTC Protocol — Architecture

## The problem: last-look abuse

Bilateral OTC trading has a structural integrity problem that predates crypto: **last-look abuse**.

A dealer quotes a price. In the window between quoting and settlement, the dealer can re-price or
simply refuse the trade once they see the market has moved against them — because nothing binds them
to their quote. The taker bears all the optionality cost and has no recourse.

Traditional finance solves this with centralized clearing, legal contracts, and reputational
gatekeeping. Every one of those solutions requires **identity disclosure and institutional trust
relationships** — which is exactly what a privacy-preserving venue is supposed to make unnecessary.

Midnight makes a different solution possible: **bind dealers to their quotes cryptographically and
economically, not legally.**

- A dealer posts a bond.
- A quote is a sealed commitment before it is a revealed price.
- If the revealed offer does not match the commitment, or a dealer fails to honor a live sealed
  quote, **anyone** can submit a fraud proof and slash the bond — automatically, permissionlessly,
  with no admin adjudicating and no identity ever required.
- Reputation accrues to a **pseudonymous dealer key**, not a KYC'd legal entity.

That is the product: *a private OTC venue where integrity is enforced by cryptography and stake,
rather than by gatekeeping.* Everything in this document serves that single claim.

---

## What this explicitly is NOT

These are not omissions or future work. They are design exclusions. Building any of them is drift.

| Not this | Why not |
|---|---|
| **A whitelist / allowlist system** | No admin approves dealers. Entry is permissionless: post a bond, start quoting. Trust comes from bond size and on-chain settlement/slash history, not from someone's approval. |
| **A central limit order book** | Midnight has no shared private state across users. Each participant's private state lives only on their own machine, connected to public state via ZK proofs. There is **no way to match hidden orders inside a circuit.** This is a protocol fact, not a preference. |
| **An AMM** | No pool, no bonding curve, no LP tokens. There is a dealer counterparty on the other side of every trade, and that is the entire point. |
| **A single company's hosted API** | The relay is a protocol-level message format anyone can run a node for — not a proprietary backend this repo's operator controls. |

> **Drift alarm.** If the build ever starts pulling *matching* or *price-comparison* logic into a
> Compact circuit, stop and flag it. Price comparison happens in the taker's client, on revealed
> quotes, off-chain. The chain never sees a price it can compare.

---

## Actors

| Actor | Runs | Holds | Identified on-chain by |
|---|---|---|---|
| **Dealer** | `packages/dealer-node` (or a manual client) | A posted bond; a dealer signing key | A dealer commitment derived from their secret key. Never a real-world identity. |
| **Taker** | The web client (`client/`) | Funds to trade; optionally a challenge bond | Nothing persistent. Takers are ephemeral by default. |
| **Relay Node Operator** | `packages/relay-node` | Nothing at stake | Not on-chain at all. Relays hold no funds and have no privileged role. |
| **Fraud Prover / Watchdog** | Any client with the SDK | Nothing at stake | Not on-chain. Anyone can be one. Paid out of the slashed bond. |

**These roles are not exclusive.** A dealer will typically run both a Dealer Node and a Relay Node —
running your own relay means you see RFQs first and depend on nobody for routing. A taker's client
acts as a watchdog for its own trades as a matter of course. The protocol assumes overlap and does
not require separation of these roles for its security.

---

## The three pillars

### Pillar 1 — Permissionless bonded dealer entry

Anyone becomes a dealer by posting a bond via an on-chain circuit. There is no approval step and no
gatekeeper.

- The dealer is identified on-chain **only** by a commitment derived from a secret key they hold
  locally. No identity, no registration, no allowlist.
- A public on-chain counter tracks each dealer commitment's **settled-trade count** and
  **slashed-bond count**. Takers gauge trustworthiness from bond size plus visible track record,
  without anyone having vetted the dealer.
- **Bond withdrawal is timelocked.** A dealer cannot quote fraudulently and withdraw before a fraud
  proof can land. The timelock must strictly exceed the maximum quote validity window plus the
  settlement challenge window — see `CONTRACTS.md` for the exact inequality.

The trust model here is worth stating precisely: takers are not trusting the dealer's honesty. They
are observing that the dealer has more capital at risk than they could gain by defecting on this
trade. That is a checkable arithmetic claim, not a reputational judgment.

### Pillar 2 — Sealed commit-reveal quote auctions, with slashing

When a taker's RFQ goes out, responding dealers **do not broadcast their price in the clear.**
Broadcasting lets competing dealers copy or undercut each other's quotes — which is its own form of
market abuse, and it drives real liquidity away from the venue.

Instead:

1. A dealer computes their real quote (a Zswap Offer File).
2. The dealer posts a **hash commitment** of it on-chain, bound to their dealer commitment and a
   validity window. This is public — everyone sees *that* a dealer quoted, and until when. Nobody
   sees *what*.
3. Only *after* committing does the dealer reveal the actual priced offer to the taker directly —
   point-to-point, off-chain, encrypted to the taker. Never broadcast to other dealers, never to
   relay operators.
4. The taker compares revealed prices across however many dealers responded and picks one to settle.

The commitment must be a **`persistentCommit` with a fresh high-entropy nonce**, never a bare hash.
Prices are a low-cardinality value space; a bare hash of a price is brute-forcible in milliseconds
and would leak every quote to any observer. See `.claude/skills/commit-reveal-schemes/SKILL.md`.

Two distinct classes of fraud can then be proven. They are **not** symmetric, and conflating them is
the most likely way to design this wrong:

**Class A — Commitment mismatch (objectively provable).**
The dealer reveals terms that do not match what they committed to. Because the reveal is *signed by
the dealer's key*, a taker holding a signed reveal whose hash differs from the on-chain commitment
holds a self-contained, non-repudiable proof of fraud. Anyone can submit it. The circuit verifies the
signature and the hash inequality and slashes. No interpretation, no arbitration, no trust.

**~~Class B — Failure to honor a live quote (not directly observable on-chain).~~ REMOVED 2026-09-14.**

> 🛑 **Owner decision, 2026-09-14: Class B is removed from the protocol.** `openSettlementChallenge`,
> `submitFraudProofTimeout`, challenge bonds and the dealer node's challenge loop no longer exist.
> Why, in short (full research in `ROADMAP.md`, "Research: what Class B is still for"):
>
> 1. A taker holding the dealer's pre-proved, bound Offer File **settles alone** (demonstrated
>    on-chain), so a dealer cannot "go silent" — there is nothing left for them to do.
> 2. The residual failure — the dealer **spends the offer's inputs elsewhere first** — was never
>    punishable by the challenge: `recordSettlement` answered a challenge with no proof that any
>    settlement happened, because the contract cannot see Zswap.
> 3. The challenge could still slash an **honest** dealer who missed a 600 s window during a chain
>    stall (Preprod has stalled for 10+ minutes).
>
> **What replaces it.** The taker settles immediately on a verified reveal and checks the offer's
> inputs are unspent first. If a settlement fails because the dealer spent those inputs, the taker
> can publish the dealer-signed reveal and Offer File; anyone can verify the signature under the
> on-chain `quotePk` and check on the indexer that the inputs were spent by another transaction
> before `validUntil`. That is **publicly verifiable, attributable evidence feeding reputation —
> not a slash.** It is weaker than slashing, and `GRANT.md` says so. Class A is unaffected.
>
> The original Class B design is kept below, struck through in intent, as a record of what was built
> and why it did not survive.

A dealer who simply goes silent when a taker tries to settle produces *no* on-chain evidence. The
chain cannot observe an off-chain omission. This is the honest difficulty at the center of the
design, and we resolve it by converting an unobservable off-chain omission into an observable
on-chain one:

- The taker opens a **settlement challenge** on-chain against a still-valid quote commitment, posting
  a small challenge bond.
- The dealer has a response window in which to complete settlement (which records on-chain).
- If the window closes with no settlement, **anyone** can submit a fraud proof against the unanswered
  challenge, and the bond is slashed.
- If the dealer *does* settle in time, the taker's challenge bond is forfeited to the dealer — this
  is what prices griefing.

This is an optimistic-challenge construction, and it inherits that family's known weakness: it
assumes a dealer who is online and not being censored. A dealer whose node crashes gets slashed
identically to one acting in bad faith. We consider that correct — an OTC dealer quoting a live price
they cannot honor *is* the harm, regardless of intent — but it is a real operational cost of being a
dealer and it is stated plainly in `GRANT.md` rather than buried.

### Pillar 3 — Decentralized relay network + programmable disclosure

**The relay is a protocol-level gossip format, not a hosted service.** This mirrors Midnight's own
design intent for Offer Files: proved locally, serialized, and postable anywhere — a Discord channel,
a Telegram group, a shared namespace. Our relay is simply the well-specified version of that.

- RFQs and quote-commitment *references* gossip across any number of relay nodes anyone can run.
- **Actual sealed price reveals never enter the gossip layer.** They travel point-to-point,
  encrypted to the specific taker. Relay operators see routing metadata and nothing else.
- The reference implementation ships as open infrastructure. The gossip schema in `RELAY.md` is
  specified well enough that a third party can write a compatible node without reading our code —
  that is the test of whether it is really a protocol.

**Compliance is a generalized, programmable disclosure primitive — not one hardcoded auditor key.**
A trade can carry an encrypted note addressed to whatever party or policy the counterparties agree
on, provably tied to that one trade, decryptable only by the intended party, revealing nothing about
any other activity. The contract stores a generic `(ciphertextHash, policyTag)` pair and knows
nothing about what an "auditor" is. See `DISCLOSURE.md`.

### Reference Dealer Node — the cold-start answer

The single biggest risk to any OTC venue is that **no dealer shows up first.** A venue with no
dealers has nothing to offer takers; a venue with no takers has nothing to offer dealers.

We address this in the architecture rather than hand-waving it as go-to-market: `packages/dealer-node`
ships as a first-class deliverable — quote engine, bonding helper, automated sealed-commit-then-reveal
flow, and automatic quote refresh before Offer File expiry. Becoming a dealer should be a config file
and a bond, not a development project. See `DEALER-NODE.md`.

---

## On-chain / off-chain split

This is the core design decision of the protocol. **Do not deviate from this table.**

| Responsibility | Where | Why |
|---|---|---|
| Dealer bond posting / withdrawal, settlement & slash counters | **On-chain** (`OTCProtocol.compact`) | Needs public verifiability and tamper evidence. This is what makes trust cryptoeconomic instead of administrative. |
| Sealed quote commitment hashes + validity windows | **On-chain** (`OTCProtocol.compact`) | Binds a dealer to terms before reveal — the anti-last-look mechanism itself. |
| Fraud proof submission and slashing | **On-chain** (`OTCProtocol.compact`) | Must be permissionlessly triggerable by anyone and verifiable with no trusted arbitrator. |
| Disclosure policy note attachment | **On-chain** (`OTCProtocol.compact`) | Needs to be provably tied to one specific settled trade. |
| RFQ routing, sealed-quote-commitment gossip | **Off-chain** (relay network) | No shared private state exists between users on Midnight. This *cannot* be done on-chain — it is not a design choice. |
| Priced quote reveal (dealer → specific taker) | **Off-chain, point-to-point, encrypted** | Must not be visible to competing dealers or to relay operators. |
| Actual trade proof and settlement | **Zswap** (protocol primitive) | Reuse Midnight's audited atomic-swap primitive rather than reimplementing settlement. |
| Quote liveness / refresh before expiry | **Off-chain** (Dealer Node keeper logic) | Works around the current ~1 hour Offer File expiry. |

---

## End-to-end flow

### Happy path

```
 0. BOND (once, permissionless)
    Dealer ──> postBond(amount, dealerCommitment) ──> chain
    Dealer is now live. No approval occurred.

 1. RFQ
    Taker ──> RFQ{pair, side, size, expiry, takerEncPubKey, rfqId} ──> relay gossip
    Broadcast. Reveals only that someone wants a size in a pair. No price, no identity.

 2. SEALED COMMIT                                  ┌── Dealer A
    Each responding dealer, independently: ────────┼── Dealer B
      offer   = buildZswapOffer(price, size)       └── Dealer C
      nonce   = fresh 32 bytes
      C       = persistentCommit(offerTerms, nonce)
      ──> commitQuote(rfqId, C, validUntil) ──> chain     [PUBLIC: that they quoted, until when]
                                                          [HIDDEN: the price]
 3. REVEAL (point-to-point, NEVER gossiped)
    Dealer ──> encrypt_to_taker( offerTerms, nonce, signature ) ──> Taker
    Competing dealers learn nothing. Relay operators learn nothing.

 4. COMPARE (in the taker's client only)
    Taker verifies for each reveal:
      - signature valid under dealer key
      - persistentCommit(terms, nonce) == on-chain commitment
      - quote still inside validUntil
    Then ranks by price, weighted by each dealer's public bond / settled / slashed record.

 5. SETTLE (Zswap — atomic, protocol-level)
    Taker + chosen Dealer ──> balance vector nets to zero ──> atomic swap
    Dealer ──> recordSettlement(rfqId, quoteId) ──> chain  [increments settled counter]

 6. DISCLOSE (optional)
    Either party ──> attachDisclosureNote(tradeId, ciphertextHash, policyTag) ──> chain
```

### Fraud path A — commitment mismatch

```
    Dealer commits C, then reveals terms' where commit(terms', nonce') != C,
    but signs the reveal (they must, or the taker rejects it outright).

    Taker (or ANY observer given the signed reveal)
      ──> submitFraudProof(quoteId, signedReveal) ──> chain
              circuit verifies: sig valid under dealerPk
                                AND commit(terms', nonce') != storedCommitment
              ──> slash bond, increment slash counter
```

Fully objective. Verified inside the circuit. Nobody adjudicates anything.

### Fraud path B — failure to honor a live quote

```
    Dealer commits C and reveals a good price, then goes silent when the taker
    tries to settle. The chain sees no evidence — silence leaves no trace.

    Taker ──> openSettlementChallenge(quoteId, challengeBond) ──> chain   [starts response window]
                                │
                ┌───────────────┴────────────────┐
                │                                │
       Dealer settles in time            Window closes, no settlement
                │                                │
       recordSettlement()               ANY observer ──> submitFraudProof(challengeId)
       challenge bond ──> Dealer                 ──> slash bond, increment slash counter
       (this is what prices griefing)
```

The challenge bond is load-bearing: without it, takers could open costless challenges to grief
dealers into slashing. With it, a false challenge costs the taker and pays the dealer.

---

## System diagram

```
                            ┌─────────────────────────────────────────┐
                            │        MIDNIGHT CHAIN (public)          │
                            │        OTCProtocol.compact              │
                            │                                         │
                            │  bonds:        Map<dealerCmt, Bond>     │
                            │  settled:      Map<dealerCmt, Counter>  │
                            │  slashed:      Map<dealerCmt, Counter>  │
                            │  quotes:       Map<quoteId, Commitment> │
                            │  challenges:   Map<challengeId, ...>    │
                            │  notes:        Map<tradeId, NoteRef>    │
                            └───▲──────────▲───────────▲──────────▲───┘
              postBond /        │          │           │          │
              commitQuote       │          │  openSettlementChallenge
              recordSettlement  │          │           │          │ submitFraudProof
                                │          │           │          │ (ANYONE)
                    ┌───────────┘          │           │          └──────────────┐
                    │                      │           │                         │
            ┌───────┴────────┐    ┌────────┴───────┐  ┌┴──────────────┐  ┌───────┴────────┐
            │  DEALER NODE   │    │  DEALER NODE   │  │  TAKER (web)  │  │   WATCHDOG     │
            │       A        │    │       B        │  │               │  │  (anyone, incl.│
            │                │    │                │  │  compares     │  │   the taker)   │
            │ quote engine   │    │ quote engine   │  │  revealed     │  │                │
            │ auto-refresh   │    │ auto-refresh   │  │  prices +     │  │ submits fraud  │
            │ commit→reveal  │    │ commit→reveal  │  │  public       │  │ proofs, earns  │
            │ bond mgmt      │    │ bond mgmt      │  │  dealer record│  │ slash bounty   │
            └───┬────────┬───┘    └───┬────────┬───┘  └──┬─────────┬──┘  └────────────────┘
                │        │            │        │         │         │
                │        │  SEALED PRICE REVEAL│         │         │
                │        └────────────┼────────┼─────────┘         │
                │        (point-to-point, encrypted to taker only) │
                │                     │                            │
                │                     │                    ┌───────┴────────┐
                │   RFQ + commitment refs (metadata only)   │  ZSWAP SETTLE  │
                │                     │                     │  atomic swap,  │
        ┌───────┴─────────────────────┴──────────┐          │  balance nets  │
        │      RELAY NETWORK (gossip)            │          │  to zero       │
        │  anyone can run a node — no funds,     │          └────────────────┘
        │  no privileged role, no priced data    │
        │                                        │
        │   [node]───[node]───[node]───[node]    │
        └────────────────────────────────────────┘

   Relay operators see: RFQs, and that dealer X committed to quote Y until time T.
   Relay operators NEVER see: any price, ever.
```

---

## Preprod vs. Mainnet gap

*Placeholder for M4 — this section is expanded and made authoritative at the Mainnet-readiness
milestone. Recording the known shape now so it is not discovered late.*

| Concern | Preprod | Mainnet |
|---|---|---|
| Bond asset | tNIGHT from the faucet, free and unlimited | Real NIGHT with real acquisition cost — makes minimum bond sizing an economic decision, not a config value |
| Fee token (DUST) | Faucet-supplied | Generated by registering NIGHT; the generation/registration process is a real onboarding step for every dealer and must be documented in the Dealer Node setup path |
| Settlement asset | tNIGHT / test stablecoin | USDM where applicable |
| Dealer operators | Our own test instances | Third-party operators we do not control |

The DUST-generation and registration process is the sharpest gap: on Preprod a dealer just asks the
faucet, while on Mainnet every dealer must register NIGHT to generate DUST before they can transact
at all. M4 documents this end to end.

---

## Related documents

- `CONTRACTS.md` — full `OTCProtocol.compact` spec: ledger, circuits, slashing rule, non-goals
- `RELAY.md` — gossip message schema and propagation
- `DEALER-NODE.md` — reference dealer client
- `DISCLOSURE.md` — programmable disclosure primitive
- `FRONTEND.md` — UI spec
- `ROADMAP.md` — milestones and live status **(re-read at the start of every session)**
- `GRANT.md` — project narrative and honest risk statement
