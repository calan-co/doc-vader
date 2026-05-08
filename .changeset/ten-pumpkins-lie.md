---
"@calan-co/doc-vader": patch
---

Improve backlog scan reliability and CI compliance:

- handle per-file read errors without aborting the full report
- normalize report paths across platforms
- skip `backlog/archive` by default with optional include flag
- make scan reporter tests deterministic
