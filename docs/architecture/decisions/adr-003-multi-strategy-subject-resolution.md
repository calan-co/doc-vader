---
"$schema": /frontmatter/document
id: adr-003-multi-strategy-subject-resolution
title: Implement multi-strategy subject resolution for evidence generation
type: document
subtype: decision
status: accepted
lifecycle: active
priority: high
tags:
  - adr
  - architecture
  - backlog-automation
  - subject-resolution
  - evidence-generation
links:
  reference:
    - "[[../../reference/work-management/overview.md]]"
  implements:
    - "[[../../../backlog/175.extended-rules-and-autofix-feature.md]]"
  depends:
    - "[[adr-002-vendor-adapter-pattern.md]]"
---

## Context and Problem Statement

Evidence generation in backlog automation currently fails silently when work-item subjects cannot be extracted from the triggering event's payload. Specifically:

**Incident**: Workflow run 25519076107 (templ.js) completed successfully with valid status but generated no evidence record (subjects: []).

**Root Cause**: The `extractGithubSubjects()` function searched for `work-item:...` tokens in:
- PR display title
- PR body
- Workflow run display title

When no tokens were found, the function returned an empty array with no error context. The automation system treated this as "no subjects to evidence" and silently skipped evidence creation.

**Problem**: No audit trail; cannot distinguish between "intentionally no subjects" and "subject extraction failed." This creates:

- Blind spots in automation health monitoring
- Missed evidence linking when subjects exist but are not in expected locations
- Poor developer experience (no guidance on why evidence was not created)

## Decision

Implement a **multi-strategy subject resolver** that:

1. **Tries multiple strategies in order** (configurable per consumer):
   - `payload_subject_tokens`: Extract `work-item:...` tokens from PR/workflow payload (current behavior)
   - `linked_pull_requests`: Fetch PR metadata via provider API; search PR body for tokens
   - `audit_pr_subject_index`: Query audit index of historic PR subjects by PR number/URL
   - `provider_associated_pull_requests`: Use provider's PR association endpoint (vendor-specific)

2. **Reports resolution status** with structured positive/negative conditions:
   - **Positive**: `subject_resolved`, `pr_link_found`, `pr_metadata_fetched`
   - **Negative**: `resolve_subject_failed` (with reason), `fetch_pr_metadata_failed` (with reason)

3. **Supports configuration** via `automation.subjectResolutionOrder` in consumer config:
   ```json
   "subjectResolutionOrder": [
     "payload_subject_tokens",
     "linked_pull_requests",
     "audit_pr_subject_index"
   ]
   ```

4. **Enables future enhancements** without config changes:
   - ML-based subject detection
   - Regex-based subject extraction from custom patterns
   - Webhook metadata caching

## Scope

### In Scope

- Define `SubjectResolver` interface with strategy methods
- Implement `payload_subject_tokens` strategy (current logic)
- Implement `linked_pull_requests` strategy (vendor adapter + PR metadata fetch)
- Implement `audit_pr_subject_index` strategy (read-only query to audit index)
- Create resolver chain executor (`SubjectResolverChain`) that tries strategies in order
- Update `ingestEvent()` to use resolver chain instead of direct `extractGithubSubjects()`
- Structured reporting of resolution attempts and outcomes

### Out of Scope

- Configuration UI for strategy reordering (consumer edit backlog or JSON directly)
- ML-based or regex subject detection (future)
- Real-time strategy performance metrics (can be added later)

## Decision Drivers

1. **Evidence completeness**: Must maximize subject resolution success without guessing
2. **Auditability**: All resolution attempts must be logged with success/failure context
3. **Configurability**: Consumers should control strategy order (risk tolerance, latency)
4. **Extensibility**: New strategies should not require changes to resolver chain implementation
5. **Debugging**: Failed resolution must provide clear feedback to automation users

## Considered Options

### Option 1: Keep current behavior (single payload extraction)

- **Pros**: No code changes; no API calls.
- **Cons**: Silent failures; incomplete evidence; blindness to resolver gaps.

### Option 2: Multi-strategy resolver with configurable order (chosen)

- **Pros**: Closes gaps; visible failures; extensible; supports multiple vendor APIs.
- **Cons**: Slightly higher latency (API calls); more complex resolver logic; requires audit index infrastructure.

### Option 3: Mandatory API fallback (always fetch PR if payload fails)

- **Pros**: Highest subject resolution rate.
- **Cons**: Always incurs API call latency; couples to vendor APIs; harder to troubleshoot.

## Consequences

### Positive

- **Visibility**: All resolution attempts are logged; failures are actionable (e.g., "PR not found", "no subject tokens")
- **Flexibility**: Consumers can tune strategy order (e.g., fast-only → just payload tokens; slow-ok → full resolver chain)
- **Completeness**: Evidence is generated even if subject is in PR metadata (not payload)
- **Auditability**: Audit report includes resolution strategy used and fallback chain executed
- **Extensibility**: New strategies are added as resolver implementations; no core changes

### Negative/Risks

- **Latency**: `linked_pull_requests` strategy requires API call; adds latency to evidence generation
- **Rate limiting**: Heavy use of PR metadata fetching could hit vendor API rate limits
- **Audit index dependency**: `audit_pr_subject_index` strategy requires pre-populated index (initially unavailable)
- **Complexity**: Developers must understand strategy chain and configuration

## Architecture Sketch

```
Event (payload)
   ▼
ParsedEvent (vendor-agnostic, from BacklogAutomationProvider)
   ▼
SubjectResolverChain.resolve()
   │
   ├─ Strategy 1: ExtractPayloadTokens
   │  ├─ Search for work-item:... tokens in PR body, title, workflow name
   │  ├─ Return: ["work-item:X", "work-item:Y"] or []
   │  └─ Report: {strategy: "payload_subject_tokens", found: N, error: null}
   │
   ├─ Strategy 2: FetchLinkedPullRequests (if no subjects found)
   │  ├─ Use provider.fetchPRMetadata(PRIdentity)
   │  ├─ Search PR body for work-item:... tokens
   │  ├─ Return: ["work-item:Z"] or []
   │  └─ Report: {strategy: "linked_pull_requests", found: M, error: "fetch failed"}
   │
   ├─ Strategy 3: QueryAuditPRSubjectIndex (if no subjects found)
   │  ├─ Lookup {pr_number, repo} in audit index
   │  ├─ Return: ["work-item:W"] or []
   │  └─ Report: {strategy: "audit_pr_subject_index", found: K, error: null}
   │
   └─ Result: {subjects: [all found], resolutionReport: [...]}
      ▼
   ScanState (see ADR-004)
```

### Core Interfaces

```typescript
interface SubjectResolver {
  name: string;
  resolve(event: ParsedEvent, provider: BacklogAutomationProvider, context?: ResolutionContext): Promise<SubjectResolutionResult>;
}

interface SubjectResolutionResult {
  subjects: string[];
  strategyUsed: string;
  duration: number; // milliseconds
  error?: {
    code: string;
    message: string;
  };
}

interface SubjectResolverChain {
  resolve(event: ParsedEvent, strategies: string[], provider: BacklogAutomationProvider): Promise<ResolutionReport>;
}

interface ResolutionReport {
  finalSubjects: string[];
  attempts: SubjectResolutionResult[];
  resolvedAt: string;
  resolutionStrategy: string; // which strategy succeeded
  totalDuration: number;
}

// Config contract
interface BacklogConsumerAutomation {
  autoEvidenceFromWorkflowRuns?: boolean;
  autoCloseOnMerge?: boolean;
  generateEvidenceDuringScan?: boolean;
  subjectResolutionOrder?: Array<'payload_subject_tokens' | 'linked_pull_requests' | 'audit_pr_subject_index' | 'provider_associated_pull_requests'>;
}
```

## Migration Strategy

### Phase 1: Define resolver interface and payload strategy

- Create `SubjectResolver` interface and `PayloadSubjectTokensResolver`
- Create `SubjectResolverChain` executor
- Move current `extractGithubSubjects()` logic to resolver

### Phase 2: Implement linked PR strategy

- Create `LinkedPullRequestsResolver`
- Use `BacklogAutomationProvider.fetchPRMetadata()` to get PR details
- Search fetched PR body for subject tokens

### Phase 3: Implement audit index strategy

- Create audit index scanning mechanism (future work; initially empty)
- Create `AuditPRSubjectIndexResolver`

### Phase 4: Configuration support

- Update `.doc-vader/backlog-consumer.json` schema to include `subjectResolutionOrder`
- Update CLI to accept `--resolver-order` flag

## Validation Checklist

- [ ] `SubjectResolver` interface and `SubjectResolverChain` created
- [ ] `PayloadSubjectTokensResolver` extracts current logic with identical behavior
- [ ] `LinkedPullRequestsResolver` calls provider and fetches PR metadata
- [ ] Resolver chain returns detailed `ResolutionReport` with all attempts
- [ ] Configuration option `subjectResolutionOrder` is optional (defaults to payload-only)
- [ ] Evidence generation includes resolution report in evidence record
- [ ] Tests cover all resolver strategies and chain ordering
- [ ] Backlog scan command reports resolver strategy used for each event

## Related Decisions

- **ADR-002**: Vendor adapters provide `fetchPRMetadata()` for linked PR strategy
- **ADR-004**: Backlog scan lifecycle includes resolution report in structured scan output

## Future Extensions

- Machine learning-based subject extraction from commit messages
- Custom regex patterns for organization-specific subject identifiers
- Caching of resolver results per PR to reduce API calls
- Metrics on strategy success rates and latency

