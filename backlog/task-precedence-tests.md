---
# yaml-language-server: $schema=../schemas/work-item.frontmatter.schema.json
id: wi-002
title: Parser Precedence and Fenced Code Block Exclusion
type: work-item
subtype: feature
lifecycle: active
status: proposed
priority: medium
classification:
  diataxis: how-to
  sensitivity: internal
tags: [parsers, precedence, code-blocks, testing]
---

**Estimated Effort:** 1–2 hours  
**Priority:** Medium (correctness and robustness)  
**Assignee:** TBD  
**Depends On:** wi-001 (parsers implemented)

## Overview

Ensure that Linkity parsers respect precedence rules and do not parse links inside fenced code blocks. Add/enable tests to verify correct behavior.

## Context

- Fenced code blocks (triple backticks) should be excluded from parsing
- Parser precedence must be deterministic and documented
- Tests should cover nested patterns, code block exclusion, and off-switch isolation

## Checklist

### Core Functionality

- [ ] Implement logic in `src/index.ts` to exclude parsing inside fenced code blocks
- [ ] Ensure parser precedence is correct (wikilink > markdown > url, or as specified)

### Testing & Validation

- [ ] Add/enable tests in `test/parse-precedence.test.ts` for:
  - Nested patterns (e.g., links inside links)
  - Fenced code block exclusion (no links parsed inside code fences)
  - Off-switch isolation (only enabled parsers run)
- [ ] Validate that position offsets remain accurate when excluding code blocks
- [ ] Confirm all tests pass

## Success Criteria

✅ No links parsed inside fenced code blocks  
✅ Parser precedence is correct and documented  
✅ All relevant tests pass

## References

- `src/index.ts` (main API logic)  
- `test/parse-precedence.test.ts` (test patterns)
