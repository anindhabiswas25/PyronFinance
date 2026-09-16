# Build context is the repo root (pnpm workspace), e.g.:
#   docker build -f packages/relay-node/Dockerfile -t otc-relay-node .
#
# relay-node's own `tsc` build is not runnable standalone: schema.ts imports
# packages/sdk/src/schnorr.ts by relative path (docs/RELAY.md §7 — shared wire/crypto code), and
# sdk is never compiled to .js anywhere in this repo, only run through tsx's TS-aware ESM loader.
# So this image runs the service the same way `pnpm --filter @otc/relay-node start` does in dev:
# via tsx, not a tsc build + `pnpm deploy`. Do not "fix" this by switching to dist/bin.js — that
# output exists locally as a stale artifact and does not resolve at runtime.

FROM node:22-slim AS deps
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/relay-node/package.json ./packages/relay-node/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/dealer-node/package.json ./packages/dealer-node/package.json
COPY client/package.json ./client/package.json

# Only relay-node's and sdk's dependency trees are installed — schema.ts's relative import into
# sdk needs sdk's own node_modules (@midnight-ntwrk/compact-runtime) resolvable, even though
# relay-node's package.json declares no dependency on @otc/sdk.
RUN pnpm install --frozen-lockfile --filter @otc/relay-node --filter @otc/sdk

FROM node:22-slim AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/relay-node/node_modules ./packages/relay-node/node_modules
COPY --from=deps /repo/packages/sdk/node_modules ./packages/sdk/node_modules
COPY packages/relay-node/package.json ./packages/relay-node/package.json
COPY packages/relay-node/src ./packages/relay-node/src
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/sdk/src ./packages/sdk/src

ENV RELAY_PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RELAY_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
WORKDIR /repo/packages/relay-node
CMD ["node_modules/.bin/tsx", "src/bin.ts"]
