#!/usr/bin/env bash
# Silence watchdog for long live runs. macOS ships no `timeout`, and the failure this guards against
# is not a slow run but a SILENT one: Wallet.Sync failures and indexer stalls have hung scripts for
# 8–20 minutes with no output (docs/ROADMAP.md, "Reliability"). A wall-clock timeout would kill
# healthy slow runs; this kills only a run whose log has stopped growing.
#
# usage: scripts/watchdog.sh <log-file> <silence-secs> -- <command...>
# Exit code is the command's, or 124 if the watchdog killed it.
set -u
log="$1"; silence="$2"; shift 2
[ "${1:-}" = "--" ] && shift

: > "$log"
"$@" >> "$log" 2>&1 &
pid=$!

last_size=-1
last_change=$(date +%s)
while kill -0 "$pid" 2>/dev/null; do
  sleep 5
  size=$(wc -c < "$log" | tr -d ' ')
  now=$(date +%s)
  if [ "$size" != "$last_size" ]; then
    last_size=$size; last_change=$now
  elif [ $((now - last_change)) -ge "$silence" ]; then
    echo "[watchdog] no output for ${silence}s — killing pid $pid" >> "$log"
    pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
    sleep 5
    pkill -KILL -P "$pid" 2>/dev/null; kill -KILL "$pid" 2>/dev/null
    exit 124
  fi
done
wait "$pid"
code=$?
echo "[watchdog] exit $code" >> "$log"
exit $code
