---
name: compact-contracts
description: Compact patterns for this protocol — ledger/circuit structure, public/private state separation, no cross-contract calls, circuit size and budget limits, and the off-chain witness-provider pattern for values a circuit cannot compute natively. Use when writing or debugging OTCProtocol.compact.
---

# Compact Patterns for OTCProtocol

Project-specific companion to the bundled `compact` skill. That skill is the language reference; this
one records the constraints and decisions that matter for **this** contract.

> **Update this file in place** whenever contract work reveals a Compact constraint it doesn't
> capture. That is an explicit working agreement in `CLAUDE.md`.

---

## 1. The two worlds

| World | Where | Who sees it | How it changes |
|---|---|---|---|
| `export ledger` | Every network node | **Everyone, in plaintext** | Via a verified ZK proof |
| `witness` | The user's own machine | Only them | Never — it stays local |

`disclose()` is a **compile-time annotation, not encryption.** It tells the compiler "I intend this to
be public." The disclosed value is plaintext on-chain. The compiler tracks witness taint and errors if
untainted witness data reaches a ledger write or a circuit return — that error is a feature; do not
work around it by reflexively wrapping things in `disclose()` until it compiles.

### This contract is mostly public, deliberately

A reviewer will expect a privacy protocol's contract to be private. `OTCProtocol.compact` is not, and
that is correct: its job is making dealer accountability **verifiable**, and verifiability requires
publicity. The privacy lives in the **reveal channel** (point-to-point encrypted) and in **Zswap
settlement** — not in this contract.

The only genuinely secret things here:

- `dealerSecretKey()` — never disclosed; only its **commitment** is
- **Quote prices** — hidden inside `persistentCommit`, revealed only off-chain to one taker
- Commitment **nonces** — travel in the encrypted reveal, never on-chain

Everything else — bond sizes, settled counts, slash counts, quote validity windows, which dealer
quoted on which RFQ — is public **on purpose**. That public track record is what takers use instead of
KYC.

---

## 2. No cross-contract calls

**Compact does not support contract-to-contract calls.** `OTCProtocol.compact` is one contract, and
everything requiring trustlessness lives in it.

Practical consequences:

- No separate `Bond.compact` / `Quotes.compact` / `Slashing.compact` split. Use `module` / `import`
  for *source* organization (as with `import "schnorr" prefix Schnorr_`), which is compile-time only.
- No calling out to a token contract. Native token movement uses `receiveUnshielded` /
  `sendUnshielded` directly.
- No oracle call. The contract has no opinion on fair value, by design (`docs/CONTRACTS.md` §1).
- Settlement is **Zswap**, a protocol-level primitive, not a contract we call. `recordSettlement`
  records that settlement happened; it cannot verify it. That gap is documented and accepted.

---

## 3. Ledger ADT choices, and why

| Our ledger field | Type | Why this one |
|---|---|---|
| `bonds` | `Map<Bytes<32>, Bond>` | Per-dealer lookup by commitment. Public by design. |
| `settled` / `slashed` | `Map<Bytes<32>, Counter>` | `Counter` has monotonic `.increment(n)`; these must never decrease. |
| `quotes` | `Map<Bytes<32>, Quote>` | Keyed by deterministic, publicly recomputable `quoteId`. |
| `challenges` | `Map<Bytes<32>, Challenge>` | Keyed by `deriveChallengeId(quoteId, taker)`. |
| `notes` | `Map<Bytes<32>, NoteRef>` | One note per `tradeId`; re-attachment rejected. |
| `burnedTotal` | `Uint<128>` cell | Transparency only. **No circuit path may ever decrease it.** |

**Why no `MerkleTree` anywhere.** `MerkleTree` exists to give *anonymous membership proofs* — proving
you're in a set without revealing which member you are. This protocol wants the opposite for dealers:
a taker must see **exactly which** dealer has **exactly which** bond and track record. Anonymity
within the dealer set would destroy the trust signal. Using `Map` here is a deliberate choice, not an
oversight — do not "improve" it to a Merkle tree.

**`Counter` cannot decrease**, which is exactly right for `settled` and `slashed`. Counters
deliberately survive `withdrawBond` so a dealer can't launder a slash by re-bonding under the same
commitment (`docs/CONTRACTS.md` §8).

---

## 4. Type rules that bite

- **`Field` supports only `==` / `!=`.** Any ordering comparison needs `Uint<n>` or `Uint<0..n>`. All
  our timestamps and amounts are `Uint<64>` / `Uint<128>` for this reason.
- **`Uint<n>` wraps on overflow.** Arithmetic on bond amounts and basis-point splits must be
  bounds-checked. In `slashBond`, compute the burn share as the **remainder**
  (`amount - takerCut - proverCut`) so integer-division rounding cannot leak value or over-pay.
- **`as Uint<0..n>` casts can fail at runtime**, not compile time — a failed cast is a failed
  transaction.
- **`JubjubPoint` equality:** compare `jubjubPointX()` / `jubjubPointY()`. Struct `==` is reference
  equality and always fails for freshly constructed points.
- **Structs are nominally typed** — matching shape isn't enough, the name matters.
- **`Uint<0..n>` is capped at `n <= 2^248`.** A literal or const bound above that fails to compile
  (`range end ... exceeds the limit of ... (2^248)`). This is why the Schnorr polyfill's scalar-field
  range check (§9 below) can't express `Uint<0..R>` directly for Jubjub's ~252-bit order — it needs a
  two-limb decomposition instead.
- **Large integer literals used as `Field` need an explicit `as Field` cast** once they exceed the
  largest representable `Uint` literal (i.e., `>= 2^248`), e.g.
  `(6554484396890773809930967563523245729705921265872317281365359162392183254199 as Field)`.

### Unverified against the compiler — check during M1

1. **Struct-valued `Map`** (`Map<Bytes<32>, Bond>`).
2. **Struct spread syntax** (`Bond { ...b, amount: 0 }`). If unsupported, rebuild field-by-field.
3. **`blockTimeLt`** for the validity-window *upper* bound. `blockTimeGte(t)` gives a lower bound only;
   `docs/CONTRACTS.md` §5.2 currently has a placeholder awaiting this.
4. **`Maybe<Bytes<32>>` as a circuit parameter** (`recordSettlement`'s optional `challengeId`).

Record the answers here as they're found.

---

## 5. Time

```compact
assert(blockTimeGte(disclose(unlockTime)), "Timelock not elapsed");
```

- `blockTimeGte(t)` → true when `block_time >= t`. `Uint<64>` Unix seconds.
- **Never store raw block time on the ledger.** Store target timestamps and compare.
- Chain time is coarse and slightly adversarial. Every window in this protocol
  (`CHALLENGE_WINDOW`, `PROOF_GRACE_PERIOD`, `BOND_WITHDRAW_DELAY`) is sized with generous margin
  rather than tuned tight — see the timelock inequality in `docs/CONTRACTS.md` §6.

---

## 6. Token custody

```compact
receiveUnshielded(default<Bytes<32>>, disclose(amount));                    // in
sendUnshielded(default<Bytes<32>>, amount,
               right<ContractAddress, UserAddress>(disclose(recipient)));   // out
```

The contract custodies bonds and challenge bonds. Rules:

- **Every inbound path must have a matching outbound path** — except the burn share, which
  intentionally has none.
- **"Burning" = retaining with no withdrawal path.** There is no burn primitive. Unspendability
  enforced by the *absence* of a release path is stronger than a privileged burn address, because no
  key can ever change it.
- **Check for pending obligations before releasing.** `withdrawBond` asserts
  `liveQuotes == 0 && openChallenges == 0` **and** the timelock. Both, not either.

---

## 7. The witness-provider pattern

A `witness` declares a private input whose **signature is in Compact** and whose **body is in
TypeScript**. Use it for values a circuit cannot compute natively.

```compact
witness dealerSecretKey(): Bytes<32>;
witness takerAddress():    Bytes<32>;
```

```typescript
// packages/sdk — the provider side
export const otcWitnesses = {
  dealerSecretKey: ({ privateState }: WitnessContext<Ledger, OTCPrivateState>):
    [OTCPrivateState, Uint8Array] => [privateState, privateState.dealerSk],

  takerAddress: ({ privateState, coinPublicKey }: WitnessContext<Ledger, OTCPrivateState>):
    [OTCPrivateState, Uint8Array] => [privateState, coinPublicKey],
};
```

**Witnesses are untrusted.** The circuit must validate anything a witness returns — a malicious
client can return whatever it likes. Our defense is structural: `dealerSecretKey()` is never used
directly, only through `dealerCommitment(sk)`, and the resulting commitment must already exist in
`bonds`. A caller supplying a fabricated key derives a commitment that isn't bonded, and the lookup
fails. **Never trust a witness value that isn't checked against ledger state.**

Follow the `example-locker-dapp` and `midnight-js` skills for provider wiring.
*(Note: MidSwap is not present on this machine — those bundled skills are the reference instead.)*

---

## 8. Circuit size and proving cost

Every operation becomes constraints. Rough ordering, cheapest first: comparisons and arithmetic <
`persistentHash` / `persistentCommit` < Merkle path verification < **signature verification**.

**`submitFraudProofMismatch` is by far our largest circuit** — Schnorr verification plus a commitment
recomputation. Watch it:

- Measure proving time early; it directly affects whether fraud proofs are practical to submit.
- If it exceeds budget, the fallback is to verify the signature off-chain and have the circuit accept
  a pre-verified attestation — **but that reintroduces a trusted party and would gut the
  permissionless-enforcement claim.** Treat it as a last resort requiring an explicit decision, not a
  quiet optimization.

Conversely, on the **preview** network a too-*small* circuit fails with
`prove: no SRS params for k=6`. Our circuits are unlikely to hit this, but `attachDisclosureNote` is
small enough to be worth checking.

---

## 9. The Schnorr polyfill — task 1.0 resolution

**Resolved 2026-08-27, against Compact compiler 0.30.0 / `compact-runtime` 0.15.0 / ledger 8.0.**
`jubjubSchnorrVerify` is still not in stdlib — confirmed by grepping `compactc.bin` for the string
`schnorr` (absent entirely). The polyfill is required and lives at `contracts/src/schnorr.compact`,
imported as `import "schnorr" prefix Schnorr_;`.

**The subtlety that isn't in the elided reference example:** a `transientHash` challenge lives in
Compact's native `Field` (~255-bit BLS12-381 scalar field), but `ecMul` / `ecMulGenerator` scalars —
including `signature.response` itself — must be valid **Jubjub-subgroup scalars**, a smaller field the
runtime calls `EmbeddedFr`. Passing an unreduced Field value into either produces a runtime error:
`failed to decode for built-in type EmbeddedFr after successful typecheck`. A challenge exceeds
`EmbeddedFr`'s range roughly 87.5% of the time, so a naive polyfill (hash straight into `ecMul`)
*compiles* but is broken for almost every input.

**Jubjub's subgroup order**, empirically determined by binary-searching the exact `EmbeddedFr` decode
boundary (not taken from memory or docs):

```
R = 6554484396890773809930967563523245729705921265872317281365359162392183254199   (252 bits)
```

**Why this needs a two-limb range check, not a single `Uint<0..R>` bound:** `Uint<0..n>` caps at
`n <= 2^248` (see §4), and `R` is ~252 bits. `schnorr.compact` decomposes the challenge as
`challenge = quotient*R + remHi*2^248 + remLo` via a witness `getChallengeReduction`, with:

- `quotient: Uint<0..9>` (`floor(FieldModulus / R) == 8`)
- `remHi: Uint<0..15>`, `remLo: Uint<248>`, plus an explicit
  `assert(remHi < 14 || remLo < R_LO, ...)` lexicographic check against `R`'s own hi/lo split
  (`R_HI = 14`, `R_LO = 222104516725044372704429320860625768980218979470098935457522536959433977015`)

**Why the lexicographic check is load-bearing, not defense-in-depth:** bounding only `remHi < 15` and
`remLo < 2^248` allows `remainder < 15*2^248`, which is *larger* than `R`. Without the extra check, a
dishonest witness could submit a non-canonical `(quotient, remainder)` pair — e.g. `quotient - 1` paired
with `remainder + R` — that still satisfies `quotient*R + remainder == challenge` under Field
arithmetic while using a different effective EC scalar. This was verified as an actual attack vector
(not hypothetical) in the test harness below, and the range check closes it.

**Also required:** `response` (the signature's own scalar) must independently be `< R`, computed by
the signer as `s = (k + (c mod R)*sk) mod R` — true Euclidean mod-`R` arithmetic, not native Field
arithmetic (mod the *different* field modulus `p`). This is real production guidance for the SDK's
signing code (task 1.8), not just a test detail.

**How this was verified** (not just compiled — actually run against real signatures via
`compact-runtime`'s `Contract`/`createCircuitContext`, with a witness computing the true Euclidean
decomposition):

- A validly-signed message verifies.
- A tampered message, a tampered response, and the wrong pubkey are all rejected.
- Challenge values at exactly `R-1`, `R`, and `R+1` all reduce correctly (limb boundary is correct).
- A witness attempting the non-canonical `(quotient-1, remainder+R)` substitution described above is
  rejected by the in-circuit range check.

**Consequence for `submitFraudProofMismatch` (§9.4 sizing note above):** this circuit is now larger
than the original estimate — it does the challenge hash, the two-limb range-checked reduction, *and*
the EC verification. Proving-time measurement (task 1.9/2.8) should account for this.

---

## 10. Security checklist for this contract

- [ ] Quote commitments use `persistentCommit` with a fresh nonce — **never** `persistentHash`
- [ ] Distinct `pad(32, "otc:...:v1")` domain separator per hash purpose
- [ ] Every witness value validated against ledger state before being trusted
- [ ] `withdrawBond` checks timelock **and** `liveQuotes == 0` **and** `openChallenges == 0`
- [ ] Slash arithmetic computes the burn share as a remainder — no rounding leak
- [ ] Fraud circuits are callable by **anyone**; no caller authentication anywhere
- [ ] Quotes/challenges marked `resolved` to prevent double-slashing
- [ ] **No privileged key, owner, admin, or pause anywhere.** If one appears, the change is wrong.
- [ ] No circuit compares two prices — matching and comparison are client-side, off-chain
