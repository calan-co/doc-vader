---
id: wi-60340
title: Artifact Graph and Nested Claim Architecture ADR
summary: Decide the architecture for format-agnostic artifacts, nested artifact identity, and section-level claim semantics after the Sandcastle MVP stabilizes at file/document atomicity.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 4
links:
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
    - '[[60338-hosted-saas-github-app-architecture-adr]]'
  evidence:
    - '[[record-20260614-164243-60340]]'
tags:
  - adr
  - artifact-graph
  - claims
  - extensibility
  - hitl
---

## Goal

Produce the ADR for Doc-Vader's artifact graph model, including how nested artifacts are identified, normalized, guarded, and claimed across file-backed and non-file-backed formats.

## Background

The Sandcastle MVP in [[60339-agent-command-surface-for-skills-and-sandcastle]] should keep claim atomicity at the current file/document or work-item boundary because today's implementation is still Markdown/frontmatter and work-item centric. Section-level claims, such as claiming the summary section of a README independently from the installation section, should wait until Doc-Vader has a real artifact graph capable of addressing nested artifacts reliably.

An artifact is not necessarily a file. Future Doc-Vader claim and guard logic should be able to reason over frontmatter, document bodies, Markdown sections, schema-defined subdocuments, hosted records, generated outputs, and other configured artifact types through a format-agnostic graph. Native format concepts such as frontmatter and content should be adapters into that graph rather than privileged business-logic inputs.

## Tasks

- [ ] Define the canonical artifact identity model, including file-backed artifacts, nested artifacts, and hosted or generated artifacts.
- [ ] Decide how Markdown/frontmatter adapters should expose document, frontmatter, body, and heading-section artifacts.
- [ ] Decide how non-Markdown artifact adapters will register artifact IDs, parent/child relationships, mutability, and classification metadata.
- [ ] Define how AFK/HITL classification normalizes from artifact-specific formats before guard logic runs.
- [ ] Define when nested artifact claims are allowed and how they interact with file-level collision detection.
- [ ] Define how artifact graph decisions compose with hosted authority, lease backends, and Sandcastle execution.
- [ ] Record the decision as an ADR or equivalent durable decision document.

## Deliverables

- An ADR describing the artifact graph domain model, adapter responsibilities, nested artifact identity rules, and claim atomicity policy.
- A compatibility note explaining that Sandcastle MVP remains file/document or work-item atomic until artifact graph support lands.
- Follow-on implementation slices for artifact graph core, Markdown adapter support, classification normalization, and nested claim enforcement if the ADR accepts the approach.

## Acceptance Criteria

- [ ] ADR explicitly defines artifact, artifact ref, artifact graph, nested artifact, adapter, and claim scope terminology.
- [ ] ADR distinguishes current file/document atomicity from future nested artifact claims.
- [ ] ADR explains why section-level claims are not available before artifact graph implementation.
- [ ] ADR defines fail-closed AFK/HITL normalization across artifact types.
- [ ] ADR defines how artifact graph support integrates with schema/template/config extensibility from [[60333-canonical-schema-profile-routing-and-fixtures]].
- [ ] ADR defines how hosted authority and local execution modes consume the same artifact identity model.
- [ ] Resulting implementation work can be decomposed into AFK slices without reopening the core artifact identity decision.

## Notes

- Do not add section-level claim behavior to [[60339-agent-command-surface-for-skills-and-sandcastle]] before this ADR is complete.
- Treat Markdown sections as an initial adapter target, not as the global artifact model.
- Preserve the Sandcastle invariant that claimable work is AFK only.
