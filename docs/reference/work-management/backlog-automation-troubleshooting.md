---
id: backloga-63
title: Backlog Automation Troubleshooting Guide
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - backlog-automation
  - troubleshooting
  - debugging
links:
  reference:
    - '[[backlog-scan-cli.md]]'
    - '[[resolver-strategy-guide.md]]'
    - '[[../../guide/backlog-automation-configuration.md]]'
---

# Backlog Automation Troubleshooting Guide

This guide helps diagnose and resolve common issues with backlog automation.

## Common Issues

### Evidence Not Being Generated

**Symptom**: Workflow runs complete but no evidence records are created in the backlog

**Checklist**:
- [ ] Is `autoEvidenceFromWorkflowRuns` enabled in config?
- [ ] Is the automation workflow trigger in your `.github/workflows` file?
- [ ] Are you running in the correct repository?
- [ ] Check the scan report for errors

**Diagnosis**:

```bash
# Check configuration
cat .doc-vader/backlog-consumer.json | jq '.automation'

# Run manual scan to see what's happening
doc-vader backlog scan --report-format json | jq '.summary'
```

**Solutions**:

1. **Enable evidence generation in config**:
   ```json
   {
     "automation": {
       "autoEvidenceFromWorkflowRuns": true,
       "generateEvidenceDuringScan": true
     }
   }
   ```

2. **Check workflow triggers**:
   ```yaml
   on:
     workflow_run:
       types: [completed]
     pull_request:
       types: [opened, synchronize, closed]
   ```

3. **Review scan report**:
   ```bash
   doc-vader backlog scan --report-format json > /tmp/report.json
   cat /tmp/report.json | jq '.summary'
   cat /tmp/report.json | jq '.errors'
   ```

### Subject Resolution Failing

**Symptom**: Scan report shows `resolve_subject_failed` errors; no work-item identifiers found

**Root causes**:
- No work-item tokens in PR or workflow metadata
- Resolver strategy not matching where tokens are located
- PR metadata not accessible (deleted/archived)

**Diagnosis**:

```bash
# Check what the resolver chain found
doc-vader backlog scan --debug --report-format json | \
  jq '.events[] | select(.error) | {eventId, error}'

# Check specific PR for work-item tokens
gh pr view <PR_NUMBER> --json title,body | jq '.body'
```

**Solutions**:

1. **Add work-item token to PR body**:
   ```
   This PR fixes the login bug.
   
   Closes work-item:175
   ```

2. **Enable PR metadata fetching**:
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
   # See which resolver succeeded
   doc-vader backlog scan --debug | grep "resolution_strategy"
   ```

### Slow Scan Performance

**Symptom**: Backlog scans are taking >30 seconds to complete

**Root cause**: Likely using PR metadata fetching strategy for many events

**Diagnosis**:

```bash
# Check how long each event takes
doc-vader backlog scan --debug --report-format json | \
  jq '.events[] | {eventId, duration: .resolutionReport.totalDuration}'
```

**Solutions**:

1. **Use fast resolver for CI workflows**:
   ```bash
   doc-vader backlog scan --resolver-order payload_subject_tokens
   ```

2. **Tune resolver order in config**:
   ```json
   {
     "automation": {
       "subjectResolutionOrder": ["payload_subject_tokens"]
     }
   }
   ```

3. **Consider scheduling comprehensive scans separately**:
   ```yaml
   # Fast scan in CI
   - run: doc-vader backlog scan --resolver-order payload_subject_tokens
   
   # Comprehensive scan nightly
   - run: doc-vader backlog scan --generate-evidence --resolver-order payload_subject_tokens,linked_pull_requests
     if: github.event.schedule == 'nightly'
   ```

### GitHub API Rate Limiting

**Symptom**: `fetch_pr_metadata_failed` errors; rate limit warnings

**Root cause**: PR metadata fetching exhausts GitHub API quota

**Diagnosis**:

```bash
# Check current rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.rate_limit'

# Expected output:
# {
#   "limit": 5000,
#   "remaining": 4500,
#   "reset": 1620000000
# }
```

**Solutions**:

1. **Reduce resolver chain**:
   ```json
   {
     "automation": {
       "subjectResolutionOrder": ["payload_subject_tokens"]
     }
   }
   ```

2. **Authenticate with higher quota token**:
   ```bash
   # Use GitHub App token instead of personal token
   # GitHub Apps have 15,000 requests/hour vs 5,000 for personal tokens
   ```

3. **Schedule scans during off-peak**:
   ```yaml
   schedule:
     - cron: '0 2 * * *'  # 2 AM UTC
   ```

4. **Use audit index for historical lookups**:
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

### Duplicate Evidence Records

**Symptom**: Multiple `record-*` files created for the same workflow event

**Root cause**: Scan was run multiple times without idempotency detection

**Diagnosis**:

```bash
# Check for duplicate records
ls -la backlog/record-* | wc -l

# Find records for same event
grep -l "eventId: 25519076107" backlog/record-*.md
```

**Solutions**:

1. **Verify idempotency** (should be automatic):
   ```bash
   # Running same scan twice should create no new records
   doc-vader backlog scan --generate-evidence
   doc-vader backlog scan --generate-evidence
   ```

2. **Manual cleanup** (if needed):
   ```bash
   # Delete duplicate records (keep oldest)
   rm backlog/record-*.md  # Review first!
   
   # Re-run scan (should create correct record)
   doc-vader backlog scan --generate-evidence
   ```

3. **Check record filename format**:
   ```bash
   # Records should follow: record-{timestamp}-{work-item-id}.md
   ls backlog/record-*.md | head -5
   ```

### Configuration Issues

**Symptom**: Unexpected behavior; config seems ignored

**Diagnosis**:

```bash
# Check which config is being used
doc-vader backlog scan --debug 2>&1 | grep "config"

# Validate config schema
cat .doc-vader/backlog-consumer.json | jq .

# Check for syntax errors
pnpm run docs:lint  # If available
```

**Solutions**:

1. **Verify config location**:
   ```bash
   # Should be at repository root
   ls -la .doc-vader/backlog-consumer.json
   ```

2. **Check config schema**:
   ```bash
   # Example valid config
   cat > .doc-vader/backlog-consumer.json << 'EOF'
   {
     "$schema": "...",
     "metadata": {
       "consumer": "org/repo",
       "version": "1.0"
     },
     "automation": {
       "autoEvidenceFromWorkflowRuns": true
     }
   }
   EOF
   ```

3. **CLI flags override config**:
   ```bash
   # This CLI flag overrides config setting
   doc-vader backlog scan --resolver-order payload_subject_tokens
   ```

## Debugging Commands

### View Latest Scan Report

```bash
# Download artifact from workflow run
gh run view <RUN_ID> --repo org/repo -a

# Or run manual scan
doc-vader backlog scan --report-format json | less
```

### Check Event Details

```bash
# View specific workflow run
gh run view <RUN_ID> --repo org/repo --log

# View specific PR
gh pr view <PR_NUMBER> --repo org/repo --json title,body,merged,state
```

### Test Resolver Chain

```bash
# Try different resolvers
doc-vader backlog scan --resolver-order payload_subject_tokens
doc-vader backlog scan --resolver-order linked_pull_requests

# See detailed resolution attempts
doc-vader backlog scan --debug --report-format json | \
  jq '.events[0].resolutionReport'
```

### Verify Configuration

```bash
# Check what config will be used
cat .doc-vader/backlog-consumer.json

# Override for testing
export DOC_VADER_BACKLOG_CONFIG=/path/to/test-config.json
doc-vader backlog scan
```

## Error Reference

### `resolve_subject_failed`

**Meaning**: No resolver strategy found any work-item subjects

**Check**:
- Work-item tokens in PR body/title/workflow name
- Resolver order configuration

**Fix**:
- Add work-item tokens to PR metadata
- Check resolver order includes appropriate strategies

### `fetch_pr_metadata_failed`

**Meaning**: PR metadata fetching failed (API error)

**Check**:
- GitHub API availability
- Authentication token validity
- Rate limits

**Fix**:
- Check GitHub API status
- Verify `GITHUB_TOKEN` environment variable
- Use faster resolver chain without API calls

### `parse_event_failed`

**Meaning**: Event payload could not be parsed

**Check**:
- Event format and structure
- Vendor compatibility

**Fix**:
- Enable debug mode to see parsing error
- Check event schema against vendor documentation

### `create_record_failed`

**Meaning**: Could not create evidence record file

**Check**:
- Filesystem permissions
- Disk space
- Path validity

**Fix**:
- Check write permissions on backlog directory
- Ensure sufficient disk space
- Try manual file creation

### `update_work_item_failed`

**Meaning**: Could not update work-item to link evidence

**Check**:
- Work-item file exists and is valid
- Frontmatter structure correct
- No conflicting updates

**Fix**:
- Verify work-item file exists and is valid YAML
- Check frontmatter format
- Retry scan

## Advanced Troubleshooting

### Enable Debug Logging

```bash
doc-vader backlog scan --debug --report-format json 2>&1 | tee debug.log
```

### Inspect Resolver Internals

```bash
# See all resolver attempts
doc-vader backlog scan --debug | grep -E "(resolver|strategy|duration)"
```

### Manual Event Testing

```bash
# Create test event
cat > /tmp/test-event.json << 'EOF'
{
  "workflow_run": {
    "id": 123,
    "name": "test-workflow (work-item:175)",
    "conclusion": "success"
  }
}
EOF

# Test resolver with manual event
# (Not yet supported; requires CLI enhancement)
```

### Performance Profiling

```bash
# Measure scan time
time doc-vader backlog scan --report-format json > report.json

# Check event-level durations
cat report.json | jq '.events[] | {eventId, duration}'
```

## Getting Help

### When to Contact Support

- Configuration errors you can't resolve
- Suspected bugs in resolver logic
- Performance issues beyond optimization options
- Multi-forge or vendor-specific issues

### Provide These Details

1. Configuration file (sanitized)
2. Scan report (JSON)
3. Debug output:
   ```bash
   doc-vader backlog scan --debug --report-format json > debug-report.json
   ```
4. Example workflow event or PR
5. Error message text (exact)

## See Also

- [Backlog Automation Configuration](../../guide/backlog-automation-configuration.md)
- [Resolver Strategy Guide](./resolver-strategy-guide.md)
- [Backlog Scan CLI Reference](./backlog-scan-cli.md)
- [ADR-004: Backlog Scan Lifecycle](../../architecture/decisions/adr-004-backlog-scan-lifecycle.md)

