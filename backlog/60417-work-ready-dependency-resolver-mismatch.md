---
id: wi-60417
title: Fix `dv wi ready` Dependency Resolver Mismatch
summary: Resolve inconsistency between graph resolver and ready filter's dependency evaluator that blocks dependent work items from being selectable.
type: work-item
subtype: bug
lifecycle: active
status: ready
status_reason: ready
priority: high
estimated: 3
links:
  blocks:
    - '[[60415-authoritative-dv4sandcastle-documentation]]'
    - '[[60416-end-to-end-sandcastle-smoke-and-recovery]]'
  reference:
    - '[[../docs/reference/work-management/foundation.md]]'
tags:
  - afk
  - bug
  - work-management
  - ready-evaluation
---

# Fix `dv wi ready` Dependency Resolver Mismatch

## Problem

The work graph correctly resolves dependencies, but `dv wi ready` reports dependency state as unknown, preventing work items with satisfied dependencies from being selectable.

**Observed behavior:**
- `dv work graph inspect wi:60415` shows wi-60415's dependency correctly resolved to wi:60414
- `dv wi ready --json` reports the same dependency as `stateKnown: false`, `satisfied: false`
- wi-60415 and dependent items remain excluded from ready candidates

**Impact:**
- AFK work items blocked on completed dependencies cannot be claimed for Sandcastle
- Ready filter is unreliable for multi-item workflows

## Root Cause

Two different dependency resolvers exist in doc-vader:

1. **Graph resolver** (used by `dv work graph inspect`) — correctly resolves work-item references
2. **Ready filter evaluator** (used by `dv wi ready`) — fails to resolve the same references

Both should use the same resolution strategy. The graph resolver is proven correct; the ready filter should adopt its pattern.

## What to fix

Update the ready filter's dependency evaluation to use the same resolver as the work graph. Ensure both resolvers handle:
- Short-form references: `[[60414-sandcastle-init-templateargs-wiring]]`
- Path-form references: `[[../backlog/60414-sandcastle-init-templateargs-wiring.md]]`
- Graph node resolution consistency across all `dv` commands

## Acceptance criteria

- [ ] Graph resolver and ready filter use the same dependency resolution strategy
- [ ] `dv wi ready --json` reports wi-60415 as a candidate after wi-60414 completion
- [ ] Both reference formats (short-form and path-form) resolve correctly
- [ ] Verified with: clear runtime cache (`rm -f .doc-vader/runtime/runtime.sqlite`) and retest
- [ ] Add regression test: create a test work item with depends_on link and verify ready filter evaluates it correctly
- [ ] No other work items' readiness evaluation is negatively affected

## Verification steps

1. Start state: `dv wi ready --json` shows empty candidates, wi-60415 in exclusions with `stateKnown: false`
2. After fix: `dv wi ready --json` includes wi-60415 in candidates
3. Verify `dv work graph inspect wi:60415` still shows correct resolved edges
4. Run full backlog validation: `pnpm run backlog:validate`

## Related

- Blocks wi-60415 and wi-60416 from being claimed for AFK execution
- Part of Sandcastle readiness workflow: https://github.com/calan-co/doc-vader/issues/60379
