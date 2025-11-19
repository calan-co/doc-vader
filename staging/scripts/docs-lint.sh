#!/bin/sh
# Centralized documentation linting script
# Orchestrates all documentation validation tools

SCRIPT_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")

echo $SCRIPT_DIR

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

HAS_ERRORS=0

echo "${BLUE}================================${NC}"
echo "${BLUE}Documentation Validation${NC}"
echo "${BLUE}================================${NC}"
echo ""


# Aggregate all output to .lint-session.log for feedback loop
LINT_LOG=".lint-session.log"
rm -f "$LINT_LOG"

{
  echo "${YELLOW}[4/9] Validating markdown style...${NC}"
  if [ "$#" -gt 0 ]; then
    npx markdownlint-cli2 "$@"
  else
    npx markdownlint-cli2 'docs/**/*.md' '*.md'
  fi
  if [ $? -ne 0 ]; then
    HAS_ERRORS=1
    echo "${RED}✗ Markdown style validation failed${NC}"
  else
    echo "${GREEN}✓ Markdown style validation passed${NC}"
  fi
  for LINT in markdown-style naming diagram crossref anchor frontmatter template "structure folder" "structure readme"; do
      echo "${YELLOW}[$LINT] Validating $LINT...${NC}"
      if [ "$#" -gt 0 && "$LINT" != "frontmatter" ]; then
        node $SCRIPT_DIR/lint.js $LINT "$@"
      else
        node $SCRIPT_DIR/lint.js $LINT
      fi
    if [ $? -ne 0 ]; then
      HAS_ERRORS=1
      echo "${RED}✗ $LINT validation failed${NC}"
    else
      echo "${GREEN}✓ $LINT validation passed${NC}"
    fi
    echo ""
  done
} 2>&1 | tee "$LINT_LOG"

# Summary
echo "${BLUE}================================${NC}"
if [ $HAS_ERRORS -ne 0 ]; then
  echo "${RED}Documentation validation FAILED${NC}"
  echo "${BLUE}================================${NC}"
  echo ""
  echo "To auto-fix markdown style issues, run:"
  echo "  ${YELLOW}npm run docs:lint:fix${NC}"
  echo ""
else
  echo "${GREEN}All documentation validation PASSED${NC}"
  echo "${BLUE}================================${NC}"
  echo ""
fi

# Always run feedback loop after linting
# node $SCRIPT_DIR/lint/feedback-hook.js

exit $HAS_ERRORS
