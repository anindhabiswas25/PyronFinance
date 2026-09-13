# Midnight OTC Protocol — Project Narrative

## The problem: last-look abuse

Bilateral OTC trading has a structural integrity problem that predates crypto by decades.

A dealer quotes a price. In the window between quoting and settlement, the dealer can re-price the
trade or refuse it outright once they see the market has moved against them. Nothing binds them to
their quote. The taker has effectively written the dealer a free option — and bears the entire cost
of it — while believing they received a firm price.

This is called **last look**, and in traditional FX it is a live, ongoing scandal rather than a
historical curiosity. Regulators have fined major dealers over its abuse. The practice persists
because the only known remedies are institutional.

Traditional finance addresses it with centralized clearing, legal contracts, and reputational
gatekeeping. Every one of those remedies requires **identity disclosure and institutional trust
relationships** — which is precisely what a privacy-preserving venue exists to make unnecessary. A
private OTC venue built on conventional foundations must therefore choose: either disclose identities
and gain recourse, or preserve privacy and give up any binding on dealer behavior.

Midnight dissolves that choice.

---

## The mechanism: bind dealers cryptographically and economically, not legally

**A dealer posts a bond. A quote is a sealed commitment before it is a revealed price. If the
revealed offer does not match the commitment, or a dealer fails to honor a live sealed quote, anyone
can submit a fraud proof and slash the bond — automatically, permissionlessly, with no admin
adjudicating and no identity ever required.**

Concretely:

1. **Permissionless bonded entry.** Anyone becomes a dealer by posting a bond. No approval, no
   allowlist, no gatekeeper. The dealer exists on-chain only as a commitment derived from a key they
   hold locally. Bond withdrawal is timelocked so a dealer cannot defect and exit before a fraud
   proof can land.
2. **Sealed commit-reveal quoting.** A dealer commits a hash of their quote on-chain — publicly
   binding themselves to terms nobody can yet see — and only then reveals the priced offer directly
   to the taker, encrypted, point-to-point. Competing dealers never see it. Relay operators never
   see it.
3. **Permissionless slashing.** A dealer-signed reveal that does not open the on-chain commitment is
   a self-contained, non-repudiable proof of fraud that *anyone* can submit for a bounty. A dealer
   who goes silent on a live quote is exposed by an on-chain settlement challenge they fail to
   answer.

Reputation accrues to a pseudonymous key: a public, on-chain settled-trade count and slash count that
any taker can read, attached to no legal entity and vetted by nobody.

### Why this is a new mechanism, not a UI wrapper around Offer Files

The honest version of the skeptical question is: *Zswap Offer Files already let two parties agree a
private atomic swap. What does this add?*

Offer Files solve **settlement**. Two parties who have already agreed a price can execute it
privately and atomically. That is a genuine primitive and we reuse it rather than reimplementing it.

Offer Files do not solve **the period before settlement**, which is where last-look abuse lives
entirely. Nothing in an Offer File binds a dealer to a quote they have not yet signed. A dealer can
quote 41.44, watch the market move, and simply decline to produce the Offer File. The taker's only
recourse is not to trade with them again — which requires a persistent identity to avoid, which is
exactly what a private venue cannot demand.

What this protocol adds is **a binding obligation that exists before settlement and is enforceable
without identity**:

- A commitment posted on-chain *before* the price is revealed, so the dealer is bound while the price
  is still secret.
- A bond that a stranger can slash, so the obligation has teeth against a pseudonym.
- A fraud predicate mechanical enough to live in a circuit, so no arbitrator, no admin, and no
  company adjudicates a dispute.

That is a new cryptoeconomic mechanism. The UI is downstream of it.

The design also required solving a problem that has a *wrong* obvious answer. A dealer who simply
goes silent produces no on-chain evidence — the chain cannot observe an off-chain omission. Rather
than pretend a circuit can detect silence, we convert the unobservable off-chain omission into an
observable on-chain one: the taker opens a settlement challenge with a small bond, and the dealer
either settles or is slashed by anyone. The taker's bond is forfeited to the dealer if the dealer
does settle, which prices griefing. This is an optimistic-challenge construction with well-understood
properties and well-understood costs, both stated below.

---

## How this differs from other Midnight trading projects

These are different problems, not different implementations of one problem.

| Project type | What it solves | Why it is not this |
|---|---|---|
| **Dark pool / CLOB** | Continuous many-to-many matching of resting orders | A book aggregates hidden orders and matches them. Midnight has no shared private state, so a circuit cannot match hidden orders at all. Such a project must either centralize the book — reintroducing the trusted operator — or match on public orders. Either way it is solving *matching*, not *bilateral quote integrity*. We deliberately do not build a book. |
| **AMM / DEX** | Passive pooled liquidity via a bonding curve | **There is no dealer counterparty at all.** A curve cannot renege — and so an AMM has no last-look problem to solve, and nothing to say about dealer accountability. Pooled liquidity is also a poor fit for the size-sensitive block trades OTC exists to serve. |
| **Perpetuals / derivatives venue** | Leveraged synthetic exposure, funding rates, liquidation | Derivatives, not spot settlement integrity. Its hard problems are oracle design and liquidation solvency. It presupposes settlement works; we are working on whether the *quote* is honest. |
| **Payment / transfer app** | Moving value privately | No price discovery, no counterparty quoting, no adverse selection. Adjacent primitives, different problem. |

The distinguishing question to ask of any of them: *what happens when a counterparty quotes you a
price and then walks away?* For a book, an AMM, or a payments app, the question does not arise. For a
bilateral OTC venue it is the entire product, and it is the only question this protocol answers.

---

## What ships at each milestone

**M1 — Core protocol contract (Preprod).** `OTCProtocol.compact`: bonding with timelocked withdrawal,
sealed quote commitments, settlement recording, and both fraud-proof paths with slashing. Deploy
scripts and `packages/sdk`.
*Done when:* on Preprod, a dealer posts a bond and commits a quote, and a scripted fraud-proof test
correctly slashes the bond on a deliberately mismatched reveal.

**M2 — Relay node + minimal RFQ flow (Preprod).** `packages/relay-node` as open infrastructure with a
gossip schema specified well enough for third-party reimplementation, plus the taker frontend through
sealed-bid, reveal, comparison, and Zswap settlement.
*Done when:* one full sealed-bid RFQ cycle with at least two competing dealer commitments runs end to
end on Preprod and is demoable.

**M3 — Dealer Node + programmable disclosure.** `packages/dealer-node` — standing quotes, warm-pool
Offer File refresh, automated commit-then-reveal, automated challenge response. Plus the disclosure
primitive: an encrypted note provably tied to one trade, decryptable only by its intended recipient.
*Done when:* a Dealer Node holds a standing quote alive unattended across multiple Offer File expiry
cycles, and a disclosure note round-trips with the negative cases (wrong party cannot decrypt; no
linkage to other trades) verified.

**M4 — Mainnet readiness.** Final bond sizing and slashed-funds parameters at real value, USDM
settlement, Mainnet configs, third-party dealer operators, and full documentation of the Preprod →
Mainnet DUST generation and registration gap.
*Done when:* the contract and both node types run against Mainnet config with real operators.

---

## Open risks, stated honestly

We would rather state these plainly than have a reviewer find them.

### 1. Dealer bootstrapping — the venue's existential risk

An OTC venue with no dealers has nothing to offer takers, and one with no takers has nothing to offer
dealers. This is the risk most likely to kill the project, and it is not a cryptographic problem.

**Mitigation, built into the architecture rather than deferred to go-to-market:** the reference Dealer
Node ships as a first-class M3 deliverable with the explicit target that a competent operator goes
from clone to live standing quote in under thirty minutes — a config file and a bond, not a
development project. **Residual risk remains real.** Shipping good dealer software does not conjure
dealers with capital and inventory. We are lowering the barrier as far as engineering can; the rest
is genuinely unsolved and we do not claim otherwise.

### 2. Commit-then-reveal latency — unvalidated, and gating our own claims

The mechanism inserts proof generation and a chain confirmation between "dealer decides a price" and
"taker sees it."

**Measured on Preprod (M2 task 2.8, one developer machine, local proof server — not a benchmark):**

| Step | Measured |
|---|---|
| Build + prove an **unshielded** Offer File | 6–16 ms (no ZK proof involved) |
| Build + prove a **shielded** Offer File | ~3.1 s median steady state, 6.4 s cold; **no gain from parallel requests** |
| `commitQuote` (prove + submit + chain confirmation) | 18.8–24.6 s typical; **53.2 s** observed on a degraded network |
| Taker settlement (balance + prove + submit) | 16.9–23.6 s |

The end-to-end quote round trip is therefore **tens of seconds, dominated by chain confirmation**,
not by proving. For shielded pairs, proving adds ~3 s per pre-proved offer and bounds how fast a
dealer can refill a warm pool. These are the numbers, including the bad ones; see `ROADMAP.md`
task 2.8 for conditions and limits.

If it is slow enough, dealers must widen spreads to cover the risk of being bound across a longer
window — which would make the venue less competitive precisely because of the mechanism that makes it
trustworthy. The mitigation is the Dealer Node's warm pool of pre-proved Offer Files, which amortizes
proving out of the hot path; whether that suffices is an empirical question.

**No performance claim appears in any external material beyond the measured table above.** Where a
number is bad, it is published as a bad number. Whether tens of seconds of binding latency leaves
dealers able to quote competitively is **still unvalidated**. The table measures the mechanism, not
market viability.

### 3. A dealer can still make a revealed quote fail — and is not slashed for it

**Updated 2026-09-14: the settlement challenge (Class B) was removed.** A taker holding the dealer's
pre-proved Offer File settles unilaterally, so a dealer cannot stall. But a dealer who **spends the
offer's inputs elsewhere** before the taker's settlement lands makes it fail, and that option is
last-look by another name. It is exploited at scale where it exists: on Polymarket, where
off-chain-matched orders settle later on-chain, half of ~1.95 M reverted settlements over nine months
were deliberate, including exactly this "drain the balance first" pattern (arXiv 2606.16852).

The protocol does **not** slash for this — no Compact primitive we found lets a circuit observe that
a UTXO was spent, and the removed challenge could not either (its answer was self-attested). What it
offers instead: the window is short (the taker settles on reveal, ~20–60 s measured), the taker
pre-checks the inputs, and a failed quote leaves **publicly verifiable, attributable evidence** (the
dealer-signed reveal plus the Offer File, checked against the indexer) that clients fold into the
dealer's track record. That is reputation, not collateral, and it is the weakest guarantee in the
protocol. Escrowing the dealer's inventory would close it, at the cost of moving settlement off Zswap
and making executed amounts public; that trade was considered and not taken.

~~Original risk 3, "Optimistic challenge assumes a live, uncensored dealer", kept for the record:~~

Class-B fraud detection slashes a dealer who fails to answer a settlement challenge in time. **A
dealer whose node crashes is slashed identically to one acting in bad faith.**

We consider this the correct semantics — an OTC dealer quoting a live price they cannot honor *is*
the harm, whatever the intent — but it makes dealing operationally demanding, and it is a cost
prospective dealers must understand before bonding. The Dealer Node treats challenge response as its
highest-priority loop with a 5x timing margin, and the challenge bond prices griefing. Neither fully
eliminates the risk of a dealer being slashed for an infrastructure failure.

### 4. Pseudonymous reputation can be discarded

A slashed dealer can generate a fresh key and re-bond as a new dealer with a clean record. **This is
unavoidable in a permissionless pseudonymous system** — preventing it would require exactly the
identity layer this protocol exists to avoid.

The defense is economic rather than preventive: a fresh commitment has a *zero* settled count, so
discarding a slash also discards the entire accumulated track record, and takers can weight a long
clean history accordingly. This works only once the venue is mature enough for track records to be
worth something — which means it is weakest exactly when the venue is youngest.

### 5. The settled counter is dealer-attested

`recordSettlement` is called by the dealer, and the contract cannot inspect a Zswap swap to verify a
trade occurred. A dealer could inflate their settled count. The bond — which cannot be faked — remains
the hard guarantee, and takers should weight it above the counter. Binding settlement records to a
Zswap transaction hash is tracked as post-M4 work.

### 6. Relay censorship is resisted, not solved

Multi-relay querying defeats individual relay censorship. It does not defeat a partitioned taker or
one whose known relays share an operator. There is no Sybil-resistant relay discovery in v1;
stake-weighting relays would reintroduce the permissioned layer we reject. Takers can run their own
relay or contact dealers directly, and the protocol degrades to direct contact rather than failing —
but the honest statement is that relay-level censorship resistance is partial.

### 7. Contract-level dependency risk

In-circuit Jubjub Schnorr signature verification — which Class-A fraud proofs depend on entirely —
currently exists as a hand-written polyfill rather than a Compact standard-library primitive.
Validating it against the current compiler is the **first task of M1**, ahead of all other contract
work. If it does not hold, Class-A proofs cannot ship as specified and the design falls back to
challenge-based detection for both fraud classes — a materially weaker guarantee that would be
disclosed here rather than quietly absorbed.

---

## Summary

Last-look abuse is a real, persistent, regulator-recognized failure in bilateral OTC markets, and
every existing remedy for it requires identity and institutional trust. Midnight makes a
cryptoeconomic remedy possible for the first time: **bond the dealer, seal the quote, and let anyone
slash a defector — with no admin, no allowlist, and no identity at any point.**

What ships is protocol infrastructure, not a product: an open contract, an open relay specification
any node can implement, an open dealer client that makes market-making a config file, and a
disclosure primitive that supports compliance without building a backdoor.

The mechanism is new. The risks — bootstrapping and latency above all — are real, unsolved, and
stated here rather than discovered later.
