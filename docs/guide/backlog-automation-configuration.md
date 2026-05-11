---
id: backloga-3593
title: Backlog Automation Configuration Guide
type: document
subtype: guide
lifecycle: active
status: ready
tags:
  - backlog-automation
  - configuration
  - consumer-config
links:
  reference:
    - '[[../reference/work-management/backlog-scan-cli.md]]'
    - '[[../architecture/decisions/adr-003-multi-strategy-subject-resolution.md]]'
---

# Backlog Automation Configuration Guide

This guide explains how to configure backlog automation for your repository using the `.doc-vader/backlog-consumer.json` configuration file.

## Overview

Backlog automation in doc-vader enables:

- **Automated evidence generation**: Create audit trail records when workflow runs complete
- **Subject resolution**: Extract work-item identifiers from PR/workflow metadata using multiple strategies
- **Scan reporting**: Generate structured JSON reports of scan decisions for monitoring and debugging

## Configuration File Location

Place your configuration in the root of your repository:

```text
.doc-vader/backlog-consumer.json
```

## Basic Configuration

### Minimal Configuration

```json
{
  "$schema": "schemas/backlog-consumer.schema.json",
  "metadata": {
    "consumer": "my-org/my-repo",
    "version": "1.0"
  },
  "automation": {
    "autoEvidenceFromWorkflowRuns": true
  }
}
```

### Full Configuration

```json
{
  "$schema": "schemas/backlog-consumer.schema.json",
  "metadata": {
    "consumer": "my-org/my-repo",
    "version": "1.0"
  },
  "automation": {
    "autoEvidenceFromWorkflowRuns": true,
    "autoCloseOnMerge": false,
    "generateEvidenceDuringScan": false,
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests"
    ]
  }
}
```

## Configuration Options

### `autoEvidenceFromWorkflowRuns`

**Type**: `boolean`  
**Default**: `true`  
**Description**: Enable automated evidence record creation when workflow runs complete

When enabled, the automation system will:
- Listen for workflow completion events
- Extract work-item subjects from PR/workflow metadata
- Create evidence records linking the workflow to the work items
- Audit trail shows what automation did and when

**Example**:
```json
{
  "automation": {
    "autoEvidenceFromWorkflowRuns": true
  }
}
```

### `autoCloseOnMerge`

**Type**: `boolean`  
**Default**: `false`  
**Description**: Automatically close work items when their linked PR is merged

When enabled, the automation system will:
- Detect merged PRs linked to work items
- Close the work item (status: `closed`)
- Create an audit record showing the closure reason

⚠️ **Warning**: This is a destructive operation. Use with caution on production backlog.

**Example**:
```json
{
  "automation": {
    "autoCloseOnMerge": false
  }
}
```

### `generateEvidenceDuringScan`

**Type**: `boolean`  
**Default**: `false`  
**Description**: Generate evidence records during backlog scan (in addition to automatic workflow-based generation)

When enabled, `doc-vader backlog scan` will:
- Parse completed workflow runs
- Resolve work-item subjects
- Create evidence records for each match
- Link evidence to work items

**Use case**: Backfill evidence for workflow runs that occurred before automation was enabled

**Example**:
```json
{
  "automation": {
    "generateEvidenceDuringScan": true
  }
}
```

### `subjectResolutionOrder`

**Type**: `string[]`  
**Default**: `["payload_subject_tokens", "linked_pull_requests"]`  
**Allowed values**:
- `payload_subject_tokens`: Extract work-item identifiers from PR/workflow payload (fastest, least comprehensive)
- `linked_pull_requests`: Fetch PR metadata via API and search for identifiers (slower, more comprehensive)
- `audit_pr_subject_index`: Query audit index of historical PR subjects (requires pre-populated index)
- `provider_associated_pull_requests`: Use provider's PR association endpoint (vendor-specific)

**Description**: Configure the order in which subject resolution strategies are attempted

The resolver chain tries strategies in order and stops at the first successful match. This option allows you to control the tradeoff between speed and comprehensiveness.

**Examples**:

Fast scans (payload only):
```json
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}
```

Comprehensive scans (all strategies):
```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests",
      "audit_pr_subject_index"
    ]
  }
}
```

## Resolver Strategy Reference

| Strategy | Speed | Coverage | Requirements | Best For |
| --- | --- | --- | --- | --- |
| `payload_subject_tokens` | ⚡ Fast | Basic | None | Time-sensitive workflows; subjects always in payload |
| `linked_pull_requests` | ⚡⚡ Medium | High | GitHub API quota | Comprehensive scans; subjects may be in PR metadata |
| `audit_pr_subject_index` | ⚡⚡ Medium | Lookup | Audit index populated | Historical subject lookups |
| `provider_associated_pull_requests` | ⚡⚡ Medium | High | Vendor API | Vendor-specific PR association |

### Strategy Details

#### `payload_subject_tokens` (Payload Token Extraction)

**How it works**: Searches for `work-item:...` tokens in:
- PR body (description)
- PR title
- Workflow run display title
- Workflow run name

**Performance**: ~1ms per event (no API calls)

**Coverage**: Requires work-item identifiers to be explicitly mentioned in PR or workflow metadata

**Example**: PR body contains "Closes work-item:175" → subject resolved

#### `linked_pull_requests` (PR Metadata Fetching)

**How it works**: 
1. Extracts PR identity from event
2. Fetches PR metadata via GitHub API
3. Searches PR body for `work-item:...` tokens
4. Returns found subjects or empty array

**Performance**: ~200-500ms per PR fetch (includes API call)

**Coverage**: Comprehensive; finds subjects in any field of PR metadata

**Example**: PR #123 body contains a template with "work-item:175" → LinkedPullRequestsResolver finds it

**Requirements**: 
- GitHub API quota available
- Network connectivity
- PR still accessible (not deleted)

#### `audit_pr_subject_index` (Audit Index Lookup)

**How it works**: Queries a pre-built index of historical PR→subject associations

**Performance**: ~10ms per lookup (local lookup, no network)

**Coverage**: Only subjects that exist in index (requires backfill)

**Requirements**: 
- Index built and up-to-date
- Index available at query time

**Use case**: Subjects that were historically associated but may no longer be in PR body

#### `provider_associated_pull_requests` (Vendor API Association)

**How it works**: Delegates to provider's PR association method (vendor-specific)

**Performance**: Vendor-dependent (~200-1000ms)

**Coverage**: Vendor-dependent

**Requirements**: Vendor API support for PR association queries

## Workflow Configuration

To enable backlog automation in your workflow, add the automation triggers:

### GitHub Actions Example

```yaml
name: Backlog Automation

on:
  workflow_run:
    types: [completed]
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run backlog scan
        run: doc-vader backlog scan --generate-evidence --report-format json --output-file /tmp/scan-report.json
      
      - name: Upload scan report
        uses: actions/upload-artifact@v4
        with:
          name: backlog-scan-report-${{ github.run_id }}
          path: /tmp/scan-report.json
```

## CLI Configuration Override

CLI flags override configuration file settings. Use this for temporary adjustments:

```bash
# Override resolver order for this run
doc-vader backlog scan --resolver-order payload_subject_tokens --generate-evidence

# Run in strict mode (fail if any errors)
doc-vader backlog scan --strict

# Combine options
doc-vader backlog scan \
  --resolver-order payload_subject_tokens,linked_pull_requests \
  --generate-evidence \
  --strict \
  --report-format json --output-file report.json
```

## Configuration Precedence

Settings are applied in this order (later values override earlier):

1. Built-in defaults
2. Configuration file (`.doc-vader/backlog-consumer.json`)
3. Environment variables (if supported)
4. CLI flags (highest priority)

**Example**: 

Config file sets resolver order to `["payload_subject_tokens", "linked_pull_requests"]`, but CLI flag overrides:

```bash
# Effective resolver order: just payload tokens
doc-vader backlog scan --resolver-order payload_subject_tokens
```

## Troubleshooting

### Evidence Not Being Created

**Problem**: Workflow runs complete but no evidence records are created

**Diagnosis**:
1. Check `autoEvidenceFromWorkflowRuns` is enabled
2. Check automation trigger is in workflow
3. Review scan report for error messages

**Solution**:
```bash
# Check current scan without creating evidence
doc-vader backlog scan --report-format json

# Look for errors in report (resolve_subject_failed, etc.)
# Adjust resolver order if needed
```

### Subject Resolution Failing

**Problem**: Scan report shows `resolve_subject_failed` errors

**Diagnosis**:
1. Check PR/workflow body contains work-item identifiers
2. Check resolver order includes appropriate strategies
3. Check API quotas (if using linked_pull_requests)

**Solution**:
```bash
# Try adding linked_pull_requests strategy
doc-vader backlog scan \
  --resolver-order payload_subject_tokens,linked_pull_requests \
  --report-format json
```

### Performance Issues

**Problem**: Scans are slow (taking >30 seconds)

**Diagnosis**: Likely using linked_pull_requests for many events

**Solution**:
```bash
# Use payload-only resolver for fast scans
# Configure automation to use fast resolver by default
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}

# Run comprehensive scans manually with CLI override
doc-vader backlog scan \
  --resolver-order payload_subject_tokens,linked_pull_requests
```

## Advanced Configuration

### Time-Sensitive Workflows

For workflows that prioritize speed (e.g., CI/CD gates), use payload-only resolution:

```json
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"],
    "generateEvidenceDuringScan": false
  }
}
```

### Comprehensive Backfill

For backfilling evidence from historical workflow runs:

```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests",
      "audit_pr_subject_index"
    ],
    "generateEvidenceDuringScan": true
  }
}
```

### Production Safety

For production backlog where errors should stop processing:

Use the `--strict` flag:

```bash
doc-vader backlog scan --strict --generate-evidence
# Exits with code 1 if any errors; code 0 if all conditions met
```

## See Also

- [Backlog Scan CLI Reference](../reference/work-management/backlog-scan-cli.md)
- [Resolver Strategy Guide](../reference/work-management/resolver-strategy-guide.md)
- [ADR-003: Multi-Strategy Subject Resolution](../architecture/decisions/adr-003-multi-strategy-subject-resolution.md)
- [ADR-004: Backlog Scan Lifecycle](../architecture/decisions/adr-004-backlog-scan-lifecycle.md)

