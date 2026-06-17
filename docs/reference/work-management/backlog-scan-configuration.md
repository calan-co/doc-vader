---
id: scanconfig-2164
title: Backlog Scan Configuration Reference
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - backlog-automation
  - configuration
  - resolver
links:
  reference:
    - '[[backlog-scan-cli.md]]'
    - '[[resolver-strategy-guide.md]]'
    - '[[../../guide/backlog-automation-configuration.md]]'
---

# Backlog Scan Configuration Reference

This guide covers the `backlog scan` configuration system: the consumer config file, CLI flag overrides, and resolver order precedence.

---

## Consumer Config File

The consumer config file (`.doc-vader/backlog-consumer.json` by default) lets you define persistent scan settings for a repository.

> **Missing file behavior**: If the config file does not exist, the scan silently falls back to built-in defaults. This means repositories without a `.doc-vader/backlog-consumer.json` file work out-of-the-box without any configuration required. Only non-`ENOENT` read errors (e.g., permission denied, malformed JSON) are propagated as failures.

The same consumer config file is also used by local pre-push validation (`pnpm run hooks:pre-push`) through `automation.prePushValidation`.

### `automation.prePushValidation`

Configure changed-file validation policy and severity.

```json
{
  "automation": {
    "prePushValidation": {
      "schemas": {
        "baseline": "schemas/frontmatter/work-item/1.0.0.json",
        "changed": "schemas/frontmatter/by-type/work-item/latest.json",
        "archive": "schemas/frontmatter/work-item/1.0.0.json"
      },
      "severity": {
        "baseline": "error",
        "changed": "error",
        "archive": "warn",
        "checklist": "error"
      }
    }
  }
}
```

Severity values: `none|info|warn|error`.

Schema values may use local paths, `/frontmatter/...` aliases, `file://` URIs, or `https://` URLs.

### `automation.subjectResolutionOrder`

Override the default resolver chain order. When set, this value is used unless a `--resolver-order` CLI flag is also provided.

**Type**: `string[]` (resolver names)  
**Default**: `["payload_subject_tokens", "linked_pull_requests"]`  
**Valid values**: `"payload_subject_tokens"`, `"linked_pull_requests"`

**Example** — fast-only resolver for time-sensitive pipelines:

```json
{
  "roots": {
    "backlog": "backlog",
    "active": "backlog",
    "archive": "backlog/archive",
    "records": "backlog/records"
  },
  "automation": {
    "autoCloseOnMerge": true,
    "autoEvidenceFromWorkflowRuns": true,
    "preserveCommitMap": true,
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}
```

**Example** — comprehensive two-strategy chain:

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

### `automation.workItemMatchPatterns`

Define which ID prefixes are treated as work-item tokens during subject resolution.

**Type**: `string[]`  
**Default**: `["work-item:"]`

Each pattern is treated as a prefix, and scan token matching extracts values shaped like:

- `<pattern><slug>` where `<slug>` matches `a-z0-9` plus hyphen groups

**Examples**:

```json
{
  "automation": {
    "workItemMatchPatterns": ["work-item:", "wi-"]
  }
}
```

### `automation.pullRequestPath`

Configure where pull request links are read from frontmatter.

**Type**: `string` (dotted path)  
**Default**: `"links.pull_requests"`

The parser supports both:

- object-array shape: `links.pull_requests: ["https://..."]`
- list-of-maps shape: `links: [{ pull_request: "https://..." }]`

**Example**:

```json
{
  "automation": {
    "pullRequestPath": "links.prs"
  }
}
```

### `automation.requiredCandidateFields`

Configure required fields for archive candidate validation.

**Type**: `Array<string | { field: string, values?: string[] }>`  
**Default**:

```json
[
  "actual",
  { "field": "status", "values": ["ready-for-review", "closed"] }
]
```

Notes:

- Pull request links are always required and validated independently via `automation.pullRequestPath`.
- `actual` is validated as numeric when present in `requiredCandidateFields`.
- Any rule with `values` enforces value membership.

**Example** (stricter status gate):

```json
{
  "automation": {
    "requiredCandidateFields": [
      "actual",
      { "field": "status", "values": ["closed"] }
    ]
  }
}
```

---

## CLI Flags

CLI flags override the consumer config for a single run.

### `--resolver-order`

Override `automation.subjectResolutionOrder` for this run.

```bash
doc-vader backlog scan --resolver-order payload_subject_tokens

doc-vader backlog scan --resolver-order payload_subject_tokens,linked_pull_requests

doc-vader backlog scan \
  --consumer-config .doc-vader/backlog-consumer.json \
  --resolver-order payload_subject_tokens,linked_pull_requests
```

### `--strict`

Exit with code 1 if any work items have scan errors or unmet conditions.

```bash
doc-vader backlog scan --strict --generate-evidence
```

---

## Precedence Rules

When resolving which resolver order to use, the following precedence applies (highest to lowest):

| Priority | Source | Description |
| --- | --- | --- |
| 1 | `--resolver-order` CLI flag | Explicit per-run override |
| 2 | `automation.subjectResolutionOrder` in consumer config | Persistent per-repo setting |
| 3 | Built-in default | `["payload_subject_tokens", "linked_pull_requests"]` |

**Example**: Config sets `["payload_subject_tokens"]` but CLI specifies `["linked_pull_requests"]`:

```bash
doc-vader backlog scan \
  --consumer-config .doc-vader/backlog-consumer.json \
  --resolver-order linked_pull_requests
```

---

## Typical Configurations

### Fast CI pipeline (payload-only)

Best for workflows where work-item tokens appear in PR titles or bodies.

```json
{
  "automation": {
    "subjectResolutionOrder": ["payload_subject_tokens"]
  }
}
```

**Latency**: ~1ms per scan event  
**Coverage**: PR/workflow payload only

### Comprehensive linking

Best for thorough backlog automation across PR descriptions and linked branches.

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

**Latency**: 200-500ms per scan event (GitHub API call)  
**Coverage**: Full PR metadata + linked PR graph

---

## See Also

- [Resolver Strategy Reference](./resolver-strategy-guide.md) — per-strategy latency, coverage, and tradeoffs
- [Backlog Scan CLI Reference](./backlog-scan-cli.md) — full CLI flag documentation
- [Backlog Automation Configuration Guide](../../guide/backlog-automation-configuration.md) — complete configuration guide
