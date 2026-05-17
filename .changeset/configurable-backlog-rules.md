---
"doc-vader": minor
---

Make backlog scan subject matching and candidate validation rules configurable through `.doc-vader/backlog-consumer.json`.

- Add configurable work item token prefixes via `automation.workItemMatchPatterns`.
- Add configurable pull request link extraction path via `automation.pullRequestPath`.
- Add configurable candidate validation requirements via `automation.requiredCandidateFields`.
- Add unit, integration, and e2e coverage for config-driven behavior.
- Document the new configuration keys in backlog scan reference docs.
