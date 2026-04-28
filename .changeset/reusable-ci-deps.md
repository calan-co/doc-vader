---
"@calan-co/doc-vader": minor
---

Add missing direct dependencies required by plugin and processor modules: `unified-lint-rule`, `unist-util-visit-parents`, `vfile`, `zod`, `@types/mdast`. Add `tsx` as dev dependency for docs-lint script runtime. These were previously resolved transitively but must be declared explicitly per semver contract.
