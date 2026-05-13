---
"@calan-co/doc-vader": minor
---

feat(210-phase-d): convert backlog sweep workflow to thin wrapper

Phase D updates the backlog sweep workflow to invoke `doc-vader backlog scan --generate-evidence` as a thin wrapper and uploads a JSON scan report artifact (`backlog-scan-report-{run-id}`).

Also adds troubleshooting runbook guidance for retrieving and debugging scan failures via workflow artifacts.
