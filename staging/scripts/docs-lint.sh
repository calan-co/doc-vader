#!/usr/bin/env bash
# Centralized documentation linting script
# Uses unified remark-lint pipeline with custom plugins for consistent validation

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

HAS_ERRORS=0
STATUS_FILE=$(mktemp "${TMPDIR:-/tmp}/docs-lint-status.XXXXXX")
trap 'rm -f "$STATUS_FILE"' EXIT

FORMAT="text"
FAIL_ON="error"
LINT_PATTERNS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --format=*)
      FORMAT="${1#*=}"
      shift
      ;;
    --fail-on)
      FAIL_ON="$2"
      shift 2
      ;;
    --fail-on=*)
      FAIL_ON="${1#*=}"
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: docs-lint.sh [--format text|json] [--fail-on error|warning] [patterns...]

Options:
  --format       Output format (default: text)
  --fail-on      Failure threshold for remark-lint messages (default: error)
EOF
      exit 0
      ;;
    *)
      LINT_PATTERNS+=("$1")
      shift
      ;;
  esac
done

if [[ "$FORMAT" != "text" && "$FORMAT" != "json" ]]; then
  echo "--format must be one of: text, json" >&2
  exit 2
fi

if [[ "$FAIL_ON" != "error" && "$FAIL_ON" != "warning" ]]; then
  echo "--fail-on must be one of: error, warning" >&2
  exit 2
fi

if [[ ${#LINT_PATTERNS[@]} -eq 0 ]]; then
  LINT_PATTERNS=("docs/**/*.md" "*.md" "backlog/**/*.md")
fi

if [[ "$FORMAT" == "json" ]]; then
  cd "$PROJECT_ROOT" || { echo "Failed to cd to $PROJECT_ROOT"; exit 1; }

  REMARK_OUTPUT=$(node --import tsx/esm scripts/docs-remark-lint.ts --format json --fail-on "$FAIL_ON" "${LINT_PATTERNS[@]}" 2>&1)
  REMARK_RESULT=$?
  FRONTMATTER_OUTPUT=$(node "$SCRIPT_DIR/lint/frontmatter-lint.cjs" 2>&1)
  FRONTMATTER_RESULT=$?

  if [[ $REMARK_RESULT -ne 0 || $FRONTMATTER_RESULT -ne 0 ]]; then
    HAS_ERRORS=1
  fi

  REMARK_RESULT="$REMARK_RESULT" \
  FRONTMATTER_RESULT="$FRONTMATTER_RESULT" \
  HAS_ERRORS="$HAS_ERRORS" \
  FAIL_ON="$FAIL_ON" \
  REMARK_OUTPUT="$REMARK_OUTPUT" \
  FRONTMATTER_OUTPUT="$FRONTMATTER_OUTPUT" \
  node - <<'NODE'
const payload = {
  format: "json",
  failOn: process.env.FAIL_ON,
  passed: process.env.HAS_ERRORS === "0",
  remark: {
    exitCode: Number(process.env.REMARK_RESULT ?? "1"),
    output: process.env.REMARK_OUTPUT ?? "",
  },
  frontmatter: {
    exitCode: Number(process.env.FRONTMATTER_RESULT ?? "1"),
    output: process.env.FRONTMATTER_OUTPUT ?? "",
  },
};
console.log(JSON.stringify(payload, null, 2));
NODE

  exit $HAS_ERRORS
fi

echo "${BLUE}================================${NC}"
echo "${BLUE}Documentation Validation${NC}"
echo "${BLUE}(Unified Remark Pipeline)${NC}"
echo "${BLUE}================================${NC}"
echo ""

# Aggregate all output to .lint-session.log for feedback loop
LINT_LOG=".lint-session.log"
rm -f "$LINT_LOG"

{
  echo "${YELLOW}Running unified remark-lint validation...${NC}"

  # Run the remark-based linter using node directly
  # This will validate: markdown style, template compliance, naming conventions,
  # cross-references, and more via the remark plugins
  cd "$PROJECT_ROOT"
  node --import tsx/esm scripts/docs-remark-lint.ts --fail-on "$FAIL_ON" "${LINT_PATTERNS[@]}"
  REMARK_RESULT=$?
  
  if [ $REMARK_RESULT -ne 0 ]; then
    HAS_ERRORS=1
    echo "${RED}✗ Unified validation failed${NC}"
  else
    echo "${GREEN}✓ Unified validation passed${NC}"
  fi
  
  echo ""
  
  # Note: frontmatter-lint.cjs is kept temporarily until item 172 integrates
  # frontmatter schema validation into the remark pipeline
  echo "${YELLOW}Validating frontmatter schema...${NC}"
  node $SCRIPT_DIR/lint/frontmatter-lint.cjs
  FRONTMATTER_RESULT=$?
  
  if [ $FRONTMATTER_RESULT -ne 0 ]; then
    HAS_ERRORS=1
    echo "${RED}✗ Frontmatter validation failed${NC}"
  else
    echo "${GREEN}✓ Frontmatter validation passed${NC}"
  fi
  
  echo "$HAS_ERRORS" > "$STATUS_FILE"
} 2>&1 | tee "$LINT_LOG"

if [ -f "$STATUS_FILE" ]; then
  HAS_ERRORS=$(cat "$STATUS_FILE")
fi

# Summary
echo "${BLUE}================================${NC}"
if [ $HAS_ERRORS -ne 0 ]; then
  echo "${RED}Documentation validation FAILED${NC}"
  echo "${BLUE}================================${NC}"
  echo ""
  echo "Review the errors above. For help, see:"
  echo "  - CONTRIBUTING.md for naming and style conventions"
  echo "  - docs/guide/centralized-remark-config.md for linting details"
  echo ""
else
  echo "${GREEN}All documentation validation PASSED${NC}"
  echo "${BLUE}================================${NC}"
  echo ""
fi

exit $HAS_ERRORS
