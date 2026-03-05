#!/bin/sh
# Centralized documentation linting script
# Uses unified remark-lint pipeline with custom plugins for consistent validation

SCRIPT_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

HAS_ERRORS=0
STATUS_FILE=$(mktemp "${TMPDIR:-/tmp}/docs-lint-status.XXXXXX")
trap 'rm -f "$STATUS_FILE"' EXIT

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
  
  # Determine which files to lint
  LINT_PATTERNS="docs/**/*.md *.md backlog/**/*.md"
  if [ "$#" -gt 0 ]; then
    LINT_PATTERNS="$@"
  fi
  
  # Run the remark-based linter using node directly
  # This will validate: markdown style, template compliance, naming conventions,
  # cross-references, and more via the remark plugins
  cd "$PROJECT_ROOT"
  NODE_OPTIONS="--loader tsx/esm" node scripts/docs-remark-lint.ts $LINT_PATTERNS
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
