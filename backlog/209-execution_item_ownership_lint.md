---
id: wi-209
title: Create execution-item-ownership lint rule
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
estimated: 2
links:
  evidence:
    - '[[record-20260518-124800-209]]'
tags:
  - validation
  - lint
  - execution
  - schemas
---

## Goal

Create a pre-commit lint rule that validates execution phase hierarchies to ensure:

1. No work item is referenced in multiple epics
2. No work item is referenced multiple times within the same epic
3. Clear error messages guide resolution when violations are found

## Implementation

Create `staging/scripts/lint/execution-item-ownership.cjs`:

```javascript
#!/usr/bin/env node

/**
 * @precommitRule Validates execution phase item ownership
 * @precommitRule Each work item can only appear in one epic's execution hierarchy
 * @precommitRule Work items cannot be duplicated within same epic's phases
 */

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const BACKLOG_DIR = path.join(__dirname, "../../../backlog");

/**
 * Recursively collect all item IDs from a phase hierarchy
 * @param {object} phase - Phase object with items or nested phases
 * @param {string} phasePath - Human-readable path for error reporting
 * @param {Map<string, string[]>} itemLocations - Map of itemId -> [phase paths]
 * @returns {Map<string, string[]>} Updated itemLocations map
 */
function collectItemsFromPhase(phase, phasePath, itemLocations = new Map()) {
  if (phase.items) {
    phase.items.forEach((itemId) => {
      if (itemLocations.has(itemId)) {
        itemLocations.get(itemId).push(phasePath);
      } else {
        itemLocations.set(itemId, [phasePath]);
      }
    });
  }

  if (phase.phases) {
    phase.phases.forEach((subPhase) => {
      const subPath = `${phasePath} > ${subPhase.name}`;
      collectItemsFromPhase(subPhase, subPath, itemLocations);
    });
  }

  return itemLocations;
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

  // Map of epicId -> Map of itemId -> [phase paths]
  const epicItemMap = new Map();

  // First pass: collect all items from all epics
  for (const file of files) {
    const filePath = path.join(BACKLOG_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const frontmatter = extractFrontmatter(content);

    if (
      !frontmatter ||
      frontmatter.subtype !== "epic" ||
      !frontmatter.execution?.phases
    ) {
      continue;
    }

    const epicId = frontmatter.id || path.basename(file, ".md");
    const itemLocations = new Map();

    frontmatter.execution.phases.forEach((phase) => {
      collectItemsFromPhase(phase, phase.name, itemLocations);
    });

    epicItemMap.set(epicId, itemLocations);
  }

  // Second pass: validate ownership
  let hasErrors = false;

  // Check for items in multiple epics
  const globalItemMap = new Map(); // itemId -> [epicIds]

  for (const [epicId, itemLocations] of epicItemMap.entries()) {
    for (const itemId of itemLocations.keys()) {
      if (globalItemMap.has(itemId)) {
        globalItemMap.get(itemId).push(epicId);
      } else {
        globalItemMap.set(itemId, [epicId]);
      }
    }
  }

  // Report multi-epic violations
  for (const [itemId, epicIds] of globalItemMap.entries()) {
    if (epicIds.length > 1) {
      hasErrors = true;
      console.error(`❌ Item ${itemId} referenced in multiple epics:`);
      epicIds.forEach((epicId) => {
        const phases = epicItemMap.get(epicId).get(itemId);
        console.error(`   - Epic ${epicId}:`);
        phases.forEach((phase) => console.error(`     - ${phase}`));
      });
      console.error(
        `   Resolution: Move item to single epic, link via depends_on if needed\n`,
      );
    }
  }

  // Report intra-epic duplicates
  for (const [epicId, itemLocations] of epicItemMap.entries()) {
    for (const [itemId, phases] of itemLocations.entries()) {
      if (phases.length > 1) {
        hasErrors = true;
        console.error(`❌ Item ${itemId} duplicated within Epic ${epicId}:`);
        phases.forEach((phase) => console.error(`   - ${phase}`));
        console.error(
          `   Resolution: Remove duplicate references, keep one canonical location\n`,
        );
      }
    }
  }

  if (hasErrors) {
    process.exit(1);
  } else {
    console.log("✅ All execution item ownership constraints satisfied");
    process.exit(0);
  }
}

main();
```

## Acceptance Criteria

- [ ] Script validates recursive phase hierarchies correctly
- [ ] Multi-epic violations detected and reported with clear guidance
- [ ] Intra-epic duplicates detected and reported
- [ ] Error messages include epic IDs and phase paths
- [ ] Script exits with code 1 on violations, 0 on success
- [ ] Pre-commit hook configured to run this validation
- [ ] Test cases created for valid and invalid scenarios

## Testing

**Valid scenarios:**

```yaml
# Epic 172
execution:
  phases:
    - name: "Phase 1"
      items: ["172.1", "172.2"]
    - name: "Phase 2"
      phases:
        - name: "Phase 2a"
          items: ["172.3"]
        - name: "Phase 2b"
          items: ["172.4"]

# Epic 209
execution:
  phases:
    - name: "Phase 1"
      items: ["209.1"]
```

**Invalid scenario 1 - Multi-epic:**

```yaml
# Epic 172
execution:
  phases:
    - name: "Phase 1"
      items: ["172.1"]

# Epic 209
execution:
  phases:
    - name: "Phase 1"
      items: ["172.1"]  # ❌ Duplicate across epics
```

**Invalid scenario 2 - Intra-epic duplicate:**

```yaml
# Epic 172
execution:
  phases:
    - name: "Phase 1"
      items: ["172.1"]
    - name: "Phase 2"
      items: ["172.1"] # ❌ Duplicate within same epic
```

## Dependencies

- Depends on: [[172.canonical-schema-integration-epic.md]] (execution property must exist in schema)
- Blocks: None

## Notes

- Uses recursive traversal to handle arbitrary nesting depth
- Phase path construction (`Phase 1 > Phase 1a > Phase 1a1`) provides clear error location context
- Script should be added to `.husky/pre-commit` hook after implementation
- Consider adding CI gate as well for merge protection
