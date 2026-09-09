---
$schema: /frontmatter/document
id: adr-14
title: Publish a Publisher-Owned Work Selection Contract
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - work
  - contracts
  - consumers
  - versioning
links:
  reference:
    - "[[adr-006-task-command-surface-work-item-canonical-model.md]]"
    - "[[adr-007-local-runtime-authority-git-sqlite.md]]"
    - "[[adr-009-storage-and-format-seams.md]]"
    - "[[../../../../backlog/60473-publish-work-result-selection-contract.md]]"
---

# ADR-014: Publish a Publisher-Owned Work Selection Contract

## Context and Problem Statement

`dv work ready --json` publishes the internal `task-ready/v1` readiness result.
A downstream consumer copied an obsolete result schema and rejected a valid
publisher result. Copying or decoding readiness fields outside Doc-Vader creates
divergent schema ownership and lets consumers infer readiness semantics.

Consumers need one narrow, versioned decision boundary that supports guarded
effects while retaining durable publisher evidence. The boundary must fail
closed for transport, authorization, invocation, identity, and capability
failures.

## Decision

Doc-Vader owns Work-result schema, readiness selection, version mapping, and
readiness semantics. Its official external surface is the Node-version-neutral
CLI JSON transport: `dv work capabilities <work-item-id> --json` for discovery and
`dv work select <work-item-id> --request <json-file|-> --json` for invocation.
`lib/work` remains the publisher's in-process API for Doc-Vader-supported
Node runtimes, not the external consumer contract.

The publisher-owned selection port accepts a requested Work Item identity and
opaque invocation context. It executes readiness selection internally; callers
never supply or decode `task-ready/*` data. The command bridge is
`dv work select <work-item-id> --request - --json`: a Node 20 consumer can invoke that
transport over stdin/stdout without importing the Node 22 Doc-Vader runtime.
`dv work capabilities <work-item-id> --json` discovers supported capabilities and explicit
request/response version mappings. Node 20 consumers invoke the installed `dv`
binary, send the request JSON to `dv work select <work-item-id> --request - --json`, and load
only the portable CommonJS boundary validator at
`consumer/publisher-work-selection-v1-decoder.cjs`; it has no Doc-Vader package
imports and is included in the published package. Its response contains only:

- the invoked capability/version, including an unsupported requested version;
- either an exact selected identity matching the request or a typed
  `not-selected` outcome;
- a JSON-safe publisher decision artifact with the exact invoked command
  (`--request -` for stdin or the supplied file argument) and a base64 string
  containing opaque source-result evidence. Command evidence uses canonical
  POSIX single-quote token escaping, so request and backlog paths with
  whitespace (or embedded single quotes) are unambiguous and decoder-valid.
  Object or non-string source-result values are malformed transport and fail
  closed.

The stable `not-selected` diagnostic codes are `NOT_FOUND`, `NOT_READY`,
`AMBIGUOUS`, `NOT_AUTHORIZED`, `INVALID_REQUEST`,
`UNSUPPORTED_CAPABILITY`, and `PUBLISHER_UNAVAILABLE`.

Consumers may preserve the capability and opaque artifact as evidence, but must
treat every non-selection code as opaque and fail closed before guarded effects.
Malformed envelopes, unsupported capabilities, invocation failures, missing
or non-JSON-safe decision artifacts, non-selections, and identity mismatches
also fail closed.

`doc-vader-contract/v1` argv compatibility remains independent of this
selection capability. Agent Workflows is not a participant in this contract.

## Consequences

### Positive

- Doc-Vader has one authority for Work-result and readiness semantics.
- Consumers receive a small stable boundary rather than copied schemas.
- Evidence reconstruction retains the publisher version and opaque artifact.

### Costs and Risks

- Consumers must not promote diagnostic codes into readiness semantics.
- New capability versions require explicit publisher compatibility mapping and
  consumer adoption; unsupported versions remain fail-closed.

## Validation

- `tests/work-selection-contract.test.ts` proves a real ready candidate,
  each stable non-selection code, malformed/mismatched transport rejection,
  and evidence retention.
- Focused contract tests, TypeScript typecheck, and `git diff --check` pass.
- Independent review verifies publisher-owned selection and strict consumer
  boundary decoding.
