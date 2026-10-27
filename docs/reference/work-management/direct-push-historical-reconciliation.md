---
id: dpr-60520
title: Direct-Push Historical Reconciliation
summary: Admin-gated, disabled-by-default reconciliation for verified historical direct pushes.
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - work-management
  - reconciliation
  - github
  - direct-push
---

# Direct-Push Historical Reconciliation

`dv work reconcile-direct-push` is an exceptional recovery path for a historical
commit that was pushed directly to a protected branch. It is disabled unless the
repository itself supplies `.doc-vader/direct-push-reconciliation.json`:

```json
{
  "$schema": "schemas/work-management/direct-push-reconciliation.schema.json",
  "enabled": true,
  "repository": "github.com/<owner>/<repository>",
  "protected_ref": "refs/heads/<protected-branch>",
  "from": ["ready"],
  "status": "completed",
  "reason": "completed",
  "receipt": { "subtype": "approval", "outcome": "approved" },
  "changed_files": "exact"
}
```

The policy is project-local. No packaged default enables this path.

## Procedure

1. Create an approval record linked by the work item. Its body must associate
   the work item and the direct-push commit, and satisfy the configured receipt
   subtype and outcome.
2. Commit the work item-to-commit link and approval record on the configured
   protected ref. Use that full 40-character commit SHA as `--receipt-commit`.
3. Authenticate `gh` as a repository administrator, then provide the full
   direct-push SHA and every changed path exactly once:

```bash
dv work reconcile-direct-push wi-123 \
  --commit <40-character-direct-push-sha> \
  --receipt record-admin-approval \
  --receipt-commit <40-character-receipt-sha> \
  --changed-file path/to/changed-file \
  --actual 1 \
  --completed-date 2026-10-27
```

The command fetches the configured protected ref and fails closed unless both
commits are reachable from it, the receipt commit contains the direct-push
commit, the immutable receipt matches, the origin matches the policy, `gh` is
authenticated, the viewer has `admin` permission, and the manifest exactly
matches `git diff` for the direct-push commit.

It only transitions the work item. It never creates retroactive runtime locks
or changes GitHub branch protection.
