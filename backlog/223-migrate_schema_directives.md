---
id: wi-223
type: work-item
subtype: task
lifecycle: active
status: ready
title: Migrate Frontmatter Schema Directives to New Paths
summary: Bulk migrate markdown frontmatter schema directives
priority: low
audience:
  - contributors
governance:
  profiles:
    - migration
tags:
  - schema
  - paths
  - migration
  - bulk-update
estimated: 2
links:
  depends_on:
    - '[[222-update_code_defaults]]'
---

## Files to Update

All markdown files with `# yaml-language-server: $schema=...` directives:

- All backlog items in backlog/
- All documents in docs/

Example update:

```yaml
# BEFORE
# yaml-language-server: $schema=schemas/frontmatter/work-item/latest.json

# AFTER
# yaml-language-server: $schema=schemas/frontmatter/by-type/work-item/latest.json
```

## Implementation

Create migration script: `scripts/migrate-schema-directives.ts`

```typescript
import { glob } from "glob";
import { readFile, writeFile } from "fs/promises";

const OLD_PATTERN =
  /# yaml-language-server: \$schema=schemas\/frontmatter\/(document|work-item)\/latest\.json/;
const NEW_PATTERN = (type: string) =>
  `# yaml-language-server: $schema=schemas/frontmatter/by-type/${type}/latest.json`;

async function migrate() {
  const files = await glob("**/*.md", { ignore: ["node_modules/**"] });

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const updated = content.replace(OLD_PATTERN, (match, type) =>
      NEW_PATTERN(type),
    );

    if (updated !== content) {
      await writeFile(file, updated, "utf-8");
      console.log(`Updated: ${file}`);
    }
  }
}

migrate().catch(console.error);
```

## Execution Steps

1. Create scripts/migrate-schema-directives.ts
2. Run: `npx tsx scripts/migrate-schema-directives.ts`
3. Verify changes: `git diff | grep schema` (check updates)
4. Spot-check random files to ensure correctness

## Pattern Handled

- Relative paths: `schemas/frontmatter/{type}/latest.json`
- Both `document` and `work-item` types
- Variants: `current.json`, `v1.0.0.json` (if any)

## Edge Cases

- Custom schemas (e.g., `schemas/custom/schema.json`) - not updated
- URLs pointing to remote schemas - not updated
- Comments mentioning old paths - not updated (acceptable)

## Acceptance Criteria

- [ ] Migration script created and tested
- [ ] All ~50+ markdown files updated
- [ ] Schema directives point to by-type/ structure
- [ ] No unintended changes (custom schemas untouched)
- [ ] All updated files valid YAML frontmatter
- [ ] Git diff shows only schema path changes

## Testing

- [ ] Random sample of updated files passes frontmatter validation
- [ ] Backlog audit runs without schema errors
- [ ] Documentation frontmatter valid
- [ ] No broken wikilinks from update

## Related

- [[224-execution_item_status_validity_lint]]
