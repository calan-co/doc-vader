import matter from "gray-matter";
import yaml from "js-yaml";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { SubjectResolverName } from "../backlog/scan-types.js";
import {
  normalizePullRequestPath,
  normalizeRequiredFieldRules,
  normalizeWorkItemMatchPatterns,
  type RequiredFieldRule,
} from "../backlog/configurable-rules.js";
import { getProviderForForge } from "../backlog/provider-registry.js";
import type { BacklogAutomationProvider } from "../backlog/provider.js";
import {
  auditRuntimeClaimCoverage,
  completeRuntimeClaimExecutionForTask,
  createRuntimeClaimPackage,
  RuntimeClaimSqliteDataAdapter,
} from "../runtime-claim/index.js";
import type {
  RuntimeChangedFileAuditResult,
  RuntimeClaimAuditTrace,
  RuntimeClaimCoverageAuditTrace,
  RuntimeExecutionTerminalResult,
} from "../runtime/index.js";
import { TaskCommandError } from "../task/errors.js";
import { validateRecordPayload, type RecordPayload } from "../task/record.js";
import { loadDocVaderConfig } from "../config/loader.js";
import { loadDocumentTypePackRegistry } from "../document-type-packs/registry.js";
import {
  resolveWorkManagementChecklistDefinitions,
  workManagementDocumentTypePack,
} from "./checklist-definitions.js";
import { WorkItemCompletionGate } from "./completion-gate.js";
import {
  evaluateTransition,
  resolveDefaultWorkItemState,
} from "./frontmatter-lint.js";
import {
  allowPolicyDecision,
  type GatePolicy,
  type PolicyDecision,
} from "./policies.js";
import {
  evaluateWorkItemCompletion,
  mutateMarkdownQualifierLeaf,
  projectMarkdownChecklists,
  projectWorkItemQualifiers,
  WorkItemCompletionQualifierError,
  type CompletionQualifierBlocker,
  type QualifierStatus,
  type WorkItemQualifierProjection,
} from "./qualifiers.js";
import {
  normalizeEvidenceLinks,
  validateTerminalMetadata,
} from "./terminal-metadata.js";
import { Saga, SagaOrchestrator, SagaStore, createFileCommand } from "./saga.js";

export * from "./policies.js";
export { WorkItemCompletionGate } from "./completion-gate.js";

export type LinkKind = "pr" | "evidence" | "reference";
export type ForgeProvider = "github" | "gitlab" | "bitbucket" | "subversion";

type Frontmatter = Record<string, unknown>;

interface MarkdownDocument {
  filePath: string;
  raw: string;
  frontmatter: Frontmatter;
  body: string;
}

interface WorkItemCompletionContext {
  readonly rootDir: string;
  readonly document: MarkdownDocument;
  readonly targetStatus: string;
  readonly requestedStatus: string;
  readonly targetStatusReason: string;
  readonly candidateFrontmatter: Frontmatter;
  readonly requiredPaths: readonly string[];
  readonly claimToken?: string;
  readonly authorizeClaim: boolean;
  readonly mode: "transition" | "finalize";
  readonly checklistDefinitions: Parameters<typeof evaluateWorkItemCompletion>[1];
}

interface ConsumerRoots {
  backlog: string;
  active: string;
  archive: string;
  records: string;
  audit?: string;
}

interface ConsumerAutomation {
  autoCloseOnMerge?: boolean;
  autoEvidenceFromWorkflowRuns?: boolean;
  preserveCommitMap?: boolean;
  subjectResolutionOrder?: SubjectResolverName[];
  validateArchiveCandidates?: boolean;
  invalidCandidateStatus?: string;
  workItemMatchPatterns?: string[];
  pullRequestPath?: string;
  requiredCandidateFields?: Array<string | RequiredFieldRule>;
}

interface ConsumerMigration {
  legacyActive?: string;
  legacyArchive?: string;
}

interface ResolvedConsumerConfig {
  roots: ConsumerRoots;
  automation: Required<
    Omit<
      ConsumerAutomation,
      "subjectResolutionOrder" | "invalidCandidateStatus"
    >
  > &
    Pick<
      ConsumerAutomation,
      "subjectResolutionOrder" | "invalidCandidateStatus"
    >;
  migration: Required<ConsumerMigration>;
}

export interface ConsumerConfig {
  roots?: Partial<ConsumerRoots>;
  automation?: ConsumerAutomation;
  migration?: ConsumerMigration;
}

export interface TransitionWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  status: string;
  statusReason?: string;
  actual?: number;
  /** Remove an optional estimate as part of this same validated update. */
  clearEstimated?: boolean;
  assignee?: string;
  /** Exact active runtime claim required when the target is claimed. */
  claimToken?: string;
  /** Claimed-path coverage facts produced by a guarded authorization preflight. */
  claimedPathAudit?: RuntimeChangedFileAuditResult;
  dryRun?: boolean;
}

export interface LinkWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  kind: LinkKind;
  value: string;
  /** Exact active runtime claim required when the target is claimed. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface RecordCommitOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  sha: string;
  summary: string;
  /** Exact active runtime claim required when the target is claimed. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface CreateRecordOptions {
  rootDir?: string;
  consumerConfig?: string;
  id?: string;
  summary: string;
  subtype?: string;
  status?: string;
  statusReason?: string;
  outcome?: string;
  recordedAt?: string;
  observation: string;
  findings?: string[];
  notes?: string[];
  subjects: string[];
  artifactRefs?: string[];
  supportingRefs?: string[];
  /** Exact active runtime Claim token when a subject resolves to claimed Work. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface FinalizeWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  pullRequestPath?: string;
  provider?: BacklogAutomationProvider;
  statusReason?: string;
  actual?: number;
  /** Exact active runtime claim required when the target is claimed. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface MigrateBacklogOptions {
  rootDir?: string;
  consumerConfig?: string;
  dir?: string;
  /** Exact active Claim token when a migrated Work Item is claimed. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface IngestEventOptions {
  rootDir?: string;
  consumerConfig?: string;
  provider: ForgeProvider;
  event: string;
  payloadPath: string;
  /** Exact active Claim token for each event subject that is actively claimed. */
  claimToken?: string;
  dryRun?: boolean;
}

export interface TransitionWorkItemResult {
  id: string;
  filePath: string;
  frontmatter: Frontmatter;
  dryRun: boolean;
  /** Claim lifecycle completion for a successful terminal mutation. */
  execution?: RuntimeExecutionTerminalResult;
}

export interface LinkWorkItemResult extends TransitionWorkItemResult {
  kind: LinkKind;
  value: string;
}

export interface RecordCommitResult extends TransitionWorkItemResult {
  sha: string;
}

export interface CreateRecordResult {
  id: string;
  filePath: string;
  frontmatter: Frontmatter;
  body: string;
  dryRun: boolean;
}

export interface FinalizeWorkItemResult extends TransitionWorkItemResult {
  archivePath: string;
}

export interface MigrationRecord {
  legacyPath: string;
  newPath: string;
  legacyId: string | null;
  newId: string;
  generatedRecords: string[];
}

export interface MigrateBacklogResult {
  dryRun: boolean;
  migrated: MigrationRecord[];
  basenameMap: Record<string, string>;
}

export interface IngestEventResult {
  provider: ForgeProvider;
  event: string;
  dryRun: boolean;
  subjects: string[];
  actions: Array<Record<string, unknown>>;
}

const DEFAULT_ROOTS: ConsumerRoots = {
  backlog: "backlog",
  active: "backlog/active",
  archive: "backlog/archive",
  records: "backlog/records",
  audit: "backlog/audit",
};

const FRONTMATTER_ORDER = [
  "$schema",
  "$template",
  "id",
  "title",
  "summary",
  "owner",
  "assignee",
  "type",
  "subtype",
  "lifecycle",
  "status",
  "status_reason",
  "priority",
  "estimated",
  "actual",
  "completed_date",
  "commits",
  "links",
  "tags",
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

function ensureArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isWithinPath(child: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function inferStatusReason(status: string): string {
  switch (status) {
    case "draft":
      return "needs-triage";
    case "ready":
      return "auto";
    case "running":
      return "implementation";
    case "paused":
      return "blocked";
    case "completed":
      return "completed";
    case "aborted":
      return "cancelled";
    default:
      return "recorded";
  }
}

function inferLifecycle(status: string, archived: boolean): string {
  if (archived || ["completed", "aborted"].includes(status)) {
    return "inactive";
  }
  if (status === "draft") {
    return "draft";
  }
  return "active";
}

function normalizeRawStatus(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "ready";
  }
  return value.trim().toLowerCase();
}

function normalizeStatus(value: unknown): string {
  const status = normalizeRawStatus(value);
  return status === "closed" ? "completed" : status;
}

function hasEvidenceLinks(frontmatter: Frontmatter): boolean {
  return normalizeEvidenceLinks(frontmatter).length > 0;
}

function appendTerminalEvidenceNote(
  document: MarkdownDocument,
  statusReason: string,
  completedDate: string,
): void {
  const note = `- ${completedDate}: Closed as ${statusReason} with evidence in backlog/audit/auditing-backlog-report.json.`;
  if (document.body.includes(note)) {
    return;
  }
  document.body = `${document.body.trimEnd()}\n\n${note}\n`;
}

function normalizeLifecycle(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

export function authorizeWorkMutation(options: {
  rootDir: string;
  taskId: string;
  claimToken?: string;
  requiredPaths: string[];
  claimedPathAudit?: RuntimeChangedFileAuditResult;
}): void {
  const decision = createRuntimeClaimPackage({ rootDir: options.rootDir })
    .createAuthorityGatePolicy().evaluate({
    rootDir: options.rootDir,
    targetType: "task",
    targetId: options.taskId,
    claimToken: options.claimToken,
    requiredPaths: options.requiredPaths,
    ...(options.claimedPathAudit
      ? { claimedPathAudit: options.claimedPathAudit }
      : {}),
    authorizeClaim: true,
  });
  if (!decision.allowed) {
    throw new TaskCommandError(
      decision.code ?? "RUNTIME_CLAIM_AUTHORITY_BLOCKED",
      decision.message ?? "Runtime claim authority blocked this mutation.",
      decision.details ? { ...decision.details } : undefined,
    );
  }
}

function authorizeWorkItemSagaRecovery(rootDir: string, taskId: string, claimToken: string | undefined): void {
  const claim = new RuntimeClaimSqliteDataAdapter({ rootDir }).getClaimByTarget("task", taskId);
  if (!claim || claim.state !== "active" || claim.claim_token !== claimToken) {
    throw new TaskCommandError(
      "WORK_MUTATION_CLAIM_REQUIRED",
      `Saga recovery for '${taskId}' requires its exact active claim token.`,
      { taskId, ...(claim ? { expectedClaimToken: claim.claim_token, providedClaimToken: claimToken } : {}) },
    );
  }
}

function createWorkItemSagaOrchestrator(store: SagaStore, rootDir: string): SagaOrchestrator {
  return new SagaOrchestrator(store, {
    authorize(authority, instance) {
      authorizeWorkItemSagaRecovery(rootDir, authority.taskId, authority.claimToken);
      authorizeWorkMutation({
        rootDir,
        taskId: authority.taskId,
        claimToken: authority.claimToken,
        requiredPaths: instance.commands.map((command) => command.targetPath),
      });
    },
  });
}

export async function runRuntimeClaimCoverageAudit(options: {
  rootDir: string;
  taskId: string;
  claimToken?: string;
  requiredPaths: string[];
  mergeTargetRef?: string;
  auditTrace?: RuntimeClaimAuditTrace;
  /** Opt-in test/benchmark tracing for the complete changed-file coverage audit. */
  fullAuditTrace?: RuntimeClaimCoverageAuditTrace;
}): Promise<RuntimeChangedFileAuditResult> {
  const audit = () => auditRuntimeClaimCoverage({
    rootDir: options.rootDir,
    targetType: "task",
    targetId: options.taskId,
    claimToken: options.claimToken,
    requiredPaths: options.requiredPaths,
    mergeTargetRef: options.mergeTargetRef,
    auditTrace: options.auditTrace,
    fullAuditTrace: options.fullAuditTrace,
  });
  return options.fullAuditTrace?.traceAsync
    ? options.fullAuditTrace.traceAsync("fullAudit", audit)
    : audit();
}

function completionQualifierDecision(
  context: WorkItemCompletionContext,
): PolicyDecision {
  const { document, targetStatus } = context;
  const policyId = "work-item-completion-qualifier";
  if (targetStatus !== "completed") {
    return allowPolicyDecision(policyId);
  }

  const completion = evaluateWorkItemCompletion(
    document.raw,
    context.checklistDefinitions,
  );
  const blockers: CompletionQualifierBlocker[] = completion.children.flatMap(
    (scope) => [
      ...scope.children
        .filter((qualifier) => qualifier.status === "unmet")
        .map((qualifier) => ({
          scope: scope.scope,
          status: qualifier.status,
          id: qualifier.id,
          label: qualifier.label,
        })),
      ...(scope.status === "indeterminate"
        ? [{ scope: scope.scope, status: scope.status }]
        : []),
    ],
  );

  if (blockers.length === 0) {
    return allowPolicyDecision(policyId);
  }

  const checklistHeadingById = new Map(
    (context.checklistDefinitions ?? resolveWorkManagementChecklistDefinitions()).map((definition) => [
      definition.id,
      definition.heading,
    ]),
  );
  const issues = blockers.map((blocker) => {
    const scope = checklistHeadingById.get(blocker.scope) ?? blocker.scope;
    return blocker.label
      ? `${scope}: ${blocker.label}`
      : `${scope}: required completion scope is empty or unknown`;
  });
  return {
    policyId,
    allowed: false,
    code: "WORK_ITEM_COMPLETION_QUALIFIERS_BLOCKED",
    message: `Cannot transition '${String(
      document.frontmatter.id ?? path.basename(document.filePath),
    )}' to '${targetStatus}' with unchecked completion criteria:\n- ${issues.join(
      "\n- ",
    )}`,
    details: { status: completion.status, blockers },
  };
}

function transitionLifecycleDecision(
  frontmatter: Frontmatter,
  targetStatus: string,
  targetStatusReason: string,
): PolicyDecision {
  const policyId = "work-item-completion-lifecycle";
  const fromStatus = normalizeStatus(frontmatter.status);
  const fromStatusReason =
    typeof frontmatter.status_reason === "string" &&
    frontmatter.status_reason.trim().length > 0
      ? frontmatter.status_reason.trim()
      : inferStatusReason(fromStatus);

  if (fromStatus === targetStatus) {
    return allowPolicyDecision(policyId);
  }

  let evaluation: ReturnType<typeof evaluateTransition>;
  try {
    evaluation = evaluateTransition(
      { status: fromStatus, status_reason: fromStatusReason },
      { status: targetStatus, status_reason: targetStatusReason },
    );
  } catch (error) {
    return {
      policyId,
      allowed: false,
      code: "WORK_UPDATE_INVALID_TRANSITION",
      message: error instanceof Error ? error.message : String(error),
      details: {
        fromStatus,
        fromStatusReason,
        toStatus: targetStatus,
        toStatusReason: targetStatusReason,
      },
    };
  }

  if (evaluation.allowed) {
    return allowPolicyDecision(policyId);
  }
  return {
    policyId,
    allowed: false,
    code: "WORK_UPDATE_INVALID_TRANSITION",
    message: `Transition from '${fromStatus}' to '${targetStatus}' with status_reason '${targetStatusReason}' is not allowed by the work-management profile.`,
    details: {
      fromStatus,
      fromStatusReason,
      toStatus: targetStatus,
      toStatusReason: targetStatusReason,
    },
  };
}

function createWorkItemCompletionGate(): WorkItemCompletionGate<WorkItemCompletionContext> {
  const qualifierPolicy: GatePolicy<WorkItemCompletionContext> = {
    id: "work-item-completion-qualifier",
    evaluate: (context) =>
      completionQualifierDecision(context),
  };
  const evidencePolicy: GatePolicy<WorkItemCompletionContext> = {
    id: "work-item-completion-evidence",
    evaluate: (context) => {
      if (context.mode === "finalize") {
        return hasEvidenceLinks(context.document.frontmatter)
          ? allowPolicyDecision("work-item-completion-evidence")
          : {
              policyId: "work-item-completion-evidence",
              allowed: false,
              code: "WORK_ITEM_COMPLETION_EVIDENCE_BLOCKED",
              message: `Cannot finalize '${String(context.document.frontmatter.id)}' without linked evidence.`,
            };
      }
      const terminalMetadata = validateTerminalMetadata(context.candidateFrontmatter);
      return terminalMetadata.valid
        ? allowPolicyDecision("work-item-completion-evidence")
        : {
            policyId: "work-item-completion-evidence",
            allowed: false,
            code: "WORK_UPDATE_CLOSED_METADATA_REQUIRED",
            message: `Transitioning to '${context.targetStatus}' requires schema-valid terminal metadata before mutation: provide a schema-compatible --status_reason, actual effort unless this is an unestimated AFK item, and links.evidence as a non-empty array of schema-valid links (for example: links.evidence: ['[[record-id]]']).`,
            details: {
              requestedStatus: context.requestedStatus,
              canonicalStatus: context.targetStatus,
              required: ["actual", "links.evidence"],
              missing: terminalMetadata.missing,
              schemaErrors: terminalMetadata.schemaErrors,
              flags: ["--actual <number>", "--clear-estimated"],
            },
          };
    },
  };
  const lifecyclePolicy: GatePolicy<WorkItemCompletionContext> = {
    id: "work-item-completion-lifecycle",
    evaluate: (context) => {
      if (context.mode === "transition") {
        return transitionLifecycleDecision(
          context.document.frontmatter,
          context.targetStatus,
          context.targetStatusReason,
        );
      }
      const currentStatus = normalizeStatus(context.document.frontmatter.status);
      const currentLifecycle = normalizeLifecycle(context.document.frontmatter.lifecycle);
      if (currentStatus !== "completed") {
        return {
          policyId: "work-item-completion-lifecycle",
          allowed: false,
          code: "WORK_ITEM_FINALIZE_STATUS_REQUIRED",
          message: `Cannot finalize '${String(context.document.frontmatter.id)}' from status '${currentStatus}'. Expected completed.`,
        };
      }
      if (currentLifecycle !== "active") {
        return {
          policyId: "work-item-completion-lifecycle",
          allowed: false,
          code: "WORK_ITEM_FINALIZE_LIFECYCLE_REQUIRED",
          message: `Cannot finalize '${String(context.document.frontmatter.id)}' from lifecycle '${currentLifecycle || "(missing)"}'. Expected active.`,
        };
      }
      return allowPolicyDecision("work-item-completion-lifecycle");
    },
  };
  const claimAuthorityPolicy: GatePolicy<WorkItemCompletionContext> = {
    id: "runtime-claim-authority",
    evaluate: (context) =>
      createRuntimeClaimPackage({ rootDir: context.rootDir })
        .createAuthorityGatePolicy().evaluate({
        rootDir: context.rootDir,
        targetType: "task",
        targetId: String(context.document.frontmatter.id),
        claimToken: context.claimToken,
        requiredPaths: context.requiredPaths,
        authorizeClaim: context.authorizeClaim,
      }),
  };
  return new WorkItemCompletionGate({
    qualifierPolicy,
    evidencePolicy,
    lifecyclePolicy,
    claimAuthorityPolicy,
  });
}

function assertWorkItemCompletionAllowed(
  context: WorkItemCompletionContext,
): void {
  const decision = createWorkItemCompletionGate().evaluate(context);
  if (decision.allowed) {
    return;
  }
  const blocker = decision.children?.find((child) => !child.allowed) ?? decision;
  if (blocker.code === "WORK_ITEM_COMPLETION_QUALIFIERS_BLOCKED") {
    throw new WorkItemCompletionQualifierError(blocker.message ?? "Completion qualifiers blocked.", {
      status: blocker.details?.status as QualifierStatus,
      blockers: (blocker.details?.blockers ?? []) as CompletionQualifierBlocker[],
    });
  }
  if (
    context.mode === "finalize" &&
    [
      "WORK_ITEM_COMPLETION_EVIDENCE_BLOCKED",
      "WORK_ITEM_FINALIZE_STATUS_REQUIRED",
      "WORK_ITEM_FINALIZE_LIFECYCLE_REQUIRED",
    ].includes(blocker.code ?? "")
  ) {
    throw new Error(blocker.message ?? "Work item completion was blocked.");
  }
  if (blocker.code) {
    throw new TaskCommandError(
      blocker.code,
      blocker.message ?? "Work item completion was blocked.",
      blocker.details ? { ...blocker.details } : undefined,
    );
  }
  throw new Error(blocker.message ?? "Work item completion was blocked.");
}

function normalizeSha(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalAssignee(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLegacyCommitMap(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(
    value as Record<string, unknown>,
  ).reduce<Array<readonly [string, string]>>((entries, [sha, summary]) => {
    if (!/^[0-9a-f]{7,40}$/i.test(sha.trim())) {
      return entries;
    }
    if (typeof summary !== "string") {
      return entries;
    }
    const trimmedSummary = summary.trim();
    if (trimmedSummary.length === 0) {
      return entries;
    }
    entries.push([normalizeSha(sha), trimmedSummary] as const);
    return entries;
  }, []);

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeLink(kind: LinkKind, value: string): string {
  const trimmed = value.trim();
  if (kind === "pr") {
    return trimmed;
  }
  if (/^\[\[[^\]]+\]\]$/.test(trimmed)) {
    return trimmed;
  }
  if (/^(https?:)?\/\//.test(trimmed) || /^mailto:/.test(trimmed)) {
    return trimmed;
  }
  const basename = stripMarkdownExtension(
    trimmed.split(/[\\/]/).pop() || trimmed,
  );
  return `[[${basename}]]`;
}

function reorderFrontmatter(frontmatter: Frontmatter): Frontmatter {
  const ordered: Frontmatter = {};
  for (const key of FRONTMATTER_ORDER) {
    if (key in frontmatter) {
      ordered[key] = frontmatter[key];
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function stringifyMarkdown(frontmatter: Frontmatter, body: string): string {
  const serialized = yaml.dump(reorderFrontmatter(frontmatter), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  return `---\n${serialized}---\n\n${body.replace(/^\s+/, "")}`;
}

async function readMarkdown(filePath: string): Promise<MarkdownDocument> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  return {
    filePath,
    raw,
    frontmatter: (parsed.data ?? {}) as Frontmatter,
    body: parsed.content,
  };
}

async function writeMarkdown(
  filePath: string,
  frontmatter: Frontmatter,
  body: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringifyMarkdown(frontmatter, body), "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
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

export async function loadConsumerConfig(
  rootDir: string,
  configPath?: string,
): Promise<ResolvedConsumerConfig> {
  const fallback: ResolvedConsumerConfig = {
    roots: { ...DEFAULT_ROOTS },
    automation: {
      autoCloseOnMerge: false,
      autoEvidenceFromWorkflowRuns: true,
      preserveCommitMap: true,
      validateArchiveCandidates: false,
      subjectResolutionOrder: undefined,
      invalidCandidateStatus: undefined,
      workItemMatchPatterns: normalizeWorkItemMatchPatterns(undefined),
      pullRequestPath: normalizePullRequestPath(undefined),
      requiredCandidateFields: normalizeRequiredFieldRules(undefined),
    },
    migration: {
      legacyActive: DEFAULT_ROOTS.backlog,
      legacyArchive: DEFAULT_ROOTS.archive,
    },
  };

  if (!configPath) {
    return fallback;
  }

  const loaded = await readJsonFile<ConsumerConfig>(
    path.resolve(rootDir, configPath),
  ).catch((err: unknown) => {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  });

  if (loaded === null) {
    return fallback;
  }
  return {
    roots: {
      ...fallback.roots,
      ...(loaded.roots ?? {}),
    },
    automation: {
      ...fallback.automation,
      ...(loaded.automation ?? {}),
      workItemMatchPatterns: normalizeWorkItemMatchPatterns(
        loaded.automation?.workItemMatchPatterns,
      ),
      pullRequestPath: normalizePullRequestPath(
        loaded.automation?.pullRequestPath,
      ),
      requiredCandidateFields: normalizeRequiredFieldRules(
        loaded.automation?.requiredCandidateFields,
      ),
    },
    migration: {
      ...fallback.migration,
      ...(loaded.migration ?? {}),
    },
  };
}

function ensureWorkItemLinks(
  frontmatter: Frontmatter,
): Record<string, unknown> {
  const rawLinks = frontmatter.links;
  const links: Record<string, unknown> = {};

  if (Array.isArray(rawLinks)) {
    for (const entry of rawLinks) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      for (const [key, value] of Object.entries(entry)) {
        if (typeof value !== "string" || value.trim().length === 0) {
          continue;
        }

        if (key === "pull_request") {
          const current = Array.isArray(links.pull_requests)
            ? (links.pull_requests as unknown[])
            : [];
          links.pull_requests = [...current, value.trim()];
          continue;
        }

        if (key === "evidence") {
          const current = Array.isArray(links.evidence)
            ? (links.evidence as unknown[])
            : [];
          links.evidence = [...current, value.trim()];
        }
      }
    }
  } else if (typeof rawLinks === "object" && rawLinks !== null) {
    Object.assign(links, rawLinks as Record<string, unknown>);
  }

  frontmatter.links = links;
  return links;
}

async function resolveChecklistDefinitionsForWorkItem(
  rootDir: string,
  document: MarkdownDocument,
) {
  const configPath = path.join(rootDir, ".doc.json");
  if (!(await pathExists(configPath))) {
    return resolveWorkManagementChecklistDefinitions();
  }
  const config = await loadDocVaderConfig(configPath);
  if (!config.documentTypePacks?.length) {
    return resolveWorkManagementChecklistDefinitions();
  }
  const namespace = typeof document.frontmatter.namespace === "string"
    ? document.frontmatter.namespace
    : config.document?.namespace ?? config.namespace;
  const type = typeof document.frontmatter.type === "string"
    ? document.frontmatter.type
    : config.document?.defaultType ?? config.defaultType;
  const subtype = typeof document.frontmatter.subtype === "string"
    ? document.frontmatter.subtype
    : config.document?.defaultSubtype ?? config.defaultSubtype;
  if (!namespace || !type) {
    throw new Error("Configured document-type packs require canonical namespace and type metadata for Work Item checklist resolution.");
  }
  const registry = await loadDocumentTypePackRegistry({
    config,
    baseDir: rootDir,
    builtIns: [workManagementDocumentTypePack],
  });
  return registry.select({ namespace, type, subtype }).checklistDefinitions;
}

export async function resolveWorkItemFile(
  rootDir: string,
  config: ResolvedConsumerConfig,
  id: string,
): Promise<string> {
  const dirs = unique([config.roots.active, config.roots.backlog, config.roots.archive])
    .map((value) => path.resolve(rootDir, value));
  for (const dirPath of dirs) {
    const files = await findMarkdownFiles(dirPath);
    for (const filePath of files) {
      const document = await readMarkdown(filePath);
      if (document.frontmatter.id === id) {
        return filePath;
      }
    }
  }
  throw new Error(`Unable to find work item '${id}'.`);
}

export interface InspectWorkItemQualifiersOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
}

export interface WorkItemQualifierInspection extends WorkItemQualifierProjection {
  readonly workItemId: string;
  readonly filePath: string;
}

export interface MutateWorkItemQualifierOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  qualifierId: string;
  status: QualifierStatus;
  /** Exact active runtime claim required when the target is claimed. */
  claimToken?: string;
}

export interface WorkItemQualifierMutation extends WorkItemQualifierProjection {
  readonly workItemId: string;
  readonly filePath: string;
}

export interface AttestWorkItemQualifierOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  qualifierId: string;
  /** Existing evidence record/reference that sanctions this attestation. */
  evidence: string;
  /** Exact active runtime Claim token when the Work Item is claimed. */
  claimToken?: string;
}

export interface WorkItemQualifierAttestation extends WorkItemQualifierMutation {
  readonly evidence: string;
}

/** Read the authoritative Markdown Work Item as a semantic qualifier projection. */
export async function inspectWorkItemQualifiers(
  options: InspectWorkItemQualifiersOptions,
): Promise<WorkItemQualifierInspection> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const definitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  return {
    workItemId: String(document.frontmatter.id),
    filePath,
    ...projectWorkItemQualifiers(document.raw, definitions),
  };
}

/**
 * Persist one current Markdown leaf qualifier without rewriting unrelated
 * frontmatter or body content.
 */
export async function attestWorkItemQualifier(
  options: AttestWorkItemQualifierOptions,
): Promise<WorkItemQualifierAttestation> {
  const evidence = options.evidence.trim();
  if (!evidence) {
    throw new TaskCommandError(
      "WORK_ITEM_ATTESTATION_EVIDENCE_REQUIRED",
      "Checklist attestation requires an evidence reference.",
      { workItemId: options.id },
    );
  }
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  authorizeWorkMutation({
    rootDir,
    taskId: options.id,
    claimToken: options.claimToken,
    requiredPaths: [filePath],
  });
  const document = await readMarkdown(filePath);
  const definitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  await assertAttestationEvidenceExists(rootDir, config, evidence);
  const checkboxMutation = mutateMarkdownQualifierLeaf({
    markdown: document.raw,
    id: options.qualifierId,
    status: "met",
    definitions,
  });
  const attested = matter(checkboxMutation.markdown);
  const links = ensureWorkItemLinks(attested.data as Frontmatter);
  links.evidence = unique([
    ...ensureArray(links.evidence),
    normalizeLink("evidence", evidence),
  ]);
  await writeMarkdown(filePath, attested.data as Frontmatter, attested.content);
  const written = await readMarkdown(filePath);
  return {
    workItemId: String(written.frontmatter.id),
    filePath,
    ...projectWorkItemQualifiers(
      written.raw,
      await resolveChecklistDefinitionsForWorkItem(rootDir, written),
    ),
    evidence: normalizeLink("evidence", evidence),
  };
}

export interface InspectWorkItemChecklistOptions extends InspectWorkItemQualifiersOptions {
  readonly checklistId: string;
}

export interface WorkItemChecklistInspection {
  readonly workItemId: string;
  readonly filePath: string;
  readonly checklist: {
    readonly id: string;
    readonly checks: readonly {
      readonly id: string;
      readonly label: string;
      readonly status: "met" | "unmet";
    }[];
  };
}

export interface MutateWorkItemCheckOptions extends Omit<MutateWorkItemQualifierOptions, "qualifierId" | "status"> {
  readonly checklistId: string;
  readonly checkId: string;
  readonly action: "complete" | "clear";
}

/** Parsed evidence is passed to the transaction; stdin must be expanded by its caller. */
export type WorkItemCheckEvidence = string | {
  readonly reference?: string;
  readonly json?: string;
  readonly stdin?: string;
};

export interface CompleteWorkItemCheckWithEvidenceOptions extends Omit<MutateWorkItemCheckOptions, "action"> {
  readonly evidence: WorkItemCheckEvidence;
  /** Record subtype for JSON evidence; references retain their existing type. */
  readonly evidenceType?: string;
  /** Internal retry key for the durable evidence/check transaction. */
  readonly sagaId?: string;
}

export interface WorkItemCheckEvidenceTransaction extends WorkItemQualifierAttestation {
  readonly record?: CreateRecordResult;
}

export interface WorkItemCheckExecutionContext {
  readonly workItemId: string;
  readonly frontmatter: Frontmatter;
  readonly action: "complete" | "clear";
}

/**
 * Default execution policy derives the current category from the registered
 * workflow profile rather than encoding lifecycle status names in check code.
 */
export const executionCategoryCheckPolicy: GatePolicy<WorkItemCheckExecutionContext> = {
  id: "work-item-check-execution-category",
  evaluate(context) {
    try {
      const category = resolveDefaultWorkItemState(context.frontmatter).category;
      if (category === "execution") {
        return allowPolicyDecision(this.id);
      }
      return {
        policyId: this.id,
        allowed: false,
        code: "WORK_ITEM_CHECK_EXECUTION_CATEGORY_REQUIRED",
        message: `Cannot ${context.action} a check while '${context.workItemId}' is outside the execution category.`,
        details: { category },
      };
    } catch (error) {
      return {
        policyId: this.id,
        allowed: false,
        code: "WORK_ITEM_CHECK_EXECUTION_CATEGORY_REQUIRED",
        message: `Cannot resolve the execution category for '${context.workItemId}'.`,
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
};

function assertWorkItemCheckExecutionAllowed(context: WorkItemCheckExecutionContext): void {
  const decision = executionCategoryCheckPolicy.evaluate(context);
  if (!decision.allowed) {
    throw new TaskCommandError(
      decision.code ?? "WORK_ITEM_CHECK_EXECUTION_BLOCKED",
      decision.message ?? "Work Item check execution is blocked by policy.",
      decision.details ? { ...decision.details } : undefined,
    );
  }
}

/** Validate the Work-pack running category before a bounded policy override consumes. */
export async function assertWorkItemRunningCategory(options: InspectWorkItemQualifiersOptions): Promise<void> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  assertWorkItemCheckExecutionAllowed({
    workItemId: String(document.frontmatter.id),
    frontmatter: document.frontmatter,
    action: "complete",
  });
}

function checkAddressPath(checkId: string): string | undefined {
  return /^([0-9]+(?:\.[0-9]+)*)-/.exec(checkId)?.[1];
}

function resolveCurrentWorkItemCheck(options: {
  readonly workItemId: string;
  readonly document: MarkdownDocument;
  readonly definitions: Parameters<typeof projectMarkdownChecklists>[1];
  readonly checklistId: string;
  readonly checkId: string;
}): { readonly check: { readonly id: string; readonly label: string; readonly status: "met" | "unmet" }; readonly qualifierId: string } {
  const checklist = projectMarkdownChecklists(options.document.raw, options.definitions).checklists
    .find((candidate) => candidate.id === options.checklistId);
  if (!checklist) {
    throw new TaskCommandError("WORK_ITEM_CHECKLIST_UNKNOWN", `Unknown current checklist '${options.checklistId}'.`, {
      workItemId: options.workItemId,
      checklistId: options.checklistId,
    });
  }
  const checkIndex = checklist.checks.findIndex((candidate) => candidate.id === options.checkId);
  if (checkIndex < 0) {
    const requestedPath = checkAddressPath(options.checkId);
    const sameSourceAddress = requestedPath && checklist.checks.some(
      (candidate) => checkAddressPath(candidate.id) === requestedPath,
    );
    throw new TaskCommandError(
      sameSourceAddress ? "WORK_ITEM_CHECK_ADDRESS_DRIFT" : "WORK_ITEM_CHECK_UNKNOWN",
      sameSourceAddress
        ? "Current checklist check title no longer matches the supplied natural address."
        : `Unknown current check '${options.checkId}'.`,
      { workItemId: options.workItemId, checklistId: options.checklistId, checkId: options.checkId },
    );
  }
  const qualifier = projectWorkItemQualifiers(options.document.raw, options.definitions)
    .qualifier.children.find((scope) => scope.scope === options.checklistId)?.children[checkIndex];
  const check = checklist.checks[checkIndex]!;
  if (!qualifier || qualifier.label !== check.label) {
    throw new TaskCommandError("WORK_ITEM_CHECK_ADDRESS_DRIFT", "Current checklist check address no longer resolves to the expected source item.", {
      workItemId: options.workItemId,
      checklistId: options.checklistId,
      checkId: options.checkId,
    });
  }
  return { check, qualifierId: qualifier.id };
}

/** Inspect one current checklist contributed by the Work Item's selected pack. */
export async function inspectWorkItemChecklist(
  options: InspectWorkItemChecklistOptions,
): Promise<WorkItemChecklistInspection> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const definitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  const checklist = projectMarkdownChecklists(document.raw, definitions).checklists
    .find((candidate) => candidate.id === options.checklistId);
  if (!checklist) {
    throw new TaskCommandError("WORK_ITEM_CHECKLIST_UNKNOWN", `Unknown current checklist '${options.checklistId}'.`, {
      workItemId: options.id,
      checklistId: options.checklistId,
    });
  }
  return { workItemId: String(document.frontmatter.id), filePath, checklist };
}

async function prepareClaimBoundCheckMutation(options: Omit<MutateWorkItemCheckOptions, "action"> & {
  readonly action: "complete" | "clear";
  readonly requiredPaths?: readonly string[];
}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  // The claim gate is intentionally before the source read: natural addresses
  // are always re-resolved from the content protected by the held lock.
  authorizeWorkMutation({
    rootDir,
    taskId: options.id,
    claimToken: options.claimToken,
    requiredPaths: [...(options.requiredPaths ?? [filePath])],
  });
  const document = await readMarkdown(filePath);
  assertWorkItemCheckExecutionAllowed({
    workItemId: String(document.frontmatter.id),
    frontmatter: document.frontmatter,
    action: options.action,
  });
  const definitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  const resolved = resolveCurrentWorkItemCheck({
    workItemId: String(document.frontmatter.id),
    document,
    definitions,
    checklistId: options.checklistId,
    checkId: options.checkId,
  });
  return { rootDir, config, filePath, document, definitions, resolved };
}

export interface WorkItemCheckMutationPlan extends WorkItemQualifierMutation {
  /** Current natural address persisted with the expected source version. */
  readonly mutationId: string;
  readonly expectedMarkdown: string;
  readonly desiredMarkdown: string;
}

export interface WorkItemCheckMutationApplication extends WorkItemQualifierMutation {
  /** Restore only the source version this application wrote. */
  compensate(): Promise<void>;
}

/** Resolve a claimed Work mutation without writing its source. */
export async function planWorkItemCheck(
  options: MutateWorkItemCheckOptions,
): Promise<WorkItemCheckMutationPlan> {
  const prepared = await prepareClaimBoundCheckMutation(options);
  const mutation = mutateMarkdownQualifierLeaf({
    markdown: prepared.document.raw,
    id: prepared.resolved.qualifierId,
    status: options.action === "complete" ? "met" : "unmet",
    definitions: prepared.definitions,
  });
  return {
    workItemId: String(prepared.document.frontmatter.id),
    filePath: prepared.filePath,
    revision: mutation.revision,
    qualifier: mutation.qualifier,
    mutationId: prepared.resolved.qualifierId,
    expectedMarkdown: prepared.document.raw,
    desiredMarkdown: mutation.markdown,
  };
}

/** Apply one fresh natural check address with source-owned compensation. */
export async function applyWorkItemCheck(
  options: MutateWorkItemCheckOptions,
): Promise<WorkItemCheckMutationApplication> {
  const plan = await planWorkItemCheck(options);
  await fs.writeFile(plan.filePath, plan.desiredMarkdown, "utf8");
  return {
    workItemId: plan.workItemId,
    filePath: plan.filePath,
    revision: plan.revision,
    qualifier: plan.qualifier,
    async compensate() {
      const current = await fs.readFile(plan.filePath, "utf8");
      if (current !== plan.desiredMarkdown) {
        throw new TaskCommandError(
          "WORK_ITEM_CHECK_COMPENSATION_CONFLICT",
          "Cannot compensate a Work check after its source changed again.",
          { workItemId: plan.workItemId, filePath: plan.filePath },
        );
      }
      await fs.writeFile(plan.filePath, plan.expectedMarkdown, "utf8");
    },
  };
}

/** Complete or clear one fresh natural check address under its Work Item claim. */
export async function mutateWorkItemCheck(
  options: MutateWorkItemCheckOptions,
): Promise<WorkItemQualifierMutation> {
  const { compensate: _compensate, ...mutation } = await applyWorkItemCheck(options);
  return mutation;
}

function parseWorkItemCheckEvidence(evidence: WorkItemCheckEvidence):
  | { readonly kind: "reference"; readonly value: string }
  | { readonly kind: "record"; readonly payload: RecordPayload } {
  const raw = typeof evidence === "string"
    ? evidence.trim()
    : (evidence.reference ?? evidence.json ?? evidence.stdin ?? "").trim();
  if (!raw) {
    throw new TaskCommandError("WORK_ITEM_CHECK_EVIDENCE_REQUIRED", "Check completion requires evidence.");
  }
  const shouldParseJson = typeof evidence !== "string"
    ? Boolean(evidence.json ?? evidence.stdin)
    : raw.startsWith("{");
  if (!shouldParseJson) {
    return { kind: "reference", value: raw };
  }
  try {
    return { kind: "record", payload: validateRecordPayload(JSON.parse(raw)) };
  } catch (error) {
    throw new TaskCommandError(
      "WORK_ITEM_CHECK_EVIDENCE_INVALID",
      "Check evidence JSON must be a valid typed record payload.",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * Atomically link existing evidence or create a typed evidence record and
 * complete the exact natural check resolved under the active claim lock.
 */
export async function completeWorkItemCheckWithEvidence(
  options: CompleteWorkItemCheckWithEvidenceOptions,
): Promise<WorkItemCheckEvidenceTransaction> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const saga = new Saga({
    id: options.sagaId,
    authority: { taskId: options.id, ...(options.claimToken ? { claimToken: options.claimToken } : {}) },
    commands: [],
  });
  const sagaStore = new SagaStore({ rootDir });
  try {
    // Recover stale evidence/check effects before reading or locking a conflicting Work Item.
    const recovered = await createWorkItemSagaOrchestrator(sagaStore, rootDir).recoverPending();
    if (recovered.some((instance) => instance.status === "disputed")) {
      throw new TaskCommandError("WORK_ITEM_CHECK_SAGA_DISPUTED", "A pending evidence/check transaction is disputed and requires recovery review.");
    }
  } finally {
    sagaStore.close();
  }
  const evidence = parseWorkItemCheckEvidence(options.evidence);
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const recordPreview = evidence.kind === "record"
    ? await createRecord({
      rootDir,
      consumerConfig: options.consumerConfig,
      claimToken: options.claimToken,
      dryRun: true,
      id: evidence.payload.id,
      summary: evidence.payload.summary,
      observation: evidence.payload.observation,
      subtype: options.evidenceType ?? "test-result",
      outcome: evidence.payload.outcome,
      recordedAt: evidence.payload.recordedAt,
      artifactRefs: evidence.payload.artifactRefs,
      supportingRefs: evidence.payload.supportingRefs,
      findings: evidence.payload.findings,
      notes: evidence.payload.notes,
      subjects: unique([options.id, ...(evidence.payload.subjects ?? []), ...(evidence.payload.subject ? [evidence.payload.subject] : [])]),
    })
    : undefined;
  const prepared = await prepareClaimBoundCheckMutation({
    ...options,
    action: "complete",
    requiredPaths: [filePath, ...(recordPreview ? [recordPreview.filePath] : [])],
  });
  if (evidence.kind === "reference") {
    await assertAttestationEvidenceExists(prepared.rootDir, prepared.config, evidence.value);
  }
  const mutation = mutateMarkdownQualifierLeaf({
    markdown: prepared.document.raw,
    id: prepared.resolved.qualifierId,
    status: "met",
    definitions: prepared.definitions,
  });
  const attested = matter(mutation.markdown);
  const evidenceLink = evidence.kind === "reference"
    ? normalizeLink("evidence", evidence.value)
    : `[[${path.basename(recordPreview!.filePath, ".md")}]]`;
  const links = ensureWorkItemLinks(attested.data as Frontmatter);
  links.evidence = unique([...ensureArray(links.evidence), evidenceLink]);
  const workItemContent = stringifyMarkdown(attested.data as Frontmatter, attested.content);
  const commands = await Promise.all([
    ...(recordPreview
      ? [createFileCommand({
        rootDir,
        sagaId: saga.id,
        filePath: recordPreview.filePath,
        content: stringifyMarkdown(recordPreview.frontmatter, recordPreview.body),
      })]
      : []),
    createFileCommand({ rootDir, sagaId: saga.id, filePath: prepared.filePath, content: workItemContent }),
  ]);
  const executionStore = new SagaStore({ rootDir });
  try {
    const result = await createWorkItemSagaOrchestrator(executionStore, rootDir).execute(new Saga({ id: saga.id, authority: saga.authority, commands }));
    if (result.status === "disputed") {
      throw new TaskCommandError("WORK_ITEM_CHECK_SAGA_DISPUTED", "Evidence/check transaction is disputed and requires recovery review.", { sagaId: saga.id });
    }
    if (result.status !== "completed") {
      throw new TaskCommandError("WORK_ITEM_CHECK_SAGA_FAILED", "Evidence/check transaction was compensated.", { sagaId: saga.id });
    }
  } finally {
    executionStore.close();
  }
  const written = await readMarkdown(prepared.filePath);
  return {
    workItemId: String(written.frontmatter.id),
    filePath: prepared.filePath,
    ...projectWorkItemQualifiers(written.raw, await resolveChecklistDefinitionsForWorkItem(prepared.rootDir, written)),
    evidence: evidenceLink,
    ...(recordPreview ? { record: { ...recordPreview, dryRun: false } } : {}),
  };
}

export async function mutateWorkItemQualifier(
  options: MutateWorkItemQualifierOptions,
): Promise<WorkItemQualifierMutation> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  authorizeWorkMutation({
    rootDir,
    taskId: options.id,
    claimToken: options.claimToken,
    requiredPaths: [filePath],
  });
  const document = await readMarkdown(filePath);
  const definitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  const mutation = mutateMarkdownQualifierLeaf({
    markdown: document.raw,
    id: options.qualifierId,
    status: options.status,
    definitions,
  });
  await fs.writeFile(filePath, mutation.markdown, "utf8");
  return {
    workItemId: String(document.frontmatter.id),
    filePath,
    revision: mutation.revision,
    qualifier: mutation.qualifier,
  };
}

function buildWorkItemBasename(slug: string) {
  return `work-item-${slug}`;
}

function buildWorkItemId(slug: string): string {
  return `work-item:${slug}`;
}

function buildRecordBasename(slug: string): string {
  return `record-${slug}`;
}

function buildRecordId(slug: string): string {
  return `record:${slug}`;
}

function deriveLegacySlug(filePath: string): string {
  return slugify(path.basename(filePath, ".md").replace(/_/g, "-"));
}

function summarizeLegacyItem(
  frontmatter: Frontmatter,
  filePath: string,
): string {
  const summary =
    typeof frontmatter.summary === "string" ? frontmatter.summary.trim() : "";
  if (summary.length > 0) {
    return summary;
  }
  const title =
    typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  if (title.length > 0) {
    return title.replace(/^\d+:\s*/, "");
  }
  return deriveLegacySlug(filePath).replace(/-/g, " ");
}

function extractLegacyDependencies(frontmatter: Frontmatter): string[] {
  const links =
    typeof frontmatter.links === "object" && frontmatter.links !== null
      ? (frontmatter.links as Record<string, unknown>)
      : {};
  return ensureArray(links.depends_on);
}

function extractLegacyPullRequests(frontmatter: Frontmatter): string[] {
  const links =
    typeof frontmatter.links === "object" && frontmatter.links !== null
      ? (frontmatter.links as Record<string, unknown>)
      : {};
  return ensureArray(links.pull_requests);
}

function extractLegacyTestResults(
  frontmatter: Frontmatter,
): Array<{ timestamp?: string; note: string }> {
  if (!Array.isArray(frontmatter.test_results)) {
    return [];
  }

  return frontmatter.test_results
    .filter(
      (entry): entry is { timestamp?: string; note?: string } =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      timestamp:
        typeof entry.timestamp === "string" ? entry.timestamp : undefined,
      note: typeof entry.note === "string" ? entry.note : "",
    }))
    .filter((entry) => entry.note.trim().length > 0);
}

function rewriteBasenames(
  content: string,
  basenameMap: Record<string, string>,
): string {
  return content.replace(
    /\[\[([^\]|#]+)([^\]]*)\]\]/g,
    (fullMatch, target, suffix) => {
      const normalizedTarget = stripMarkdownExtension(String(target).trim());
      const replacement = basenameMap[normalizedTarget];
      if (!replacement) {
        return fullMatch;
      }
      return `[[${replacement}${suffix}]]`;
    },
  );
}

function appendRelationships(body: string, dependencies: string[]): string {
  if (dependencies.length === 0) {
    return body;
  }
  const lines = dependencies.map(
    (dependency) => `- \`depends_on\`: ${dependency}`,
  );
  const trimmed = body.replace(/\s+$/, "");
  return `${trimmed}\n\n## Relationships\n\n${lines.join("\n")}\n`;
}

function buildRecordBody(options: CreateRecordOptions): string {
  const findings = unique(options.findings ?? []);
  const notes = unique(options.notes ?? []);
  const artifacts = unique(options.artifactRefs ?? []);
  const subjects = unique(options.subjects ?? []);
  const supportingRefs = unique(options.supportingRefs ?? []);

  const lines: string[] = [
    "## Recorded At",
    "",
    options.recordedAt ?? new Date().toISOString(),
    "",
    "## Outcome",
    "",
    options.outcome ?? "noted",
    "",
    "## Observation",
    "",
    options.observation.trim(),
    "",
    "## Subject References",
    "",
    ...subjects.map((subject) => `- ${subject}`),
  ];

  if (findings.length > 0) {
    lines.push(
      "",
      "## Findings",
      "",
      ...findings.map((finding) => `- ${finding}`),
    );
  }
  if (artifacts.length > 0) {
    lines.push(
      "",
      "## Artifact References",
      "",
      ...artifacts.map((artifact) => `- ${artifact}`),
    );
  }
  if (supportingRefs.length > 0) {
    lines.push(
      "",
      "## Supporting References",
      "",
      ...supportingRefs.map((reference) => `- ${reference}`),
    );
  }
  if (notes.length > 0) {
    lines.push("", "## Notes", "", ...notes.map((note) => `- ${note}`));
  }

  return `${lines.join("\n")}\n`;
}

async function assertAttestationEvidenceExists(
  rootDir: string,
  config: ResolvedConsumerConfig,
  evidence: string,
): Promise<void> {
  const normalized = normalizeLink("evidence", evidence);
  const match = normalized.match(/^\[\[([^\]|#]+)/);
  if (!match) {
    throw new TaskCommandError(
      "WORK_ITEM_ATTESTATION_EVIDENCE_UNRESOLVED",
      "Checklist attestation evidence must reference an existing local record.",
      { evidence: normalized },
    );
  }
  const reference = stripMarkdownExtension(match[1].trim());
  const recordsRoot = path.resolve(rootDir, config.roots.records);
  for (const filePath of await findMarkdownFiles(recordsRoot)) {
    if (stripMarkdownExtension(path.basename(filePath)) === reference) {
      return;
    }
    const document = await readMarkdown(filePath);
    if (document.frontmatter.id === reference) {
      return;
    }
  }
  throw new TaskCommandError(
    "WORK_ITEM_ATTESTATION_EVIDENCE_UNRESOLVED",
    `Checklist attestation evidence '${normalized}' does not resolve to an existing record.`,
    { evidence: normalized },
  );
}

async function resolveRecordSubjectWorkItem(
  rootDir: string,
  config: ResolvedConsumerConfig,
  subject: string,
): Promise<{ id: string; filePath: string } | undefined> {
  const target = subject
    .trim()
    .replace(/^\[\[\s*/, "")
    .replace(/\s*\]\]$/, "")
    .split(/[|#]/, 1)[0]
    ?.trim();
  if (!target) {
    return undefined;
  }

  try {
    const filePath = await resolveWorkItemFile(rootDir, config, target);
    const document = await readMarkdown(filePath);
    return { id: String(document.frontmatter.id), filePath };
  } catch {
    // A record subject commonly uses a Work Item basename rather than its ID.
    const basename = stripMarkdownExtension(path.basename(target));
    const dirs = unique([config.roots.active, config.roots.backlog, config.roots.archive])
      .map((value) => path.resolve(rootDir, value));
    for (const dirPath of dirs) {
      for (const filePath of await findMarkdownFiles(dirPath)) {
        if (stripMarkdownExtension(path.basename(filePath)) !== basename) {
          continue;
        }
        const document = await readMarkdown(filePath);
        if (typeof document.frontmatter.id === "string") {
          return { id: document.frontmatter.id, filePath };
        }
      }
    }
    return undefined;
  }
}

/**
 * A public record can describe unclaimed or non-Work subjects. When it
 * resolves to claimed Work, reserve both the new record and its Work artifact
 * before writing so record creation cannot be a Claim bypass.
 */
async function authorizeRecordCreation(
  rootDir: string,
  config: ResolvedConsumerConfig,
  options: CreateRecordOptions,
  recordPath: string,
): Promise<void> {
  const workItems = new Map<string, { id: string; filePath: string }>();
  for (const subject of options.subjects) {
    const workItem = await resolveRecordSubjectWorkItem(rootDir, config, subject);
    if (workItem) {
      workItems.set(workItem.id, workItem);
    }
  }
  for (const workItem of workItems.values()) {
    authorizeWorkMutation({
      rootDir,
      taskId: workItem.id,
      claimToken: options.claimToken,
      requiredPaths: [recordPath, workItem.filePath],
    });
  }
}

async function createRecordInternal(
  rootDir: string,
  config: ResolvedConsumerConfig,
  options: CreateRecordOptions,
): Promise<CreateRecordResult> {
  const subtype = options.subtype ?? "test-result";
  if (
    options.id &&
    !/^record:[a-zA-Z0-9]+(?:[_-][a-zA-Z0-9]+)*$/.test(options.id)
  ) {
    throw new Error(
      `Invalid record id '${options.id}': must match record:<slug> with alphanumeric segments separated by dashes or underscores`,
    );
  }
  const slug = options.id
    ? options.id.replace(/^record:/, "")
    : slugify(options.summary);
  const recordId = options.id ?? buildRecordId(slug);
  const recordsRoot = path.resolve(rootDir, config.roots.records);
  const filePath = path.resolve(recordsRoot, `${buildRecordBasename(slug)}.md`);
  if (!filePath.startsWith(`${recordsRoot}${path.sep}`)) {
    throw new Error(
      `Resolved record path escapes records root for '${recordId}'`,
    );
  }
  // Supporting references are evidence annotations, not Work relationships.
  // Preserve command, commit, glob, and test identifiers verbatim; only callers
  // explicitly creating relationship-bearing links may use normalizeLink.
  const supportingRefs = unique(
    (options.supportingRefs ?? []).map((value) => value.trim()).filter(Boolean),
  );

  const frontmatter: Frontmatter = {
    $schema: "schemas/work-management/frontmatter/record.json",
    id: recordId,
    title: options.summary.trim(),
    summary: options.summary.trim(),
    type: "record",
    subtype,
    lifecycle: "active",
    status: options.status ?? "ready",
    status_reason: options.statusReason ?? "recorded",
  };

  if (supportingRefs.length > 0) {
    frontmatter.links = { supporting_reference: supportingRefs };
  }

  const body = buildRecordBody({ ...options, id: recordId, supportingRefs });
  if (!options.dryRun) {
    await writeMarkdown(filePath, frontmatter, body);
  }

  return {
    id: recordId,
    filePath,
    frontmatter,
    body,
    dryRun: Boolean(options.dryRun),
  };
}

export async function transitionWorkItem(
  options: TransitionWorkItemOptions,
): Promise<TransitionWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const requestedStatus = normalizeRawStatus(options.status);
  const status = normalizeStatus(options.status);
  const shouldValidateTerminalMetadata = ["completed", "aborted"].includes(status);
  if (!options.dryRun && !shouldValidateTerminalMetadata) {
    authorizeWorkMutation({
      rootDir,
      taskId: options.id,
      claimToken: options.claimToken,
      requiredPaths: [filePath],
      claimedPathAudit: options.claimedPathAudit,
    });
  }
  const document = await readMarkdown(filePath);
  const lifecycle = ["completed", "aborted"].includes(status)
    ? "active"
    : inferLifecycle(status, false);
  const statusReason = options.statusReason ?? inferStatusReason(status);

  const candidateFrontmatter: Frontmatter = {
    ...document.frontmatter,
    status,
    status_reason: statusReason,
    lifecycle,
    ...(typeof options.actual === "number" ? { actual: options.actual } : {}),
  };
  if (options.clearEstimated) {
    delete candidateFrontmatter.estimated;
  }
  if (shouldValidateTerminalMetadata) {
    const checklistDefinitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
    assertWorkItemCompletionAllowed({
      rootDir,
      document,
      targetStatus: status,
      requestedStatus,
      targetStatusReason: statusReason,
      candidateFrontmatter,
      requiredPaths: [filePath],
      claimToken: options.claimToken,
      authorizeClaim: !options.dryRun,
      mode: "transition",
      checklistDefinitions,
    });
  }

  document.frontmatter.status = status;
  document.frontmatter.status_reason = statusReason;
  document.frontmatter.lifecycle = lifecycle;
  if (options.clearEstimated) {
    delete document.frontmatter.estimated;
  }
  if (typeof options.actual === "number") {
    document.frontmatter.actual = options.actual;
  }
  if (typeof options.assignee === "string") {
    const normalizedAssignee = normalizeOptionalAssignee(options.assignee);
    if (normalizedAssignee) {
      document.frontmatter.assignee = normalizedAssignee;
    } else {
      delete document.frontmatter.assignee;
    }
  }
  if (["completed", "aborted"].includes(status)) {
    document.frontmatter.completed_date = new Date().toISOString().slice(0, 10);
    if (hasEvidenceLinks(document.frontmatter)) {
      appendTerminalEvidenceNote(
        document,
        statusReason,
        String(document.frontmatter.completed_date),
      );
    }
  }

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }
  const execution =
    !options.dryRun && ["completed", "aborted"].includes(status)
      ? completeRuntimeClaimExecutionForTask({
          rootDir,
          taskId: options.id,
          claimToken: options.claimToken,
        })
      : undefined;

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    dryRun: Boolean(options.dryRun),
    ...(execution ? { execution } : {}),
  };
}

export async function linkWorkItem(
  options: LinkWorkItemOptions,
): Promise<LinkWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  if (!options.dryRun) {
    authorizeWorkMutation({
      rootDir,
      taskId: options.id,
      claimToken: options.claimToken,
      requiredPaths: [filePath],
    });
  }
  const document = await readMarkdown(filePath);
  const links = ensureWorkItemLinks(document.frontmatter);
  const bucketKey = options.kind === "pr" ? "pull_requests" : options.kind;
  const normalizedValue = normalizeLink(options.kind, options.value);
  links[bucketKey] = unique([
    ...ensureArray(links[bucketKey]),
    normalizedValue,
  ]);

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    kind: options.kind,
    value: normalizedValue,
    dryRun: Boolean(options.dryRun),
  };
}

export async function recordWorkItemCommit(
  options: RecordCommitOptions,
): Promise<RecordCommitResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  authorizeWorkMutation({
    rootDir,
    taskId: options.id,
    claimToken: options.claimToken,
    requiredPaths: [filePath],
  });
  const document = await readMarkdown(filePath);
  const commits =
    typeof document.frontmatter.commits === "object" &&
    document.frontmatter.commits !== null
      ? { ...(document.frontmatter.commits as Record<string, unknown>) }
      : {};

  if (!/^[0-9a-f]{7,40}$/i.test(options.sha.trim())) {
    throw new Error(
      `Invalid commit SHA "${options.sha}": must be a hex string of 7–40 characters`,
    );
  }
  const trimmedSummary = options.summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error("Commit summary must not be empty");
  }
  commits[normalizeSha(options.sha)] = trimmedSummary;
  document.frontmatter.commits = commits;

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    sha: normalizeSha(options.sha),
    dryRun: Boolean(options.dryRun),
  };
}

export async function createRecord(
  options: CreateRecordOptions,
): Promise<CreateRecordResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  // Resolve the path without writing, authorize every affected Work subject,
  // then perform the single durable record write through the private helper.
  const preview = await createRecordInternal(rootDir, config, {
    ...options,
    dryRun: true,
  });
  // A dry run has no durable mutation to authorize. Callers use its stable
  // predicted path to reserve a multi-artifact operation before writing.
  if (!options.dryRun) {
    await authorizeRecordCreation(rootDir, config, options, preview.filePath);
  }
  return createRecordInternal(rootDir, config, options);
}

export async function finalizeWorkItem(
  options: FinalizeWorkItemOptions,
): Promise<FinalizeWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const archivePath = path.resolve(
    rootDir,
    config.roots.archive,
    path.basename(filePath),
  );
  const alreadyFinalized =
    path.resolve(filePath) === archivePath &&
    normalizeStatus(document.frontmatter.status) === "completed" &&
    normalizeLifecycle(document.frontmatter.lifecycle) === "inactive";

  if (alreadyFinalized) {
    authorizeWorkMutation({
      rootDir,
      taskId: options.id,
      claimToken: options.claimToken,
      requiredPaths: [archivePath],
    });
    const execution =
      !options.dryRun
        ? completeRuntimeClaimExecutionForTask({
            rootDir,
            taskId: options.id,
            claimToken: options.claimToken,
          })
        : undefined;
    return {
      id: options.id,
      filePath,
      archivePath,
      frontmatter: document.frontmatter,
      dryRun: Boolean(options.dryRun),
      ...(execution ? { execution } : {}),
    };
  }

  const checklistDefinitions = await resolveChecklistDefinitionsForWorkItem(rootDir, document);
  assertWorkItemCompletionAllowed({
    rootDir,
    document,
    targetStatus: "completed",
    requestedStatus: "completed",
    targetStatusReason: options.statusReason ?? "completed",
    candidateFrontmatter: document.frontmatter,
    requiredPaths: [filePath, archivePath],
    claimToken: options.claimToken,
    // Preserve the existing finalize seam, which validates claim coverage for dry runs too.
    authorizeClaim: true,
    mode: "finalize",
    checklistDefinitions,
  });

  const pullRequestPath =
    typeof options.pullRequestPath === "string" &&
    options.pullRequestPath.trim().length > 0
      ? options.pullRequestPath.trim()
      : "links.pull_requests";

  const pullRequestLinks = extractStringValuesAtPath(
    document.frontmatter as Record<string, unknown>,
    pullRequestPath,
  );

  if (pullRequestLinks.length === 0) {
    throw new Error(`Cannot finalize '${options.id}' without linked PRs.`);
  }
  const provider = requireAuthenticatedProvider(options.provider, options.id);

  const validationErrors = await validateLinkedPullRequestsMerged({
    id: options.id,
    pullRequestLinks,
    provider,
  });
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("\n"));
  }

  document.frontmatter.status = "completed";
  document.frontmatter.status_reason = options.statusReason ?? "completed";
  document.frontmatter.lifecycle = "inactive";
  document.frontmatter.completed_date = new Date().toISOString().slice(0, 10);
  if (typeof options.actual === "number") {
    document.frontmatter.actual = options.actual;
  }
  if (typeof document.frontmatter.actual !== "number") {
    throw new Error(
      `Cannot finalize '${options.id}' without actual effort recorded.`,
    );
  }
  if (!options.dryRun) {
    await writeMarkdown(archivePath, document.frontmatter, document.body);
    if (path.resolve(filePath) !== archivePath) {
      await fs.unlink(filePath);
    }
  }
  const execution =
    !options.dryRun
      ? completeRuntimeClaimExecutionForTask({
          rootDir,
          taskId: options.id,
          claimToken: options.claimToken,
        })
      : undefined;

  return {
    id: options.id,
    filePath,
    archivePath,
    frontmatter: document.frontmatter,
    dryRun: Boolean(options.dryRun),
    ...(execution ? { execution } : {}),
  };
}

function requireAuthenticatedProvider(
  provider: BacklogAutomationProvider | undefined,
  workItemId: string,
): BacklogAutomationProvider {
  const resolvedProvider =
    provider ?? getProviderForForge("github", process.env.GITHUB_TOKEN);

  if (!resolvedProvider.isAuthenticated()) {
    throw new Error(
      `Cannot finalize '${workItemId}' without an authenticated provider to verify linked PRs.`,
    );
  }

  return resolvedProvider;
}

async function validateLinkedPullRequestsMerged(options: {
  id: string;
  pullRequestLinks: string[];
  provider: BacklogAutomationProvider;
}): Promise<string[]> {
  const issues: string[] = [];

  for (const pullRequestLink of options.pullRequestLinks) {
    const identity = options.provider.normalizePRReference(pullRequestLink);
    if (!identity) {
      issues.push(
        `Cannot finalize '${options.id}' because linked PR '${pullRequestLink}' could not be parsed.`,
      );
      continue;
    }

    try {
      const metadata = await options.provider.fetchPRMetadata(identity);
      if (!metadata.merged) {
        issues.push(
          `Cannot finalize '${options.id}' because linked PR '${metadata.url}' is not merged.`,
        );
      }
    } catch (error) {
      issues.push(
        `Cannot finalize '${options.id}' because linked PR '${identity.reference}' could not be verified: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return issues;
}

function extractStringValuesAtPath(
  source: Record<string, unknown>,
  dottedPath: string,
): string[] {
  const segments = dottedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let cursor: unknown = source;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null) {
      return [];
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (typeof cursor === "string") {
    const trimmed = cursor.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(cursor)) {
    return [];
  }

  return cursor
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Migration mapping output is repository-operational metadata rather than a
 * Work artifact. It is deliberately non-governed, but fail closed if consumer
 * configuration would place it under any governed Work/Record root.
 */
function assertNonGovernedMigrationMap(options: {
  rootDir: string;
  config: ResolvedConsumerConfig;
  mappingPath: string;
}): void {
  const governedRoots = [
    options.config.roots.active,
    options.config.roots.archive,
    options.config.roots.records,
  ].map((entry) => path.resolve(options.rootDir, entry));
  if (governedRoots.some((root) => isWithinPath(options.mappingPath, root))) {
    throw new TaskCommandError(
      "WORK_MIGRATION_NON_GOVERNED_POLICY_VIOLATION",
      "Migration mapping output must remain outside governed Work and Record roots.",
      { mappingPath: options.mappingPath, governedRoots },
    );
  }
}

export async function migrateBacklog(
  options: MigrateBacklogOptions,
): Promise<MigrateBacklogResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const legacyRoot = path.resolve(
    rootDir,
    options.dir ?? config.migration.legacyActive,
  );
  const legacyArchive = path.resolve(rootDir, config.migration.legacyArchive);
  const activeFiles = (await findMarkdownFiles(legacyRoot)).filter(
    (filePath) =>
      !isWithinPath(filePath, legacyArchive) &&
      path.basename(filePath) !== "AGENTS.md",
  );
  const archiveFiles = (await findMarkdownFiles(legacyArchive)).filter(
    (filePath) => path.basename(filePath) !== "AGENTS.md",
  );
  const files = unique([...activeFiles, ...archiveFiles]);
  const basenameMap: Record<string, string> = {};
  const targetBasenameSet = new Set<string>();
  const skippedLegacyPaths = new Set<string>();

  for (const legacyPath of files) {
    const slug = deriveLegacySlug(legacyPath);
    const legacyBasename = stripMarkdownExtension(path.basename(legacyPath));
    const targetBasename = buildWorkItemBasename(slug);
    if (targetBasenameSet.has(targetBasename)) {
      console.warn(
        `[migrateBacklog] Skipping "${legacyPath}": target basename "${targetBasename}" is already mapped by another entry`,
      );
      skippedLegacyPaths.add(legacyPath);
      continue;
    }
    targetBasenameSet.add(targetBasename);
    basenameMap[legacyBasename] = targetBasename;
  }

  const migrated: MigrationRecord[] = [];

  for (const legacyPath of files) {
    if (skippedLegacyPaths.has(legacyPath)) {
      continue;
    }

    const isArchived = legacyPath.startsWith(legacyArchive);
    const legacyDoc = await readMarkdown(legacyPath);
    const slug = deriveLegacySlug(legacyPath);
    const newId = buildWorkItemId(slug);
    const newBasename = buildWorkItemBasename(slug);
    const normalizedStatus = isArchived
      ? "closed"
      : normalizeStatus(legacyDoc.frontmatter.status);
    const pullRequests = unique(
      extractLegacyPullRequests(legacyDoc.frontmatter),
    );
    const dependencies = extractLegacyDependencies(legacyDoc.frontmatter)
      .map((dependency) => dependency.replace(/^\[\[|\]\]$/g, ""))
      .map(
        (dependency) =>
          basenameMap[stripMarkdownExtension(dependency)] ?? dependency,
      )
      .map((dependency) => `[[${stripMarkdownExtension(dependency)}]]`);

    const assignee = normalizeOptionalAssignee(legacyDoc.frontmatter.assignee);
    const normalizedCommits = normalizeLegacyCommitMap(
      legacyDoc.frontmatter.commits,
    );

    const frontmatter: Frontmatter = {
      $schema: "schemas/work-management/frontmatter/work-item.json",
      id: newId,
      title: legacyDoc.frontmatter.title,
      summary: summarizeLegacyItem(legacyDoc.frontmatter, legacyPath),
      type: "work-item",
      subtype: legacyDoc.frontmatter.subtype ?? "task",
      lifecycle: inferLifecycle(normalizedStatus, isArchived),
      status: normalizedStatus,
      status_reason:
        typeof legacyDoc.frontmatter.status_reason === "string"
          ? legacyDoc.frontmatter.status_reason
          : inferStatusReason(normalizedStatus),
      priority: legacyDoc.frontmatter.priority ?? "medium",
      estimated:
        typeof legacyDoc.frontmatter.estimated === "number"
          ? legacyDoc.frontmatter.estimated
          : 0,
    };

    if (typeof legacyDoc.frontmatter.owner === "string") {
      frontmatter.owner = legacyDoc.frontmatter.owner;
    }
    if (assignee) {
      frontmatter.assignee = assignee;
    }
    if (Array.isArray(legacyDoc.frontmatter.tags)) {
      frontmatter.tags = legacyDoc.frontmatter.tags;
    }
    if (typeof legacyDoc.frontmatter.actual === "number") {
      frontmatter.actual = legacyDoc.frontmatter.actual;
    } else if (normalizedStatus === "closed") {
      frontmatter.actual =
        typeof legacyDoc.frontmatter.estimated === "number"
          ? legacyDoc.frontmatter.estimated
          : 0;
    }
    if (typeof legacyDoc.frontmatter.completed_date === "string") {
      frontmatter.completed_date = legacyDoc.frontmatter.completed_date;
    }
    if (normalizedCommits) {
      frontmatter.commits = normalizedCommits;
    }

    const links: Record<string, unknown> = {};
    if (pullRequests.length > 0) {
      links.pull_requests = pullRequests;
    }

    const generatedRecords: string[] = [];
    const legacyTestResults = extractLegacyTestResults(legacyDoc.frontmatter);
    const fallbackEvidence =
      legacyTestResults.length === 0 && normalizedStatus === "closed";
    const evidenceEntries = fallbackEvidence
      ? [
          {
            timestamp:
              typeof legacyDoc.frontmatter.completed_date === "string"
                ? `${legacyDoc.frontmatter.completed_date}T00:00:00Z`
                : undefined,
            note: "Legacy closed work item migrated without inline test_results; preserved as closure evidence.",
          },
        ]
      : legacyTestResults;
    const targetPath = path.resolve(
      rootDir,
      isArchived ? config.roots.archive : config.roots.active,
      `${newBasename}.md`,
    );
    const generatedRecordPaths = evidenceEntries.map((_, index) =>
      path.resolve(
        rootDir,
        config.roots.records,
        `${buildRecordBasename(`${slug}-evidence-${index + 1}`)}.md`,
      ),
    );
    if (!options.dryRun) {
      // Verify all paths before the first record is created; this includes the
      // replacement Work Item and the legacy source that will be deleted.
      const requiredPaths = [targetPath, legacyPath, ...generatedRecordPaths];
      authorizeWorkMutation({
        rootDir,
        taskId: newId,
        claimToken: options.claimToken,
        requiredPaths,
      });
      // The source may itself be an actively claimed legacy Work Item. Check
      // its Claim too so migration cannot delete an in-progress source under a
      // newly generated destination identity.
      const legacyWorkItemId =
        typeof legacyDoc.frontmatter.id === "string"
          ? legacyDoc.frontmatter.id.trim()
          : "";
      if (legacyWorkItemId && legacyWorkItemId !== newId) {
        authorizeWorkMutation({
          rootDir,
          taskId: legacyWorkItemId,
          claimToken: options.claimToken,
          requiredPaths,
        });
      }
    }

    for (let index = 0; index < evidenceEntries.length; index += 1) {
      const entry = evidenceEntries[index];
      const recordSlug = `${slug}-evidence-${index + 1}`;
      const record = await createRecordInternal(rootDir, config, {
        id: buildRecordId(recordSlug),
        summary: `${String(
          frontmatter.title ?? frontmatter.summary,
        )} evidence ${index + 1}`,
        subtype: legacyTestResults.length === 0 ? "evidence" : "test-result",
        status: "ready",
        statusReason: "recorded",
        outcome: legacyTestResults.length === 0 ? "noted" : "noted",
        recordedAt: entry.timestamp,
        observation: entry.note,
        subjects: [`[[${newBasename}]]`],
        artifactRefs: pullRequests,
        dryRun: options.dryRun,
      });
      generatedRecords.push(path.basename(record.filePath));
    }

    if (generatedRecords.length > 0) {
      links.evidence = generatedRecords.map(
        (recordFile) => `[[${stripMarkdownExtension(recordFile)}]]`,
      );
    }
    if (Object.keys(links).length > 0) {
      frontmatter.links = links;
    }

    const rewrittenBody = appendRelationships(
      rewriteBasenames(legacyDoc.body, basenameMap),
      dependencies,
    );
    if (!options.dryRun) {
      await writeMarkdown(targetPath, frontmatter, rewrittenBody);
      if (path.resolve(legacyPath) !== targetPath) {
        await fs.unlink(legacyPath);
      }
    }

    migrated.push({
      legacyPath,
      newPath: targetPath,
      legacyId:
        typeof legacyDoc.frontmatter.id === "string"
          ? legacyDoc.frontmatter.id
          : null,
      newId,
      generatedRecords,
    });
  }

  if (!options.dryRun && config.roots.audit) {
    const mappingPath = path.resolve(
      rootDir,
      config.roots.audit,
      "work-management-migration-map.json",
    );
    assertNonGovernedMigrationMap({ rootDir, config, mappingPath });
    await fs.mkdir(path.dirname(mappingPath), { recursive: true });
    await fs.writeFile(
      mappingPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), migrated, basenameMap },
        null,
        2,
      ),
      "utf8",
    );
  }

  return { dryRun: Boolean(options.dryRun), migrated, basenameMap };
}

const WORK_ITEM_TOKEN_PATTERNS: RegExp[] = [
  /\bwork-item:[a-z0-9]+(?:-[a-z0-9]+)*\b/g,
  /\bwi-\d+\b/g,
];

function extractGithubSubjects(payload: Record<string, unknown>): string[] {
  const subjects = new Set<string>();
  const maybeStrings = [
    payload.doc_vader_subjects,
    payload.docVaderSubjects,
    payload.body,
    (payload.pull_request as Record<string, unknown> | undefined)?.body,
    (payload.pull_request as Record<string, unknown> | undefined)?.title,
    (payload.workflow_run as Record<string, unknown> | undefined)
      ?.display_title,
    (payload.workflow_run as Record<string, unknown> | undefined)?.name,
  ];

  for (const value of maybeStrings) {
    if (typeof value !== "string") {
      continue;
    }

    // Deterministic extraction order: evaluate patterns in fixed order and
    // preserve first-seen token order while de-duplicating.
    for (const pattern of WORK_ITEM_TOKEN_PATTERNS) {
      const matches = value.match(pattern) ?? [];
      for (const match of matches) {
        subjects.add(match);
      }
    }
  }

  return Array.from(subjects);
}

function githubWorkflowOutcome(conclusion: string | undefined): string {
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
      return "fail";
    case "cancelled":
    case "timed_out":
      return "mixed";
    default:
      return "noted";
  }
}

/**
 * Resolve the deterministic record path, then authorize the complete event
 * mutation as one reservation before either artifact is written.
 */
async function reserveEventEvidenceMutation(options: {
  rootDir: string;
  config: ResolvedConsumerConfig;
  subject: string;
  claimToken?: string;
  recordOptions: CreateRecordOptions;
}): Promise<void> {
  const record = await createRecordInternal(options.rootDir, options.config, {
    ...options.recordOptions,
    dryRun: true,
  });
  const workItemPath = await resolveWorkItemFile(
    options.rootDir,
    options.config,
    options.subject,
  );
  authorizeWorkMutation({
    rootDir: options.rootDir,
    taskId: options.subject,
    claimToken: options.claimToken,
    requiredPaths: [record.filePath, workItemPath],
  });
}

export async function ingestEvent(
  options: IngestEventOptions,
): Promise<IngestEventResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const payload = await readJsonFile<Record<string, unknown>>(
    path.resolve(rootDir, options.payloadPath),
  );

  if (options.provider !== "github") {
    throw new Error(`Provider '${options.provider}' is not implemented yet.`);
  }

  const subjects = extractGithubSubjects(payload);
  const actions: Array<Record<string, unknown>> = [];
  const automationProvider = getProviderForForge(options.provider);

  if (options.event.startsWith("pull_request")) {
    const pullRequest =
      (payload.pull_request as Record<string, unknown> | undefined) ?? {};
    const prUrl =
      typeof pullRequest.html_url === "string"
        ? pullRequest.html_url
        : undefined;
    const merged = pullRequest.merged === true;
    const mergeCommitSha =
      typeof pullRequest.merge_commit_sha === "string"
        ? pullRequest.merge_commit_sha
        : undefined;
    const title =
      typeof pullRequest.title === "string"
        ? pullRequest.title
        : "Merged pull request";

    for (const subject of subjects) {
      if (prUrl) {
        await linkWorkItem({
          rootDir,
          consumerConfig: options.consumerConfig,
          id: subject,
          kind: "pr",
          value: prUrl,
          claimToken: options.claimToken,
          dryRun: options.dryRun,
        });
        actions.push({ type: "link", subject, kind: "pr", value: prUrl });
      }
      if (merged && mergeCommitSha) {
        await recordWorkItemCommit({
          rootDir,
          consumerConfig: options.consumerConfig,
          id: subject,
          sha: mergeCommitSha,
          summary: title,
          claimToken: options.claimToken,
          dryRun: options.dryRun,
        });
        actions.push({
          type: "record-commit",
          subject,
          sha: mergeCommitSha,
          summary: title,
        });
      }
      if (merged && config.automation.autoCloseOnMerge) {
        const workItemPath = await resolveWorkItemFile(
          rootDir,
          config,
          subject,
        );
        const workItem = await readMarkdown(workItemPath);
        const links =
          typeof workItem.frontmatter.links === "object" &&
          workItem.frontmatter.links !== null
            ? (workItem.frontmatter.links as Record<string, unknown>)
            : {};
        if (
          ensureArray(links.evidence).length > 0 &&
          typeof workItem.frontmatter.actual === "number"
        ) {
          await finalizeWorkItem({
            rootDir,
            consumerConfig: options.consumerConfig,
            id: subject,
            claimToken: options.claimToken,
            dryRun: options.dryRun,
            pullRequestPath: config.automation.pullRequestPath,
            provider: automationProvider,
          });
          actions.push({ type: "finalize", subject });
        }
      }
    }
  }

  if (
    options.event.startsWith("workflow_run") &&
    config.automation.autoEvidenceFromWorkflowRuns
  ) {
    const workflowRun =
      (payload.workflow_run as Record<string, unknown> | undefined) ?? {};
    const workflowName =
      typeof workflowRun.name === "string" ? workflowRun.name : "workflow";
    const conclusion =
      typeof workflowRun.conclusion === "string"
        ? workflowRun.conclusion
        : undefined;
    const htmlUrl =
      typeof workflowRun.html_url === "string"
        ? workflowRun.html_url
        : undefined;
    const runId =
      workflowRun.id !== undefined ? String(workflowRun.id) : workflowName;

    for (const subject of subjects) {
      const subjectSlug = subject.replace(/^work-item:/, "");
      const recordOptions: CreateRecordOptions = {
        id: buildRecordId(
          `${subjectSlug}-${slugify(workflowName)}-${slugify(runId)}`,
        ),
        summary: `${workflowName} result for ${subject}`,
        subtype: "test-result",
        status: "ready",
        statusReason: "recorded",
        outcome: githubWorkflowOutcome(conclusion),
        recordedAt:
          typeof workflowRun.updated_at === "string"
            ? workflowRun.updated_at
            : new Date().toISOString(),
        observation: `Workflow '${workflowName}' completed with conclusion '${
          conclusion ?? "unknown"
        }'.`,
        findings: htmlUrl ? [`Run details: ${htmlUrl}`] : undefined,
        subjects: [`[[work-item-${subjectSlug}]]`],
        artifactRefs: htmlUrl ? [htmlUrl] : undefined,
        dryRun: options.dryRun,
      };
      if (!options.dryRun) {
        await reserveEventEvidenceMutation({
          rootDir,
          config,
          subject,
          claimToken: options.claimToken,
          recordOptions,
        });
      }
      const record = await createRecordInternal(rootDir, config, recordOptions);
      const evidenceLink = `[[${stripMarkdownExtension(
        path.basename(record.filePath),
      )}]]`;
      await linkWorkItem({
        rootDir,
        consumerConfig: options.consumerConfig,
        id: subject,
        kind: "evidence",
        value: evidenceLink,
        claimToken: options.claimToken,
        dryRun: options.dryRun,
      });
      actions.push({
        type: "create-record",
        subject,
        record: record.id,
        outcome: githubWorkflowOutcome(conclusion),
      });
      actions.push({
        type: "link",
        subject,
        kind: "evidence",
        value: evidenceLink,
      });
    }
  }

  return {
    provider: options.provider,
    event: options.event,
    dryRun: Boolean(options.dryRun),
    subjects,
    actions,
  };
}
