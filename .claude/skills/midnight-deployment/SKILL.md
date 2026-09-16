---
name: midnight-deployment
description: Deploy and init script patterns for OTCProtocol — Preprod indexer/RPC/proof-server endpoints, environment variable conventions, faucet usage, and the Preprod-to-Mainnet DUST gap. Use when writing deploy scripts or configuring any of the three runnable components.
---

# Deployment & Environment

Covers deploying `OTCProtocol.compact` and configuring the three runnable components: `client/`,
`packages/relay-node`, `packages/dealer-node`.

> **MidSwap is not present on this machine.** Deploy-script and witness-provider patterns here are
> drawn from the bundled `example-locker-dapp`, `midnight-js`, and `example-counter` skills. If
> MidSwap becomes available, revisit this file.

---

## 1. Network endpoints

| Network | Indexer | RPC |
|---|---|---|
| **preprod** | `https://indexer.preprod.midnight.network/api/v4/graphql` | `https://rpc.preprod.midnight.network` |
| preview | `https://indexer.preview.midnight.network/api/v4/graphql` | — |
| mainnet | `https://indexer.mainnet.midnight.network/api/v4/graphql` | `https://rpc.mainnet.midnight.network` |
| local | `http://localhost:8088/api/v4/graphql` | `ws://localhost:9944` |

**Faucet (Preprod):** `https://faucet.preprod.midnight.network`
**Proof server:** always local — `docker run -p 6300:6300 midnightnetwork/proof-server`

Preprod is the target through M3. Mainnet is M4 only.

---

## 2. Environment variable conventions

Shared prefix `MN_` for chain config; component prefixes for the rest. **Every component reads the
same chain variables**, so one `.env` configures the whole stack.

```bash
# ── Chain (all components) ───────────────────────────────
MN_NETWORK=preprod                # undeployed | preprod | preview | mainnet
MN_INDEXER=https://indexer.preprod.midnight.network/api/v4/graphql
MN_RPC=https://rpc.preprod.midnight.network
MN_PROOF_SERVER=http://localhost:6300
MN_CONTRACT_ADDRESS=0x...         # written by the deploy script

# ── Secrets — NEVER commit ───────────────────────────────
MN_WALLET_SEED=...                # deploy + dealer wallet
OTC_DEALER_KEY_PATH=./secrets/dealer.key

# ── Relay node ───────────────────────────────────────────
RELAY_PORT=8420
RELAY_PEERS=wss://relay-a.example/gossip,wss://relay-b.example/gossip
RELAY_MAX_MSG_BYTES=65536
RELAY_ENABLE_MAILBOX=false
RELAY_PAIRS=tNIGHT/USDM

# ── Web (Vite: must be VITE_-prefixed to reach the browser) ──
VITE_MN_NETWORK=preprod
VITE_MN_INDEXER=...
VITE_MN_CONTRACT_ADDRESS=0x...
VITE_RELAY_ENDPOINTS=wss://relay-a.example/gossip,wss://relay-b.example/gossip
```

Rules:

- **Never a secret in a `VITE_` variable.** Vite inlines them into the browser bundle. Only public
  config crosses that boundary.
- **`.env.preprod` / `.env.mainnet` committed; `.env` and `.env.local` git-ignored.** Committed files
  hold endpoints only, never seeds or keys.
- **Fail fast at startup.** Validate the full config on boot and exit with a clear message. A dealer
  node that starts with a bad contract address and discovers it at quote time has already committed
  to quotes it cannot serve. (This used to say "may miss a challenge window"; Class B was removed.)
- **`secrets/` is git-ignored; key files are `0600`.**

---

## 3. Deploy script pattern

```
scripts/
  deploy.ts        # compile check → deploy → write address → verify
  init.ts          # post-deploy sanity: read ledger, confirm constructor state
  fund.ts          # faucet helper (Preprod only)
  e2e-fraud.ts     # M1 definition-of-done: bond → commit → bad reveal → slash
```

Shape of `deploy.ts`:

```typescript
// 1. Providers — same wiring for every component (see the midnight-js skill)
const providers = {
  privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'otc-private-state' }),
  publicDataProvider:   indexerPublicDataProvider(MN_INDEXER, MN_INDEXER_WS),
  zkConfigProvider:     new NodeZkConfigProvider(contractManagedPath),
  proofProvider:        httpClientProofProvider(MN_PROOF_SERVER),
  walletProvider, midnightProvider,
};

// 2. Deploy with initial private state
const deployed = await deployContract(providers, {
  contract: new OTCProtocol.Contract(otcWitnesses),
  privateStateId: 'otcPrivateState',
  initialPrivateState: { dealerSk: null },
});

// 3. Persist the address where every component reads it
writeDeployment({ network: MN_NETWORK, address: deployed.deployTxData.public.contractAddress,
                  deployedAt: Date.now(), blockHeight: ... });

// 4. Verify by reading ledger state back — never trust the deploy receipt alone
```

**Write the address to `deployments/<network>.json`, committed to the repo.** All three components
and the docs read from one place; a contract address pasted into three configs will drift.

**Verify by reading back.** A deploy transaction that is accepted is not proof the contract is
queryable. `init.ts` reads the ledger and asserts the constructor state before anything else is built
on top.

---

## 4. Compile before deploy

```bash
compact compile contracts/OTCProtocol.compact contracts/managed/otc-protocol
```

Produces `keys/*.prover` (2–10 MB), `keys/*.verifier` (~2 KB), `zkir/*.bzkir`, and TypeScript
bindings.

- **Commit `verifier` keys and bindings; git-ignore `prover` keys** (too large; regenerate locally).
- **Compiler version pinning is mandatory.** A version mismatch between the compiler that produced
  the ZK assets and the runtime that consumes them produces confusing failures at proving time, not
  at build time. Pin in `package.json` and check it in CI.
- Use `--skip-zk` for fast iteration on contract logic; **never** deploy `--skip-zk` output.

---

## 5. Faucet and funding (Preprod)

```bash
pnpm tsx scripts/fund.ts --address <addr>     # or use the faucet UI
```

Each component needs funding:

| Component | Needs |
|---|---|
| Deploy wallet | DUST for the deploy transaction |
| Dealer node | Bond amount + DUST for `commitQuote` / `recordSettlement` per quote |
| Taker (web) | Trade funds + DUST for its own settlement fee — and consolidated coins (see zswap-offer-files §2) |
| Relay node | **Nothing.** Relays hold no funds and make no transactions. |

**A dealer's DUST burn is per-quote and continuous.** Every `commitQuote` is a transaction. A dealer
quoting actively needs a DUST balance that keeps up, and running dry mid-window means being unable to
call `recordSettlement` or `commitQuote`. (This used to end "an unanswered challenge and a slashed
bond"; challenges were removed 2026-09-14.) **The Dealer Node must monitor DUST as a first-class health
check, alongside bond balance** — and note the balancer provisions `additionalFeeOverhead` (3 DUST) per
transaction, so that is the practical floor per concurrent transaction.

---

## 6. The Preprod → Mainnet gap (M4)

The sharpest difference, and the one most likely to surprise a real dealer operator:

| Concern | Preprod | Mainnet |
|---|---|---|
| Getting tokens | Faucet — free, instant, unlimited | Real acquisition. Bond sizing becomes an economic decision. |
| **DUST** | Faucet-supplied | **Generated by registering NIGHT.** A real onboarding step before *any* transaction is possible. |
| Settlement asset | tNIGHT / test stablecoin | USDM where applicable |
| Failure cost | Restart | Real value lost |

**DUST generation is the gap that will bite.** On Preprod a dealer asks the faucet. On Mainnet every
dealer must register NIGHT to generate DUST *before they can transact at all* — so a new Mainnet
dealer cannot post a bond, let alone quote, until that completes. This must be step one of the Dealer
Node's Mainnet quickstart, not a footnote.

M4 task 4.5 documents this end to end in `docs/ARCHITECTURE.md`.

---

## 7. Local development

```bash
docker run -p 6300:6300 midnightnetwork/proof-server    # required
pnpm dev                                                # turbo: web + relay + dealer
```

Recommended local loop: **Preprod chain + local proof server.** Running the full local stack is
possible (see the `multinetwork` skill) but Preprod removes a large moving part, and the faucet makes
it free.

For two competing dealers (the M2 definition of done), run two dealer nodes with different key files,
different `reveal_listen` ports, and different `mid_price` values.

---

## 8. Checklist

- [ ] Proof server running on `:6300`
- [ ] Contract compiled with a **pinned** compiler version
- [ ] Deploy address written to `deployments/<network>.json`, read from there everywhere
- [ ] `init.ts` verifies ledger state by reading it back
- [ ] No secrets in any `VITE_` variable
- [ ] `.env`, `.env.local`, `secrets/` git-ignored; key files `0600`
- [ ] All components validate config at startup and fail fast
- [ ] Dealer node monitors **DUST balance** as well as bond balance
- [ ] Mainnet: DUST generation/registration documented before any operator onboards
