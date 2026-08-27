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

const MIN_BOND: Uint<128> = /* set per-deployment; see §7 */;
const MIN_CHALLENGE_BOND: Uint<128> = /* see §5.2 */;
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
| `commitQuote` | dealer commitment, **commitment hash**, validity window, rfqId | **the price**, size, the nonce, the Offer File |
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
  assert(disclose(amount) >= MIN_BOND, "Bond below minimum");
  receiveUnshielded(default<Bytes<32>>, disclose(amount));
  bonds.insert(cmt, Bond {
    amount: disclose(amount), quotePk: disclose(quotePk),
    withdrawRequested: 0, liveQuotes: 0, openChallenges: 0, active: true,
  });
  settled.insert(cmt, default<Counter>());
  slashed.insert(cmt, default<Counter>());
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
export circuit commitQuote(rfqId: Bytes<32>, commitment: Bytes<32>, validUntil: Uint<64>): [] {
  const cmt = disclose(dealerCommitment(dealerSecretKey()));
  const b = bonds.lookup(cmt);
  assert(b.active, "Dealer not active (withdrawing or unbonded)");
  assert(b.amount >= MIN_BOND, "Bond fell below minimum after slashing");
  // Cap validity: an unbounded window would let a dealer sit on a free option indefinitely,
  // and would force BOND_WITHDRAW_DELAY to be unbounded too.
  assert(!blockTimeGte(disclose(validUntil)), "validUntil already past");
  assert(blockTimeGte(disclose(validUntil) - MAX_QUOTE_VALIDITY) == false
         || true, /* see §9 note on expressing an upper bound */ "Validity window too long");
  const qid = deriveQuoteId(cmt, disclose(rfqId), disclose(commitment));
  assert(!quotes.member(qid), "Duplicate quote");
  quotes.insert(qid, Quote { dealerCmt: cmt, commitment: disclose(commitment),
                             validUntil: disclose(validUntil), rfqId: disclose(rfqId),
                             resolved: false });
  bonds.insert(cmt, Bond { ...b, liveQuotes: (b.liveQuotes + 1) as Uint<32> });
}

// Taker converts an unobservable off-chain omission into an observable on-chain one.
// UPDATED during M1 build: `now` is caller-supplied and chain-validated — same reasoning as
// requestBondWithdrawal above.
export circuit openSettlementChallenge(quoteId: Bytes<32>, bondAmount: Uint<128>, now: Uint<64>): [] {
  const q = quotes.lookup(disclose(quoteId));
  assert(!q.resolved, "Quote already resolved");
  assert(!blockTimeGte(q.validUntil), "Quote expired — nothing to honor");
  assert(disclose(bondAmount) >= MIN_CHALLENGE_BOND, "Challenge bond too small");
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
export circuit recordSettlement(quoteId: Bytes<32>, challengeId: Maybe<Bytes<32>>): [] {
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
  assert(!notes.member(disclose(tradeId)), "Note already attached");
  notes.insert(disclose(tradeId), NoteRef {
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

## 7. Open parameter: `MIN_BOND`

Deliberately left unset in this spec. The right value is an economic judgment that needs Preprod
data, not a number invented now.

The binding constraint: **a bond must exceed the maximum profit from defecting on the largest quote
it backs.** That profit is roughly `size × adverse_price_move` over the quote window. A 15-minute
window on a volatile pair can move 1–2%, so a bond credibly backing a 100k notional quote wants to be
in the low thousands, not tens.

Two candidate designs, to be decided with M2 data:

1. **Flat `MIN_BOND` floor** — simple, but either over-collateralizes small dealers or
   under-collateralizes large quotes.
2. **Per-quote notional cap** — `commitQuote` rejects quotes whose notional exceeds `bond × k`. Scales
   correctly and needs no oracle if notional is denominated in the bond asset. **Currently preferred.**

Design (2) requires `commitQuote` to see the quote *size*, which leaks size while keeping price
hidden. Whether that trade is acceptable is an M2 decision, recorded here so it is made deliberately.

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

## 9. Implementation risks to resolve during M1

1. **`Schnorr_schnorrVerify` is a polyfill, not stdlib.** In-circuit Jubjub Schnorr verification
   currently ships as a hand-written `schnorr.compact` module (per the `example-zk-loan-application`
   reference), pending `jubjubSchnorrVerify` landing in the Compact Standard Library. Class-A fraud
   proofs depend on it entirely. **First M1 task: confirm the polyfill compiles and verifies against
   the current compiler version.** If it does not, Class-A proofs cannot ship as specified and the
   design must fall back to challenge-based detection for both fraud classes — a materially weaker
   guarantee that would need to be disclosed in `GRANT.md`.
2. **Expressing "validity window not too long."** `blockTimeGte` gives a lower bound; the upper-bound
   check in `commitQuote` is written awkwardly above pending confirmation of `blockTimeLt`
   availability. Resolve and rewrite cleanly.
3. **Struct-valued `Map` and struct spread.** `Map<Bytes<32>, Bond>` and `Bond { ...b, x: y }` spread
   syntax both need verification against the compiler; if spread is unsupported, structs must be
   rebuilt field-by-field.
4. **Circuit size.** `submitFraudProofMismatch` does signature verification *and* a commitment
   recomputation, making it by far the largest circuit. Watch proving time and the `k` parameter.
5. **`JubjubPoint` equality** must compare `jubjubPointX()` / `jubjubPointY()` — struct `==` is
   reference equality and always fails for freshly constructed points.

Update `.claude/skills/compact-contracts/SKILL.md` in place with whatever these investigations reveal.
