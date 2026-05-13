---
"@calan-co/doc-vader": minor
---

feat(210-phase-b): Implement vendor abstraction and PR-link resolver

**Phase B: Vendor Adapter & PR-Link Resolver**

Adds vendor-agnostic backlog automation infrastructure:

- `BacklogAutomationProvider` interface for multi-forge support (GitHub, GitLab, Bitbucket)
- `GitHubBacklogAutomationProvider` implementation with full webhook/API integration
- `SubjectResolver` interface and strategy pattern for pluggable resolution logic
- `LinkedPullRequestsResolver` with smart auth detection (fetch PR metadata when available, fallback gracefully)
- `SubjectResolverChain` executor with configurable strategy ordering
- Full async/await support for network operations

Maintains full backward compatibility with Phase A infrastructure while enabling Phase C evidence generation.

**Tests:** All 165+ tests pass. 23 new tests for provider and resolver abstractions.

**Acceptance:** All Phase B acceptance criteria met.
