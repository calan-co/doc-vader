---
title: GitHub App Deployment and CI Wiring Plan
id: githubap-2340
type: document
subtype: generic
lifecycle: active
status: ready
tags:
  - github
  - app
  - ci
  - deployment
links:
  reference:
    - '[[227.story-create-doc-vader-github-app.md]]'
    - '[[234.github-app-deployment-and-ci-plan-story.md]]'
---

## Goal

Provide a deployable operational plan for the doc-vader GitHub App used by backlog automation and protected-branch workflows.

## Deployment Target

1. Register a dedicated `doc-vader` GitHub App in the owning organization.
2. Install the app on required repositories.
3. Use installation tokens generated at runtime in CI.

## Required Permissions

Minimum repository permissions:

- `contents: write`
- `pull_requests: write`
- `issues: write` (if issue comments/status updates are part of workflow)

## Secrets and Credentials

Store as repository or organization secrets:

- `DOC_VADER_APP_ID` (repository variable)
- `DOC_VADER_PRIVATE_KEY` (repository secret containing PEM)

Do not commit keys or long-lived tokens to the repository.

## Installation Steps

- Create or identify the `doc-vader` GitHub App in the owning org.
- Grant repository permissions: `contents: write`, `pull_requests: write`.
- Install the app on each consumer repository (for RC scope: `calan-co/doc-vader`, `templjs/templ.js`).
- Set repository variable `DOC_VADER_APP_ID` to the numeric app ID.
- Set repository secret `DOC_VADER_PRIVATE_KEY` to the app PEM private key.

## CI Wiring

1. Use `actions/create-github-app-token` in workflow jobs that require privileged app identity.
2. Use the generated installation token for git pushes and API calls.
3. Restrict privileged steps to jobs that need them.

Current workflows already wired:

- `.github/workflows/backlog-sweep.yml`
- `.github/workflows/backlog-ingest-pull-request.yml`
- `.github/workflows/backlog-ingest-workflow-run.yml`

## Webhook/Event Scope

Enable only required events for automation use cases, for example:

- `pull_request`
- `push`
- `issues`
- `check_run` or `check_suite` if status integration is required

## Rollback Plan

If deployment causes failures:

1. Disable app-based privileged workflow steps via workflow condition flag.
2. Revert to non-privileged execution path where possible.
3. Rotate app private key if leakage is suspected.
4. Re-enable after smoke tests pass.

## Smoke Test Checklist

1. Verify token generation in CI job logs (without exposing secrets).
2. Verify app identity is used for repository actions.
3. Verify protected-branch operations behave as expected.
4. Verify no unrelated workflow gained elevated privileges.

## Verification Commands

```bash
# Check required repo variable and secret
gh variable list --repo calan-co/doc-vader | grep DOC_VADER_APP_ID
gh secret list --repo calan-co/doc-vader | grep DOC_VADER_PRIVATE_KEY

gh variable list --repo templjs/templ.js | grep DOC_VADER_APP_ID
gh secret list --repo templjs/templ.js | grep DOC_VADER_PRIVATE_KEY

# Inspect bypass actors on rulesets
gh api repos/templjs/templ.js/rulesets?per_page=100 --jq '.[] | {id,name}'
gh api repos/templjs/templ.js/rulesets/13237327 --jq '{id,name,bypass_actors}'

gh api repos/calan-co/doc-vader/rulesets?per_page=100 --jq '.[] | {id,name}'
```

## Key Rotation

1. Generate a new private key for the `doc-vader` app in GitHub App settings.
2. Update `DOC_VADER_PRIVATE_KEY` in each installed repository.
3. Trigger a dry-run backlog automation workflow dispatch.
4. Confirm app-token generation and successful authenticated operations.
5. Revoke old private key in app settings after validation.
