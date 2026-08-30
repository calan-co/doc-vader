---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60496
title: Establish self-hosted pull-based CI timing telemetry
summary: Track and operate a self-hosted pull-based timing pipeline that ingests GitHub Actions artifacts for Windows CI performance decisions.
type: work-item
subtype: epic
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  evidence:
    - '[[record-20260830-092324-60496]]'
tags:
  - ci
  - windows
  - telemetry
  - prometheus
  - github-actions
---

## Goal

Provide durable, self-hosted timing evidence for Windows CI decisions without making GitHub Actions push directly into internal observability infrastructure.

## Scope

- Emit structured timing artifacts from selected GitHub Actions jobs.
- Operate a self-hosted pull-based collector that retrieves authorized artifacts and exposes metrics to Prometheus or a compatible scraper.
- Define retention, cardinality, authentication, and artifact-integrity controls.
- Publish a dashboard/runbook for timeout and parallelism decisions.

## Acceptance Criteria

- [ ] Windows CI timing artifacts have a documented, versioned schema.
- [ ] A self-hosted pull worker retrieves only authorized GitHub Actions artifacts and verifies their provenance.
- [ ] Prometheus-compatible metrics expose stage duration, sample outcome, runner image, operating system, and Node version with bounded labels.
- [ ] The operational runbook defines retention, alerting, failure handling, and access controls.
- [ ] At least one timing decision uses the collected metrics and links its evidence.

## Risks and Constraints

- Do not place long-lived ingestion credentials in GitHub Actions.
- Keep metric labels bounded; do not use run IDs or paths as metric labels.
- Preserve GitHub artifact evidence for auditability independently of metrics ingestion.
