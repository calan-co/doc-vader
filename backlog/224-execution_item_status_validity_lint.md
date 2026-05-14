---
id: wi-224
type: work-item
subtype: task
lifecycle: active
status: ready
title: Create execution-item-status-validity lint rule
priority: medium
estimated: 2
tags:
  - validation
  - lint
  - execution
  - schemas
links:
  depends_on:
    - '[[210-canonical_schema_integration_epic.md]]'
    - '[[209-execution_item_ownership_lint.md]]'
---

## Goal

Create a pre-commit lint rule that validates execution status fields to ensure:

1. `current_phase` matches a phase name in the phases hierarchy (at any nesting level)
2. `current_item` matches an item ID found in some items array within phases
3. Cross-reference integrity (no dangling references)
4. Clear error messages guide resolution when violations are found

## Implementation

Create `staging/scripts/lint/execution-item-status-validity.cjs`:

```javascript
#!/usr/bin/env node

/**
 * @precommitRule Validates execution status field references
 * @precommitRule current_phase must match a phase name in phases hierarchy
 * @precommitRule current_item must match an item ID in phases.items arrays
 */

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const BACKLOG_DIR = path.join(__dirname, "../../../backlog");

/**
 * Recursively collect all phase names from hierarchy
 */
function collectPhaseNames(phase, names = []) {
  if (phase.name) {
    names.push(phase.name);
  }

  if (phase.phases) {
    phase.phases.forEach((subPhase) => {
      collectPhaseNames(subPhase, names);
    });
  }

  return names;
}

/**
 * Recursively collect all item IDs from phases hierarchy
 */
function collectItemIds(phase, items = new Set()) {
  if (phase.items) {
    phase.items.forEach((id) => items.add(id));
  }

  if (phase.phases) {
    phase.phases.forEach((subPhase) => {
      collectItemIds(subPhase, items);
    });
  }

  return items;
}

/**
 * Extract frontmatter from markdown file
 */
function extractFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return null;
  try {
    return yaml.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function main() {
  const files = fs
    .readdirSync(BACKLOG_DIR)
    .filter((f) => f.endsWith(".md") && f !== "AGENTS.md");

  let hasErrors = false;

  for (const file of files) {
    const filePath = path.join(BACKLOG_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter || !frontmatter.execution?.phases) {
      continue;
    }

    const itemId = frontmatter.id || path.basename(file, ".md");
    const execution = frontmatter.execution;

    // Collect all valid phase names and item IDs
    const allPhaseNames = new Set();
    const allItemIds = new Set();

    execution.phases.forEach((phase) => {
      collectPhaseNames(phase, allPhaseNames);
      collectItemIds(phase, allItemIds);
    });

    // Validate current_phase
    if (execution.current_phase) {
      if (!allPhaseNames.has(execution.current_phase)) {
        hasErrors = true;
        console.error(
          `❌ Item ${itemId}: current_phase "${execution.current_phase}" not found in phases`,
        );
        console.error(
          `   Available phases: ${Array.from(allPhaseNames).join(", ")}`,
        );
        console.error(
          `   Resolution: Update current_phase to match an existing phase name\n`,
        );
      }
    }

    // Validate current_item
    if (execution.current_item) {
      if (!allItemIds.has(execution.current_item)) {
        hasErrors = true;
        console.error(
          `❌ Item ${itemId}: current_item "${execution.current_item}" not found in items`,
        );
        console.error(
          `   Available items: ${Array.from(allItemIds).join(", ")}`,
        );
        console.error(
          `   Resolution: Update current_item to match an existing item ID\n`,
        );
      }
    }
  }

  if (hasErrors) {
    process.exit(1);
  } else {
    console.log("✅ All execution status field references are valid");
    process.exit(0);
  }
}

main();
```

## Acceptance Criteria

- [ ] Script recursively collects all phase names from hierarchy
- [ ] Script collects all item IDs from items arrays at all nesting levels
- [ ] Detects invalid current_phase references with clear guidance
- [ ] Detects invalid current_item references with clear guidance
- [ ] Error messages show available values for correction
- [ ] Script exits with code 1 on violations, 0 on success
- [ ] Pre-commit hook configured to run this validation
- [ ] Test cases created for valid and invalid scenarios

## Testing

**Valid scenario:**

```yaml
execution:
  current_phase: "Phase 2: Configuration System"
  current_item: "212"
  phases:
    - name: "Phase 1: Foundation"
      items: ["211"]
    - name: "Phase 2: Configuration System"
      items: ["212", "213", "214"]
```

**Invalid scenario 1 - Non-existent phase:**

```yaml
execution:
  current_phase: "Phantom Phase" # ❌ Not in phases
  current_item: "212"
  phases:
    - name: "Phase 1"
      items: ["211"]
    - name: "Phase 2"
      items: ["212"]
```

**Invalid scenario 2 - Non-existent item:**

```yaml
execution:
  current_phase: "Phase 2"
  current_item: "999" # ❌ Not in any items array
  phases:
    - name: "Phase 1"
      items: ["211"]
    - name: "Phase 2"
      items: ["212"]
```

**Invalid scenario 3 - Nested phase mismatch:**

```yaml
execution:
  current_phase: "Phase 2a" # ❌ Nested phase name not recognized
  current_item: "212"
  phases:
    - name: "Phase 1"
      items: ["211"]
    - name: "Phase 2"
      phases:
        - name: "Phase 2a"
          items: ["212"]
```

## Notes

- Uses recursive traversal to handle arbitrary nesting depth
- Phase name and item ID collection is case-sensitive for exact matching
- Script should be added to `.husky/pre-commit` hook after implementation
- Consider adding CI gate as well for merge protection
- Works in tandem with [[209-execution_item_ownership_lint]] to validate execution integrity
