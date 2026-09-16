<div align="center">
<img width="1455" height="830" alt="Screenshot 2026-09-16 at 12 39 33 PM" src="https://github.com/user-attachments/assets/ed73af2f-dd78-4fbe-bf71-69f2da1a264f" />

# Pyron Finance

### Private OTC trading on Midnight, where a dealer's quote is binding by cryptography and a bond instead of by a legal contract.

**Midnight OTC Protocol** · bonded dealers · sealed commit-reveal quotes · permissionless slashing · open relay network

[![Network](https://img.shields.io/badge/network-Midnight%20Preprod%20%7C%20Preview-6b4eff)](#-deployments)
[![Contract](https://img.shields.io/badge/contract-Compact%200.30-222)](contracts/src/OTCProtocol.compact)
[![Relays](https://img.shields.io/badge/relays-2%20live-2ea44f)](#relay-network-public-nodes)
[![Status](https://img.shields.io/badge/status-testnet-orange)](#-project-status)

[Deployments](#-deployments) · [Architecture](#-architecture) · [Quickstart](#-quickstart) · [Run a Dealer](#-run-a-dealer-node) · [Run a Relay](#-run-a-relay-node) · [Docs](#-documentation)

</div>

---

## ✦ Why Pyron

Bilateral OTC trading has a long-standing problem called **last look**. A dealer quotes a price.
If the market then moves against them, they re-price or refuse, because nothing binds them to the
quote. The taker carries all of that risk.

Traditional finance handles this with central clearing, legal contracts and vetting of who may
trade. All of these require the parties to disclose their identity, which a privacy-preserving
venue is built to avoid.

Pyron uses [Midnight](https://midnight.network) to handle it differently: **it binds dealers to
their quotes with cryptography and money at stake, not with contracts.**

| | Traditional OTC desk | Pyron |
|---|---|---|
| Who may quote | Approved counterparties | **Anyone who posts a bond** |
| What binds the quote | A legal agreement | **An on-chain commitment and a bond that can be slashed** |
| Who handles fraud | A clearing house or a court | **Anyone can submit a proof, and a circuit checks it** |
| Identity | KYC'd legal entity | **A pseudonymous key commitment** |
| Price visibility | Visible to the venue | **Encrypted point-to-point to the taker only** |
| Compliance | Blanket access for auditors | **A disclosure note for one trade, sent to a recipient chosen per trade** |

### The three pillars

1. **Permissionless bonded dealers.** A dealer posts a bond and can start quoting. There is no
   allowlist and no admin key. A dealer appears on-chain only as a key commitment, and public
   settled and slashed counters give each dealer a track record. Withdrawing a bond requires a
   24-hour timelock.
2. **Sealed commit-reveal quotes, with slashing.** A dealer commits to a hash of the quote on-chain
   *before* revealing the price. The priced reveal is encrypted and sent only to the taker. If the
   signed reveal doesn't match the commitment, **anyone** can submit a fraud proof, and the dealer's
   whole bond is slashed.
3. **An open relay network with programmable disclosure.** The relay is a gossip wire format that
   anyone can run, not a hosted backend. Priced reveals never pass through gossip. Compliance uses a
   generic on-chain `(ciphertextHash, policyTag)` note tied to exactly one settled trade.

The **reference Dealer Node** ships alongside the protocol. It addresses the cold-start problem: to
become a dealer you need a config file and a bond, not a development project.

> **What Pyron is not:** it is not an allowlist, not a central limit order book (Midnight has no
> shared private state to match hidden orders in), not an AMM (no pools, curves or LP tokens), and
> not a hosted API.

---

## ✦ How it works

```
 0. BOND        Dealer ── postBond(amount, quotePk) ─────────────────────────────▶ chain
                (permissionless; no approval step exists)

 1. RFQ         Taker ── RFQ{pair, side, size, expiry, takerEncPk} ──▶ relay gossip
                (no price, no identity)

 2. COMMIT      Dealer builds a Zswap Offer File, then:
                  C = persistentCommit(terms, nonce)
                  commitQuote(rfqId, C, validUntil, notional) ────────────────────▶ chain
                  quote_ref{quoteId} ──▶ relay gossip
                PUBLIC: that dealer X quoted, and until when.   HIDDEN: the price.

 3. REVEAL      Dealer ── Enc_taker(terms, nonce, offerFile) + Schnorr sig ──▶ Taker
                (point-to-point or opaque relay mailbox; NEVER gossiped)

 4. COMPARE     Taker's client, off-chain only:
                  ✓ signature valid under the dealer's on-chain quotePk
                  ✓ persistentCommit(terms, nonce) == on-chain commitment
                  ✓ revealed size matches on-chain notional, quote still valid
                  ✓ offer inputs unspent (indexer pre-check)
                → rank by price, weighted by bond and settled/slashed history

 5. SETTLE      Taker settles ALONE with the dealer's pre-proved Offer File
                (Zswap atomic swap; balance vector nets to zero)
                Dealer ── recordSettlement(quoteId) ────────────────────────────▶ chain

 6. DISCLOSE    Either party ── attachDisclosureNote(tradeId, ctHash, policyTag) ──▶ chain
    (optional)
```

### Fraud path: commitment mismatch (Class A)

```
Dealer commits C, then reveals terms' where persistentCommit(terms', nonce') ≠ C,
and signs the reveal (the taker's client rejects an unsigned one).

ANYONE ── submitFraudProofMismatch(quoteId, terms', nonce', sig) ──▶ chain
           circuit checks:  Schnorr(sig, quotePk) valid  ∧  commit(terms', nonce') ≠ C
           ⇒ full bond slashed:  60% wronged taker · 10% fraud prover · 30% burned
           ⇒ dealer deactivated, slashed counter +1, quote resolved
```

The chain does all the checking and nobody has to judge the case. This path has **run on-chain on
both Preprod and Preview** (`pnpm run e2e-fraud`).

> **Class B was removed on 2026-09-14.** Class B was a settlement challenge for a dealer who
> "went silent". A taker holding the pre-proved Offer File settles alone, so a dealer can't stall.
> The remaining failure is a dealer spending the offer's inputs first. The protocol handles it with
> immediate settlement, an input pre-check, and failure evidence that anyone can verify and that
> feeds the dealer's track record. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## ✦ Deployments

All deployments are on Midnight **testnets**. The contract is not on Mainnet yet; Mainnet readiness
is milestone M4.

### Protocol contract: `OTCProtocol`

| Network | Contract address | Deploy height | Deployed |
|---|---|---|---|
| **Preprod** (current) | `c85b6b93a12fa0e19121bdd6bb4e15ee98f3783e304bf97cb2e3a49a374b6b34` | 2,536,138 | 2026-09-14 |
| **Preview** (current) | `e35b4547d59c7132c021753344d662d445b739af0e78cc39bc771e58fd05d1fa` | 851,956 | 2026-09-14 |

Both run the current 9-circuit contract (with Class B removed). On each network, `init` passes all
fresh-state checks and `e2e-fraud` has slashed a real bond. The source of truth is
[`deployments/`](deployments).

<details>
<summary>Superseded deployments (kept for audit history)</summary>

| Network | Address | Note |
|---|---|---|
| Preprod | `f365d5622e2609e007416eb6c5966ce9d96517787cdb032ac6fdc1d301414cf5` | Bond-sizing (task 2.9) build, superseded 2026-09-14 |
| Preprod | `539d3ea689983058059137f4c6d0ee234ae29b585f7f222919a2013800ee2225` | M1 build, pre-2.9 circuits |
| Preview | `c4d65ea5f5c92ca3666f1fce82827c8afe03fe78a53bfdac342b98e7659303c4` | Bond-sizing build, superseded 2026-09-14 |
| Preview | `f25703438d00441deadba817aa60e42637f304598b3f90e15ca5cfb9e9a74c04` | Pre-2.9 circuits |

</details>

### Trading pairs and token types

| Network | Pair | Base | Counter asset | Counter token type |
|---|---|---|---|---|
| Preprod | `tNIGHT/TESTUSD` | tNIGHT (native) | TESTUSD (unshielded test stablecoin) | `53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc` |
| Preview | `tNIGHT/USDM` | tNIGHT (native) | USDM (VIA Labs bridge) | `003bacd9a361ba0d425e408776020e40271375e8b8de42d73eec046a44947d73` |
| Mainnet *(planned)* | `NIGHT/USDM` | NIGHT | USDM | `8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b` |

USDM doesn't exist on Midnight Preprod: the VIA Labs bridge connects Cardano Preprod to Midnight
**Preview**. So Preprod uses TESTUSD, a test token deployed by this project.

### Test token contracts (Preprod)

| Contract | Address | Token type |
|---|---|---|
| `TestToken` (TESTUSD, unshielded) | `69fbe4bc9d80cc02541d34aa5492bae572b67195c041506a98716899a799c5a7` | `53139e6d7da2e5e87d4cbfddb566d03618d6b9405b01b3b66822ee6ffb02eafc` |
| `TestShieldedToken` (shielded) | `cb9e6aecdf41d1aeaa37e721b95598a22d0ff150e228be7540da181fba95acde` | `5c695cbbd95f6500e1189812f7ddeaacd22bc2a8a8e5408535c95ee38a0c04ac` |

### Relay network: public nodes

Two peered reference relays run on Railway with the store-and-forward mailbox turned on. Anyone can
add more nodes; these two aren't special.

| Node | Gossip (WebSocket) | Health |
|---|---|---|
| `relay1` | `wss://relay1-production.up.railway.app/gossip` | [/health](https://relay1-production.up.railway.app/health) |
| `relay2` | `wss://relay2-production-b144.up.railway.app/gossip` | [/health](https://relay2-production-b144.up.railway.app/health) |

```bash
curl https://relay1-production.up.railway.app/health
# {"ok":true,"peers":2,"version":1,"uptimeSec":…}
```

To point the web client at these relays, set:

```bash
VITE_RELAYS=wss://relay1-production.up.railway.app/gossip,wss://relay2-production-b144.up.railway.app/gossip
```

### Midnight infrastructure endpoints

| Network | Indexer (HTTP) | Indexer (WS) | Node RPC |
|---|---|---|---|
| Preprod | `https://indexer.preprod.midnight.network/api/v4/graphql` | `wss://indexer.preprod.midnight.network/api/v4/graphql/ws` | `https://rpc.preprod.midnight.network` |
| Preview | `https://indexer.preview.midnight.network/api/v4/graphql` | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` | `https://rpc.preview.midnight.network` |

Proof server (local): `docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v`.
Preview faucet: <https://midnight-tmnight-preview.nethermind.dev/>

---

## ✦ Architecture

### System diagram

```
                        ┌───────────────────────────────────────────────┐
                        │          MIDNIGHT CHAIN  (public state)       │
                        │              OTCProtocol.compact              │
                        │                                               │
                        │  bonds    Map<dealerCmt, Bond>                │
                        │  settled  Map<dealerCmt, Counter>             │
                        │  slashed  Map<dealerCmt, Counter>             │
                        │  quotes   Map<quoteId,   Quote>               │
                        │  notes    Map<tradeId,   NoteRef>             │
                        │  burnedTotal                                  │
                        └──▲─────────────▲──────────────▲───────────▲───┘
      postBond / commitQuote │             │              │           │ submitFraudProofMismatch
      recordSettlement       │             │  attachDisclosureNote    │ (ANYONE)
                             │             │              │           │
          ┌──────────────────┴──┐  ┌───────┴───────┐  ┌───┴───────────┴───┐  ┌──────────────┐
          │   DEALER NODE (A…N) │  │  TAKER (web)  │  │     WATCHDOG      │  │   INDEXER    │
          │  quote engine       │  │  React client │  │  anyone with the  │  │  GraphQL v4  │
          │  warm offer pool    │  │  + wallet via │  │  SDK; earns 10%   │◀─┤  (read-only  │
          │  commit → reveal    │  │  DApp         │  │  of a slash       │  │  chain view) │
          │  refresh keeper     │  │  Connector    │  └───────────────────┘  └──────────────┘
          │  crash-safe journal │  │  compare +    │
          └───┬──────────┬──────┘  │  verify       │
              │          │         └──┬─────────┬──┘
              │          │  SEALED    │         │
              │          └──REVEAL────┘         │        ┌──────────────────────┐
              │   (X25519 + ChaCha20-Poly1305,  │        │   ZSWAP SETTLEMENT   │
              │    point-to-point / mailbox)    └───────▶│  atomic swap, taker  │
              │                                          │  settles unilaterally│
              │  RFQ + quote_ref (metadata only)         └──────────────────────┘
      ┌───────┴──────────────────────────────────────┐
      │          RELAY NETWORK  (WebSocket gossip)    │
      │   [relay1] ═══ [relay2] ═══ [anyone's node]   │
      │   no funds · no on-chain identity · no prices │
      └───────────────────────────────────────────────┘
```

### Actors

| Actor | Runs | Holds | Appears on-chain as |
|---|---|---|---|
| **Dealer** | `packages/dealer-node` or the web `/desk` | A bond and a quote-signing key | A dealer commitment `H("otc:dealer:v1", sk)` |
| **Taker** | The web client (`client/`) | Funds to trade | Nothing persistent |
| **Relay operator** | `packages/relay-node` | Nothing at stake | Doesn't appear on-chain |
| **Watchdog / fraud prover** | Any SDK client | Nothing at stake | Doesn't appear on-chain; receives 10% of a slash |

### On-chain / off-chain split

This split is the core design decision of the protocol.

| Responsibility | Where | Why |
|---|---|---|
| Bond posting and withdrawal, settled and slashed counters | **On-chain** | Public verifiability makes trust depend on stake rather than on an admin |
| Sealed quote commitments and validity windows | **On-chain** | Binds a dealer before the reveal; this is the anti-last-look mechanism |
| Fraud-proof submission and slashing | **On-chain** | Anyone must be able to trigger it, and it must need no arbitrator |
| Disclosure note attachment | **On-chain** | Must be provably tied to one settled trade |
| RFQ routing and commitment gossip | **Off-chain** (relays) | Midnight has no shared private state between users |
| Priced quote reveal | **Off-chain, point-to-point, encrypted** | Competing dealers and relay operators must never see it |
| Trade settlement | **Zswap** | Reuses the audited atomic-swap primitive |
| Quote liveness and refresh | **Off-chain** (Dealer Node keeper) | Works around the ~1 h Offer File expiry |

> **Design rule:** price comparison always happens in the taker's client, on revealed quotes. The
> chain never sees a price it could compare.

### Visibility

| Who | Sees | Never sees |
|---|---|---|
| Public chain | That a dealer is bonded, bond size, that a quote exists, its notional and validity window, settled and slashed counts | Any price or the dealer's identity |
| Relay operators | RFQs (pair, side, size, expiry, taker encryption key) and quote references | **Any price, or which dealer the taker chose** |
| Competing dealers | The same as relay operators | Each other's reveals |
| Disclosure recipient | The one trade a note was attached to | Any other trade by either party |

---

## ✦ Smart contract: `OTCProtocol.compact`

Source: [`contracts/src/OTCProtocol.compact`](contracts/src/OTCProtocol.compact) · compiled output
(verifier keys, ZKIR, JS bindings): [`contracts/managed/otc-protocol/`](contracts/managed/otc-protocol)
· full specification: [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

The contract has **no admin or privileged key** and **no price logic**.

### Ledger

```compact
struct Bond    { amount, quotePk: JubjubPoint, withdrawRequested, liveQuotes, active }
struct Quote   { dealerCmt, commitment, validUntil, rfqId, notional, resolved }
struct NoteRef { ciphertextHash, policyTag: Uint<16>, recipientHint }

ledger bonds:       Map<Bytes<32>, Bond>      // dealerCmt → bond
ledger settled:     Map<Bytes<32>, Counter>   // dealerCmt → settled trades
ledger slashed:     Map<Bytes<32>, Counter>   // dealerCmt → times slashed
ledger quotes:      Map<Bytes<32>, Quote>     // quoteId   → commitment record
ledger notes:       Map<Bytes<32>, NoteRef>   // tradeId   → disclosure note
ledger burnedTotal: Uint<128>                 // transparency only
```

### Circuits (9)

| Circuit | Who calls it | What it does |
|---|---|---|
| `postBond(amount, quotePk)` | Dealer | Locks tNIGHT and registers the dealer commitment and quote-signing key. Anyone can call it |
| `topUpBond(amount)` | Dealer | Adds to an existing bond |
| `requestBondWithdrawal(now)` | Dealer | Deactivates the dealer and starts the 24 h timelock |
| `withdrawBond(recipient)` | Dealer | Releases the bond after the timelock, and only if there are no live quotes |
| `commitQuote(rfqId, commitment, validUntil, notional)` | Dealer | Records a sealed quote; enforces the validity cap and the notional cap |
| `recordSettlement(quoteId)` | Dealer | Marks a quote settled and increments the settled counter |
| `releaseExpiredQuote(quoteId)` | Anyone | Resolves an expired, unsettled quote so the dealer's bond can be withdrawn |
| `submitFraudProofMismatch(…)` | **Anyone** | Verifies a Schnorr-signed reveal that doesn't match the commitment, then slashes the full bond |
| `attachDisclosureNote(tradeId, ciphertextHash, policyTag, …)` | Counterparty | Attaches a disclosure note to one **settled** trade |

### Protocol parameters

| Parameter | Value | Meaning |
|---|---|---|
| `MAX_QUOTE_VALIDITY` | 900 s | Longest allowed quote window, so a dealer can't hold a free option for long |
| `BOND_WITHDRAW_DELAY` | 86,400 s | Withdrawal timelock; strictly longer than validity plus the proof grace period |
| `PROOF_GRACE_PERIOD` | 3,600 s | How long after expiry a fraud proof can still land |
| `TIME_SLACK` | 300 s | Allowed drift between a caller-supplied `now` and block time |
| `NOTIONAL_CAP_K` | 20 | `notional ≤ bond × 20`, so a bond must be ≥ 5% of the quote's notional |
| Slash split | 60 / 10 / 30 | Wronged taker / fraud prover / burned (in bps: 6000 / 1000 / rest) |

### Compact constraints the design works around

- **No `now` inside a circuit.** Circuits can only compare against block time, so time-dependent
  circuits take a caller-supplied `now` and check that it is within `TIME_SLACK` of block time.
- **No division operator.** The 60/10/30 split comes from a witness (`computeSlashShares`), and the
  circuit checks it with multiplication and a two-sided range check.
- **No Jubjub Schnorr verifier in the stdlib.** In-circuit verification is a hand-written gadget
  ([`contracts/src/schnorr.compact`](contracts/src/schnorr.compact)) with a range-checked challenge
  reduction. It was cross-checked against the SDK signer in [`packages/sdk/src/schnorr.ts`](packages/sdk/src/schnorr.ts).
- **Domain separation.** Every derivation uses a distinct separator (`otc:dealer:v1`,
  `otc:quote:v1`, …).

---

## ✦ Cryptography

| Purpose | Construction | Where |
|---|---|---|
| Dealer identity | `persistentHash("otc:dealer:v1", sk)` | Contract + `packages/sdk/src/domain.ts` |
| Quote commitment | `persistentCommit(terms, nonce)` with a fresh 32-byte nonce, **never a bare hash**, because prices are low-cardinality and a bare hash could be brute-forced | Contract + `packages/sdk/src/quotes.ts` |
| Quote ID | `persistentHash("otc:quote:v1", dealerCmt, rfqId, C)` | Contract + SDK |
| Reveal signature | Schnorr over Jubjub, verified in-circuit | `contracts/src/schnorr.compact`, `packages/sdk/src/schnorr.ts` |
| Reveal encryption | X25519 ECDH → HKDF-SHA256 → ChaCha20-Poly1305 (RFC 8439) | `packages/sdk/src/reveal-channel.ts`, `aead.ts` |
| Disclosure notes | Encrypted to a named recipient; only `hash(ciphertext)` goes on-chain | `packages/sdk/src/disclosure.ts` |
| Relay message IDs | Content-addressed canonical JSON | `packages/relay-node/src/schema.ts` |

The SDK's crypto uses the audited pure-JS `@noble/*` libraries, so the same code runs in Node and in
the browser without `node:crypto` or `Buffer`. A test checks it byte-for-byte against the earlier
`node:crypto` implementation.

---

## ✦ Repository layout

```
pyronfinance/
├── contracts/
│   ├── src/
│   │   ├── OTCProtocol.compact        # the protocol contract (9 circuits)
│   │   ├── schnorr.compact            # in-circuit Jubjub Schnorr verifier
│   │   ├── TestToken.compact          # TESTUSD (unshielded) for Preprod
│   │   └── TestShieldedToken.compact  # shielded test token
│   ├── managed/                       # compiler output: verifier keys, ZKIR, JS bindings
│   └── test/                          # compact-runtime simulator suite
│
├── packages/
│   ├── sdk/            @otc/sdk          bonding, quotes, fraud proofs, Zswap offers,
│   │                                     relay client + aggregator, reveal channel,
│   │                                     disclosure, wallet + providers, browser entry
│   ├── relay-node/     @otc/relay-node   standalone gossip node (WS + HTTP), Dockerfile
│   └── dealer-node/    @otc/dealer-node  reference dealer: config, identity, journal,
│                                         warm offer pool, quoting state machine, Dockerfile
│
├── client/             @otc/client       Pyron web app (React 18 + Vite + Tailwind + Zustand)
│   ├── src/app/                          shell, router, trade runtime
│   ├── src/features/                     landing, trade, desk, dealers, venue, activity,
│   │                                     portfolio, receipt, verify, deal
│   ├── src/data/live/                    indexer, relays, wallet, circuits, spent-coin check
│   └── test/                             unit, component, fixture scenarios, Playwright e2e
│
├── scripts/            deploy, init, fund, status, e2e-* flows, probes, browser-e2e harness
├── deployments/        deployed contract addresses per network
├── docs/               the specification (the source of truth)
└── .claude/skills/     project skills that record Compact/Midnight constraints found so far
```

---

## ✦ Tech stack

| Layer | Technology |
|---|---|
| Smart contract | **Compact** 0.30 · Midnight ZK circuits · Zswap |
| Chain SDK | `@midnight-ntwrk/midnight-js-*` 4.0.2 · `ledger-v8` 8.1.2 · `compact-runtime` 0.15 · wallet-sdk (facade, HD, shielded, unshielded, dust) |
| Proving | `midnightntwrk/proof-server:8.1.0` (Docker) |
| Chain reads | Midnight Indexer GraphQL v4 (HTTP + `graphql-ws`) |
| Crypto | `@noble/curves`, `@noble/hashes`, `@noble/ciphers` |
| Relay | Node.js 22 · `ws` · in-memory, expiring state (no database) |
| Dealer Node | Node.js 22 · TOML config · crash-consistent append-only journal |
| Web client | React 18 · Vite 5 · TypeScript · Tailwind CSS 3 · Zustand · React Router 6 · Midnight DApp Connector API 4.0.1 · IndexedDB (`idb-keyval`) |
| Testing | Vitest 4 · Testing Library · Playwright + axe-core (WCAG 2.1 AA) |
| Monorepo | pnpm 9 workspaces · Turborepo |
| Infra | Docker / Docker Compose · Railway (public relays) |

---

## ✦ Quickstart

### Prerequisites

- **Node.js ≥ 22** and **pnpm 9**
- **Docker** (for the proof server)
- **Compact compiler 0.30.0**:
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  compact update 0.30.0
  ```

### 1. Install and compile

```bash
git clone https://github.com/anindhabiswas25/PyronFinance.git
cd PyronFinance
pnpm install
pnpm run compact        # generates prover keys (git-ignored); verifier keys match the deployment byte-for-byte
```

### 2. Start a proof server

```bash
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v
```

> Use the image org **`midnightntwrk`** (no "e"). `midnightnetwork/proof-server` is a stale,
> unrelated image. It accepts requests and then spins at 100% CPU forever, which looks exactly like
> slow proving.

### 3. Configure a wallet

```bash
cp .env.preprod .env           # or .env.preview
pnpm generate-seed             # prints a 64-hex seed → MN_WALLET_SEED in .env
# MN_PRIVATE_STATE_PASSWORD=<16+ chars, 3 of: upper, lower, digit, symbol>
pnpm run print-address         # fund THIS address from the faucet (CAPTCHA-gated)
pnpm run fund                  # register NIGHT for DUST generation
pnpm run status                # NIGHT balance, DUST balance, current deployment
```

### 4. Use the deployed contract, or deploy your own

```bash
# Use the deployed contract: set MN_CONTRACT_ADDRESS from deployments/<network>.json
pnpm run init                  # checks deployments/<network>.json against the indexer

# Or deploy a fresh instance
pnpm run deploy && pnpm run init
```

### 5. Watch the protocol work end to end

```bash
pnpm run e2e-fraud             # bond → commit → mismatched reveal → fraud proof → slash
pnpm run e2e-settle            # bond → commit → encrypted reveal → taker settles → recordSettlement
pnpm run e2e-rfq-2dealers      # two competing dealers over two relays; the better quote settles
```

---

## ✦ Run a Dealer Node

To become a dealer you need a config file and a bond. The target is **under 30 minutes** from
`git clone` to a live standing quote. Full guide: [`packages/dealer-node/README.md`](packages/dealer-node/README.md).

```bash
cd packages/dealer-node
cp dealer.example.toml dealer.toml        # set contract, ≥2 relays, [[quote_policy]]
pnpm gen-key --config dealer.toml         # writes secrets/dealer.key, prints your dealer commitment
pnpm bond    --config dealer.toml         # postBond on-chain
pnpm start   --config dealer.toml         # quote, commit, reveal, refresh
pnpm exec tsx --env-file-if-exists=../../.env src/bin.ts status --config dealer.toml
```

Example relay section that uses the public nodes:

```toml
[relays]
endpoints   = [
  "wss://relay1-production.up.railway.app/gossip",
  "wss://relay2-production-b144.up.railway.app/gossip",
]
use_mailbox = true
```

**What the node does:**
- **Warm offer pool.** It keeps pre-proved Zswap Offer Files ready, because proving takes about 3 s
  per offer and concurrency gives no speedup. It also keeps a coin reserve so offers don't compete
  for the same inputs.
- **Commit → reveal state machine.** It writes to the journal *before* `commitQuote`, and reveals
  only after the commitment is visible on the indexer.
- **Refresh keeper.** It renews quotes before the ~1 h Offer File expiry.
- **Risk limits.** These include `max_live_quotes`, `max_total_notional` and `halt_on_slash`.
- **Secrets never go in the TOML.** The node refuses any config key that looks like a secret; the
  seed and password come from `.env`.

**Docker:**

```bash
docker compose -f packages/dealer-node/docker-compose.yml up --build -d
```

This starts the Dealer Node together with its own proof server. The journal is kept on a named
volume.

---

## ✦ Run a Relay Node

Anyone can run a relay. It holds no funds, has no on-chain identity and needs no database. The wire
format is normative in [`docs/RELAY.md`](docs/RELAY.md), and a third party should be able to build a
compatible node from that document alone.

```bash
# Local
RELAY_ENABLE_MAILBOX=true pnpm --filter @otc/relay-node start

# Two peered relays on :18787 / :18788
docker compose -f packages/relay-node/docker-compose.yml up --build

# Single image
docker build -f packages/relay-node/Dockerfile -t otc-relay-node .
docker run -p 8787:8787 -e RELAY_ENABLE_MAILBOX=true \
  -e RELAY_PEERS=wss://relay1-production.up.railway.app/gossip otc-relay-node
```

| Env var | Default | Meaning |
|---|---|---|
| `RELAY_PORT` | `8787` | HTTP + WebSocket port |
| `RELAY_PEERS` | — | Comma-separated bootstrap peers (`wss://…/gossip`) |
| `RELAY_MAX_MSG_BYTES` | `65536` | Max frame size |
| `RELAY_ENABLE_MAILBOX` | `false` | Serve the opaque store-and-forward reveal mailbox |
| `RELAY_PAIRS` | — | Pairs this node advertises (informational) |

| Endpoint | Purpose |
|---|---|
| `WS  /gossip` | Peer and client gossip: `rfq`, `quote_ref`, `cancel`, `peer_announce` |
| `GET /health` | `{ ok, peers, version, uptimeSec }` |
| `GET /rfqs?pair=&since=` | Recent RFQs, for clients that poll |
| `POST/GET /mailbox/:takerEncPk` | Opaque encrypted reveal blobs (the relay can't decrypt them) |

The relay provides content-addressed dedup, TTL-bounded propagation, per-type rate limits,
misbehavior scoring and banning, and CORS on every HTTP route so browsers can call it.
**A relay can only ever censor.** Clients verify every claim a relay makes against the chain and
query several relays at once.

---

## ✦ Web client

The Pyron web app is in `client/`. It has no backend: it talks only to the connected wallet (through
the Midnight DApp Connector), the indexer and the relays.

```bash
cp client/.env.example client/.env.local
# VITE_NETWORK=preprod
# VITE_RELAYS=wss://relay1-production.up.railway.app/gossip,wss://relay2-production-b144.up.railway.app/gossip
pnpm --filter @otc/client dev          # http://localhost:5174
pnpm --filter @otc/client build        # production bundle → client/dist
```

| Route | Page |
|---|---|
| `/` | Landing page |
| `/trade` | Request → sealed bids → compare → settle; every verification check runs in the browser |
| `/trade/:quoteId` | Trade receipt |
| `/venue` | Live venue overview |
| `/dealers`, `/dealers/:dealerCmt` | Dealer directory and profile (bond, settled and slashed history) |
| `/activity` | Protocol event feed replayed from the indexer |
| `/desk` | Dealer desk: bond, keys (encrypted in the browser, with a forced backup), manual quote |
| `/me` | Portfolio and history (encrypted under a passphrase) |
| `/verify` | Check a quote or open a disclosure note |
| `/deal` | Command reference for running your own dealer |

The trade loop runs in the app shell, so a trade keeps running when you navigate away. A
notification centre shows its progress. The accessibility check (axe WCAG 2.1 AA) passes on every
route at desktop width and at a 390 px phone width.

---

## ✦ Scripts reference

| Command | Purpose |
|---|---|
| `pnpm run compact` | Compile `OTCProtocol.compact` |
| `pnpm run compact:testtoken` / `compact:testshieldedtoken` | Compile the test tokens |
| `pnpm generate-seed` | Generate a wallet seed |
| `pnpm run print-address` | Print the wallet address to fund |
| `pnpm run fund` | Register NIGHT for DUST generation |
| `pnpm run status` | Show wallet, DUST and deployment status |
| `pnpm run deploy` / `init` | Deploy the contract / run fresh-state checks |
| `pnpm run deploy-test-token` | Deploy and mint TESTUSD (Preprod) |
| `pnpm run transfer` / `consolidate` / `split-for-dust` | Wallet coin management |
| `pnpm run e2e-fraud` | Run the fraud path on-chain |
| `pnpm run e2e-settle` / `e2e-settle-2wallet` | Run a settlement on-chain (one wallet / two wallets) |
| `pnpm run e2e-lifecycle` | Run the bond lifecycle (top-up, release, withdraw) |
| `pnpm run e2e-rfq-2dealers` | Run two competing dealers over two live relays |
| `pnpm run taker-pinger` | Headless taker that sends RFQs and runs every client-side check |
| `pnpm run probe-*` | Measurement probes (swap semantics, fees, shielded latency) |

To run any script against one network's endpoints, use `scripts/on-network.sh <preprod|preview> <script>`, for example `scripts/on-network.sh preview e2e-fraud`.

---

## ✦ Testing

```bash
pnpm test                               # workspace Vitest suite + client tests
pnpm typecheck                          # root, scripts, and client
pnpm --filter @otc/client test:e2e      # Playwright route + accessibility checks
```

| Suite | Covers |
|---|---|
| `contracts/test` | The compiled contract in the `compact-runtime` simulator: bonding, quoting, settlement, fraud, disclosure, Schnorr, test token |
| `packages/sdk/test` | Derivations, quotes, offers, reveal channel, AEAD parity, bech32m, relay aggregator (including negative cases where a relay or dealer lies), browser safety |
| `packages/relay-node/test` | Canonical-JSON IDs, every validation rejection path, gossip convergence over real sockets, mailbox |
| `packages/dealer-node/test` | Config and identity, crash-consistent journal, warm pool, inventory planning, quoting state machine |
| `client/test` | Unit, component and fixture-driven trade scenarios, plus the live relay adapter against real relay servers |

> **Simulation is not chain integration.** Every protocol path marked ✅ below has also run against
> a live Midnight testnet, because several real defects passed both `tsc` and the simulator suite
> and only showed up on-chain.

---

## ✦ Project status

| Milestone | Scope | Status |
|---|---|---|
| **M1** | Core protocol contract on Preprod | ✅ Complete: deployed, and the fraud proof slashes a bond on-chain |
| **M2** | Relay node + RFQ flow | 🟡 Relays, aggregation, encrypted reveals, two-asset and two-wallet settlement, and two competing dealers over live relays have all run on-chain. The web UI is built; a settlement from a browser wallet is still pending |
| **M3** | Dealer Node + disclosure | ✅ Complete: live settlement and disclosure round trip, unattended multi-expiry run |
| **M4** | Mainnet readiness | ⬜ Not started |

**Verified on-chain:** `postBond`, `topUpBond`, `requestBondWithdrawal`, `commitQuote`,
`recordSettlement`, `releaseExpiredQuote`, `submitFraudProofMismatch`, a two-asset Zswap settlement,
a shielded offer settlement, and a contract circuit proved and submitted through the web client's
browser code path.

**Measured performance (Preprod):**

| Metric | Value |
|---|---|
| Contract proof generation | ~0.7 s |
| Shielded Offer File proving | 6.4 s cold · 3.1 s median steady-state |
| Browser circuit: prove / balance / submit | 1.5 s / 2.4 s / 16.9 s |
| Wallet sync: cold vs. restored snapshot | ~20 min vs. ~8 s |

The live record of what is done and what is still open is [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## ✦ Security model and known limits

These limits are listed openly:

- **`recordSettlement` is attested by the dealer.** The contract can't inspect a Zswap swap, so the
  settled counter is a soft reputation signal. The bond is the hard guarantee.
- **Only Class A fraud is slashable.** If a dealer spends an offer's inputs before the taker
  settles, the protocol produces publicly verifiable evidence that feeds the dealer's track record,
  but it doesn't slash the bond.
- **Disclosure isn't enforced.** The primitive makes honest disclosure *possible and verifiable*;
  it can't force anyone to attach a note. Only the named-recipient policy (`0x0001`) ships today;
  time-delayed, threshold and dual-recipient policies are reserved `policyTag` values.
- **Relays can censor.** Clients defend against this by querying at least two relays and checking
  every reference against the chain.
- **Testnet only.** On Mainnet, bonds cost real NIGHT and every dealer must register NIGHT for DUST.
  Both are M4 work.
- **Not audited.** Don't use this with real funds.

Never commit `.env` files, wallet seeds, `secrets/dealer.key` or private-state passwords.

---

## ✦ Documentation

| Document | Contents |
|---|---|
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestone status, decisions made, and open decisions |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Pillars, actors, split table, end-to-end and fraud flows |
| [`docs/CONTRACTS.md`](docs/CONTRACTS.md) | `OTCProtocol.compact` spec: ledger, circuits, slashing rule, bond sizing |
| [`docs/RELAY.md`](docs/RELAY.md) | Normative gossip wire format and propagation rules |
| [`docs/DEALER-NODE.md`](docs/DEALER-NODE.md) | Reference dealer design: config, commit→reveal, refresh |
| [`docs/DISCLOSURE.md`](docs/DISCLOSURE.md) | Programmable disclosure primitive and policy shapes |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | Web client specification |
| [`docs/GRANT.md`](docs/GRANT.md) | Narrative, differentiation, and risk statement |

---

<div align="center">

**Pyron Finance.** Built on [Midnight](https://midnight.network).

</div>
