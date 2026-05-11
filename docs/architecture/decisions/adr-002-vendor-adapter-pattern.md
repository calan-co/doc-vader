---
$schema: /frontmatter/document
id: adrvendo-7451
title: Implement vendor adapter pattern for backlog automation
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - backlog-automation
  - vendor-abstraction
links:
  reference:
    - '[[../../reference/work-management/overview.md]]'
  implements:
    - '[[../../../backlog/175.extended-rules-and-autofix-feature.md]]'
---

## Context and Problem Statement

The backlog automation system currently couples vendor-specific logic (GitHub) with domain logic for subject extraction and event ingestion. This creates several problems:

- **Maintainability**: Any vendor-specific detail (payload shape, webhook format, API calls) is embedded in the main `lib/work-management/index.ts` module.
- **Portability**: Supporting a second forge (GitLab, Bitbucket, Gitea) would require rewriting event parsing, subject extraction, and PR identity normalization throughout the domain layer.
- **Testability**: Domain logic cannot be tested independently of GitHub's payload format.
- **Silent failures**: Subject extraction failures (e.g., no work-item tokens in PR body) have no structured error reporting or fallback mechanism.

## Decision

Implement a vendor adapter pattern that:

1. **Extracts vendor-specific logic** into a `BacklogAutomationProvider` interface with concrete adapters (`GitHubBacklogAutomationProvider`, etc.)
2. **Centralizes payload normalization** so domain logic operates on a vendor-agnostic `ParsedEvent` contract
3. **Separates concerns**: domain rules (condition checking, evidence generation) from vendor details (API client calls, payload mapping)
4. **Enables multi-strategy resolution** through a provider-agnostic `SubjectResolver` chain (see ADR-003)

## Scope

### In Scope

- Define `BacklogAutomationProvider` interface and `GitHubBacklogAutomationProvider` implementation
- Extract payload parsing, PR identity normalization, and workflow run identity extraction to provider methods
- Update `lib/work-management/ingestEvent()` to use provider adapters
- Create provider registry for selective initialization (GitHub-only initially)
- Move PR metadata fetching (optional fallback) to provider methods

### Out of Scope

- GitLab, Bitbucket, or other forge adapters (future work)
- Provider discovery from repository configuration (future; hard-coded to GitHub for now)
- Dynamic provider switching per workflow run (future)

## Decision Drivers

1. **Multi-forge support**: Must enable adding new vendors without touching domain logic
2. **Testability**: Domain tests should mock a single provider interface, not GitHub payloads
3. **Error visibility**: Vendor-specific failures (PR fetch failed, subject extraction failed) must be reportable
4. **Minimal coupling**: Core automation logic should not import GitHub client libraries or types

## Considered Options

### Option 1: Status quo (keep GitHub logic in `lib/work-management`)

- **Pros**: No refactoring; works for single vendor.
- **Cons**: Unmaintainable for multi-forge; hard to test; silent failures.

### Option 2: Vendor adapter interface (chosen)

- **Pros**: Clean separation; testable; supports multi-forge; structured errors.
- **Cons**: Upfront design cost; requires interface discipline.

### Option 3: Configuration-driven routing (e.g., JSON config per vendor)

- **Pros**: Dynamic vendor selection without code changes.
- **Cons**: Over-engineered for current needs; defers critical design decisions.

## Consequences

### Positive

- Domain logic can be tested without GitHub API/payload knowledge.
- Adding a new forge requires a new adapter class and provider registration, not changes to core automation.
- Vendor-specific failures surface as structured errors in scan reports.
- Clear contract between adapter and domain (ParsedEvent, PRIdentity, WorkflowRunIdentity).

### Negative/Risks

- Initial refactoring effort to extract GitHub adapter from monolithic `lib/work-management/index.ts`.
- Adapter interface must remain stable; future breaking changes require migration.
- Provider registry adds a minor initialization step.

## Architecture Sketch

```
┌─────────────────────────────────────────────────────────────┐
│ Domain Layer (Vendor-Agnostic)                              │
│                                                              │
│  ├─ ingestEvent(event: ParsedEvent)                         │
│  ├─ checkConditions(state: ScanState): Condition[]          │
│  ├─ generateEvidence(record: EvidenceRecord)                │
│  └─ SubjectResolver (multi-strategy chain)                  │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ uses
                           │
┌──────────────────────────────────────────────────────────────┐
│ Adapter Layer (Vendor-Specific)                              │
│                                                              │
│  ├─ BacklogAutomationProvider interface                      │
│  │   ├─ parsePayload(raw: Record)                           │
│  │   ├─ extractPRIdentity(event: ParsedEvent)               │
│  │   ├─ extractWorkflowRunIdentity(event: ParsedEvent)      │
│  │   ├─ normalizePRReference(ref: string)                   │
│  │   └─ fetchPRMetadata(ref: PRIdentity)                    │
│  │                                                           │
│  └─ GitHubBacklogAutomationProvider                          │
│      (implements BacklogAutomationProvider)                  │
└──────────────────────────────────────────────────────────────┘
```

### Core Interfaces

```typescript
// Vendor-agnostic event representation
interface ParsedEvent {
  source: 'workflow_run' | 'pull_request' | 'issue';
  timestamp: string;
  workflow?: {
    name: string;
    displayTitle?: string;
    status: 'completed' | 'in_progress' | 'pending';
    conclusion?: string;
  };
  pullRequest?: {
    number: number;
    url: string;
    title: string;
    body: string;
    merged: boolean;
  };
}

interface PRIdentity {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

interface WorkflowRunIdentity {
  id: string;
  owner: string;
  repo: string;
  status: string;
  conclusion?: string;
}

interface BacklogAutomationProvider {
  parsePayload(raw: Record<string, unknown>): ParsedEvent;
  extractPRIdentity(event: ParsedEvent): PRIdentity | null;
  extractWorkflowRunIdentity(event: ParsedEvent): WorkflowRunIdentity | null;
  normalizePRReference(ref: string): string;
  fetchPRMetadata?(identity: PRIdentity): Promise<PRMetadata | null>;
}
```

## Migration Strategy

### Phase 1: Define interfaces and GitHub adapter (see work item A)

- Extract `GitHubBacklogAutomationProvider` from current `lib/work-management/index.ts` logic
- Create `BacklogAutomationProvider` interface
- Create provider registry and initialization

### Phase 2: Update domain layer to use provider (see work item D)

- Refactor `ingestEvent()` to accept a provider and call its methods
- Update workflows to initialize provider before calling ingest
- Update tests to mock provider instead of GitHub payloads

### Phase 3: Future forges

- Add `GitLabBacklogAutomationProvider` or other adapters
- No changes to domain or workflow automation required

## Validation Checklist

- [ ] `BacklogAutomationProvider` interface and `GitHubBacklogAutomationProvider` created
- [ ] All GitHub-specific payload logic moved to adapter methods
- [ ] Provider registry tests pass (GitHub provider loads correctly)
- [ ] Domain tests mock provider interface, not GitHub payloads
- [ ] Adapter extraction does not change observed behavior (no silent failures)
- [ ] Error reporting includes adapter-specific failure context

## Related Decisions

- **ADR-003**: Multi-strategy subject resolution leverages vendor adapters for PR metadata fallback
- **ADR-004**: Backlog scan lifecycle uses providers to normalize event sources

