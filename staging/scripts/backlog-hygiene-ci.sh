#!/bin/sh
# CI-friendly backlog hygiene validation.
# Always writes JSON report artifact, then exits with gate status.

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT_DIR" || exit 1

ARTIFACT_PATH=${1:-backlog/audit/auditing-backlog-report.json}
ARTIFACT_DIR=$(dirname -- "$ARTIFACT_PATH")
mkdir -p "$ARTIFACT_DIR"

if [ ! -f dist/cli/doc-vader.js ]; then
  if command -v nx >/dev/null 2>&1; then
    nx run doc-vader:build >/dev/null
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm exec nx run doc-vader:build >/dev/null
  else
    echo "dist/cli/doc-vader.js is missing and neither nx nor pnpm is available to build it." >&2
    exit 1
  fi
fi

set +e
if command -v pnpm >/dev/null 2>&1; then
  pnpm -s run dv backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > "$ARTIFACT_PATH"
else
  node dist/cli/doc-vader.js backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > "$ARTIFACT_PATH"
fi
STATUS=$?
set -e

echo "Backlog hygiene report: $ARTIFACT_PATH"
exit "$STATUS"
