#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-calan-co}"
REPO="${REPO:-doc-vader}"

# App id used in templjs/templ.js
APP_ID="${APP_ID:-3558979}"

# Path to PEM private key for the same GitHub App installation
APP_KEY_PATH="${APP_KEY_PATH:-$HOME/.keys/doc-vader.2026-04-30.private-key.pem}"

# Ruleset names that should allow the integration bypass (match templjs behavior)
RULESET_NAMES=("Long-lived Branch Policy" "Staging Merge Method Policy")

REPO_SLUG="$OWNER/$REPO"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

set_variable_if_needed() {
  local name="$1"
  local desired="$2"
  local current

  current="$(gh variable get "$name" --repo "$REPO_SLUG" --json value --jq '.value' 2>/dev/null || true)"
  if [[ "$current" == "$desired" ]]; then
    echo "Variable $name already set to desired value; skipping"
    return
  fi

  gh variable set "$name" --repo "$REPO_SLUG" --body "$desired"
  echo "Set variable $name"
}

echo "== Preflight =="
require_cmd gh
require_cmd jq
gh auth status >/dev/null
test -f "$APP_KEY_PATH" || { echo "Missing APP_KEY_PATH file: $APP_KEY_PATH"; exit 1; }

echo "== Set repo variable + secret =="
set_variable_if_needed BACKLOG_AUTOMATION_ENABLED "true"
set_variable_if_needed DOC_VADER_APP_ID "$APP_ID"

# Secrets are write-only via API; overwrite is safe and keeps desired state.
gh secret set DOC_VADER_PRIVATE_KEY --repo "$REPO_SLUG" < "$APP_KEY_PATH"
echo "Updated secret DOC_VADER_PRIVATE_KEY"

echo "== Read rulesets =="
RULESETS_JSON="$(gh api "repos/$OWNER/$REPO/rulesets")"

for RULESET_NAME in "${RULESET_NAMES[@]}"; do
  RULESET_ID="$(jq -r --arg n "$RULESET_NAME" '.[] | select(.name==$n) | .id' <<<"$RULESETS_JSON")"
  if [[ -z "$RULESET_ID" || "$RULESET_ID" == "null" ]]; then
    echo "Ruleset not found: $RULESET_NAME"
    exit 1
  fi

  FULL="$(gh api "repos/$OWNER/$REPO/rulesets/$RULESET_ID")"

  if jq -e --argjson app_id "$APP_ID" '
    any((.bypass_actors // [])[]?; .actor_type=="Integration" and .actor_id==$app_id and .bypass_mode=="always")
  ' <<<"$FULL" >/dev/null; then
    echo "Ruleset already has integration bypass: $RULESET_NAME ($RULESET_ID); skipping"
    continue
  fi

  echo "Updating bypass actor on ruleset: $RULESET_NAME ($RULESET_ID)"

  # Build full PUT payload preserving existing config and appending bypass actor if missing
  PAYLOAD="$(jq -c --argjson app_id "$APP_ID" '
    .bypass_actors = (
      (.bypass_actors // []) as $ba
      | if any($ba[]?; .actor_type=="Integration" and .actor_id==$app_id)
        then $ba
        else ($ba + [{"actor_id":$app_id,"actor_type":"Integration","bypass_mode":"always"}])
        end
    )
    | {
        name, target, enforcement, conditions, rules, bypass_actors
      }
  ' <<<"$FULL")"

  gh api --method PUT "repos/$OWNER/$REPO/rulesets/$RULESET_ID" \
    -H "Accept: application/vnd.github+json" \
    --input - <<<"$PAYLOAD" >/dev/null
done

echo "== Verify =="
gh api "repos/$OWNER/$REPO/actions/variables" --jq '.variables[] | [.name, .value] | @tsv'
gh api "repos/$OWNER/$REPO/actions/secrets" --jq '.secrets[]?.name'
for RULESET_NAME in "${RULESET_NAMES[@]}"; do
  RULESET_ID="$(jq -r --arg n "$RULESET_NAME" '.[] | select(.name==$n) | .id' <<<"$RULESETS_JSON")"
  gh api "repos/$OWNER/$REPO/rulesets/$RULESET_ID" --jq '.name, .bypass_actors'
done

echo "Done."