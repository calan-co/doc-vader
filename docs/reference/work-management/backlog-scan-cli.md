---
id: backlog-scan-cli-reference
title: Backlog Scan CLI Reference
type: document
subtype: reference
lifecycle: active
status: active
priority: high
tags:
  - backlog-automation
  - cli
  - commands
links:
  reference:
    - "[[backlog-automation-configuration.md]]"
    - "[[../architecture/decisions/adr-004-backlog-scan-lifecycle.md]]"
---

# Backlog Scan CLI Reference

The `backlog scan` command analyzes workflow runs and pull requests to detect work-item links and optionally create evidence records.

## Command Syntax

```bash
doc-vader backlog scan [OPTIONS]
```

## Description

Scans backlog automation triggers (workflow completion events, PR updates) to:

- Parse event metadata using vendor adapters
- Resolve work-item subjects using configurable strategy chain
- Evaluate conditions (PR merged, workflow succeeded, subject resolved)
- Optionally create evidence records linking workflow to work items
- Generate structured JSON or human-readable reports

## Options

### `--generate-evidence`

Create evidence records for resolved work items.

**Type**: Boolean flag  
**Default**: `false`  
**Example**:
```bash
doc-vader backlog scan --generate-evidence
```

**Behavior**:
- Evidence records are created with filename `record-{timestamp}-{work-item-id}.md`
- Records are linked to work items in frontmatter
- Evidence generation is idempotent (re-running with same event creates no duplicates)

### `--report-format <format>`

Output format for scan report.

**Type**: `json` | `text`  
**Default**: `json`  
**Example**:
```bash
# JSON output (machine-readable)
doc-vader backlog scan --report-format json

# Text output (human-readable)
doc-vader backlog scan --report-format text
```

**Output Locations**:
- `json`: Written to stdout as valid JSON (pipe to file: `> report.json`)
- `text`: Written to stdout as formatted text with colors

### `--resolver-order <resolvers>`

Configure subject resolution strategy order.

**Type**: Comma-separated list of resolver names  
**Default**: `payload_subject_tokens,linked_pull_requests`  
**Allowed values**:
- `payload_subject_tokens`
- `linked_pull_requests`
- `audit_pr_subject_index`
- `provider_associated_pull_requests`

**Example**:
```bash
# Fast resolver (payload only)
doc-vader backlog scan --resolver-order payload_subject_tokens

# Comprehensive resolvers (try multiple strategies)
doc-vader backlog scan --resolver-order payload_subject_tokens,linked_pull_requests,audit_pr_subject_index

# Single fallback
doc-vader backlog scan --resolver-order linked_pull_requests
```

**Precedence**: CLI flag overrides configuration file setting

### `--strict`

Exit with error code 1 if any scan conditions fail or errors occur.

**Type**: Boolean flag  
**Default**: `false`  
**Example**:
```bash
doc-vader backlog scan --strict
```

**Behavior**:
- Scan completes normally (processes all events)
- Exit code 1 if any events have errors or unmet conditions
- Exit code 0 if all events scan successfully with all conditions met
- Report still generated; failures logged in report

**Use case**: Production workflows that should fail fast on automation errors

### `--output-file <path>`

Write report to file instead of stdout.

**Type**: File path  
**Default**: stdout  
**Example**:
```bash
doc-vader backlog scan --report-format json --output-file /tmp/scan-report.json
```

### `--debug`

Enable verbose logging for troubleshooting.

**Type**: Boolean flag  
**Default**: `false`  
**Example**:
```bash
doc-vader backlog scan --debug
```

**Output**: Detailed logs for:
- Event parsing steps
- Resolver strategy attempts
- API calls (if using linked_pull_requests)
- Evidence creation steps

## Examples

### Basic Scan (Report Only)

```bash
doc-vader backlog scan --report-format json
```

Output: JSON report showing conditions, subjects, errors for all events

### Generate Evidence

```bash
doc-vader backlog scan --generate-evidence --report-format json > scan-report.json
```

Output: JSON report + evidence records created and linked to work items

### Fast Scan (Payload Only)

```bash
doc-vader backlog scan --resolver-order payload_subject_tokens --report-format text
```

Output: Text report using only payload token extraction (no API calls)

### Comprehensive Scan with API Fallback

```bash
doc-vader backlog scan \
  --resolver-order payload_subject_tokens,linked_pull_requests \
  --generate-evidence \
  --report-format json > comprehensive-report.json
```

Output: Comprehensive scan with PR metadata fallback; evidence records created

### Strict Mode (CI Integration)

```bash
doc-vader backlog scan --strict --generate-evidence
echo "Scan exit code: $?"
```

Exit code 0 if all conditions met; 1 if any errors or unmet conditions

### Debugging

```bash
doc-vader backlog scan --debug --report-format json | tee scan-debug.json
```

Output: Verbose debug logs on stderr; JSON report on stdout

## Environment Variables

### `DOC_VADER_BACKLOG_CONFIG`

Override path to `.doc-vader/backlog-consumer.json`

```bash
export DOC_VADER_BACKLOG_CONFIG=/path/to/custom-config.json
doc-vader backlog scan
```

### `DOC_VADER_BACKLOG_REPO`

Override repository identifier (for testing)

```bash
export DOC_VADER_BACKLOG_REPO=my-org/my-repo
doc-vader backlog scan
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Scan completed successfully; all conditions met (or `--strict` not set) |
| 1 | Scan completed with errors or unmet conditions (only if `--strict` set) |
| 2 | Invalid arguments or configuration |
| 3 | Configuration file not found or invalid |

## Report Schema

### JSON Report Structure

```json
{
  "scanId": "uuid-string",
  "timestamp": "2026-05-07T14:30:00Z",
  "scanStartedAt": "2026-05-07T14:30:00Z",
  "scanCompletedAt": "2026-05-07T14:30:15Z",
  "duration": 15000,
  "options": {
    "generateEvidence": true,
    "reportFormat": "json",
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests"
    ]
  },
  "summary": {
    "totalEvents": 3,
    "successfulScans": 2,
    "failedScans": 1,
    "evidenceCreated": 2,
    "errors": 1
  },
  "events": [
    {
      "eventType": "workflow_run",
      "eventId": "12345678",
      "conditions": {
        "pr_link_found": true,
        "pr_merged": true,
        "workflow_succeeded": true,
        "subject_resolved": true,
        "valid_status": true,
        "valid_evidence": true,
        "record_created": true,
        "evidence_linked": true
      },
      "subjects": ["work-item:175"],
      "resolutionStrategy": "payload_subject_tokens",
      "resolutionReport": {
        "finalSubjects": ["work-item:175"],
        "attempts": [
          {
            "strategy": "payload_subject_tokens",
            "found": 1,
            "duration": 2,
            "error": null
          }
        ],
        "resolvedAt": "2026-05-07T14:30:01Z",
        "totalDuration": 2
      },
      "evidence": {
        "created": true,
        "recordIds": ["record-20260507-143000-175"],
        "linkedAt": "2026-05-07T14:30:05Z"
      }
    }
  ],
  "errors": []
}
```

### Condition Reference

**Positive Conditions** (event facts):
- `pr_link_found`: Event linked to a pull request
- `pr_merged`: The PR is merged
- `workflow_run_found`: Event is a workflow completion
- `workflow_succeeded`: Workflow completed successfully
- `subject_resolved`: At least one work-item subject found
- `valid_status`: All preconditions for evidence met
- `valid_evidence`: Record passes schema validation
- `record_created`: Evidence record written to disk
- `evidence_linked`: Evidence added to work-item

**Errors** (failure codes):
- `resolve_subject_failed`: No resolution strategy succeeded
- `fetch_pr_metadata_failed`: PR metadata fetch failed
- `parse_event_failed`: Event parsing failed
- `create_record_failed`: Evidence record creation failed
- `update_work_item_failed`: Linking evidence to work item failed
- `invalid_schema`: Evidence record fails validation

## Workflow Integration

### GitHub Actions Example

```yaml
- name: Scan backlog
  run: |
    doc-vader backlog scan \
      --generate-evidence \
      --report-format json \
      --output-file /tmp/scan-report.json

- name: Upload report
  uses: actions/upload-artifact@v3
  with:
    name: backlog-scan-report
    path: /tmp/scan-report.json
```

### Local Development

```bash
# Check current automation state
doc-vader backlog scan --report-format text

# Backfill evidence for historical workflow runs
doc-vader backlog scan \
  --generate-evidence \
  --resolver-order payload_subject_tokens,linked_pull_requests

# Debug resolution failures
doc-vader backlog scan --debug --report-format json
```

## Troubleshooting

### Command Not Found

```bash
# Ensure doc-vader is installed
pnpm install

# Run with package context
pnpm exec doc-vader backlog scan
```

### Invalid Configuration

```bash
# Check configuration file
cat .doc-vader/backlog-consumer.json

# Override configuration path
DOC_VADER_BACKLOG_CONFIG=/path/to/config.json doc-vader backlog scan
```

### Subject Resolution Failing

```bash
# Check with debug output
doc-vader backlog scan --debug --report-format json

# Try different resolver order
doc-vader backlog scan --resolver-order payload_subject_tokens

# Check resolver order in config
cat .doc-vader/backlog-consumer.json | jq '.automation.subjectResolutionOrder'
```

### Report Not Generated

```bash
# Ensure output path is writable
touch /tmp/test-write.json && rm /tmp/test-write.json

# Try writing to different location
doc-vader backlog scan --output-file ./scan-report.json

# Check stdout if no file specified
doc-vader backlog scan --report-format json | head -20
```

## See Also

- [Backlog Automation Configuration Guide](../guide/backlog-automation-configuration.md)
- [Resolver Strategy Reference](./resolver-strategy-guide.md)
- [Evidence Records](./backlog-evidence-records.md)
- [Troubleshooting Guide](./backlog-automation-troubleshooting.md)

