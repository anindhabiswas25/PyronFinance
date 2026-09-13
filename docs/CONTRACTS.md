# `OTCProtocol.compact` — Contract Specification

Single contract. No cross-contract calls (Compact does not support them). Everything the protocol
needs to be *trustless* lives here; everything else is deliberately off-chain per the split table in
`ARCHITECTURE.md`.

**Confirmed decisions** (settled with the project owner before M1):

| Decision | Value |
|---|---|
| Bond asset | **tNIGHT on Preprod → NIGHT on Mainnet** (native unshielded) |
| Slashed-funds destination | **Split: majority to the wronged taker, remainder burned** — exact fractions below |
| Disclosure scope at M3 | **Single named recipient key only**; richer policies deferred but the field is reserved now |
| First pair | **tNIGHT/USDM**, encoded generically so more pairs are config, not a migration |
| **Class B** | **Removed (2026-09-14).** No `openSettlementChallenge`, `submitFraudProofTimeout`, `Challenge` ledger, `openChallenges`, challenge bonds or `CHALLENGE_WINDOW`. `recordSettlement(quoteId)` takes no other parameter. 9 circuits. See `ROADMAP.md` "Research: what Class B is still for" |

> **Reading this spec after 2026-09-14.** Every Class B element below — the `Challenge` struct,
> §5.2's `openSettlementChallenge` and challenge-answering `recordSettlement`, §5.3's
> `submitFraudProofTimeout`, `CHALLENGE_WINDOW` in §2 and §6, and all of §7a — **describes the
> removed design** and is kept for the record. The implemented contract is
> `contracts/src/OTCProtocol.compact`. With `CHALLENGE_WINDOW` gone, the §6 inequality is
> `BOND_WITHDRAW_DELAY (86400) > MAX_QUOTE_VALIDITY (900) + PROOF_GRACE_PERIOD (3600) = 4500`.

---

## 1. Non-goals (explicit)

Stating these in the contract spec because the contract is where the temptation to add them appears.

- **No matching engine.** The contract never compares two prices. It never sees a price at all until
  a fraud proof reveals one. Order matching is impossible on Midnight (no shared private state) and
  price *comparison* belongs in the taker's client.
- **No allowlist, no admin, no owner, no pause.** There is no privileged key anywhere in this
  contract. Nothing in the ledger is writable by a distinguished party. If a future change requires
  an admin key, that change is wrong.
- **No settlement logic.** Settlement is Zswap's atomic swap. This contract *records that settlement
  happened*; it does not perform or custody it. We do not reimplement an audited protocol primitive.
- **No price oracle.** The contract has no opinion on whether a quote was a *good* price. It enforces
  only that a dealer honored the price they committed to. "Fair value" is not a protocol concern.
- **No dispute resolution.** Both fraud classes resolve to a mechanical predicate. There is no
  arbitration path, no appeal, and no human in the loop, by construction.
- **No identity.** Nothing in the ledger is, or hashes to, a real-world identity.

---

## 2. Constants

```compact
// Slashing distribution — basis points, must sum to 10_000.
const SLASH_TAKER_BPS:  Uint<16> = 6000;  // compensation to the wronged taker
const SLASH_PROVER_BPS: Uint<16> = 1000;  // bounty to whoever submitted the fraud proof
const SLASH_BURN_BPS:   Uint<16> = 3000;  // permanently unspendable

// Timing (seconds). The inequality in §6 must hold.
const MAX_QUOTE_VALIDITY:   Uint<64> = 900;    // 15 min — a quote may not be live longer
const CHALLENGE_WINDOW:     Uint<64> = 600;    // 10 min for a dealer to answer a challenge
const PROOF_GRACE_PERIOD:   Uint<64> = 3600;   // 1 h for a watchdog to land a proof
const BOND_WITHDRAW_DELAY:  Uint<64> = 86400;  // 24 h timelock
const TIME_SLACK:           Uint<64> = 300;    // 5 min — added during M1 build; see note below

// Bond sizing (§7, §7a) — implemented in M2 task 2.9. There is NO flat MIN_BOND: the per-quote
// notional cap subsumes it. (This block previously declared MIN_BOND / MIN_CHALLENGE_BOND as
// unset placeholders; they shipped as PLACEHOLDER_* = 1 until 2026-09-13.)
const NOTIONAL_CAP_K:       Uint<8>   = 20;   // commitQuote: notional <= bond * 20
const CHALLENGE_BOND_PCT:   Uint<8>   = 2;    // openSettlementChallenge: bond >= 2% of notional ...
const CHALLENGE_BOND_DENOM: Uint<8>   = 100;
const CHALLENGE_BOND_FLOOR: Uint<128> = 1;    // ... and >= the floor. The floor AMOUNT is OPEN (M4 4.1)
```

> **On the 60/10/30 split.** The chosen policy was "majority to taker, remainder burned," with the
> taker share described as covering *both* compensation and the fraud-proof bounty. Since the prover
> is frequently *not* the taker, that 70% bucket is split explicitly: 60% compensation + 10% prover
> bounty. **When the taker proves their own fraud — the common case — they collect the full 70%.**
> The 30% burn is what stops a taker and a dealer from staging a fake slash to move funds between
> themselves: any collusive round-trip loses 30% of the bond, so it is never profitable.
>
> **"Burned" mechanically:** the contract simply retains the burned portion and no circuit path can
> ever release it. There is no burn primitive; unspendability is enforced by the absence of a
> withdrawal path, which is stronger than a privileged burn address.

---

## 3. Ledger declarations

```compact
pragma language_version >= 0.22;

import CompactStandardLibrary;
import "schnorr" prefix Schnorr_;   // see §9 — RISK: polyfill, not yet stdlib

export struct Bond {
  amount:            Uint<128>,   // currently bonded, minus any slashed
  quotePk:           JubjubPoint, // dealer's quote-signing pubkey (verifies reveals)
  withdrawRequested: Uint<64>,    // unix secs; 0 = no pending withdrawal
  liveQuotes:        Uint<32>,    // unexpired commitments — blocks withdrawal while > 0
  openChallenges:    Uint<32>,    // unresolved challenges — blocks withdrawal while > 0
  active:            Boolean,
}

export struct Quote {
  dealerCmt:   Bytes<32>,
  commitment:  Bytes<32>,   // persistentCommit(terms, nonce) — NOT a bare hash
  validUntil:  Uint<64>,
  rfqId:       Bytes<32>,
  resolved:    Boolean,     // settled or slashed; terminal
}

export struct Challenge {
  quoteId:      Bytes<32>,
  takerAddr:    Bytes<32>,  // payout target for compensation
  bondAmount:   Uint<128>,
  respondBy:    Uint<64>,
  resolved:     Boolean,
}

export struct NoteRef {
  ciphertextHash: Bytes<32>,  // hash of the off-chain encrypted note
  policyTag:      Uint<16>,   // generic; contract ascribes no meaning — see DISCLOSURE.md
  recipientHint:  Bytes<32>,  // opaque to the contract
}

// ── Public state ──────────────────────────────────────────────────────────
export ledger bonds:      Map<Bytes<32>, Bond>;        // dealerCmt -> bond
export ledger settled:    Map<Bytes<32>, Counter>;     // dealerCmt -> settled trades
export ledger slashed:    Map<Bytes<32>, Counter>;     // dealerCmt -> times slashed
export ledger quotes:     Map<Bytes<32>, Quote>;       // quoteId -> commitment record
export ledger challenges: Map<Bytes<32>, Challenge>;   // challengeId -> challenge
export ledger notes:      Map<Bytes<32>, NoteRef>;     // tradeId -> disclosure note ref
export ledger burnedTotal: Uint<128>;                  // transparency only; never withdrawable

// ── Private inputs ────────────────────────────────────────────────────────
witness dealerSecretKey(): Bytes<32>;
witness takerAddress():    Bytes<32>;
```

**Domain separation** — distinct separators, never reused across purposes:

```compact
pure circuit dealerCommitment(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "otc:dealer:v1"), sk]);
}

pure circuit deriveQuoteId(dealerCmt: Bytes<32>, rfqId: Bytes<32>, c: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>([pad(32, "otc:quote:v1"), dealerCmt, rfqId, c]);
}

pure circuit deriveChallengeId(quoteId: Bytes<32>, taker: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "otc:challenge:v1"), quoteId, taker]);
}
```

`quoteId` is deterministic and publicly recomputable, so a taker can locate a dealer's on-chain
commitment from the gossiped reference alone, with no lookup service.

---

## 4. What is public vs. private

The honest summary: **this contract is almost entirely public, on purpose.** Its job is to make
dealer accountability *verifiable*, and verifiability requires publicity. The privacy in this
protocol lives in the *quote reveal channel* and in *Zswap settlement* — not here.

| Circuit | Public (on-chain, plaintext) | Private (stays in witness) |
|---|---|---|
| `postBond` | bond amount, dealer commitment, quote pubkey | dealer secret key |
| `topUpBond` | added amount, dealer commitment | dealer secret key |
| `requestBondWithdrawal` | dealer commitment, request timestamp | dealer secret key |
| `withdrawBond` | amount, recipient address | dealer secret key |
| `commitQuote` | dealer commitment, **commitment hash**, validity window, rfqId, **notional (= size)** — see §7 for why that is not a new leak | **the price**, the nonce, the Offer File |
| `openSettlementChallenge` | quoteId, taker payout address, challenge bond | taker's other activity, the quoted price |
| `recordSettlement` | quoteId, dealer commitment | the executed price, the counterparty relationship |
| `submitFraudProofMismatch` | quoteId, **revealed terms**, nonce, signature | — (fraud proof necessarily reveals the terms) |
| `submitFraudProofTimeout` | challengeId | — |
| `attachDisclosureNote` | tradeId, ciphertext hash, policy tag | note contents, recipient identity |

Two consequences worth being explicit about, because a reader will otherwise assume more privacy
than exists:

1. **Quote *activity* is public even though quote *prices* are not.** Anyone can see that dealer
   `0xab…` quoted on RFQ `0x12…` until 14:32. That is deliberate — it is what makes the
   anti-last-look guarantee checkable, and it is the pseudonymous track record takers rely on.
2. **Submitting a fraud proof reveals the fraudulent price.** Unavoidable: proving the reveal did
   not match the commitment requires exhibiting the reveal. This only ever happens for quotes that
   were already fraudulent.

---

## 5. Circuits

### 5.1 Bonding

```compact
// Permissionless. No approval step exists anywhere in this contract.
export circuit postBond(amount: Uint<128>, quotePk: JubjubPoint): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  assert(!bonds.member(cmt), "Dealer already bonded; use topUpBond");
  assert(disclose(amount) > 0, "Bond must be positive"); // no flat minimum — the cap is per quote, §7
  receiveUnshielded(default<Bytes<32>>, disclose(amount));
  bonds.insert(cmt, Bond {
    amount: disclose(amount), quotePk: disclose(quotePk),
    withdrawRequested: 0, liveQuotes: 0, openChallenges: 0, active: true,
  });
  // Map<K, Counter> does NOT auto-vivify: both reading and incrementing an uninitialised
  // counter throw at runtime. Without these, recordSettlement and slashBond fail for every
  // dealer — i.e. slashing never works at all. (`default<Counter>()` does not parse; Counter
  // is a ledger-only ADT. insertDefault is the correct initialiser.)
  settled.insertDefault(cmt);
  slashed.insertDefault(cmt);
}

export circuit topUpBond(amount: Uint<128>): [] { /* receiveUnshielded; bond.amount += amount */ }

// Starts the timelock. Does NOT stop the dealer honoring quotes already live.
//
// UPDATED during M1 build: Compact circuits cannot read block time as a value, only compare
// against it (`blockTimeGte`). `now` is caller-supplied and bound to within TIME_SLACK (300s)
// of actual chain time via a two-sided blockTimeGte check — see compact-contracts SKILL.md §9.
export circuit requestBondWithdrawal(now: Uint<64>): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  assert(bonds.member(cmt), "Not a dealer");
  const b = bonds.lookup(cmt);
  const claimedNow = disclose(now);
  assert(blockTimeGte(claimedNow), "claimed time is in the future");
  assert(!blockTimeGte((claimedNow + TIME_SLACK) as Uint<64>), "claimed time too far in the past");
  bonds.insert(cmt, Bond { ...b, withdrawRequested: claimedNow, active: false });
  // active=false => commitQuote now rejects. A withdrawing dealer cannot take on new obligations.
}

export circuit withdrawBond(recipient: UserAddress): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  const b = bonds.lookup(cmt);
  assert(b.withdrawRequested > 0, "No withdrawal requested");
  assert(blockTimeGte(b.withdrawRequested + BOND_WITHDRAW_DELAY), "Timelock not elapsed");
  assert(b.openChallenges == 0, "Unresolved challenges outstanding");
  assert(b.liveQuotes == 0, "Live quote commitments outstanding");
  sendUnshielded(default<Bytes<32>>, b.amount,
                 right<ContractAddress, UserAddress>(disclose(recipient)));
  bonds.remove(cmt);   // counters deliberately persist — see §8
}
```

### 5.2 Quoting and settlement

```compact
// UPDATED in M2 task 2.9: takes `notional` (bond-asset base units) and stores it on the Quote.
export circuit commitQuote(
  rfqId: Bytes<32>, commitment: Bytes<32>, validUntil: Uint<64>, notional: Uint<128>
): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  const b = bonds.lookup(cmt);
  assert(b.active, "Dealer not active (withdrawing or unbonded)");
  // Per-quote notional cap, §7. Replaces "bond fell below minimum": a slashed bond backs nothing.
  assert(disclose(notional) > 0, "Notional must be positive");
  assert(disclose(notional) <= b.amount * NOTIONAL_CAP_K, "Notional exceeds bond cap");
  // Cap validity: an unbounded window would let a dealer sit on a free option indefinitely,
  // and would force BOND_WITHDRAW_DELAY to be unbounded too.
  const validUntilPub = disclose(validUntil);
  assert(!blockTimeGte(validUntilPub), "validUntil already past");
  // Cap the window: require validUntil <= now + MAX_QUOTE_VALIDITY, i.e.
  // now >= validUntil - MAX_QUOTE_VALIDITY, which is blockTimeGte — NOT its negation.
  // POLARITY WARNING: the negated form compiles and typechecks identically but means the
  // opposite, requiring the window to be LONGER than the cap. That inversion shipped in the
  // M1 build and was invisible to both the compiler and tsc; only executing the circuit
  // caught it (contracts/test/quoting.test.ts).
  assert(validUntilPub >= MAX_QUOTE_VALIDITY(), "validUntil implausibly small"); // underflow guard
  assert(blockTimeGte((validUntilPub - MAX_QUOTE_VALIDITY()) as Uint<64>), "Validity window too long");
  const qid = deriveQuoteId(cmt, disclose(rfqId), disclose(commitment));
  assert(!quotes.member(qid), "Duplicate quote");
  quotes.insert(qid, Quote { dealerCmt: cmt, commitment: disclose(commitment),
                             validUntil: disclose(validUntil), rfqId: disclose(rfqId),
                             notional: disclose(notional), resolved: false });
  bonds.insert(cmt, Bond { ...b, liveQuotes: (b.liveQuotes + 1) as Uint<32> });
}

// Taker converts an unobservable off-chain omission into an observable on-chain one.
// UPDATED during M1 build: `now` is caller-supplied and chain-validated — same reasoning as
// requestBondWithdrawal above.
export circuit openSettlementChallenge(quoteId: Bytes<32>, bondAmount: Uint<128>, now: Uint<64>): [] {
  const q = quotes.lookup(disclose(quoteId));
  assert(!q.resolved, "Quote already resolved");
  assert(!blockTimeGte(q.validUntil), "Quote expired — nothing to honor");
  // max(floor, 2% of notional), §7a — checked without division, rounding against the challenger.
  assert(disclose(bondAmount) >= CHALLENGE_BOND_FLOOR, "Challenge bond below floor");
  assert(disclose(bondAmount) * CHALLENGE_BOND_DENOM >= q.notional * CHALLENGE_BOND_PCT,
         "Challenge bond below 2% of notional");
  receiveUnshielded(default<Bytes<32>>, disclose(bondAmount));
  const claimedNow = disclose(now);
  assert(blockTimeGte(claimedNow), "claimed time is in the future");
  assert(!blockTimeGte((claimedNow + TIME_SLACK) as Uint<64>), "claimed time too far in the past");
  const taker = disclose(takerAddress());
  challenges.insert(deriveChallengeId(disclose(quoteId), taker), Challenge {
    quoteId: disclose(quoteId), takerAddr: taker, bondAmount: disclose(bondAmount),
    respondBy: (claimedNow + CHALLENGE_WINDOW) as Uint<64>, resolved: false,
  });
  /* bond.openChallenges += 1 */
}

// Called by the dealer after Zswap settlement completes. Also answers any open challenge,
// returning the challenge bond to the dealer — this is what prices griefing.
// `recipient` is the dealer's unshielded wallet address, for the challenge-bond refund. It must
// be explicit: the dealer commitment is persistentHash("otc:dealer:v1", sk) — an identity hash,
// NOT an address. Refunding to it sends funds to a key nobody holds. (Fixed during M1; the
// original spec omitted this parameter and the implementation refunded to the commitment.)
export circuit recordSettlement(
  quoteId: Bytes<32>, challengeId: Maybe<Bytes<32>>, recipient: Bytes<32>
): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  const q = quotes.lookup(disclose(quoteId));
  assert(q.dealerCmt == cmt, "Not your quote");
  assert(!q.resolved, "Already resolved");
  quotes.insert(disclose(quoteId), Quote { ...q, resolved: true });
  settled.lookup(cmt).increment(1);
  /* liveQuotes -= 1; if challengeId present and unexpired:
     mark resolved, pay bondAmount to the dealer, openChallenges -= 1 */
}
```

> **`recordSettlement` is dealer-attested, not Zswap-verified.** The contract cannot inspect a Zswap
> swap, so a dealer could in principle inflate their settled counter by recording settlements that
> never happened. This is a **known, accepted limitation**, and it is bounded: the counter is a soft
> reputation signal, while the *bond* is the hard guarantee, and inflating a counter costs a real
> transaction fee per increment while gaining nothing that a taker's own verification would trust.
> Takers should weight bond size above settled count. Binding the counter to a Zswap transaction hash
> is tracked as post-M4 work in `ROADMAP.md`.

### 5.2a Releasing expired quotes

Added during the M1 build. Not in the original spec, and its absence was a **liveness bug that
made every honest dealer's bond permanently unwithdrawable.**

```compact
// Permissionless. Anyone may call it, including the dealer clearing their own stale liability.
export circuit releaseExpiredQuote(quoteId: Bytes<32>): [] {
  const qidPub = disclose(quoteId);
  assert(quotes.member(qidPub), "Unknown quote");
  const q = quotes.lookup(qidPub);
  assert(!q.resolved, "Quote already resolved");
  assert(blockTimeGte((q.validUntil + PROOF_GRACE_PERIOD()) as Uint<64>),
         "Fraud-proof grace period still open");
  quotes.insert(qidPub, Quote { ...q, resolved: true });
  releaseLiveQuote(q.dealerCmt);   // liveQuotes -= 1, with underflow guard
}
```

**Why it is needed.** `liveQuotes` was only ever decremented by `recordSettlement`. A quote that
expires unsettled — the ordinary outcome whenever a taker doesn't trade — left `liveQuotes > 0`
permanently, and `withdrawBond` asserts `liveQuotes == 0`. A dealer who quoted once and was never
taken up could never recover their bond.

**Why it is gated on `PROOF_GRACE_PERIOD`, not plain expiry.** `submitFraudProofMismatch` asserts
`!q.resolved`. If release were allowed at expiry, a fraudulent dealer could resolve their own quote
the instant it expired and become **immune to a Class-A fraud proof**. Waiting out the grace period
closes that escape hatch — and is what makes `PROOF_GRACE_PERIOD` load-bearing rather than a number
that appears only in the §6 inequality.

**Why the Class-B path needs no additional guard.** A challenge can only be opened while the quote
is live, so `respondBy <= validUntil + CHALLENGE_WINDOW (600)`, always strictly inside
`validUntil + PROOF_GRACE_PERIOD (3600)`. Any timeout proof therefore becomes submittable before
release is possible. This is the §6 inequality doing real work; do not shrink `PROOF_GRACE_PERIOD`
below `CHALLENGE_WINDOW`.

### 5.3 Fraud proofs — permissionless, callable by anyone

```compact
// CLASS A — commitment mismatch. Fully objective.
// Anyone holding a dealer-signed reveal that does not open the on-chain commitment can slash.
export circuit submitFraudProofMismatch(
  quoteId:      Bytes<32>,
  revealedTerms: Vector<4, Field>,        // pair, side, price, size — the signed message
  revealedNonce: Bytes<32>,
  signature:     Schnorr_SchnorrSignature,
  beneficiary:   Bytes<32>                // wronged taker's payout address
): [] {
  const q = quotes.lookup(disclose(quoteId));
  assert(!q.resolved, "Quote already resolved");
  const b = bonds.lookup(q.dealerCmt);

  // 1. The dealer really said this. Without signature verification, anyone could
  //    fabricate a "mismatching reveal" and slash an honest dealer.
  Schnorr_schnorrVerify<4>(disclose(revealedTerms), disclose(signature), b.quotePk);

  // 2. ...and it does not open the commitment they posted.
  const recomputed = persistentCommit<Vector<4, Field>>(
      disclose(revealedTerms), disclose(revealedNonce));
  assert(recomputed != q.commitment, "Reveal matches commitment — no fraud");

  slashBond(q.dealerCmt, disclose(beneficiary));
  quotes.insert(disclose(quoteId), Quote { ...q, resolved: true });
}

// CLASS B — failure to honor a live quote, proven by an unanswered challenge.
export circuit submitFraudProofTimeout(challengeId: Bytes<32>): [] {
  const c = challenges.lookup(disclose(challengeId));
  assert(!c.resolved, "Challenge already resolved");
  assert(blockTimeGte(c.respondBy), "Response window still open");
  const q = quotes.lookup(c.quoteId);
  const dealerCmt = q.dealerCmt;
  slashBond(dealerCmt, c.takerAddr);
  // Challenge bond returns to the taker; they were in the right.
  sendUnshielded(default<Bytes<32>>, c.bondAmount,
                 right<ContractAddress, UserAddress>(c.takerAddr as UserAddress));
  challenges.insert(disclose(challengeId), Challenge { ...c, resolved: true });
  quotes.insert(c.quoteId, Quote { ...q, resolved: true });
}

// UPDATED during M1 build: Compact has no division operator at all (`/` is a parse error,
// confirmed against the compiler — see compact-contracts SKILL.md §9). The split now uses a
// witness (`computeSlashShares`) supplying the pre-divided shares, verified in-circuit via
// multiplication and a tight two-sided inequality against amount*bps — the standard
// range-checked-division pattern, same technique the Schnorr challenge reduction needed.
circuit slashBond(dealerCmt: Bytes<32>, beneficiary: Bytes<32>): [] {
  const b = bonds.lookup(dealerCmt);
  const shares = computeSlashShares(b.amount);   // witness: [takerCut, proverCut]
  const takerCut = disclose(shares[0]);
  const proverCut = disclose(shares[1]);
  assert(takerCut * 10000 <= b.amount * SLASH_TAKER_BPS, "taker cut too high");
  assert((takerCut + 1) * 10000 > b.amount * SLASH_TAKER_BPS, "taker cut not maximal");
  assert(proverCut * 10000 <= b.amount * SLASH_PROVER_BPS, "prover cut too high");
  assert((proverCut + 1) * 10000 > b.amount * SLASH_PROVER_BPS, "prover cut not maximal");
  const burnCut   = (b.amount - takerCut - proverCut) as Uint<128>;   // remainder — no rounding leak
  sendUnshielded(default<Bytes<32>>, takerCut,  right<...>(beneficiary as UserAddress));
  sendUnshielded(default<Bytes<32>>, proverCut, right<...>(disclose(takerAddress()) as UserAddress));
  burnedTotal = (burnedTotal + burnCut) as Uint<128>;   // retained forever; no path releases it
  bonds.insert(dealerCmt, Bond { ...b, amount: 0, active: false });
  slashed.lookup(dealerCmt).increment(1);
}
```

**The whole bond is slashed, not a fraction of it.** An earlier instinct is to slash partially so a
dealer can recover. That is wrong here: a dealer who defected on one quote had every other live quote
backed by the same bond, and a partial slash leaves those quotes under-collateralized while the
dealer is still nominally active. Full slash plus `active: false` is the only state that keeps the
remaining guarantees coherent. A dealer who wants to return posts a fresh bond — and carries a
permanent, visible slash counter.

### 5.4 Disclosure

```compact
// Generic. The contract knows nothing about auditors, regulators, or policies.
export circuit attachDisclosureNote(
  tradeId: Bytes<32>, ciphertextHash: Bytes<32>, policyTag: Uint<16>, recipientHint: Bytes<32>
): [] {
  const tid = disclose(tradeId);
  // The one property this primitive must enforce: a note is provably tied to one specific
  // SETTLED trade. Without these two assertions any caller can attach a note to arbitrary
  // bytes, and DISCLOSURE.md's central claim is false. (Missing in the M1 build.)
  assert(quotes.member(tid), "Unknown trade");
  assert(quotes.lookup(tid).resolved, "Trade not settled");
  assert(!notes.member(tid), "Note already attached");
  notes.insert(tid, NoteRef {
    ciphertextHash: disclose(ciphertextHash),
    policyTag: disclose(policyTag),
    recipientHint: disclose(recipientHint),
  });
}
```

The contract stores a hash and an opaque tag. It never learns the note contents, the recipient, or
what the policy means. Interpretation lives entirely in `DISCLOSURE.md` and in client code — which is
what makes the primitive *programmable* rather than a hardcoded auditor backdoor.

---

## 6. The timelock inequality

Bond withdrawal must not outrun fraud detection. Required:

```
BOND_WITHDRAW_DELAY  >  MAX_QUOTE_VALIDITY + CHALLENGE_WINDOW + PROOF_GRACE_PERIOD
      86400          >        900          +      600         +      3600          = 5100  ✓
```

The 24 h delay is far above the 5100 s floor, deliberately — the margin absorbs chain congestion and
proof-generation latency without needing a parameter change. `liveQuotes == 0` and
`openChallenges == 0` are additionally required at withdrawal, so the inequality is a backstop rather
than the sole defense.

---

## 7. Bond sizing: per-quote notional cap (decided 2026-09-12)

**Decision: design (2), the per-quote notional cap, with `k = 20`.** `commitQuote` takes the quote
notional and rejects it unless `notional <= bond * 20` — equivalently, a dealer must bond at least
5% of anything they quote. `MIN_BOND` as a flat floor is **not** adopted; the cap subsumes it.

### Why the cap, when §7 previously deferred it

The deferral rested on one objection: the cap "requires `commitQuote` to see the quote *size*, which
leaks size while keeping price hidden." **That leak is already paid for elsewhere**, so it is not a
cost of this design:

- `RELAY.md` and `packages/relay-node/src/schema.ts` gossip the RFQ as `{rfqId, pair, side, size}` —
  publicly, to every relay and every dealer.
- `commitQuote` already stores `rfqId: disclose(rfqId)` on-chain in the `Quote` struct.

Anyone can therefore already join on-chain `rfqId` → gossiped RFQ → size. Disclosing size to the
circuit reveals nothing a relay observer cannot already derive. **Price remains sealed either way,
and price was always the protected quantity.** If a future design sends RFQs point-to-point instead
of gossiping them, this reasoning expires and the tradeoff becomes real again — revisit it then.

### Why k = 20

A bond must do two jobs, and the stricter one binds. Deterrence needs `bond > dealer's gain from
defecting`. Compensation needs the *wronged taker* made whole — and under the 60/10/30 split (§2) the
taker receives only **0.6 × bond**:

```
0.6 * bond  >=  notional * adverse_move
bond        >=  notional * adverse_move / 0.6
```

With `MAX_QUOTE_VALIDITY` = 900 s and this section's original 1–2% volatility estimate, a 2% move
gives `notional <= bond * 30`; a 3% stress case gives `bond * 20`. **k = 20 is the stress case**, and
it cross-checks against this section's own independent estimate — "a bond credibly backing a 100k
notional quote wants to be in the low thousands": 100k / 20 = 5,000.

Above ~1× the payout cap, extra bond stops reducing taker loss, so there is no reason to go higher;
below it, loss leaks straight through to the taker.

**Denomination:** `notional` must be expressed in the bond asset (tNIGHT), so no oracle is needed.
For a tNIGHT/USDM quote the tNIGHT leg is the notional. A pair with neither leg in the bond asset
would need an oracle and is therefore out of scope until `MIN_BOND` is revisited for Mainnet (4.1).

### Implemented (M2 task 2.9, 2026-09-13) — and the one gap it leaves

`commitQuote` takes `notional`, asserts `0 < notional <= bond * 20`, and stores it on the `Quote`.
The cap is **per quote, not cumulative**: two quotes may each use the full cap. Aggregate exposure
across live quotes is the Dealer Node's `max_total_notional` risk limit, not a contract rule — pinned
by a test so a change is deliberate. The SDK derives `notional` from the quote terms
(`notionalOf` in `packages/sdk/src/terms.ts`), and refuses pairs whose base leg is not tNIGHT.

**The gap: the contract cannot tie `notional` to the sealed size.** The commitment is hiding, so
the circuit cannot open it at commit time. A dealer could declare a small notional to slip under the
cap and then reveal a larger size. That is caught **client-side**: `verifyReveal` takes the on-chain
notional and rejects a reveal whose size differs, and the relay aggregator rejects any quote whose
on-chain notional is not the size the RFQ asked for. A taker using the reference SDK never trades
against an under-declared quote.

**Open, not decided:** whether an under-declared notional should also be **slashable**. It would be
objectively provable exactly like Class A — a dealer-signed reveal that *opens* the commitment but
whose size ≠ the on-chain notional — so `submitFraudProofMismatch` could be extended to cover it.
That changes the slashing rule, so it is surfaced in `ROADMAP.md` rather than built.

---

## 7a. `MIN_CHALLENGE_BOND`: ~2% of notional, with a floor (decided 2026-09-12)

The challenge bond is forfeited to the dealer if they *do* settle (§5.2), so it prices griefing. It
must be high enough that spamming challenges is unprofitable, and low enough that a wronged taker
still enforces their own trade.

**A flat value cannot satisfy both.** Any amount small enough for a 1,000-notional taker is
negligible against a 1,000,000 notional trade. Scale it: `challenge_bond = max(floor, 0.02 *
notional)`.

> **This corrects `FRONTEND.md` Screen 3**, which illustrated a **250 tNIGHT challenge bond on a
> 1,000 tNIGHT trade — 25% of notional.** That is not anti-griefing; it prices small takers out of
> enforcement entirely, which silently converts Class-B protection into a large-taker-only feature
> and quietly re-introduces the last-look exposure this protocol exists to remove.

**Implemented (M2 task 2.9, 2026-09-13).** `openSettlementChallenge` asserts
`bond >= CHALLENGE_BOND_FLOOR` and `bond * 100 >= notional * 2`, reading `notional` from the stored
`Quote`. The 2% rounds **up** (2% of 1001 requires 21, not 20), so rounding never favours the
challenger. `PLACEHOLDER_MIN_CHALLENGE_BOND` is gone.

**The floor's amount is still open.** It is set to 1 base unit, which makes it inert on testnet so
the scaling rule is what gets exercised. M4 task 4.1 sets the real value against real-value NIGHT;
until then this is not a Mainnet parameter. Note also that the Class-B decision still open in
`ROADMAP.md` may shrink or remove this circuit entirely.

---

## 8. Counters persist across bond lifecycle

`withdrawBond` removes the `Bond` but **not** the `settled` / `slashed` counters. A dealer cannot
launder a slash by withdrawing and re-bonding under the same commitment.

They *can* launder it by generating a fresh secret key and bonding as a new dealer — and that is
unavoidable in a permissionless pseudonymous system, since preventing it would require exactly the
identity layer this protocol exists to avoid. The defense is not prevention but economics: a fresh
dealer commitment has a *zero* settled count, so laundering a slash costs the dealer their entire
accumulated track record. Takers should treat "no history" and "bad history" as both unattractive
relative to a long clean record. This is stated as an open risk in `GRANT.md`.

---

## 9. Implementation findings from the M1 build

All five original risks are resolved. Recorded here because several contradicted assumptions in
this spec, and one of them silently disabled the protocol's entire enforcement mechanism.

1. **`Schnorr_schnorrVerify` polyfill — RESOLVED, works.** Still not in stdlib (confirmed against
   compiler 0.30.0). The hand-written `contracts/src/schnorr.compact` compiles and verifies
   correctly, but required a two-limb range-checked reduction: `ecMul` scalars must be valid
   Jubjub-subgroup elements (`EmbeddedFr`, ~252 bits) while a `transientHash` challenge lives in the
   ~255-bit Field, so a naive polyfill compiles and is broken for ~87.5% of inputs. Verified
   end-to-end in `contracts/test/schnorr.test.ts` against the real compiled circuit. **Class-A
   fraud proofs ship as specified; no fallback needed.**
2. **Validity-window upper bound — RESOLVED.** No `blockTimeLt` is needed:
   `assert(blockTimeGte(validUntil - MAX_QUOTE_VALIDITY))` expresses the cap directly. The M1 build
   shipped the *negated* form, which inverts the meaning and rejects every compliant quote. See the
   polarity warning in §5.2.
3. **Struct-valued `Map` and struct spread — RESOLVED, both supported.** `Map<Bytes<32>, Bond>` and
   `Bond { ...b, x: y }` work as written.
4. **Circuit size — measured.** `submitFraudProofMismatch` is the largest circuit as predicted
   (5.7 MB prover key vs ~2.8 MB for a typical bonding circuit), followed by `commitQuote` (5.2 MB).
   Real proving *time* still requires a proof server and is unmeasured.
5. **`JubjubPoint` equality — confirmed**, compare `jubjubPointX()` / `jubjubPointY()`.

Three constraints this spec did not anticipate:

6. **No module-scope `const`.** `const X: T = v;` at the top level is a parse error. Constants are
   nullary `pure circuit`s instead, which keeps a single source of truth.
7. **No division operator.** `/` is a parse error even for plain `Uint` arithmetic. The 60/10/30
   split uses a witness supplying pre-divided shares, range-checked in-circuit by multiplication —
   the same technique the Schnorr reduction needs.
8. **No way to read block time as a value.** Circuits can only *compare* against it via
   `blockTimeGte`. `requestBondWithdrawal` and `openSettlementChallenge` therefore take a
   caller-supplied `now`, bounded to within `TIME_SLACK` (300 s) of chain time by a two-sided
   check. **This adds a parameter not in §5.1/§5.2's original signatures**, and `TIME_SLACK` is an
   untuned placeholder — tracked as open in `ROADMAP.md`.
9. **`Map<K, Counter>` does NOT auto-vivify.** Both reading and incrementing an uninitialised
   counter throw at runtime. The M1 build omitted counter initialisation on the assumption that it
   did, which meant `recordSettlement` and `slashBond` failed for every dealer — **slashing never
   worked at all.** `postBond` now calls `settled.insertDefault` / `slashed.insertDefault`.

Every one of items 2, 8 and 9 compiled cleanly and passed `tsc --noEmit`. They were caught only by
executing the circuits (`contracts/test/`). Compilation is not verification.
