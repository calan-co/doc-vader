---
id: backloga-6999
title: Backlog Automation Implementation Execution Plan
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - execution-plan
  - backlog-automation
  - phase-planning
links:
  reference:
    - '[[../../backlog/210.vendor-adapter-and-scan-lifecycle-epic.md]]'
    - '[[../../docs/architecture/decisions/adr-002-vendor-adapter-pattern.md]]'
    - '[[../../docs/architecture/decisions/adr-003-multi-strategy-subject-resolution.md]]'
    - '[[../../docs/architecture/decisions/adr-004-backlog-scan-lifecycle.md]]'
---

# Backlog Automation Implementation Execution Plan

Efficient, coordinated implementation of vendor adapter pattern and backlog scan lifecycle across 5 phases.

## Executive Summary

- **Total Duration**: 24 calendar hours (~3 development days)
- **Critical Path**: Phase A → B → C → D → E (serial dependencies)
- **Parallelization**: Infrastructure, types, docs, and testing can run in parallel
- **Risk Level**: Low (phased approach, incremental validation)
- **Resource Requirement**: 1 primary developer + optional parallel test/docs support

## Timeline and Milestones

### Phase Dependency Graph

```text
Phase A (8h)        Phase B (6h)        Phase C (4h)        Phase D (3h)        Phase E (3h)
├─ Types            ├─ Provider         ├─ Evidence         ├─ Workflow         ├─ Config
├─ Executor         ├─ Resolver Chain   ├─ Linking          ├─ Thin Wrapper     ├─ Flags
├─ Reporter         ├─ Conditions       ├─ Idempotency      ├─ Artifacts         └─ Docs
├─ CLI Command      ├─ Error Reporting  └─ Integration      └─ Tests
└─ Tests            └─ Tests                                                      
   ↓                   ↓                   ↓                   ↓
[Parallel Workstreams: Infrastructure, Types Definition, Test Fixtures, User Documentation]
```

### Gantt Timeline (Optimized with Parallelization)

```text
Day 1 (8h) - Phase A (Scan Infrastructure)
├─ 0-1h   : Setup: types definitions, test fixtures, mock provider
├─ 1-4h   : Core executor and reporter implementation
├─ 4-6h   : CLI command and integration
├─ 6-8h   : Unit tests and validation
└─ 8h     : Phase A complete; Phase B gates cleared

Day 2 (6h) - Phase B (Subject Resolution)
├─ 0-1h   : Provider interface and GitHub adapter extraction
├─ 1-3h   : Resolver strategies implementation
├─ 3-4h   : Integration with executor from Phase A
├─ 4-5h   : Error handling and reporting
├─ 5-6h   : Comprehensive integration tests
└─ 6h     : Phase B complete; Phase C gates cleared

Day 3 (10h) - Phases C + D (Evidence + Workflow) [Partially Parallel]
├─ 0-2h   : Phase C: Evidence creation and linking logic
├─ 2-4h   : Phase C: Tests and idempotency validation
├─ 4-5h   : Phase C: Integration with resolver from Phase B
├─ 5-6h   : Phase D: Workflow conversion and artifact setup
├─ 6-8h   : Phase D: End-to-end workflow test
├─ 8-9h   : Phase E: Configuration and strict mode
├─ 9-10h  : Final integration tests and validation
└─ 10h    : All phases complete; ready for review

[Parallel Throughout]
├─ Documentation updates (config guide, CLI ref, resolver guide, troubleshooting)
├─ Example generation for each phase
└─ PR template and artifact schema validation
```

## Phase Breakdown with Parallel Opportunities

### Phase A: Backlog Scan Command (8 hours)

**Goal**: Core scan infrastructure with JSON/text reporting (read-only, no behavior change)

**Deliverables**:
- `lib/backlog-automation/types.ts`: Core type definitions
- `lib/backlog-automation/executor.ts`: `BacklogScanExecutor` class
- `lib/backlog-automation/reporter.ts`: `ScanReporter` class
- `lib/backlog-automation/conditions.ts`: Condition evaluation logic
- `cli/commands/backlog-scan.ts`: CLI command implementation
- Unit and integration tests

**Estimated Effort**: 8 hours

**Parallelizable Work**:
- Test fixtures and mock data preparation (start while A is in progress)
- Example workflow runs and expected scan outputs
- Scan report schema documentation
- Configuration file examples

### Phase B: PR-Link Resolver (6 hours)

**Goal**: Vendor abstraction and multi-strategy subject resolution

**Dependencies**: Phase A (executor and reporter)

**Deliverables**:
- `lib/backlog-automation/provider.ts`: `BacklogAutomationProvider` interface
- `lib/backlog-automation/providers/github.ts`: GitHub adapter
- `lib/backlog-automation/resolver.ts`: Resolver chain
- `lib/backlog-automation/resolvers/payload-tokens.ts`: Payload strategy
- `lib/backlog-automation/resolvers/linked-pr.ts`: PR metadata strategy
- Updated executor to use providers and resolvers
- Comprehensive tests

**Estimated Effort**: 6 hours

**Parallelizable Work**:
- Resolver strategy performance benchmarks
- PR metadata fetching error scenarios
- Rate limit handling documentation
- GitHub API integration tests

### Phase C: Evidence Generation Mode (4 hours)

**Goal**: Evidence record creation and linking (optional, opt-in)

**Dependencies**: Phase B (resolver chain working)

**Deliverables**:
- `lib/backlog-automation/evidence.ts`: Evidence creation logic
- CLI `--generate-evidence` flag implementation
- Evidence record schema and template
- Idempotency validation
- Work-item linking logic
- Unit and integration tests

**Estimated Effort**: 4 hours

**Parallelizable Work**:
- Evidence record examples for documentation
- Linking behavior and edge cases documentation
- Test data for various evidence scenarios

### Phase D: Workflow Thin-Wrapper Conversion (3 hours)

**Goal**: Replace Python logic with CLI command; add artifact storage

**Dependencies**: Phase C (evidence generation working)

**Deliverables**:
- Updated `.github/workflows/backlog-sweep.yml`
- Artifact upload step for scan reports
- Removed embedded Python script
- Workflow documentation updates
- End-to-end integration tests

**Estimated Effort**: 3 hours

**Parallelizable Work**:
- Artifact schema documentation
- Workflow troubleshooting guide
- CI/CD integration examples

### Phase E: Configuration and Strict Mode (3 hours)

**Goal**: Configuration support, resolver order control, strict mode

**Dependencies**: Phase D (workflows refactored)

**Deliverables**:
- Config schema updates (`.doc-vader/backlog-consumer.json`)
- `--resolver-order` and `--strict` flag implementation
- Configuration loading and precedence logic
- CLI flag validation
- Unit tests for configuration
- Configuration guide and examples

**Estimated Effort**: 3 hours

**Parallelizable Work**:
- Configuration reference documentation
- Migration guide for existing users
- Troubleshooting for configuration issues

## Parallel Workstreams (Non-Critical Path)

These can start immediately and progress throughout all phases:

### 1. Infrastructure Setup (4-6 hours, starts immediately)

**Tasks**:
- Create test fixtures (example workflow events)
- Mock provider and resolver interfaces
- Test helper utilities
- CI/CD test infrastructure

**Owner**: Can be done by second developer or in parallel

**Deliverables**:
- `tests/fixtures/` directory with example events
- `tests/mocks/` with mock implementations
- `tests/helpers/` with test utilities

### 2. Documentation (ongoing, in parallel)

**Tasks**:
- Configuration guide (reference Phase A-E as built)
- CLI reference with examples
- Resolver strategy comparison matrix
- Troubleshooting guide with debugging commands
- Migration guide for existing consumers

**Owner**: Can be done in parallel with code development

**Deliverables**:
- `docs/guide/backlog-automation-configuration.md` ✅ (already created)
- `docs/reference/work-management/backlog-scan-cli.md` ✅ (already created)
- `docs/reference/work-management/resolver-strategy-guide.md` ✅ (already created)
- `docs/reference/work-management/backlog-automation-troubleshooting.md` ✅ (already created)

### 3. Validation and Examples (per phase)

**Tasks**:
- Create example usage for each resolver strategy
- Generate example scan reports (JSON)
- Document resolver performance characteristics
- Create example evidence records
- Build workflow trigger examples

**Owner**: Parallel with each phase

**Deliverables**:
- Example outputs and configurations
- Performance benchmark data
- Integration test scenarios

## Optimization Strategies

### 1. Batch Type Definitions Upfront

Define all types at start of Phase A to avoid rework:
- `ParsedEvent`, `PRIdentity`, `WorkflowRunIdentity`
- `ScanState`, `ConditionEvaluation`
- `ScanError`, `ScanReport`
- `SubjectResolver`, `SubjectResolverChain`
- Provider interface and GitHub adapter types

**Benefit**: Enables parallel work; prevents mid-phase refactoring

### 2. Mock Everything in Tests

Use mocks for:
- GitHub API (avoid rate limiting during tests)
- Filesystem operations (faster, cleaner)
- Provider implementations (test domain logic independently)

**Benefit**: Tests run fast; CI/CD gates clear quickly

### 3. Incremental CLI Feature Addition

Add CLI flags progressively:
- Phase A: `--report-format`, `--output-file`, `--debug`
- Phase B: No new flags
- Phase C: `--generate-evidence`
- Phase D: No new CLI flags (workflow changes only)
- Phase E: `--resolver-order`, `--strict`

**Benefit**: Users can adopt progressively; less breaking change risk

### 4. Validation Checkpoints

After each phase, validate:
- All unit tests pass
- Integration tests pass
- No TypeScript errors
- Example scenario works end-to-end
- Documentation is complete

**Benefit**: Catch issues early; unblock downstream phases

## Risk Mitigation

### Risk: Phase B Unblocks C But Resolver Chain Is Complex

**Mitigation**:
- Implement `PayloadSubjectTokensResolver` first (current logic)
- Validate it works before adding `LinkedPullRequestsResolver`
- Use mocks for PR fetching until real API integration

### Risk: Evidence Generation Side Effects Are Hard to Test

**Mitigation**:
- Use ephemeral test files (cleanup after each test)
- Mock filesystem operations
- Test idempotency by running evidence creation twice
- Example test: Create evidence, verify frontmatter, re-create, verify no duplicates

### Risk: Workflow Conversion Breaks Current Automation

**Mitigation**:
- Deploy thin wrapper as new CLI command first
- Run CLI in dry-run mode before enabling in workflow
- Keep embedded Python as fallback during Phase D
- Gradual rollout: test in doc-vader first, then templjs, then other consumers

### Risk: GitHub API Rate Limits During Testing

**Mitigation**:
- All PR metadata tests use mocks (no real API calls in CI)
- Real API calls only in integration tests (limited)
- Document rate limit handling for high-volume users
- Provide cache mechanism for future optimization

## Resource Requirements

### Primary Developer (Dedicated for Phases A-E)

- 24 hours total over 3 days
- Must understand backlog automation context
- Familiar with vendor API patterns and TypeScript interfaces

### Optional Parallel Resources

- **Test/Infrastructure Specialist**: 4-6 hours for test setup and CI/CD
- **Documentation Writer**: 4-6 hours for guides and examples
- **Code Reviewer**: Available for phase gates and PR reviews

## Success Metrics

### Phase A Complete
- [ ] `backlog scan` command works and produces valid JSON
- [ ] All conditions evaluated (no missing fields)
- [ ] Example workflow run scanned successfully
- [ ] Unit test coverage >80%
- [ ] No TypeScript errors

### Phase B Complete
- [ ] `BacklogAutomationProvider` interface tested with mock
- [ ] GitHub adapter implemented and tested
- [ ] Resolver chain tries strategies in order
- [ ] LinkedPullRequestsResolver works with mocked PR data
- [ ] Error handling for each resolver failure case

### Phase C Complete
- [ ] Evidence records created with correct structure
- [ ] Evidence linked to work items
- [ ] Idempotency verified (no duplicates on re-run)
- [ ] Example evidence record shows correct format
- [ ] All closure scenarios tested

### Phase D Complete
- [ ] Workflow calls CLI instead of Python
- [ ] Scan report stored as artifact
- [ ] Workflow end-to-end test passes
- [ ] Embedded Python removed
- [ ] Workflow documentation updated

### Phase E Complete
- [ ] Configuration file parsing works
- [ ] `--resolver-order` flag overrides config
- [ ] `--strict` mode exits code 1 on errors
- [ ] Configuration examples documented
- [ ] All phase gates cleared

## Acceptance Criteria for Release

All phases complete and passing:
- [ ] All 5 work item stories accepted and closed
- [ ] PR #17 merged to staging
- [ ] All unit and integration tests passing
- [ ] Zero TypeScript errors
- [ ] Documentation complete and reviewed
- [ ] Example scenarios documented
- [ ] Performance benchmarks acceptable
- [ ] Zero known bugs or blockers
- [ ] Consumer integration tested (e.g., templjs)

## Go-Live Checklist

Before releasing to consumers:
- [ ] Staged release notes written
- [ ] Configuration migration guide (if needed)
- [ ] Consumer templates updated (calan-co/.github)
- [ ] Example configurations in documentation
- [ ] Support runbooks and troubleshooting ready
- [ ] Monitoring/alerts for evidence generation configured
- [ ] Backward compatibility verified
- [ ] Rollback plan documented

## Next Steps

1. **Immediately** (before Phase A starts):
   - Create test fixtures and mock infrastructure
   - Define all types and interfaces (batch upfront)
   - Set up test CI/CD gates

2. **Phase A Kickoff**:
   - Assign primary developer
   - Start daily standups
   - Create PR early (draft) for continuous feedback

3. **Phase Gate Process**:
   - Phase must be 100% complete before next starts
   - All tests passing
   - Code review approval
   - Documentation complete

4. **Phase D Coordination**:
   - Prepare calan-co/.github template update
   - Coordinate with templjs/other consumers
   - Staged rollout strategy

5. **Release Readiness** (after Phase E):
   - Documentation review
   - Integration testing with real consumers
   - Performance and load testing
   - Security review of API interactions

## Estimated Timeline

| Phase | Duration | Start | End | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| Infrastructure (parallel) | 4-6h | Day 0 | Throughout | None | Immediate start |
| Phase A | 8h | Day 1 | Day 1 | Infrastructure | Ready to start |
| Phase B | 6h | Day 2 | Day 2 | Phase A | Blocked until A complete |
| Phase C | 4h | Day 3 | Day 3 | Phase B | Blocked until B complete |
| Phase D | 3h | Day 3 | Day 3 | Phase C | Can start after C |
| Phase E | 3h | Day 3 | Day 3 | Phase D | Can start after D |
| Release readiness | 2-4h | Day 4 | Day 4+ | Phase E | After all phases |

**Actual Calendar Time**: 3-4 calendar days with dedicated developer
**With Parallel Resources**: 2-3 calendar days

## Monitoring and Communication

### Daily Standups (during development)
- 10 min standup with: done, doing, blockers
- Share progress against timeline
- Address blockers immediately

### Phase Gate Reviews (after each phase)
- 30 min code review
- Verify all acceptance criteria met
- Validate example scenarios
- Approve or request changes

### Documentation Reviews (continuous)
- Review docs before phase complete
- Catch errors early
- Ensure clarity and completeness

## Rollback and Contingency

If any phase cannot be completed as planned:
- **Phase A blocked**: CLI command not working → Cannot proceed; investigate core design
- **Phase B blocked**: Provider abstraction complex → Simplify to GitHub-only first, add abstraction in Phase B+
- **Phase C blocked**: Evidence creation issues → Defer to Phase D; skip evidence generation initially
- **Phase D blocked**: Workflow conversion risky → Keep dual approach (old + new) for longer
- **Phase E blocked**: Configuration complex → Ship with defaults; add config in follow-up

## Conclusion

This plan provides:
1. **Clear sequencing** with minimal dependencies
2. **Parallelizable workstreams** to accelerate calendar time
3. **Validation checkpoints** to catch issues early
4. **Risk mitigation** for known challenges
5. **Resource flexibility** for teams of different sizes
6. **Go-live readiness** criteria and checklists

**Estimated effort**: 24 hours (3 developer days)  
**Estimated calendar time**: 3-4 days (with parallelization)  
**Risk level**: Low (phased, incremental, well-defined)  
**Success probability**: High (detailed specifications + risk planning)

