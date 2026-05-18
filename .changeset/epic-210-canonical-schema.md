---
"doc-vader": patch
---

feat(epic-210): canonical schema integration — TypeBox config, DRY schema resolver, JSON-LD vocabulary support

- Add `lib/config/schema.ts`: TypeBox-based config schemas (`DocVaderConfigSchema`, `VocabularyConfigSchema`, etc.)
- Add `lib/config/loader.ts`: `ConfigLoader` class to load and validate `.doc.json`
- Add `lib/schema/resolver.ts`: DRY `resolveSchema` / `resolveVocabularyContext` with 4-level precedence
- Update `lib/backlog/audit.ts`, `lib/frontmatter/lint.ts` to use `resolveSchema`
- Add `@context` / `@type` optional properties to frontmatter document schema (current, 1.0.0, latest)
- Add `contexts/document.jsonld` and `contexts/work-item.jsonld` (JSON-LD vocabulary mappings)
- Add `.doc.json` root config with `schemaMap` and `vocabularies`
- Add `schemas/README.md` documenting versioning and `$id` conventions
- Remove `$versioningScheme` from document schema files (WI-211)
