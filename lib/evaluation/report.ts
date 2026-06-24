import type {
  EvaluationFinding,
  EvaluationReport,
  EvaluationReviewExecution,
  EvaluationReviewProfile,
  EvaluationSubject,
  JsonRecord,
  JsonValue,
} from "./types.js";
import { normalizeReviewExecution, snapshotReviewProfile } from "./profile.js";

export function createFinding(
  finding: Omit<EvaluationFinding, "schemaVersion">,
): EvaluationFinding {
  return normalizeFinding({
    schemaVersion: "evaluation-finding/v1",
    ...finding,
  });
}

function severityRank(severity: EvaluationFinding["severity"]): number {
  switch (severity) {
    case "error":
      return 3;
    case "warn":
      return 2;
    default:
      return 1;
  }
}

function dispositionRank(disposition: EvaluationFinding["disposition"]): number {
  switch (disposition) {
    case "blocked":
      return 3;
    case "fail":
      return 2;
    case "warn":
      return 1;
    default:
      return 0;
  }
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function evidenceKey(finding: EvaluationFinding): string {
  return finding.evidence.map((entry) => entry.ref).join("|");
}

function followUpKey(finding: EvaluationFinding): string {
  return (finding.followUps ?? []).map((entry) => entry.ref).join("|");
}

function cloneJsonRecord(value: JsonRecord): JsonRecord;
function cloneJsonRecord(value: undefined): undefined;
function cloneJsonRecord(value: JsonRecord | undefined): JsonRecord | undefined {
  return value ? { ...value } : undefined;
}

function cloneSubject(
  subject: EvaluationFinding["subject"],
): EvaluationFinding["subject"] {
  return {
    ...subject,
    ...(subject.tags ? { tags: [...subject.tags] } : {}),
    ...(subject.metadata ? { metadata: cloneJsonRecord(subject.metadata) } : {}),
  };
}

function cloneEvidenceEntries(
  entries: EvaluationFinding["evidence"],
): EvaluationFinding["evidence"] {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.details ? { details: cloneJsonRecord(entry.details) } : {}),
  }));
}

function cloneFollowUpEntries(
  entries: NonNullable<EvaluationFinding["followUps"]>,
): NonNullable<EvaluationFinding["followUps"]> {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.details ? { details: cloneJsonRecord(entry.details) } : {}),
  }));
}

export function normalizeFinding(
  finding: EvaluationFinding,
): EvaluationFinding {
  return {
    ...finding,
    subject: cloneSubject(finding.subject),
    evidence: cloneEvidenceEntries(finding.evidence),
    ...(finding.followUps
      ? { followUps: cloneFollowUpEntries(finding.followUps) }
      : {}),
    ...(finding.details ? { details: cloneJsonRecord(finding.details) } : {}),
  };
}

export function sortFindings(
  findings: readonly EvaluationFinding[],
): readonly EvaluationFinding[] {
  return [...findings]
    .map((finding) => normalizeFinding(finding))
    .sort((left, right) => {
      const subjectType = compareStrings(left.subject.type, right.subject.type);
      if (subjectType !== 0) {
        return subjectType;
      }

      const subjectId = compareStrings(left.subject.id, right.subject.id);
      if (subjectId !== 0) {
        return subjectId;
      }

      const checkId = compareStrings(left.checkId, right.checkId);
      if (checkId !== 0) {
        return checkId;
      }

      const disposition =
        dispositionRank(left.disposition) - dispositionRank(right.disposition);
      if (disposition !== 0) {
        return disposition;
      }

      const severity = severityRank(left.severity) - severityRank(right.severity);
      if (severity !== 0) {
        return severity;
      }

      const reasonCode = compareStrings(left.reasonCode, right.reasonCode);
      if (reasonCode !== 0) {
        return reasonCode;
      }

      const evidence = compareStrings(evidenceKey(left), evidenceKey(right));
      if (evidence !== 0) {
        return evidence;
      }

      return compareStrings(followUpKey(left), followUpKey(right));
    });
}

export async function executeReviewProfile<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
>(
  profile: EvaluationReviewProfile<TSubject, TContext>,
  options: {
    executionId: string;
    subjects: readonly TSubject[];
    context: TContext;
    startedAt?: string;
    completedAt?: string;
  },
): Promise<EvaluationReport> {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const completedAt = options.completedAt ?? new Date().toISOString();
  const findings: EvaluationFinding[] = [];

  for (const [subjectIndex, subject] of options.subjects.entries()) {
    for (const [checkIndex, check] of profile.checks.entries()) {
      const output = await check({
        subject,
        context: options.context,
        profileId: profile.id,
        executionId: options.executionId,
        subjectIndex,
        checkIndex,
      });
      findings.push(...output.findings);
    }
  }

  const execution: Omit<EvaluationReviewExecution, "schemaVersion"> = {
    profileId: profile.id,
    executionId: options.executionId,
    startedAt,
    completedAt,
    subjectCount: options.subjects.length,
    checkCount: profile.checks.length,
  };

  return assembleReviewReport(profile, execution, findings);
}

export function assembleReviewReport<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
>(
  profile: EvaluationReviewProfile<TSubject, TContext>,
  execution: Omit<EvaluationReviewExecution, "schemaVersion">,
  findings: readonly EvaluationFinding[],
): EvaluationReport {
  const normalizedExecution = normalizeReviewExecution(execution);
  const sortedFindings = sortFindings(findings);
  const summary: JsonRecord = {};

  for (const rule of profile.summaryRules) {
    summary[rule.key] = rule.compute(sortedFindings);
  }

  return {
    schemaVersion: "evaluation-report/v1",
    profile: snapshotReviewProfile(profile),
    execution: normalizedExecution,
    generatedAt: normalizedExecution.completedAt,
    findings: sortedFindings,
    summary,
  };
}

export function serializeEvaluationReport(report: EvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

export function collectSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    compareStrings,
  );
}

export function collectJsonSummaryValues(value: JsonValue): readonly JsonValue[] {
  return Array.isArray(value) ? value : [value];
}
