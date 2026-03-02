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
  npm run build >/dev/null
fi

set +e
node dist/cli/doc-vader.js backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > "$ARTIFACT_PATH"
STATUS=$?
set -e

echo "Backlog hygiene report: $ARTIFACT_PATH"
exit "$STATUS"
