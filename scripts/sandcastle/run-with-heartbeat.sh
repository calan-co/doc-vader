#!/usr/bin/env sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: scripts/sandcastle/run-with-heartbeat.sh <label> <command> [args...]" >&2
  exit 2
fi

label="$1"
shift

"$@" &
pid="$!"
status=0
elapsed=0
heartbeat_seconds="${SANDCASTLE_HEARTBEAT_SECONDS:-30}"

while kill -0 "$pid" 2>/dev/null; do
  if [ "$elapsed" -eq 0 ]; then
    timestamp="$(date -Iseconds 2>/dev/null || date)"
    printf '[heartbeat] %s still running at %s\n' "$label" "$timestamp"
    elapsed="$heartbeat_seconds"
  fi
  sleep 1
  elapsed=$((elapsed - 1))
done

set +e
wait "$pid"
status="$?"
set -e

timestamp="$(date -Iseconds 2>/dev/null || date)"
printf '[heartbeat] %s exited with status %s at %s\n' "$label" "$status" "$timestamp"
exit "$status"
