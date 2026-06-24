import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  collectSortedStrings,
  composeReviewProfile,
  createFinding,
  createReviewProfile,
  createReviewProfileRegistry,
  executeReviewProfile,
  type EvaluationFinding,
  type EvaluationReviewExecution,
  type EvaluationReviewProfileSnapshot,
  type EvaluationSubject,
  type JsonRecord,
} from "../evaluation/index.js";
import {
  evaluateWorkItemGovernance,
  type WorkItemGovernanceDependency,
  type WorkItemGovernanceReason,
  type WorkItemGovernanceVerdict,
} from "../work-management/kernel.js";
import { loadTaskRuntimeReadiness, type TaskRuntimeReadiness } from "../task/runtime.js";

type Frontmatter = Record<string, unknown>;

type BacklogReviewFinding = EvaluationFinding;

type BacklogReviewReasonCode = WorkItemGovernanceReason["code"];
type ExtendedBacklogReviewReasonCode = BacklogReviewReasonCode | "execution_not_ready";

export const BACKLOG_REVIEW_PROFILE_ID = "backlog-review";

const BACKLOG_REVIEW_REASON_CODES: readonly ExtendedBacklogReviewReasonCode[] = [
  "archived",
  "blocked",
  "closed",
  "dependency_blocked",
  "dependency_state_unknown",
  "invalid",
  "hitl",
  "missing_classification",
  "missing_completed_date",
  "missing_evidence",
  "missing_status_reason",
  "not_active",
  "not_ready",
  "execution_not_ready",
] as const;

interface ReviewDocument {
  filePath: string;
  relativePath: string;
  archived: boolean;
  frontmatter?: Frontmatter;
  parseError?: string;
}

export interface BacklogReviewSubjectMetadata extends JsonRecord {
  filePath: string;
  archived: boolean;
  parseError: string | null;
  rawType: string | null;
  rawId: string | null;
  rawTitle: string | null;
  rawStatus: string | null;
  rawLifecycle: string | null;
  rawTags: readonly string[];
  dependencyRefs: readonly string[];
  governance: JsonRecord | null;
  runtime: JsonRecord | null;
}

export interface BacklogReviewSubject extends EvaluationSubject {
  type: "work-item";
  metadata: BacklogReviewSubjectMetadata;
}

export interface BacklogReviewSubjectReport {
  subject: EvaluationSubject;
  findings: readonly BacklogReviewFinding[];
  findingsByCheck: readonly {
    checkId: string;
    findings: readonly BacklogReviewFinding[];
  }[];
  findingsBySeverity: {
    error: readonly BacklogReviewFinding[];
    warn: readonly BacklogReviewFinding[];
    info: readonly BacklogReviewFinding[];
  };
  findingsByBlocking: {
    blocking: readonly BacklogReviewFinding[];
    nonBlocking: readonly BacklogReviewFinding[];
  };
  verdict: {
    candidate: boolean;
    excluded: boolean;
    reasons: readonly string[];
    categories: {
      invalid: boolean;
      archived: boolean;
      closed: boolean;
      hitl: boolean;
      missingClassification: boolean;
      dependencyBlocked: boolean;
      dependencyStateUnknown: boolean;
      runtimeBlocked: boolean;
      evidenceIncomplete: boolean;
    };
  };
}

export interface BacklogReviewSummary {
  counts: {
    subjects: number;
    candidates: number;
    excluded: number;
    findings: number;
    blockingFindings: number;
    errorFindings: number;
    warnFindings: number;
    infoFindings: number;
    invalidSubjects: number;
    archivedSubjects: number;
    closedSubjects: number;
    hitlSubjects: number;
    missingClassificationSubjects: number;
    dependencyBlockedSubjects: number;
    dependencyStateUnknownSubjects: number;
    runtimeBlockedSubjects: number;
    evidenceIncompleteSubjects: number;
  };
  candidateIds: readonly string[];
  excludedIds: readonly string[];
  invalidIds: readonly string[];
  archivedIds: readonly string[];
  closedIds: readonly string[];
  hitlIds: readonly string[];
  missingClassificationIds: readonly string[];
  dependencyBlockedIds: readonly string[];
  dependencyStateUnknownIds: readonly string[];
  runtimeBlockedIds: readonly string[];
  evidenceIncompleteIds: readonly string[];
}

export interface BacklogReviewReport {
  schemaVersion: "backlog-review/v1";
  profile: EvaluationReviewProfileSnapshot;
  execution: EvaluationReviewExecution;
  generatedAt: string;
  summary: BacklogReviewSummary;
  subjects: readonly BacklogReviewSubjectReport[];
  findings: readonly BacklogReviewFinding[];
}

export interface BacklogReviewOptions {
  rootDir?: string;
  backlogDir?: string;
  executionId?: string;
  startedAt?: string;
  completedAt?: string;
}

const DETERMINISTIC_REVIEW_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function collectStringLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getLinks(frontmatter: Frontmatter): Record<string, unknown> {
  return typeof frontmatter.links === "object" && frontmatter.links !== null
    ? (frontmatter.links as Record<string, unknown>)
    : {};
}

function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function normalizeDependencyId(ref: string): string {
  const stripped = stripWikiLink(ref);
  const match = stripped.match(/^(?:wi-)?(\d+)/);
  return match ? `wi-${match[1]}` : stripped;
}

function reason(
  code: BacklogReviewReasonCode,
  message: string,
  details?: JsonRecord,
): WorkItemGovernanceReason {
  return { code, message, ...(details ? { details } : {}) };
}

function getGovernance(
  metadata: BacklogReviewSubjectMetadata,
): WorkItemGovernanceVerdict | null {
  return metadata.governance as WorkItemGovernanceVerdict | null;
}

function getRuntime(
  metadata: BacklogReviewSubjectMetadata,
): TaskRuntimeReadiness | null {
  return metadata.runtime as TaskRuntimeReadiness | null;
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMarkdownFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readReviewDocuments(
  rootDir: string,
  backlogDir: string,
): Promise<ReviewDocument[]> {
  const backlogRoot = path.resolve(rootDir, backlogDir);
  const files = await findMarkdownFiles(backlogRoot);
  const documents: ReviewDocument[] = [];
  for (const filePath of files) {
    const relativePath = toPosixPath(path.relative(rootDir, filePath));
    const relativeToBacklog = toPosixPath(path.relative(backlogRoot, filePath));
    if (relativeToBacklog.startsWith("audit/") || relativeToBacklog.startsWith("records/")) {
      continue;
    }

    try {
      const parsed = matter(await fs.readFile(filePath, "utf8"));
      documents.push({
        filePath,
        relativePath,
        archived: relativeToBacklog.startsWith("archive/"),
        frontmatter: (parsed.data ?? {}) as Frontmatter,
      });
    } catch (error) {
      documents.push({
        filePath,
        relativePath,
        archived: relativeToBacklog.startsWith("archive/"),
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return documents;
}

function normalizeDependency(
  dependency: WorkItemGovernanceDependency,
): WorkItemGovernanceDependency {
  return {
    ...dependency,
    id: dependency.id.trim(),
    ref: dependency.ref.trim(),
    ...(dependency.status ? { status: dependency.status.trim() } : {}),
    ...(dependency.lifecycle ? { lifecycle: dependency.lifecycle.trim() } : {}),
    ...(dependency.filePath ? { filePath: dependency.filePath.trim() } : {}),
  };
}

function toGovernanceDependency(
  ref: string,
  documents: ReviewDocument[],
  rootDir: string,
): WorkItemGovernanceDependency {
  const id = normalizeDependencyId(ref);
  const dependency = documents.find((document) => {
    const frontmatterId = asString(document.frontmatter?.id);
    const basename = path.basename(document.filePath, ".md");
    return (
      frontmatterId === id ||
      frontmatterId === id.replace(/^wi-/, "") ||
      basename === stripWikiLink(ref)
    );
  });
  const status = asString(dependency?.frontmatter?.status);
  const lifecycle = asString(dependency?.frontmatter?.lifecycle);
  return normalizeDependency({
    id,
    ref,
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(dependency
      ? { filePath: toPosixPath(path.relative(rootDir, dependency.filePath)) }
      : {}),
    satisfied: status === "completed" || status === "closed" || lifecycle === "inactive",
    stateKnown: Boolean(dependency && status),
  });
}

async function buildGovernanceRecord(
  document: ReviewDocument,
  documents: ReviewDocument[],
  rootDir: string,
): Promise<{
  subject: BacklogReviewSubject;
  governance: WorkItemGovernanceVerdict;
  runtime?: TaskRuntimeReadiness;
} | null> {
  if (document.parseError) {
    const subjectId = document.relativePath;
    const subject: BacklogReviewSubject = {
      type: "work-item",
      id: subjectId,
      ref: document.relativePath,
      title: path.basename(document.relativePath, ".md"),
      group: document.archived ? "archive" : "backlog",
      metadata: {
        filePath: document.relativePath,
        archived: document.archived,
        parseError: document.parseError,
        rawType: null,
        rawId: null,
        rawTitle: null,
        rawStatus: null,
        rawLifecycle: null,
        rawTags: [],
        dependencyRefs: [],
        governance: null,
        runtime: null,
      },
    };
    return {
      subject,
      governance: {
        schemaVersion: "work-item-governance/v1",
        record: {
          id: subjectId,
          status: "unknown",
          lifecycle: "unknown",
          tags: [],
          archived: document.archived,
        },
        lifecycle: {
          valid: false,
          isActive: false,
          isArchived: document.archived,
          isClosed: false,
          reasons: [
            reason("invalid", "Task frontmatter could not be parsed.", {
              error: document.parseError,
            }),
          ],
        },
        classification: {
          isAfk: false,
          isHitl: false,
          reasons: [],
        },
        dependencies: {
          satisfied: false,
          known: false,
          reasons: [],
          items: [],
        },
        evidence: {
          ready: false,
          reasons: [],
        },
        archive: {
          eligible: false,
          reasons: [],
        },
        readiness: {
          ready: false,
          reasons: [
            reason("invalid", "Task frontmatter could not be parsed.", {
              error: document.parseError,
            }),
          ],
        },
      },
    };
  }

  const frontmatter = document.frontmatter ?? {};
  if (asString(frontmatter.type) !== "work-item") {
    return null;
  }

  const id = asString(frontmatter.id) ?? document.relativePath;
  const title = asString(frontmatter.title);
  const status = asString(frontmatter.status) ?? "";
  const lifecycle = asString(frontmatter.lifecycle) ?? "";
  const statusReason = asString(frontmatter.status_reason);
  const completedDate = asString(frontmatter.completed_date);
  const tags = normalizeTags(frontmatter.tags);
  const links = getLinks(frontmatter);
  const dependencyRefs = collectStringLinks(links.depends_on);
  const dependencies = dependencyRefs.map((ref) =>
    toGovernanceDependency(ref, documents, rootDir),
  );
  const governance = evaluateWorkItemGovernance({
    id,
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    tags,
    archived: document.archived || lifecycle === "archived",
    ...(statusReason ? { statusReason } : {}),
    ...(completedDate ? { completedDate } : {}),
    links,
    dependencies,
  });
  const runtime = await loadTaskRuntimeReadiness({
    rootDir,
    taskId: governance.record.id,
    markdownReady: governance.readiness.ready,
  });
  const subject: BacklogReviewSubject = {
    type: "work-item",
    id: governance.record.id || document.relativePath,
    ref: asString(frontmatter.id)
      ? `[[${governance.record.id || document.relativePath}]]`
      : document.relativePath,
    ...(title ? { title } : {}),
    group: document.archived ? "archive" : "backlog",
    metadata: {
      filePath: document.relativePath,
      archived: document.archived || lifecycle === "archived",
      parseError: null,
      rawType: asString(frontmatter.type) ?? null,
      rawId: asString(frontmatter.id) ?? null,
      rawTitle: title ?? null,
      rawStatus: status || null,
      rawLifecycle: lifecycle || null,
      rawTags: tags,
      dependencyRefs,
      governance: governance as unknown as JsonRecord,
      runtime: runtime as unknown as JsonRecord,
    },
  };
  return { subject, governance, runtime };
}

function makeFinding(
  subject: EvaluationSubject,
  checkId: string,
  reasonCode: ExtendedBacklogReviewReasonCode,
  message: string,
  details?: JsonRecord,
): BacklogReviewFinding {
  const isErrorReason = ["invalid", "archived", "closed"].includes(reasonCode);
  const isBlockingReason = [
    "dependency_blocked",
    "dependency_state_unknown",
    "hitl",
    "missing_classification",
    "not_active",
    "not_ready",
  ].includes(reasonCode);
  const severity = isErrorReason ? "error" : "warn";
  const blocking = isErrorReason || isBlockingReason;
  const disposition = blocking ? "blocked" : "warn";
  return createFinding({
    subject,
    checkId,
    disposition,
    severity,
    reasonCode,
    evidence: [
      {
        ref: subject.ref ?? subject.id,
        ...(subject.title ? { label: subject.title } : {}),
      },
    ],
    blocking,
    message,
    ...(details ? { details } : {}),
  });
}

function subjectMetadata(subject: EvaluationSubject): BacklogReviewSubjectMetadata {
  if (!subject.metadata) {
    throw new Error(`Backlog review subject '${subject.id}' is missing metadata.`);
  }
  return subject.metadata as BacklogReviewSubjectMetadata;
}

function addReasonFindings(
  subject: EvaluationSubject,
  checkId: string,
  reasons: readonly WorkItemGovernanceReason[],
): BacklogReviewFinding[] {
  return reasons.map((entry) =>
    makeFinding(
      subject,
      checkId,
      entry.code,
      entry.message,
      entry.details as JsonRecord | undefined,
    ),
  );
}

interface ReasonProfileConfig {
  idSuffix: "lifecycle" | "classification" | "dependencies" | "evidence";
  label: string;
  checkId: string;
  summaryKey:
    | "lifecycleFindingCount"
    | "classificationFindingCount"
    | "dependencyFindingCount"
    | "evidenceFindingCount";
  selectReasons: (governance: WorkItemGovernanceVerdict) => readonly WorkItemGovernanceReason[];
}

function createReasonProfile(config: ReasonProfileConfig) {
  return createReviewProfile({
    id: `${BACKLOG_REVIEW_PROFILE_ID}/${config.idSuffix}`,
    label: config.label,
    checks: [
      Object.assign(
        async ({ subject }: { subject: EvaluationSubject }) => {
          const metadata = subjectMetadata(subject);
          const governance = getGovernance(metadata);
          if (!governance) {
            return { findings: [] };
          }
          return {
            findings: addReasonFindings(
              subject,
              config.checkId,
              config.selectReasons(governance),
            ),
          };
        },
        { id: config.checkId },
      ),
    ],
    summaryRules: [
      {
        key: config.summaryKey,
        compute: (findings) =>
          findings.filter((finding) => finding.checkId === config.checkId).length,
      },
    ],
  });
}

const createLifecycleProfile = () =>
  createReasonProfile({
    idSuffix: "lifecycle",
    label: "Backlog lifecycle checks",
    checkId: "backlog.lifecycle",
    summaryKey: "lifecycleFindingCount",
    selectReasons: (governance) => governance.lifecycle.reasons,
  });

const createClassificationProfile = () =>
  createReasonProfile({
    idSuffix: "classification",
    label: "Backlog classification checks",
    checkId: "backlog.classification",
    summaryKey: "classificationFindingCount",
    selectReasons: (governance) => governance.classification.reasons,
  });

const createDependencyProfile = () =>
  createReasonProfile({
    idSuffix: "dependencies",
    label: "Backlog dependency checks",
    checkId: "backlog.dependencies",
    summaryKey: "dependencyFindingCount",
    selectReasons: (governance) => governance.dependencies.reasons,
  });

const createEvidenceProfile = () =>
  createReasonProfile({
    idSuffix: "evidence",
    label: "Backlog evidence checks",
    checkId: "backlog.evidence",
    summaryKey: "evidenceFindingCount",
    selectReasons: (governance) => governance.evidence.reasons,
  });

function createRuntimeProfile() {
  return createReviewProfile({
    id: `${BACKLOG_REVIEW_PROFILE_ID}/runtime`,
    label: "Backlog runtime checks",
    checks: [
      Object.assign(
        async ({ subject }: { subject: EvaluationSubject }) => {
          const metadata = subjectMetadata(subject);
          const runtime = metadata.runtime as TaskRuntimeReadiness | null;
          if (!runtime || runtime.executionReady) {
            return { findings: [] };
          }
          return {
            findings: [
              makeFinding(
                subject,
                "backlog.runtime",
                "execution_not_ready",
                "Task's latest execution log entry is not ready-permitting.",
                { runtime: runtime as unknown as JsonRecord },
              ),
            ],
          };
        },
        { id: "backlog.runtime" },
      ),
    ],
    summaryRules: [
      {
        key: "runtimeFindingCount",
        compute: (findings) =>
          findings.filter((finding) => finding.checkId === "backlog.runtime").length,
      },
    ],
  });
}

export const backlogReviewProfile = composeReviewProfile({
  id: BACKLOG_REVIEW_PROFILE_ID,
  label: "Deterministic Backlog Review Profile",
  description: "Deterministic Work Item backlog review built from shared checks.",
  profiles: [
    createLifecycleProfile(),
    createClassificationProfile(),
    createDependencyProfile(),
    createEvidenceProfile(),
    createRuntimeProfile(),
  ],
});

export const backlogReviewRegistry = (() => {
  const registry = createReviewProfileRegistry<typeof backlogReviewProfile>();
  registry.register(backlogReviewProfile);
  return registry;
})();

function groupFindingsBy<T>(
  findings: readonly BacklogReviewFinding[],
  selector: (finding: BacklogReviewFinding) => T,
): readonly { key: T; findings: readonly BacklogReviewFinding[] }[] {
  const groups = new Map<T, BacklogReviewFinding[]>();
  for (const finding of findings) {
    const key = selector(finding);
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    findings: group,
  }));
}

function sortByKey<T extends { key: string | number }>(
  items: readonly T[],
): readonly T[] {
  return [...items].sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function severityBucket(findings: readonly BacklogReviewFinding[]): BacklogReviewSubjectReport["findingsBySeverity"] {
  return {
    error: findings.filter((finding) => finding.severity === "error"),
    warn: findings.filter((finding) => finding.severity === "warn"),
    info: findings.filter((finding) => finding.severity === "info"),
  };
}

function blockingBucket(
  findings: readonly BacklogReviewFinding[],
): BacklogReviewSubjectReport["findingsByBlocking"] {
  return {
    blocking: findings.filter((finding) => finding.blocking),
    nonBlocking: findings.filter((finding) => !finding.blocking),
  };
}

function hasReason(
  governance: WorkItemGovernanceVerdict | null,
  code: BacklogReviewReasonCode,
): boolean {
  if (!governance) {
    return false;
  }
  return [
    ...governance.lifecycle.reasons,
    ...governance.classification.reasons,
    ...governance.dependencies.reasons,
    ...governance.evidence.reasons,
    ...governance.readiness.reasons,
  ].some((reason) => reason.code === code);
}

function subjectCategories(metadata: BacklogReviewSubjectMetadata): BacklogReviewSubjectReport["verdict"]["categories"] {
  const governance = getGovernance(metadata);
  const runtime = getRuntime(metadata);
  return {
    invalid: Boolean(metadata.parseError) || Boolean(governance && !governance.lifecycle.valid),
    archived: Boolean(governance?.lifecycle.isArchived),
    closed: Boolean(governance?.lifecycle.isClosed),
    hitl: Boolean(governance?.classification.isHitl),
    missingClassification: hasReason(governance, "missing_classification"),
    dependencyBlocked: hasReason(governance, "dependency_blocked"),
    dependencyStateUnknown: hasReason(governance, "dependency_state_unknown"),
    runtimeBlocked: Boolean(runtime && !runtime.executionReady),
    evidenceIncomplete: hasReason(governance, "missing_evidence") || hasReason(governance, "missing_status_reason") || hasReason(governance, "missing_completed_date"),
  };
}

function subjectCandidate(metadata: BacklogReviewSubjectMetadata): boolean {
  const governance = getGovernance(metadata);
  const runtime = getRuntime(metadata);
  return Boolean(
    governance &&
      governance.readiness.ready &&
      governance.lifecycle.valid &&
      governance.classification.isAfk &&
      !governance.classification.isHitl &&
      governance.dependencies.satisfied &&
      governance.evidence.ready &&
      runtime?.ready,
  );
}

function sortIds(values: readonly string[]): readonly string[] {
  return collectSortedStrings(values);
}

function summarizeReport(
  subjects: readonly BacklogReviewSubject[],
  findings: readonly BacklogReviewFinding[],
): BacklogReviewSummary {
  const grouped = subjects.map((subject) => {
    const metadata = subjectMetadata(subject);
    const categories = subjectCategories(metadata);
    const candidate = subjectCandidate(metadata);
    return {
      subject,
      metadata,
      categories,
      candidate,
    };
  });

  const candidateIds = sortIds(
    grouped.filter((entry) => entry.candidate).map((entry) => entry.subject.id),
  );
  const excludedIds = sortIds(
    grouped.filter((entry) => !entry.candidate).map((entry) => entry.subject.id),
  );
  const invalidIds = sortIds(
    grouped.filter((entry) => entry.categories.invalid).map((entry) => entry.subject.id),
  );
  const archivedIds = sortIds(
    grouped.filter((entry) => entry.categories.archived).map((entry) => entry.subject.id),
  );
  const closedIds = sortIds(
    grouped.filter((entry) => entry.categories.closed).map((entry) => entry.subject.id),
  );
  const hitlIds = sortIds(
    grouped.filter((entry) => entry.categories.hitl).map((entry) => entry.subject.id),
  );
  const missingClassificationIds = sortIds(
    grouped
      .filter((entry) => entry.categories.missingClassification)
      .map((entry) => entry.subject.id),
  );
  const dependencyBlockedIds = sortIds(
    grouped
      .filter((entry) => entry.categories.dependencyBlocked)
      .map((entry) => entry.subject.id),
  );
  const dependencyStateUnknownIds = sortIds(
    grouped
      .filter((entry) => entry.categories.dependencyStateUnknown)
      .map((entry) => entry.subject.id),
  );
  const runtimeBlockedIds = sortIds(
    grouped
      .filter((entry) => entry.categories.runtimeBlocked)
      .map((entry) => entry.subject.id),
  );
  const evidenceIncompleteIds = sortIds(
    grouped
      .filter((entry) => entry.categories.evidenceIncomplete)
      .map((entry) => entry.subject.id),
  );

  const blockingFindings = findings.filter((finding) => finding.blocking);
  const severityCounts = {
    error: findings.filter((finding) => finding.severity === "error").length,
    warn: findings.filter((finding) => finding.severity === "warn").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };

  return {
    counts: {
      subjects: subjects.length,
      candidates: candidateIds.length,
      excluded: excludedIds.length,
      findings: findings.length,
      blockingFindings: blockingFindings.length,
      errorFindings: severityCounts.error,
      warnFindings: severityCounts.warn,
      infoFindings: severityCounts.info,
      invalidSubjects: invalidIds.length,
      archivedSubjects: archivedIds.length,
      closedSubjects: closedIds.length,
      hitlSubjects: hitlIds.length,
      missingClassificationSubjects: missingClassificationIds.length,
      dependencyBlockedSubjects: dependencyBlockedIds.length,
      dependencyStateUnknownSubjects: dependencyStateUnknownIds.length,
      runtimeBlockedSubjects: runtimeBlockedIds.length,
      evidenceIncompleteSubjects: evidenceIncompleteIds.length,
    },
    candidateIds,
    excludedIds,
    invalidIds,
    archivedIds,
    closedIds,
    hitlIds,
    missingClassificationIds,
    dependencyBlockedIds,
    dependencyStateUnknownIds,
    runtimeBlockedIds,
    evidenceIncompleteIds,
  };
}

function subjectReport(
  subject: BacklogReviewSubject,
  findings: readonly BacklogReviewFinding[],
): BacklogReviewSubjectReport {
  const byCheck = sortByKey(
    groupFindingsBy(findings, (finding) => finding.checkId).map((entry) => ({
      key: entry.key,
      findings: entry.findings,
    })),
  );
  const metadata = subjectMetadata(subject);
  const categories = subjectCategories(metadata);
  const candidate = subjectCandidate(metadata);
  return {
    subject,
    findings,
    findingsByCheck: byCheck.map((entry) => ({
      checkId: String(entry.key),
      findings: entry.findings,
    })),
    findingsBySeverity: severityBucket(findings),
    findingsByBlocking: blockingBucket(findings),
    verdict: {
      candidate,
      excluded: !candidate,
      reasons: findings.map((finding) => finding.reasonCode),
      categories,
    },
  };
}

export function formatBacklogReviewReportJson(report: BacklogReviewReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatBacklogReviewReportText(report: BacklogReviewReport): string {
  const lines: string[] = [];
  lines.push("Backlog Review Report");
  lines.push(`  Generated : ${report.generatedAt}`);
  lines.push(`  Profile   : ${report.profile.id}`);
  lines.push(`  Subjects  : ${report.summary.counts.subjects}`);
  lines.push(`  Candidates: ${report.summary.counts.candidates}`);
  lines.push(`  Excluded  : ${report.summary.counts.excluded}`);
  lines.push(`  Findings  : ${report.summary.counts.findings}`);
  lines.push("");
  lines.push("Candidate IDs:");
  lines.push(report.summary.candidateIds.length > 0 ? `- ${report.summary.candidateIds.join(", ")}` : "- None");
  lines.push("Excluded IDs:");
  lines.push(report.summary.excludedIds.length > 0 ? `- ${report.summary.excludedIds.join(", ")}` : "- None");
  lines.push("");
  for (const subject of report.subjects) {
    lines.push(`${subject.subject.id} | ${subject.verdict.candidate ? "candidate" : "excluded"}`);
    for (const byCheck of subject.findingsByCheck) {
      lines.push(`  ${byCheck.checkId}: ${byCheck.findings.length}`);
    }
  }
  return lines.join("\n");
}

export async function runBacklogReview(
  options: BacklogReviewOptions = {},
): Promise<BacklogReviewReport> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = options.backlogDir ?? "backlog";
  const documents = await readReviewDocuments(rootDir, backlogDir);
  const subjects: BacklogReviewSubject[] = [];

  for (const document of documents) {
    const result = await buildGovernanceRecord(document, documents, rootDir);
    if (!result) {
      continue;
    }
    subjects.push(result.subject);
  }

  const executionId =
    options.executionId ??
    `backlog-review:${collectSortedStrings(subjects.map((subject) => subject.id)).join("|") || "empty"}`;
  const executed = await executeReviewProfile(backlogReviewProfile, {
    executionId,
    subjects,
    context: { rootDir, backlogDir },
    startedAt: options.startedAt ?? DETERMINISTIC_REVIEW_TIMESTAMP,
    completedAt: options.completedAt ?? DETERMINISTIC_REVIEW_TIMESTAMP,
  });

  const subjectReports = subjects
    .map((subject) => {
      const findings = executed.findings.filter((finding) => finding.subject.id === subject.id);
      return subjectReport(subject, findings);
    })
    .sort((left, right) => left.subject.id.localeCompare(right.subject.id));

  const summary = summarizeReport(subjects, executed.findings);

  return {
    schemaVersion: "backlog-review/v1",
    profile: executed.profile,
    execution: executed.execution,
    generatedAt: executed.generatedAt,
    summary,
    subjects: subjectReports,
    findings: executed.findings,
  };
}

export function createBacklogReviewRegistry() {
  const registry = createReviewProfileRegistry<typeof backlogReviewProfile>();
  registry.register(backlogReviewProfile);
  return registry;
}

export type { BacklogReviewReasonCode, ExtendedBacklogReviewReasonCode };
export { BACKLOG_REVIEW_REASON_CODES };
