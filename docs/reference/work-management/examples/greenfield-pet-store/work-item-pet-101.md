---
$schema: schemas/work-management/frontmatter/work-item.json
$template: templates/reference/work-management/work-item.tpl.md
id: wi-101
title: Establish Storefront Foundation
summary: Set up the storefront shell, deployment baseline, and launch-ready design primitives.
owner: platform-team
assignee: frontend-lead
type: work-item
subtype: task
lifecycle: active
status: closed
status_reason: completed
priority: high
estimated: 13
actual: 11
tags:
  - task
  - foundation
  - storefront
commits:
  a1b2c3d: Build storefront shell and deployment baseline
  d4e5f6a: Add design primitives and foundation smoke test coverage
links:
  pull_requests:
    - https://github.com/example/pet-store/pull/42
  evidence:
    - https://example.internal/pet-store/foundation-smoke-test
  reference:
    - '[[project-pet-store-website]]'
---

## Goal

Set up the storefront shell, hosting baseline, and reusable launch-ready design
primitives.

## Background

- Checkout readiness depends on a stable shell, predictable deployment path, and shared UI primitives.
- Closing this task should make the downstream checkout work unambiguously unblocked.

## Tasks

- [x] Create the storefront shell with base routes and navigation.
- [x] Establish the deployment baseline for the release candidate environment.
- [x] Publish the initial set of reusable design primitives needed by checkout work.

## Deliverables

- A deployable storefront shell.
- Reusable launch-ready design primitives.
- Smoke-test evidence for the shell and baseline routes.

## Acceptance Criteria

- [x] The storefront shell loads in the target environment. Verification: open the release candidate shell and confirm navigation and base routes render.
- [x] Shared design primitives are available for downstream launch work. Verification: review the initial component inventory used by the checkout path.

## Relationships

- `part_of`: [[work-item-pet-100]]

## Design

### Architecture

The foundation task owns the storefront shell, the route scaffold, and the
shared primitive layer. Downstream feature tasks depend on those capabilities
without restating the hosting or shell concerns.

### Style Guidelines

- Keep layout and navigation primitives reusable across browse, cart, and checkout flows.
- Prefer launch-ready defaults over theme complexity in the first release boundary.

## Examples

### Usage Examples

- Base shell routes render `/`, `/products`, and `/cart` without fallback errors.
- Checkout work can import the shared button, input, and layout primitives directly from the storefront shell package.

## Testing

### Strategy

Validate the shell in the release candidate environment and keep the smoke path
small enough that it can be rerun whenever the hosting baseline changes.

### Run Commands

- Deploy the release candidate shell to the preview environment.
- Execute the storefront shell smoke test against the preview hostname.

## Operations

### Runbook Outline

- Verify preview deployment health before handing the environment to commerce work.
- Record smoke-test evidence anywhere the launch team can retrieve it during release review.

## Notes

- This task is intentionally closed before the checkout task moves into review so the example graph has one clear upstream dependency.
