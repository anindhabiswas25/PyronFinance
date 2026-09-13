# Programmable Disclosure

## The design position

Most "compliant privacy" designs hardcode an auditor: a fixed key, baked into the contract, that can
decrypt some or all activity. That design has two problems. It is a **standing backdoor** — the key
holder's power does not depend on any counterparty agreeing to it — and it is **not
programmable** — you get exactly the one policy the contract author imagined.

We take a different position: **the contract knows nothing about auditors.**

`OTCProtocol.compact` stores, per settled trade, an opaque triple:

```
(ciphertextHash, policyTag, recipientHint)
```

It does not know what the ciphertext contains, who can decrypt it, or what the policy tag means. It
enforces exactly one property, which is the only one that needs cryptographic enforcement:

> **A disclosure note is provably tied to one specific settled trade, and to no other activity.**

Everything else — who the recipient is, under what conditions they may decrypt, what the note says —
is negotiated between the counterparties and interpreted by client software. That is what makes this
a *primitive* rather than a policy.

### What this buys

- **No standing backdoor.** A note exists only because both counterparties created one for that
  trade. There is no key that unlocks a dealer's history.
- **Provable scope.** A recipient can verify the note belongs to trade `X`. They learn nothing about
  trades `Y` and `Z` — not their existence, not their size, not their counterparties.
- **Policy evolution without a contract migration.** New policy shapes are new `policyTag` values and
  new client code. The ledger schema never changes.

### What this does not buy — stated plainly

- **Not enforcement.** The chain does not compel anyone to attach a note, nor a recipient to act on
  one. A dealer required by their own regulator to disclose must *choose* to attach a note. This
  primitive makes honest disclosure **possible and verifiable**; it does not make dishonesty
  impossible. Any claim otherwise would be false.
- **Not a compliance product.** Whether a given policy shape satisfies a given jurisdiction is a legal
  question this repository does not answer.
- **Not confidential from the counterparty.** Both parties to a trade know the trade. A note conceals
  it from *third parties*, not from the other side.

---

## Scope: what ships in M3

**Confirmed with the project owner: M3 ships a single policy shape.**

| Policy | Tag | M3 status | Notes |
|---|---|---|---|
| **Named recipient** | `0x0001` | **In scope** | Encrypt to one recipient pubkey both counterparties agree on. |
| Time-delayed reveal | `0x0002` | **Deferred** | Note becomes decryptable after a block-time threshold. |
| Threshold (k-of-n) | `0x0003` | **Deferred** | Requires multi-party key management; largest chunk of work by far. |
| Dual-recipient | `0x0004` | **Deferred** | Two independent recipients, each able to decrypt alone. |

`policyTag` is a `Uint<16>` on the ledger **from M1**, so the deferred shapes need no contract change
later — only client support. Reserving the field now is the cheap decision that keeps the expensive
one open.

**Why only one shape in M3.** Named-recipient is the shape that actually exercises the primitive
end-to-end: attach, tie to a trade, decrypt by the intended party only, and — critically — verify
that *nobody else* can decrypt and that the note reveals nothing about other trades. Building three
shapes at once would test the key management of each and the *primitive* properly of none. The
deferred shapes are documented below in enough detail that adding them is implementation, not design.

---

## The M3 shape: named recipient

### Attach

```
Inputs (both counterparties agree on the recipient out of band):
  tradeId       — derived from the settled quoteId (deterministic, publicly recomputable)
  recipientPk   — X25519 public key of the intended recipient
  note          — plaintext trade record (JSON)

1.  note = {
      "v": 1, "tradeId": "<hex32>", "pair": "tNIGHT/USDM", "side": "sell",
      "price": "0.0412", "size": "1000.0", "settledAt": 1756300900,
      "dealerCmt": "<hex32>",
      "parties": { /* whatever the counterparties agree to include */ },
      "salt": "<hex32>"          // fresh; see "Why a salt" below
    }

2.  ephemeral X25519 keypair (eskA, epkA)      — fresh per note, never reused
    shared = X25519(eskA, recipientPk)
    key    = HKDF-SHA256(shared, info = "otc:disclosure:v1" ‖ tradeId)
    ct     = ChaCha20-Poly1305(key, nonce, canonicalJSON(note))

3.  blob = { v: 1, epk: epkA, nonce, ct }      // stored OFF-CHAIN
    ciphertextHash = blake2b256(blob)

4.  on-chain:
      attachDisclosureNote(
        tradeId,
        ciphertextHash,
        policyTag     = 0x0001,
        recipientHint = blake2b256("otc:recipient:v1" ‖ recipientPk)
      )
```

**The ciphertext never goes on-chain.** Only its hash does. The blob is delivered to the recipient
directly, or held by either counterparty and produced on request. This keeps on-chain cost constant
regardless of note size, and means an attached note that is never delivered reveals nothing at all —
not even its length.

**`recipientHint` is a hash, not the key.** Publishing the raw recipient key would let observers see
*which* auditor or regulator a dealer is reporting to, and correlate that across every trade — a
significant leak with no compensating benefit. The hash lets an expecting recipient recognize their
own notes; it tells everyone else nothing.

**Why a salt in the note.** Trade fields are low-entropy — a pair, a side, a round size, a price with
few significant digits. Without a salt, an observer holding `ciphertextHash` could brute-force
candidate notes and confirm a guess. The salt makes `ciphertextHash` uninformative about contents.
This is the same reasoning that requires `persistentCommit` over `persistentHash` for quote
commitments (`.claude/skills/commit-reveal-schemes/SKILL.md`) — low-cardinality data hashed without
entropy is not hidden.

**Domain-separated HKDF `info`.** Binding the key derivation to `tradeId` means a blob for trade `X`
cannot be replayed as a valid note for trade `Y`, even by the counterparties.

### Decrypt and verify

The recipient, given the blob:

```
1. shared = X25519(recipientSk, blob.epk)
   key    = HKDF-SHA256(shared, info = "otc:disclosure:v1" ‖ tradeId)
   note   = ChaCha20-Poly1305-open(key, blob.nonce, blob.ct)
       └─ AEAD failure => wrong recipient, wrong trade, or tampered blob. Reject.

2. VERIFY AGAINST CHAIN — this step is what makes the note evidence rather than a claim:
     a. notes[tradeId] exists
     b. notes[tradeId].ciphertextHash == blake2b256(blob)
     c. notes[tradeId].policyTag == 0x0001
     d. note.tradeId == tradeId
     e. quotes[quoteId].resolved == true   (the trade actually settled)
```

Step 2 is the whole point. A note that decrypts but does not match the chain record is a party
*claiming* something about a trade. A note that decrypts **and** matches is tied, by a hash the
counterparties committed to on-chain at settlement time, to a settlement that demonstrably occurred.
Neither party can later produce a different note for the same trade, because `attachDisclosureNote`
rejects a second attachment for an existing `tradeId`.

### What a recipient learns, exactly

| Learns | Does not learn |
|---|---|
| Full contents of this one note | Anything about any other trade |
| That this trade settled on-chain | The dealer's other quotes, sizes, or counterparties |
| The dealer's pseudonymous commitment | Any real-world identity |
| That no substituted note exists for this trade | Whether other trades have notes at all |

---

### As implemented (M3 task 3.7, 2026-09-14) — `packages/sdk/src/disclosure.ts`

The sketch above left four encoding details open. The reference implementation fixes them, and an
independent client must match them byte for byte:

| Detail | Choice | Why |
|---|---|---|
| `tradeId` | The settled quote's **`quoteId`** | It is the key `attachDisclosureNote` checks in `quotes`, and anyone can recompute it |
| HKDF `info` | UTF-8 `"otc:disclosure:v1"` followed by the **32 raw `tradeId` bytes** | "‖ tradeId" needed a byte encoding; raw bytes, not hex |
| AEAD additional data | The 32 raw `tradeId` bytes | Belt and braces: a blob for trade X fails authentication under trade Y even if key derivation were ever changed |
| `ciphertextHash` | `blake2b256(canonicalJSON(blob))`, with `canonicalJSON` as defined in `RELAY.md` §2 | "blake2b256(blob)" needed a byte encoding of a JSON object |

Verification adds a sixth check to the five above: `notes[tradeId].recipientHint ==
blake2b256("otc:recipient:v1" ‖ recipientPk)`, so a recipient does not accept a note that the chain
record addresses to someone else.

**Caveat — "settled" is stronger than the contract enforces.** `attachDisclosureNote` checks
`quotes[tradeId].resolved`, and `resolved` is also set when a quote is released unsettled or slashed.
The chain therefore proves "tied to one resolved quote". Check (e) above inherits this. Tracked in
`ROADMAP.md` open decisions; closing it needs a contract change.

Tests: `packages/sdk/test/disclosure.test.ts` runs test-plan items 1–7 against the compiled contract
in the simulator, including a wrong recipient, a tampered blob (failing both the AEAD and the hash), a
substituted note re-encrypted to the right recipient (fails the hash), attachment to an unknown or
unsettled trade, a second attachment, and cross-trade unlinkability.

## Deferred shapes (design sketches, not M3 scope)

### Time-delayed reveal (`0x0002`)

Encrypt as above, but publish the decryption key material only after a block-time threshold. Two
implementations, both with real drawbacks:

- **Trusted-release:** a third party holds the key and releases at time `T`. Simple; reintroduces a
  trusted party, which is most of what we are trying to avoid.
- **Timelock puzzle:** sequential-work encryption, decryptable by anyone willing to compute for a
  known duration. No trusted party, but wall-clock duration is hardware-dependent and therefore
  imprecise.

Chain-enforced time-release is **not** achievable by storing the key on-chain after `blockTimeGte(T)`,
because whoever submits that transaction already had the key. Deferred pending a design that does not
smuggle in a trusted party.

### Threshold k-of-n (`0x0003`)

Shamir-split the content key across `n` recipients; any `k` reconstruct. The cryptography is
standard; the hard part is entirely operational — key distribution, recipient set changes, share
custody. This is why it is deferred: it is a key-management product, not a contract feature.

### Dual-recipient (`0x0004`)

Encrypt the content key separately to two recipient keys and include both wrapped keys in the blob.
Straightforward; deferred only for scope. Likely the first shape added after M3.

---

## Test plan (M3 definition of done)

A settled trade's disclosure note round-trips in an automated test script:

1. Settle a trade on Preprod; derive `tradeId`.
2. Attach a note encrypted to recipient R; assert `notes[tradeId]` matches locally computed
   `ciphertextHash`.
3. **R decrypts successfully** and all five chain-verification checks pass.
4. **A different party W, given the same blob, fails to decrypt** (AEAD failure) — the negative case
   is the one that actually proves the primitive works.
5. **A tampered blob fails** both the AEAD check and the `ciphertextHash` comparison.
6. **A second `attachDisclosureNote` for the same `tradeId` is rejected** by the contract.
7. R learns nothing about a second, unrelated settled trade — assert no linkage is derivable from the
   note or the chain record.

Test 4 and test 7 are the ones that matter. Tests 1–3 only show the happy path works; 4 and 7 show
the confidentiality and scoping claims in this document are real.
