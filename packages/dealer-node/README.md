# @otc/dealer-node — operator quickstart

Become a dealer on the Midnight OTC Protocol with **a config file and a bond**. No registration, no
approval, no allowlist: the only thing that ever appears on-chain about you is a dealer commitment.
Target: `git clone` to a live standing quote in **under 30 minutes** of your time (chain waits aside —
see "What takes time").

Design and rationale: [`docs/DEALER-NODE.md`](../../docs/DEALER-NODE.md).

## 0. Prerequisites (5 min)

- Node.js ≥ 22, pnpm 9, Docker.
- A Midnight wallet seed with **unshielded tNIGHT and DUST** on the network you will quote on (Preprod
  here). Faucets are CAPTCHA-gated: a human requests funds. Fund the address `pnpm run print-address`
  prints, not a browser wallet.
- The second asset you will quote against. On Preprod that is the testnet stand-in TESTUSD
  (`pnpm run deploy-test-token` mints it); on Preview/Mainnet it is USDM.

## 1. Install, compile the contract, start a proof server (5 min)

```bash
# Compact compiler (once per machine), pinned to the version this contract is compiled with
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.30.0

git clone <repo> && cd pyronfinance
pnpm install
pnpm run compact          # ~20 s: generates the prover keys (see below)
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v
```

**Why compile.** Prover keys are large and git-ignored, so a clean clone has only the verifier keys —
and a node without prover keys cannot bond, commit or record anything. Compilation is deterministic:
recompiling this source in a clean clone (compiler 0.30.0) produced all 9 verifier keys **byte-identical**
to the committed ones the deployed contract checks proofs against, and all 9 prover keys identical to
the developer's. Use the pinned compiler version, or the keys will not match the deployment.

The image org is **`midnightntwrk`** (no "e"). `midnightnetwork/proof-server` is a stale, unrelated
image that accepts requests and spins at 100% CPU forever — it looks exactly like slow proving.

## 2. Secrets (2 min)

Put these in the repo-root `.env` (git-ignored). **Never in the TOML** — the node refuses any config key
that looks like a secret.

```bash
MN_WALLET_SEED=<64 hex>                       # the funded wallet
MN_PRIVATE_STATE_PASSWORD=<16+ chars>          # encrypts the local private-state cache
```

## 3. Config and dealer key (5 min)

```bash
cd packages/dealer-node
cp dealer.example.toml dealer.toml
```

Edit `dealer.toml`:
- `[network].contract` — the OTCProtocol address from `deployments/<network>.json`;
- `[relays].endpoints` — **at least two** relays (run your own: `pnpm --filter @otc/relay-node start`
  with `RELAY_ENABLE_MAILBOX=true`);
- `[[quote_policy]]` — pair, `counter_token`, `mid_price`, spread, sizes.

```bash
pnpm gen-key --config dealer.toml
```

This writes `secrets/dealer.key` (0600) and prints your **dealer commitment**. Back the key file up:
it is the only way to withdraw your bond and to reveal your live quotes. The node refuses to overwrite it.

## 4. Shape your inventory (2 min + chain time) — do not skip

The wallet picks coins **smallest first**. Every coin smaller than an offer's size is swept into that
offer, and on Preprod every merged settlement with more than one unshielded input per side was
rejected by the node's time-to-dismiss rule (`Custom error 168`). Merging each asset to one coin is
**necessary, but not proven sufficient**: a two-wallet settlement with one input per side still came
out 0.1 ms over the 15 ms floor when the transaction was very small (see `docs/ROADMAP.md`, S5
recurrence). The node checks every settlement shape locally and reports the numbers; treat a 168
refusal as an inventory-shape problem, never a fee problem. Merge each asset down to one coin before quoting:

```bash
cd ../..
env $(grep -v '^#' .env.preprod | grep = | xargs) pnpm run consolidate                      # tNIGHT
env $(grep -v '^#' .env.preprod | grep = | xargs) CONSOLIDATE_TOKEN=<counter token> pnpm run consolidate
cd packages/dealer-node
```

The running node keeps inventory consolidated after that (`[pool].consolidate_above`).

## 5. Bond (2 min + chain time)

The contract lets a bond back quotes up to **20× its amount** each. Size it to your largest ladder rung:

```bash
pnpm bond --config dealer.toml --amount 100      # base units of tNIGHT; tops up if already bonded
```

## 6. Start

```bash
pnpm start --config dealer.toml
```

Healthy output, in order:

```
[wallet] mn_addr_preprod1… — syncing
[recover] 0 action(s); 0 hostage input(s)
[relay] connected ws://…/gossip            (one line per relay)
[pool] built tNIGHT/TESTUSD|buy|1000 — buy 0.001000 @ 41.315680
[tick] pool 4 warm; live quotes 0; relays 2/2
[quote] {"kind":"committed",…} / announced / revealed      (when a taker sends an RFQ)
```

`pnpm status --config dealer.toml` prints the bond, settled/slashed counts and the journal.

Stop with Ctrl-C. Live quotes stay in `dealer-journal.log`; the next start reconciles them against the
chain and re-sends any reveal a taker is still owed.

## What takes time

Everything above is minutes of operator work. The chain adds: a first wallet sync (~20 min from genesis
on Preprod, seconds afterwards from `.wallet-state/`), faucet DUST generation for a brand-new wallet,
and ~20–55 s per on-chain call. Those are the network, not setup.

## Alerts that need a human

| Log | Meaning |
|---|---|
| `ALERT … offer inputs spent by another transaction` | The node spent coins behind a live quote. It halts. Investigate before restarting. |
| `halted … bond inactive or slashed` | Your bond was slashed or withdrawn. The node stops quoting. |
| `[pool] reserve-blocked` | Not enough inventory above the reserve and floor for that rung. Fund or shrink the ladder. |
| `[pool] build-failed … spends N coins` | Inventory is fragmented. Let the keeper consolidate, or run step 4. |
| `[pool] stale-mid` | The price source is older than `refresh_secs / 2`. The node quotes nothing until it recovers. |

## Limits of this build

- Reveals are delivered through a relay mailbox only (`use_mailbox = true`).
- One `[[quote_policy]]` per process.
- Several `proof_servers` are accepted, but the wallet proves through the first.
