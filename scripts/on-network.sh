#!/usr/bin/env bash
# Runs a pnpm script against one network's committed endpoints (.env.<network>), secrets from .env.
# Existing env vars win over tsx --env-file, so the endpoints set here override whatever .env holds.
#
# usage: scripts/on-network.sh <preprod|preview> <pnpm-script> [args...]
# Wrap with scripts/watchdog.sh for live runs.
set -euo pipefail
net="$1"; shift
cd "$(dirname "$0")/.."
file=".env.$net"
[ -f "$file" ] || { echo "no $file" >&2; exit 2; }
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; *=*) export "$line" ;; esac
done < "$file"
exec pnpm run "$@"
