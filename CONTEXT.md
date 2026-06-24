# Doc-Vader

This glossary defines global Doc-Vader language. Domain-specific contexts may
specialize these terms for a particular entity family, document store, package,
or command surface, but should not redefine the global concepts.

## Language

**Entity Governance**:
Doc-Vader's top-level architecture identity for schema-backed entities,
artifacts, runtime coordination, policies, gates, audit evidence, and extension
packages.
_Avoid_: Framing Doc-Vader as only a document linter or backlog automation tool

**Artifact**:
A schema-backed persisted unit such as a document, work item, record, PRD,
manifest, projection, lineage artifact, report, or package-contributed file.
_Avoid_: Assuming all governed artifacts are Markdown documents

**Entity**:
An artifact with durable identity and lifecycle or state semantics.
_Avoid_: Treating runtime coordination rows as implementation details when they
carry governed state

**Check**:
A reusable evaluation question that defines the subject kind, policy or decision
criteria, required evidence, and possible dispositions.
_Avoid_: Using check to mean marking a checklist item complete

**Run**:
A concrete execution of a check against a subject in a specific context. A run is
only first-class when execution state itself must be tracked, resumed, or
audited independently from the finding.
_Avoid_: Treating every check as requiring a separate durable run record

**Finding**:
The recorded outcome of a check, including disposition, reasons, evidence, and
follow-up obligations. A finding is evidence-backed and may be superseded by a
later finding.
_Avoid_: Verdict, verification result, unchecked assertion

**Review**:
A governed evaluation of an entity, artifact set, or document store that applies
one or more checks and produces a report for follow-up action.
_Avoid_: Treating a store-specific review as a standalone primitive

**Review Profile**:
A review tailoring for a specific entity family, document store, audience, or
policy context, including which checks apply and what findings are expected.
_Avoid_: Hard-coded review flows that cannot be extended outside one store

**Report**:
A structured aggregation produced by a review, including scope, profile, applied
checks, findings, and deterministic summaries.
_Avoid_: Treating a report as inherently reasoned synthesis

**Summary**:
A deterministic condensation of findings or reports using declared grouping,
counting, ordering, and selection rules.
_Avoid_: Root-cause interpretation or priority judgment

**Synthesis**:
A reasoned interpretation of findings or reports that identifies meaning,
priority, root causes, trade-offs, or recommended judgment calls.
_Avoid_: Presenting reasoned interpretation as deterministic summary

**Gate**:
A fail-closed decision point that depends on one or more findings and blocks
progress when required evidence, policy, state, or runtime authority is missing.
_Avoid_: Silent skips or advisory warnings for required execution prerequisites

**Package**:
An extension bundle that contributes entity definitions, schemas, policies,
commands, templates, validation behavior, and documentation.
_Avoid_: Requiring package authors to copy built-in domain internals

**Runtime Entity**:
A coordination entity persisted in the runtime authority, such as a claim, lock,
or execution log entry.
_Avoid_: Encoding runtime coordination only in transient process memory

**Runtime Authority**:
The local or hosted persistence authority for runtime entities. The local MVP
uses one Git repository plus one SQLite runtime authority.
_Avoid_: Confusing runtime authority with Git's durable artifact history

**Storage Adapter**:
A module that loads, persists, queries, or transacts over one storage medium such
as Git-managed files, SQLite runtime tables, or future hosted storage.
_Avoid_: Letting governance rules depend directly on a concrete storage medium

**Format Adapter**:
A module that parses, serializes, and canonicalizes one artifact format such as
Markdown with YAML frontmatter, JSON payloads, or JSON Schema.
_Avoid_: Treating Markdown parsing or JSON parsing as entity governance logic

**Reasoning Level**:
A proposed future classification of how much judgment a work item or evaluation
requires before or during execution.
_Avoid_: Replacing current operational execution tags before the rubric and
policy mapping are accepted

## Flagged Ambiguities

- Ambiguity: "Check" could mean either evaluating a subject or marking a
  checklist item complete.
  Resolution: A check evaluates a subject against policy or decision criteria;
  checklist mutation uses checklist-specific language such as mark or unmark.

- Ambiguity: Every check execution might need a durable run entity.
  Resolution: A finding may carry execution context directly; run becomes
  first-class only when in-flight execution must be tracked, resumed, or audited
  independently.

- Ambiguity: A finding could be treated as a final verdict.
  Resolution: Findings are recorded outcomes for a specific check context and
  may be superseded by later evidence or policy changes.

- Ambiguity: Store-specific review could become a bespoke workflow primitive.
  Resolution: Review is the primitive; store-specific behavior belongs in
  review profiles.

- Ambiguity: Reports could require reasoning to compose.
  Resolution: Reports aggregate findings and deterministic summaries; synthesis
  is the explicit reasoned layer when interpretation, priority, or root-cause
  judgment is needed.

- Ambiguity: Reasoning level could be treated as an execution permission.
  Resolution: Reasoning level describes required judgment; execution policy
  decides which actors may execute work unattended under current constraints.
