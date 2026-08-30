---
"@calan-co/doc-vader": patch
---

Apply Windows-only timeout headroom (15s on win32 vs 5s elsewhere) to the Git and SQLite integration tests, disable Vitest test-file parallelism on Windows, and remove obsolete globally hoisted memfs mocks from Vitest setup.
