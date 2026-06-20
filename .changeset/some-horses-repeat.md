---
"@calan-co/doc-vader": minor
---

Implement remark-frontmatter-schema plugin for unified frontmatter validation

- Add Ajv-backed remark-frontmatter-schema plugin supporting strict/non-strict modes
- Integrate plugin into .remarkrc.mts Layer 1 for early frontmatter validation  
- Support caching strategy keyed by file path + mtime
- Enable type-specific schema resolution from schemas/frontmatter/ directory
- Comprehensive test coverage (8 tests) with all passing
