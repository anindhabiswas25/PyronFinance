# Build context is the repo root (pnpm workspace), e.g.:
#   docker build -f packages/dealer-node/Dockerfile -t otc-dealer-node .
#
# Like relay-node, dealer-node imports packages/sdk/src by relative path (never compiled to .js
# anywhere in this repo), so this runs via tsx, matching `pnpm --filter @otc/dealer-node start`.
#
# The contract's prover keys are git-ignored (packages/dealer-node/README.md "Why compile") and
# must be generated with the exact pinned Compact compiler version so they match the deployed
# contract byte-for-byte. This image compiles them at build time so the resulting image is fully
# self-contained — an operator does not need the Compact toolchain on their own machine.
#
# NOTHING SECRET IS BAKED INTO THIS IMAGE. secrets/dealer.key, the wallet seed, dealer.toml and the
# quote journal are supplied at `docker run` time via bind mounts / env vars — see
# packages/dealer-node/README.md and the docker-compose.yml next to this file.

ARG COMPACT_VERSION=0.30.0

FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils unzip zstd && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ARG COMPACT_VERSION
ENV PATH="/root/.local/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh \
 && compact update ${COMPACT_VERSION} \
 && compact --version

WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/dealer-node/package.json ./packages/dealer-node/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/relay-node/package.json ./packages/relay-node/package.json
COPY client/package.json ./client/package.json
# A filtered install (relay-node + sdk only) is not enough: sdk's source reaches for at least one
# package (@midnight-ntwrk/wallet-sdk-address-format) that pnpm only places somewhere resolvable
# once the full workspace graph is installed, matching how `pnpm install` at the repo root already
# works in dev. Installing everything here is the correctness-over-image-size tradeoff.
RUN pnpm install --frozen-lockfile

COPY contracts/src ./contracts/src
# All three contracts sdk's source can reach for: the real OTC protocol, and the two Preprod test
# tokens (TESTUSD stand-ins for USDM) used by inventory/quoting on testnets.
RUN pnpm run compact && pnpm run compact:testtoken && pnpm run compact:testshieldedtoken

COPY packages/sdk/src ./packages/sdk/src
COPY packages/relay-node/src ./packages/relay-node/src
COPY packages/dealer-node/src ./packages/dealer-node/src

FROM node:22-slim AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/dealer-node/node_modules ./packages/dealer-node/node_modules
COPY --from=builder /repo/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=builder /repo/packages/relay-node/node_modules ./packages/relay-node/node_modules
COPY --from=builder /repo/contracts/managed ./contracts/managed
COPY --from=builder /repo/packages/sdk/src ./packages/sdk/src
COPY --from=builder /repo/packages/relay-node/src ./packages/relay-node/src
COPY --from=builder /repo/packages/dealer-node/src ./packages/dealer-node/src
COPY packages/dealer-node/package.json ./packages/dealer-node/package.json
COPY packages/dealer-node/dealer.example.toml ./packages/dealer-node/dealer.example.toml
COPY packages/sdk/package.json ./packages/sdk/package.json

WORKDIR /repo/packages/dealer-node
# Operator-provided at `docker run`: dealer.toml, secrets/ (dealer key + optionally the wallet
# seed file), and a data dir for the crash-consistent quote journal (must survive a restart).
VOLUME ["/repo/packages/dealer-node/secrets", "/repo/packages/dealer-node/data"]

ENTRYPOINT ["node_modules/.bin/tsx", "src/bin.ts"]
CMD ["start", "--config", "dealer.toml"]
