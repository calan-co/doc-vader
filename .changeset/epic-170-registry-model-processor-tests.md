---
"@calan-co/doc-vader": patch
---

feat(epic-170): cross-file registry model doc and unified processor test suite (WI-228, WI-229)

- Add `docs/reference/cross-file-registry-model.md`: defines `RegistryNode`, `ProjectRegistry` interface, resolution algorithm, cache semantics, error reporting, and integration points for Epic 170 Track C plugins
- Add `tests/processor.test.ts`: 19-test suite covering `createTiabProcessor` composition, checklist/templateCompliance/crossref plugin wiring, instance isolation, and Epic 170 Phase 1 exit-gate baseline
