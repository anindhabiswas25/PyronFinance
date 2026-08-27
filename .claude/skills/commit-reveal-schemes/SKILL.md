---
name: commit-reveal-schemes
description: Implementing hash-commitment-then-reveal safely in Compact — binding and hiding properties, why commitments need entropy against low-cardinality brute force, and how a fraud-proof circuit verifies a mismatch. Use when working on commitQuote, submitFraudProofMismatch, or any sealed-bid mechanism.
---

# Commit-Reveal Schemes in Compact

This is the mechanism that makes the OTC protocol's anti-last-look guarantee work. Getting it subtly
wrong produces a scheme that *looks* correct and leaks every quote.

---

## 1. The two properties, and what breaks each

A commitment scheme `C = commit(value, nonce)` must be:

| Property | Means | Broken by | Consequence here |
|---|---|---|---|
| **Hiding** | `C` reveals nothing about `value` | Insufficient entropy — low-cardinality `value`, no/reused nonce | **Every sealed quote is readable pre-reveal.** The venue is worthless. |
| **Binding** | Committer can't open `C` to a different value | Hash collision (not a practical risk with Blake2-256) | A dealer could open to whatever price suits them post-hoc — last look, restored. |

**In this protocol, hiding is the fragile one.** Binding comes free from the hash function. Hiding
must be engineered, because prices are low-cardinality.

---

## 2. The critical rule: `persistentCommit`, never `persistentHash`

```compact
// ❌ CATASTROPHIC — a bare hash of a low-cardinality value is not hiding.
const C = persistentHash<Vector<4, Field>>([pair, side, price, size]);

// ✅ CORRECT — fresh 32-byte nonce, infeasible to brute-force.
const C = persistentCommit<Vector<4, Field>>([pair, side, price, size], nonce);
```

### Why this is not paranoia — do the arithmetic

A quote is `(pair, side, price, size)`. On a known RFQ, an attacker already knows the pair, the side,
and the size — they were broadcast in the RFQ. **Only the price is unknown.** A price like `41.44`
lives in a space of maybe 10⁵–10⁶ plausible ticks.

An attacker with the on-chain commitment enumerates every plausible price, hashes each, and compares.
That is **under a second on a laptop.** Every competing dealer would read every sealed quote before
reveal, and the sealed auction would be theater.

With a fresh 32-byte nonce inside the commitment, the search space becomes 2²⁵⁶ and the attack is
dead.

> **The general lesson:** the entropy in a commitment must come from the *nonce*, never from the
> value. Never reason "the value is unpredictable enough." Assume the attacker knows every field but
> one and can enumerate that one.

### Nonce discipline

- **Fresh per commitment.** Never derived from the price, the `rfqId`, a counter, or a timestamp.
  32 bytes from a CSPRNG.
- **Never reuse.** Two commitments with the same nonce and value are byte-identical on-chain,
  revealing that two quotes were the same price.
- **Persist to disk *before* submitting the commit transaction.** A lost nonce means the dealer
  cannot open their own commitment, cannot honor the quote, and gets slashed. See
  `docs/DEALER-NODE.md` §3.1.
- **Deliver inside the encrypted reveal**, so only the taker can open the commitment.

---

## 3. Context binding — commit to more than the value

A commitment to a bare price is replayable. Bind the context so a commitment is valid for exactly one
quote in one auction by one dealer.

In this protocol the binding is split across two layers:

```compact
// The commitment covers the terms:
C = persistentCommit<Vector<4, Field>>([pair, side, price, size], nonce)

// The quoteId binds it to dealer + auction, and is the ledger key:
quoteId = persistentHash<Vector<4, Bytes<32>>>([pad(32,"otc:quote:v1"), dealerCmt, rfqId, C])
```

`quoteId` is **deterministic and publicly recomputable**, which is what lets a taker locate a dealer's
on-chain commitment from a gossiped reference with no lookup service (`docs/RELAY.md` §3.2).

**Domain separation is mandatory.** Every hash purpose gets its own `pad(32, "...")` prefix —
`otc:dealer:v1`, `otc:quote:v1`, `otc:challenge:v1`, `otc:recipient:v1`. Reusing a separator across
purposes risks a value valid in one context being replayed in another.

---

## 4. The reveal must be signed — this is load-bearing

```
Dealer → Taker (point-to-point, encrypted):
  { terms: [pair, side, price, size], nonce, offerFile,
    sig: schnorrSign(dealerQuoteKey, terms) }
```

**Without a signature over the plaintext terms, the entire Class-A fraud-proof path collapses.**

Consider the fraud proof: "this reveal doesn't match the commitment, so slash." If reveals were
unsigned, *anyone* could fabricate a mismatching reveal for an honest dealer's commitment and slash
them. The signature is what makes a mismatching reveal **non-repudiable evidence** rather than an
unsupported claim.

So the fraud predicate is a conjunction, and both halves are essential:

```
FRAUD  ⟺  signatureValid(terms, sig, dealerQuotePk)      // the dealer really said this
      AND  persistentCommit(terms, nonce) != storedCommitment   // and it doesn't open the commitment
```

Sign the **terms**, not the ciphertext — the fraud-proof circuit verifies against plaintext terms it
recomputes the commitment from.

---

## 5. The fraud-proof circuit

```compact
export circuit submitFraudProofMismatch(
  quoteId: Bytes<32>,
  revealedTerms: Vector<4, Field>,
  revealedNonce: Bytes<32>,
  signature: Schnorr_SchnorrSignature,
  beneficiary: Bytes<32>
): [] {
  const q = quotes.lookup(disclose(quoteId));
  assert(!q.resolved, "Quote already resolved");
  const b = bonds.lookup(q.dealerCmt);

  // Half 1: authenticity. Omit this and anyone can slash an honest dealer.
  Schnorr_schnorrVerify<4>(disclose(revealedTerms), disclose(signature), b.quotePk);

  // Half 2: mismatch. Note the inequality — we prove fraud, not correctness.
  const recomputed = persistentCommit<Vector<4, Field>>(
      disclose(revealedTerms), disclose(revealedNonce));
  assert(recomputed != q.commitment, "Reveal matches commitment — no fraud");

  slashBond(q.dealerCmt, disclose(beneficiary));
}
```

Notes:

- **Callable by anyone.** No caller authentication — that is the point of permissionless enforcement.
  Security comes from the two asserts, not from who submits.
- **The proof necessarily reveals the fraudulent price.** Unavoidable: exhibiting the mismatch
  requires exhibiting the reveal. Only ever happens for already-fraudulent quotes.
- **Mark the quote resolved** to prevent double-slashing the same fraud.
- This is the largest circuit in the contract (signature verification + commitment recomputation).
  Watch proving time and the `k` parameter.

### ⚠️ `Schnorr_schnorrVerify` is a polyfill, not stdlib

In-circuit Jubjub Schnorr verification currently ships as a hand-written `schnorr.compact` module
(see the `example-zk-loan-application` skill), pending `jubjubSchnorrVerify` landing in the Compact
Standard Library. **Validate it compiles against the current compiler as M1 task 1.0, before building
anything on top of it.** If it fails, Class-A proofs cannot ship as specified.

Also: `JubjubPoint` equality must compare `jubjubPointX()` / `jubjubPointY()`. Struct `==` is
reference equality and always fails for freshly constructed points.

---

## 6. What a commitment cannot do — the reveal-refusal gap

**A commitment scheme binds what you say if you speak. It cannot make you speak.**

A dealer who commits and then simply never reveals has broken no cryptographic property. There is no
mismatch to prove — there is nothing at all. The chain sees a commitment and silence.

This is the fundamental limit of commit-reveal, and it is why this protocol needs a *second*,
non-cryptographic mechanism: the on-chain settlement challenge (`docs/CONTRACTS.md` §5.2). The taker
converts an unobservable off-chain omission into an observable on-chain one by opening a challenge
the dealer must answer.

**Do not attempt to solve reveal-refusal with a cleverer commitment scheme.** It is not that kind of
problem. Verifiable-delay or timelock constructions can force *eventual* opening, but they cannot
force opening within a trading window and they introduce hardware-dependent timing assumptions.

---

## 7. Timing rules

- **Commit must confirm on-chain before revealing.** Reveal-then-commit hands the taker a signed
  price with no commitment behind it — a durable artifact the dealer cannot retract. Enforce in both
  the Dealer Node and the UI.
- **Validity windows must be capped** (`MAX_QUOTE_VALIDITY = 900 s`). An uncapped window is an
  unbounded free option written to the market, and would force an unbounded bond-withdrawal timelock.
- **The withdrawal timelock must strictly exceed** `MAX_QUOTE_VALIDITY + CHALLENGE_WINDOW +
  PROOF_GRACE_PERIOD`, or a dealer can defect and exit before a fraud proof can land.

---

## 8. Checklist

- [ ] `persistentCommit` with a fresh 32-byte nonce — **never** `persistentHash` on quote terms
- [ ] Nonce from a CSPRNG; never derived from the value or any public field
- [ ] Nonce persisted to disk **before** the commit transaction is submitted
- [ ] Distinct `pad(32, "...")` domain separator per hash purpose
- [ ] Commitment bound to dealer + auction via `quoteId`
- [ ] Reveal signed over **plaintext terms** with the on-chain-registered quote key
- [ ] Fraud circuit asserts **both** signature validity **and** commitment mismatch
- [ ] Fraud circuit callable by anyone; quote marked resolved to prevent double-slash
- [ ] Commit confirmed on-chain before reveal is sent
- [ ] Validity window capped; timelock inequality holds
