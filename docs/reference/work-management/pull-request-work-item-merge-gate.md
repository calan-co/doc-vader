---
id: pullreq-6050
title: Pull Request Work-Item Merge Gate
summary: Require implementation pull requests to link one completed Work item before merge.
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - work-management
  - pull-request
  - ci
  - governance
links:
  reference:
    - '[[foundation.md]]'
    - '[[../../../backlog/60500-enforce-work-item-completion-before-merge.md]]'
---

# Pull Request Work-Item Merge Gate

`pnpm run backlog:validate:pr` is the pre-merge check for an implementation
pull request. CI supplies its canonical GitHub pull-request URL and the changed
base/head range.

## Association rule

An implementation pull request must have exactly one active Backlog Work item
whose `links.pull_requests` contains its canonical URL:

```yaml
links:
  pull_requests:
    - https://github.com/<owner>/<repository>/pull/<number>
```

The check fails closed for zero or multiple linked Work items. Documentation-only
changes—files under `docs/` or `backlog/`, plus `README.md`, `CHANGELOG.md`, and
`LICENSE`—do not require a Work item. Changes outside those paths are
implementation changes and require one.

## Completion rule

The linked Work item must have:

- `status: completed`, a non-empty `status_reason`, `completed_date`, and
  numeric `actual` effort;
- at least one `links.evidence` entry; and
- no unchecked item in either `## Tasks` or `## Acceptance Criteria`.

The local pre-push validator applies the checklist requirement to changed
completed Work items. CI is the authority for the PR URL association because it
has the canonical pull-request event and base/head revisions.

## Post-merge backstop

Backlog automation continues to inspect linked merged pull requests. Any linked
item that remains non-complete after the configured delay produces a failing
annotation; this is a bypass detector, not a substitute for the required
pre-merge check.

To make the CI job an effective repository-wide merge control, repository
administrators must configure **Work-item merge gate** as a required branch
status check. That branch-protection change is intentionally outside this
repository's normal source-code authority.
