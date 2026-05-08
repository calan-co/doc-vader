---
"$schema": /frontmatter/document
id: adr-004-backlog-scan-lifecycle
title: Define backlog scan lifecycle with structured reporting
type: document
subtype: decision
status: accepted
lifecycle: active
priority: high
tags:
  - adr
  - architecture
  - backlog-automation
  - scan-lifecycle
  - reporting
links:
  reference:
    - "[[../../reference/work-management/overview.md]]"
  implements:
    - "[[../../../backlog/175.extended-rules-and-autofix-feature.md]]"
  depends:
    - "[[adr-002-vendor-adapter-pattern.md]]"
    - "[[adr-003-multi-strategy-subject-resolution.md]]"
---

## Context and Problem Statement

Backlog automation currently embeds business logic in workflow Python scripts (`.github/workflows/backlog-sweep.yml`), making it:

- **Hard to test**: Business logic cannot be tested outside of GitHub Actions
- **Hard to port**: Re-using automation logic in other contexts requires copy-paste
- **Hard to evolve**: Adding new scanning rules requires workflow modifications
- **Hard to audit**: Scan decisions are implicit in Python code, not explicitly reported
- **Hard to debug**: Failures have no structured output; logs are scattered across jobs

## Decision

Implement a **backlog scan lifecycle** that:

1. **Separates concerns**:
   - **Scan mode** (read-only): Generate structured report of conditions, decisions, and errors
   - **Evidence generation mode** (write): Create evidence records based on scan conditions (optional, off by default)

2. **Defines scan state machine**:
   ```
   Event → Parse → Check Conditions → Resolve Subject → Generate Report → [Optionally] Create Evidence
   ```

3. **Reports structured conditions and outcomes**:
   - **Positive conditions** (event-driven facts): `pr_link_found`, `pr_merged`, `workflow_succeeded`, `subject_resolved`, `valid_status`
   - **Negative errors** (resolution failures): `resolve_subject_failed`, `fetch_pr_metadata_failed`, `create_record_failed`
   - **Metadata** (context): strategy used, subjects resolved, evidence reference

4. **Provides structured JSON report** for machine consumption:
   ```json
   {
     "scanId": "uuid",
     "timestamp": "2026-05-07T...",
     "events": [
       {
         "eventType": "workflow_run",
         "eventId": "...",
         "conditions": {...},
         "subjects": ["work-item:175"],
         "evidence": {
           "created": true,
           "recordId": "record-xyz",
           "linkedAt": "2026-05-07T..."
         }
       }
     ]
   }
   ```

5. **Enables evidence generation as opt-in mode**:
   - `backlog scan`: Report only (CI-safe, no side effects)
   - `backlog scan --generate-evidence`: Report + create evidence (workflow opt-in)

6. **Replaces workflow Python logic** with thin wrapper:
   - Workflow calls `doc-vader backlog scan --generate-evidence --output-format json`
   - Artifact stores JSON report for audit

## Scope

### In Scope

- Define `ScanState` and `ScanCondition` types
- Implement `BacklogScanExecutor` (orchestrate event → parse → condition check → resolution → report)
- Create `ScanReporter` to generate structured JSON and human-readable summaries
- Add `backlog scan` CLI command with flags (`--generate-evidence`, `--report-format`)
- Define condition taxonomy (positive facts and error types)
- Update `.github/workflows/backlog-sweep.yml` to use CLI command instead of embedded Python
- Scan report includes metadata: strategy used, resolver chain executed, fallback attempts

### Out of Scope

- Real-time streaming reports (async scanning)
- Dashboard or UI for scan results (stored in artifacts; can be viewed via GitHub UI)
- Scan filtering by repository or event type (all events processed; filtering by report query is acceptable)

## Decision Drivers

1. **Testability**: Core scan logic must be testable without GitHub Actions
2. **Portability**: Scan logic should be reusable in CI/CD systems beyond GitHub Actions
3. **Auditability**: All decisions must be visible in structured report
4. **Transparency**: Scan conditions and errors must guide debugging
5. **Safety**: Evidence generation must be opt-in and separately reportable from scan phase

## Considered Options

### Option 1: Keep embedded Python in workflows

- **Pros**: No packaging effort; works today.
- **Cons**: Unmaintainable; untestable; hard to reuse.

### Option 2: Separate scan logic into CLI command (chosen)

- **Pros**: Testable; portable; versioned with package; clear separation of concerns.
- **Cons**: Requires CLI refactoring; test coverage must be complete.

### Option 3: Embed all logic in new `lib/backlog-automation` module; no CLI

- **Pros**: Can be tested at module level.
- **Cons**: Workflow still must invoke node/ts-node; no clear CLI contract; harder to version.

## Consequences

### Positive

- **Testability**: Scan executor can be tested with mock providers and structured test cases
- **Auditability**: All decisions are visible in JSON report; no implicit behavior
- **Debuggability**: Failure reasons (e.g., "PR not found", "subject extraction failed") are explicit
- **Extensibility**: New scan rules are additions to condition checks; no workflow changes needed
- **Portability**: Scan logic can be invoked from any CI/CD system (GitLab CI, Temporal workflows, etc.)
- **Monitoring**: Structured reports can be parsed for metrics, alerts, dashboards

### Negative/Risks

- **Latency**: Fetch PR metadata strategy adds API calls and latency to scan (mitigated by optional evidence mode)
- **Complexity**: Developers must understand scan state machine and condition taxonomy
- **Breaking changes**: Changes to scan report schema must be versioned
- **Artifact storage**: JSON reports require artifact storage in CI (GitHub Actions handles this)

## Architecture Sketch

```
┌────────────────────────────────────────────────────────────────┐
│ Backlog Scan Lifecycle                                         │
└────────────────────────────────────────────────────────────────┘

Event Input (workflow_run, pull_request webhook)
   ▼
BacklogScanExecutor.execute(events, options)
   │
   ├─ For each event:
   │  │
   │  ├─ Parse Event
   │  │  └─ BacklogAutomationProvider.parsePayload(raw)
   │  │     → ParsedEvent
   │  │
   │  ├─ Extract Identities
   │  │  ├─ provider.extractPRIdentity()
   │  │  └─ provider.extractWorkflowRunIdentity()
   │  │
   │  ├─ Resolve Subject
   │  │  └─ SubjectResolverChain.resolve(event, strategies)
   │  │     → ResolutionReport (subjects + attempt log)
   │  │
   │  ├─ Check Conditions
   │  │  ├─ pr_link_found: PRIdentity !== null
   │  │  ├─ pr_merged: event.pullRequest?.merged === true
   │  │  ├─ workflow_succeeded: event.workflow?.status === 'completed' && conclusion !== 'failure'
   │  │  ├─ subject_resolved: subjects.length > 0
   │  │  ├─ valid_status: workflow status + pr merged both match expectations
   │  │  └─ valid_evidence: record can be created (schema valid, etc.)
   │  │
   │  ├─ [Optional] Create Evidence
   │  │  │ (if --generate-evidence flag set)
   │  │  ├─ For each subject:
   │  │  │  └─ Create or update work-item evidence record
   │  │  │
   │  │  └─ Link evidence to scan event
   │  │
   │  └─ Build Event Report
   │     └─ {conditions, subjects, evidence?, errors?}
   │
   └─ Generate Scan Report
      └─ ScanReporter.generateReport(events, options)
         → {scanId, timestamp, events[], summary}
```

### Core Interfaces

```typescript
interface ScanState {
  eventId: string;
  eventType: 'workflow_run' | 'pull_request' | 'issue';
  parsed: ParsedEvent;
  prIdentity?: PRIdentity;
  workflowIdentity?: WorkflowRunIdentity;
  subjects: string[];
  resolutionReport: ResolutionReport;
  conditions: ConditionEvaluation[];
  errors: ScanError[];
  evidenceCreated?: {
    recordIds: string[];
    linkedAt: string;
  };
}

interface ConditionEvaluation {
  name: string; // 'pr_link_found', 'pr_merged', 'workflow_succeeded', etc.
  value: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface ScanError {
  code: string; // 'resolve_subject_failed', 'fetch_pr_metadata_failed', etc.
  message: string;
  event?: string; // event ID that caused error
  context?: Record<string, unknown>;
}

interface ScanReport {
  scanId: string;
  timestamp: string;
  scanStartedAt: string;
  scanCompletedAt: string;
  duration: number; // milliseconds
  options: {
    generateEvidence: boolean;
    reportFormat: 'json' | 'text';
    subjectResolutionOrder: string[];
  };
  summary: {
    totalEvents: number;
    successfulScans: number;
    failedScans: number;
    evidenceCreated: number;
    errors: number;
  };
  events: ScanState[];
  errors: ScanError[]; // top-level errors (e.g., config load failed)
}

interface BacklogScanExecutor {
  execute(events: Record<string, unknown>[], options: ScanOptions): Promise<ScanReport>;
}

interface ScanOptions {
  generateEvidence?: boolean;
  reportFormat?: 'json' | 'text';
  provider: BacklogAutomationProvider;
  consumerConfig: BacklogConsumerAutomation;
}
```

## Condition Taxonomy

### Positive Conditions (event facts that enable evidence generation)

| Condition | Meaning | When True |
| --- | --- | --- |
| `pr_link_found` | Event is tied to a pull request | PR identity extracted from event |
| `pr_merged` | The linked PR is merged | `event.pullRequest?.merged === true` |
| `workflow_run_found` | Event is a workflow run completion | WorkflowRunIdentity extracted |
| `workflow_succeeded` | The workflow run completed successfully | `status === 'completed'` and `conclusion !== 'failure'` |
| `subject_resolved` | At least one work-item subject found | `subjects.length > 0` |
| `valid_status` | All preconditions for evidence met | All above conditions true |
| `valid_evidence` | Evidence record passes schema validation | Work-item file is valid YAML + content |
| `record_created` | Evidence record written to disk | File created successfully |
| `evidence_linked` | Evidence added to work item | Record added to work-item links |

### Error Taxonomy (resolution/creation failures)

| Error Code | Meaning | Recoverable |
| --- | --- | --- |
| `resolve_subject_failed` | No subject extraction strategy succeeded | No (manual intervention) |
| `fetch_pr_metadata_failed` | PR metadata fetch failed (API error) | Yes (retry with alternative strategy) |
| `parse_event_failed` | Event parsing failed (invalid payload) | No (event corrupted) |
| `create_record_failed` | Evidence record file creation failed | Partial (filesystem issue) |
| `update_work_item_failed` | Updating work-item links failed | Partial (conflict) |
| `invalid_schema` | Evidence record fails schema validation | No (template issue) |

## Migration Strategy

### Phase A: Package scan command + report generation

- Create `BacklogScanExecutor` with basic event parsing and condition checks
- Implement `ScanReporter` with JSON and text output
- Add `doc-vader backlog scan` CLI command
- Tests: verify condition evaluation, report generation, error handling

### Phase B: PR-link resolver + condition taxonomy

- Implement `LinkedPullRequestsResolver` using provider adapters
- Add all conditions to condition taxonomy
- Update scan executor to populate all conditions
- Tests: verify resolver chain, condition evaluation with mock provider

### Phase C: Optional evidence generation mode

- Add `--generate-evidence` flag to scan command
- Implement evidence creation logic (create `record-*` files)
- Link evidence to work items (update `links.evidence` in frontmatter)
- Tests: verify evidence creation, linking, idempotency

### Phase D: Workflow thin-wrapper conversion

- Update `.github/workflows/backlog-sweep.yml` to call `doc-vader backlog scan --generate-evidence`
- Store JSON report as workflow artifact
- Remove embedded Python script
- Update documentation

### Phase E: Strict mode + resolver order configuration

- Add `automation.subjectResolutionOrder` to consumer config schema
- Support `--resolver-order` CLI flag
- Add strict mode (`--strict`) that fails scan if any errors occur
- Documentation: resolver strategy guide, troubleshooting

## Validation Checklist

- [ ] `BacklogScanExecutor` and `ScanReporter` created with JSON and text output
- [ ] `ScanState` interface captures all condition evaluations
- [ ] Condition taxonomy covers all positive conditions and errors
- [ ] `backlog scan` CLI command works and produces valid JSON
- [ ] Evidence generation mode works and creates `record-*` files
- [ ] Workflow `.github/workflows/backlog-sweep.yml` refactored to thin wrapper
- [ ] All scan decisions visible in JSON report
- [ ] Tests cover all phases and error paths
- [ ] Documentation updated with scan lifecycle and condition guide

## Related Decisions

- **ADR-002**: Vendor adapters enable event normalization for scan
- **ADR-003**: Subject resolution report is embedded in scan state

## Workflow Example

**Current behavior** (embedded Python):
```yaml
- name: Scan backlog for PRs to evidence
  run: |
    python scripts/sweep.py --repo templjs/templ.js --generate-evidence
```

**New behavior** (thin wrapper):
```yaml
- name: Scan backlog for PRs to evidence
  run: |
    doc-vader backlog scan --generate-evidence --output-format json > /tmp/scan-report.json

- name: Upload scan report
  uses: actions/upload-artifact@v3
  with:
    name: backlog-scan-report
    path: /tmp/scan-report.json
```

**Report artifact** (JSON):
```json
{
  "scanId": "uuid-2026-05-07-...",
  "timestamp": "2026-05-07T14:30:00Z",
  "summary": {
    "totalEvents": 1,
    "successfulScans": 1,
    "evidenceCreated": 1,
    "errors": 0
  },
  "events": [
    {
      "eventType": "workflow_run",
      "eventId": "25519076107",
      "conditions": {
        "pr_link_found": true,
        "pr_merged": true,
        "workflow_succeeded": true,
        "subject_resolved": true,
        "valid_evidence": true,
        "record_created": true
      },
      "subjects": ["work-item:175"],
      "evidence": {
        "created": true,
        "recordIds": ["record-20260507-143000-175"],
        "linkedAt": "2026-05-07T14:30:15Z"
      }
    }
  ]
}
```

