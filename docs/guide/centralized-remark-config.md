# Centralized Remark Configuration & Core Pipeline

This feature provides a single source of truth for remark linting rules and options, with standardized plugin exports and zod-validated schemas.

## Usage

### 1. Configuration

Create a `.remarkrc.mjs` file:

```js
import { remarkLintChecklist } from "./lib/plugins/remark-lint-checklist.js";
import { remarkLintCrossref } from "./lib/plugins/remark-lint-crossref.js";
import { remarkLintTemplateCompliance } from "./lib/plugins/remark-lint-template-compliance.js";

export default {
  plugins: [
    [
      remarkLintChecklist,
      { enabled: true, requiredItems: ["Task 1", "Task 2"] },
    ],
    [remarkLintCrossref, { enabled: true }],
    [
      remarkLintTemplateCompliance,
      { enabled: true, requiredHeadings: ["Introduction", "Conclusion"] },
    ],
  ],
};
```

### 2. Programmatic API

Use the processor factory in scripts/tests:

```ts
import { createTiabProcessor } from "./lib/processor";

const processor = createTiabProcessor({
  checklist: { enabled: true, requiredItems: ["Task 1", "Task 2"] },
  crossref: { enabled: true },
  templateCompliance: {
    enabled: true,
    requiredHeadings: ["Introduction", "Conclusion"],
  },
});
```

### 3. Plugin Option Validation

All plugins use zod schemas for options. Invalid options will throw errors during processing.

### 4. Testing

Unit and integration tests are provided in `lib/plugins/*.test.ts` and `lib/integration/remark-pipeline.integration.test.ts`.

## Migration

- Refactor any custom plugin configs to use zod schemas.
- Use the processor factory for consistent linting in CI, scripts, and tests.

---

For more details, see the implementation plan and backlog files.
