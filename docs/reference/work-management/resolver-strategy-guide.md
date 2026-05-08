---
id: resolver-strategy-guide
title: Resolver Strategy Reference
type: document
subtype: reference
lifecycle: active
status: active
priority: high
tags:
  - backlog-automation
  - resolver
  - subject-resolution
links:
  reference:
    - "[[backlog-scan-cli.md]]"
    - "[[../../guide/backlog-automation-configuration.md]]"
    - "[[../../architecture/decisions/adr-003-multi-strategy-subject-resolution.md]]"
---

# Resolver Strategy Reference

This guide explains each subject resolution strategy, when to use it, and how to troubleshoot resolution failures.

## Overview

Subject resolution is the process of extracting work-item identifiers from workflow events and pull request metadata. A **resolver strategy** is a specific approach to finding these identifiers.

The resolver chain tries multiple strategies in a configurable order and stops at the first successful match. This allows you to balance comprehensiveness (more API calls, slower) with speed (fewer API calls, faster).

## Strategy Comparison Matrix

| Strategy | Speed | Coverage | Requirements | Latency | Best For |
| --- | --- | --- | --- | --- | --- |
| `payload_subject_tokens` | ⚡⚡⚡ Fast | Basic | None | ~1ms | Time-sensitive; subjects in payload |
| `linked_pull_requests` | ⚡⚡ Medium | High | GitHub API | ~200-500ms | Comprehensive; subjects in PR metadata |
| `audit_pr_subject_index` | ⚡⚡ Medium | Lookup | Audit index | ~10ms | Historical lookups; index available |
| `provider_associated_pull_requests` | ⚡⚡ Medium | High | Vendor API | ~200-1000ms | Vendor-specific PR association |

## Strategy Details

### `payload_subject_tokens`

**Description**: Extracts work-item identifiers from event payload without additional API calls

**How it works**:
1. Parse event payload (GitHub webhook)
2. Search for `work-item:...` tokens in:
   - Pull request body (description)
   - Pull request title
   - Workflow run display title
   - Workflow run name
3. Return all found tokens or empty array if none found

**Performance**:
- Speed: ~1ms per event
- No API calls
- No network overhead
- Fastest strategy

**Coverage**:
- Finds subjects explicitly mentioned in PR or workflow metadata
- Basic but reliable for well-documented workflows
- Requires work-item reference to be in expected location

**Reliability**: Very high (no external dependencies)

**Example**:

```
Event: Pull Request #123 with title "Fix login bug (work-item:175)"
Output: ["work-item:175"]

Event: Workflow "Deploy to staging" (work-item:200)
Output: ["work-item:200"]

Event: PR with no work-item tokens
Output: []
```

**When to use**:
- Time-sensitive workflows (CI gates, immediate feedback)
- High-volume automation (1000+ events/day)
- When subjects are always explicitly mentioned
- Limited API quota

**Configuration**:
```json
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}
```

### `linked_pull_requests`

**Description**: Fetches full PR metadata via API and searches for work-item identifiers

**How it works**:
1. Extract PR identity from event (PR number, repo)
2. Call GitHub API: `GET /repos/{owner}/{repo}/pulls/{pr_number}`
3. Fetch full PR metadata (body, title, all fields)
4. Search PR body for `work-item:...` tokens
5. Return all found tokens or empty array if none found

**Performance**:
- Speed: ~200-500ms per PR (includes API call)
- 1 API call per event
- Network latency included
- Scales with number of events

**Coverage**:
- Finds subjects in any field of PR metadata
- Most comprehensive for PR-based detection
- Captures subjects added to PR body after event creation
- Handles edited PRs (fetches latest version)

**Reliability**: High (depends on GitHub API availability)

**Requirements**:
- GitHub API quota (typically 5000 requests/hour per token)
- Network connectivity to GitHub
- PR must still be accessible (not deleted)

**Example**:

```
Event: Workflow run for PR #123 (no subjects in payload)
API Call: GET /repos/myorg/myrepo/pulls/123
PR Body: "Closes work-item:175 and work-item:176"
Output: ["work-item:175", "work-item:176"]
```

**When to use**:
- Comprehensive automation (backfill scenarios)
- When subjects may be in PR description (not title)
- Acceptable latency (200-500ms per event)
- Sufficient API quota
- Need to catch subjects added after workflow trigger

**Configuration**:
```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests"
    ]
  }
}
```

**Troubleshooting**:

**Problem**: "fetch_pr_metadata_failed"

```bash
# Check GitHub API status
curl -i https://api.github.com/user

# Check authentication
echo $GITHUB_TOKEN | wc -c  # Should be >40 characters

# Test PR access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/owner/repo/pulls/123
```

**Problem**: API rate limit exceeded

```bash
# Check current rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.rate_limit'

# Solution: Use fewer resolvers or schedule scans during off-peak
```

### `audit_pr_subject_index`

**Description**: Queries a pre-built index of historical PR-to-subject associations

**How it works**:
1. Extract PR identity from event
2. Query audit index for historical subjects associated with this PR
3. Return matching subjects or empty array if not in index

**Performance**:
- Speed: ~10ms per lookup
- Local lookup (no network)
- Scales with index size, not event volume
- Medium speed (slower than payload, faster than API)

**Coverage**:
- Only subjects in pre-built index
- Captures historical associations
- Useful for subjects that may have been removed from PR body
- Limited to what was previously captured

**Reliability**: Very high (local lookup, no external dependencies)

**Requirements**:
- Audit index must be built and up-to-date
- Index must be available at query time
- Subjects must have been added to index previously

**Current Status**: ⏳ Not yet implemented (planned for Phase B+)

**Example**:

```
Event: PR #123 (body no longer mentions work-item)
Index Query: SELECT subjects WHERE pr_id = 123
Index Result: ["work-item:175", "work-item:176"]
Output: ["work-item:175", "work-item:176"]
```

**When to use**:
- Backfill scenarios
- Subjects that may have been removed from PR after linking
- When you need fast lookups without API calls
- Auditing historical relationships

**Configuration** (future):
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

### `provider_associated_pull_requests`

**Description**: Uses vendor-specific API to find associated pull requests and extract subjects

**How it works**:
1. Call vendor-specific endpoint for associated PRs
2. For each PR, search for `work-item:...` tokens
3. Return all found tokens or empty array

**Performance**:
- Speed: Vendor-dependent (~200-1000ms)
- Requires vendor API call(s)
- Latency depends on vendor implementation

**Coverage**: Vendor-dependent

**Reliability**: Depends on vendor API

**Requirements**:
- Vendor API support for PR association
- Vendor-specific authentication
- Vendor quota sufficient

**Current Status**: ⏳ Planned for multi-vendor support (Phase B+)

**When to use**:
- Multi-forge environments
- When vendor API provides better associations
- Vendor-specific workflow patterns

**Configuration** (future):
```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests",
      "provider_associated_pull_requests"
    ]
  }
}
```

## Resolver Chain Behavior

The resolver chain tries strategies in order and **stops at the first successful match**.

### Chain Example

Configuration:
```json
{
  "subjectResolutionOrder": [
    "payload_subject_tokens",
    "linked_pull_requests",
    "audit_pr_subject_index"
  ]
}
```

Execution:
```
Event: Workflow for PR #123
├─ Try payload_subject_tokens
│  └─ Found: ["work-item:175"]
│  └─ ✅ STOP (first strategy succeeded)
│
Event: Workflow for PR #456 (no tokens in payload)
├─ Try payload_subject_tokens
│  └─ Found: []
│  └─ ❌ Continue to next
├─ Try linked_pull_requests
│  └─ Fetch PR #456
│  └─ Found: ["work-item:200"]
│  └─ ✅ STOP (second strategy succeeded)
│
Event: Workflow for PR #789 (no subjects found anywhere)
├─ Try payload_subject_tokens
│  └─ Found: []
│  └─ ❌ Continue
├─ Try linked_pull_requests
│  └─ Found: []
│  └─ ❌ Continue
├─ Try audit_pr_subject_index
│  └─ Found: []
│  └─ ❌ All strategies exhausted
└─ ❌ resolve_subject_failed (no subjects found)
```

## Optimization Strategies

### For Speed

```json
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}
```

- ~1ms per event
- No API calls
- Requires explicit work-item tokens in payload

### For Comprehensiveness

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

- ~1-500ms per event (depends on hits at each level)
- Multiple API calls possible
- Captures most subjects

### For Balanced Trade-off

```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "linked_pull_requests"
    ]
  }
}
```

- ~1-500ms per event
- Fast for explicit tokens; API fallback for others
- Good balance of speed and coverage

### For API-Limited Environments

```json
{
  "automation": {
    "subjectResolutionOrder": [
      "payload_subject_tokens",
      "audit_pr_subject_index"
    ]
  }
}
```

- No GitHub API calls
- Fast lookups
- Limited to indexed subjects

## Troubleshooting Resolution Failures

### Problem: `resolve_subject_failed`

All resolver strategies returned no subjects.

**Diagnosis**:
```bash
# Check with debug output
doc-vader backlog scan --debug --report-format json | grep -A 5 "resolve_subject_failed"
```

**Solutions**:

1. **Check payload for work-item tokens**:
   ```bash
   # PR body should contain "work-item:123"
   gh pr view 123 --json body
   ```

2. **Add PR metadata fallback**:
   ```json
   {
     "automation": {
       "subjectResolutionOrder": [
         "payload_subject_tokens",
         "linked_pull_requests"
       ]
     }
   }
   ```

3. **Check resolver chain**:
   ```bash
   # Try different resolver order
   doc-vader backlog scan \
     --resolver-order payload_subject_tokens,linked_pull_requests \
     --debug
   ```

### Problem: `fetch_pr_metadata_failed`

The `linked_pull_requests` resolver failed to fetch PR metadata.

**Diagnosis**:
```bash
# Check GitHub API
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/owner/repo/pulls/123

# Check network connectivity
ping github.com
```

**Solutions**:

1. **Check authentication**:
   ```bash
   echo $GITHUB_TOKEN | wc -c  # Should be >40 characters
   ```

2. **Check rate limit**:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/rate_limit | jq '.rate_limit'
   ```

3. **Use payload-only fallback**:
   ```bash
   doc-vader backlog scan --resolver-order payload_subject_tokens
   ```

### Problem: Performance Degradation

Scans are running slowly (>10 seconds per event).

**Diagnosis**:
```bash
# Check resolver chain (likely API calls)
doc-vader backlog scan --debug | grep -E "strategy|duration"
```

**Solutions**:

1. **Use faster resolver chain**:
   ```json
   {
     "automation": {
       "subjectResolutionOrder": ["payload_subject_tokens"]
     }
   }
   ```

2. **Reduce API calls**:
   ```bash
   doc-vader backlog scan --resolver-order payload_subject_tokens
   ```

3. **Batch scans during off-peak**:
   ```yaml
   schedule:
     - cron: '0 2 * * *'  # 2 AM UTC
   ```

## See Also

- [Backlog Automation Configuration](../../guide/backlog-automation-configuration.md)
- [Backlog Scan CLI Reference](./backlog-scan-cli.md)
- [ADR-003: Multi-Strategy Subject Resolution](../../architecture/decisions/adr-003-multi-strategy-subject-resolution.md)

