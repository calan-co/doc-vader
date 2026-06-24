import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonRecord, JsonValue } from "../evaluation/types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../..");
const FRONTMATTER_SUPPORT_SCHEMA_ROOT = path.join(REPO_ROOT, "schemas/frontmatter/support");
const WORK_ITEM_FRONTMATTER_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/work-management/frontmatter/work-item.json",
);
const WORK_ITEM_CONTENT_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/work-management/content/work-item.json",
);
const WORK_ITEM_PROPOSAL_BATCH_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/work-management/support/work-item-proposal-batch.json",
);
const VALIDATION_SCHEMA_PATHS = [
  path.join(FRONTMATTER_SUPPORT_SCHEMA_ROOT, "base/1.0.0.json"),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "contracts/audience-token.contract/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "contracts/classification-token.contract/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "contracts/governance-mode.contract/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "contracts/reconciliation-strategy-token.contract/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "contracts/status-reason-token.contract/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "overlays/audience-token.vocab.core/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "overlays/classification-token.vocab.core/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "overlays/governance-mode.vocab.core/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "overlays/reconciliation-strategy-token.vocab.core/1.0.0.json",
  ),
  path.join(
    FRONTMATTER_SUPPORT_SCHEMA_ROOT,
    "overlays/status-reason-token.vocab.core/1.0.0.json",
  ),
  path.join(REPO_ROOT, "schemas/work-management/support/common.json"),
  path.join(REPO_ROOT, "schemas/work-management/workflows/default/status-definitions.json"),
  path.join(
    REPO_ROOT,
    "schemas/work-management/workflows/default/generated/status-reason-compatibility.json",
  ),
  path.join(REPO_ROOT, "schemas/work-management/workflows/default/status-policy.json"),
  path.join(REPO_ROOT, "schemas/work-management/contracts/work-item-structure.json"),
  path.join(REPO_ROOT, "schemas/work-management/frontmatter/work-item.json"),
  path.join(REPO_ROOT, "schemas/work-management/content/work-item.json"),
  path.join(REPO_ROOT, "schemas/work-management/support/work-item-proposal-batch.json"),
] as const;

const SYNTHESIS_SCHEMA_VERSION = "backlog-review-synthesis/v1" as const;
const SYNTHESIS_KIND = "backlog-review-synthesis" as const;
const PROPOSAL_BATCH_SCHEMA_VERSION = "work-item-proposal-batch/v1" as const;
const PROPOSAL_BATCH_KIND = "work-item-proposal-batch" as const;
const MATERIALIZATION_MODE = "propose-only" as const;
const FRONTMATTER_SUPPORT_COMMIT = "ba226f8a801750d1fedc6486c82624034ac24533";

export type ReviewApprovalScope =
  | "rubric"
  | "architecture"
  | "repository"
  | "execution-policy"
  | "backlog"
  | "implementation"
  | "release"
  | "external-integration"
  | "security";

export type ReviewApprovalAuthority =
  | "interpretation"
  | "governance"
  | "administration"
  | "execution";

export interface ReviewApprovalRequirement {
  scope: ReviewApprovalScope;
  authority: ReviewApprovalAuthority;
}

export interface ReviewDecisionBranch {
  id: string;
  label: string;
  summary: string;
}

export interface ReviewSynthesisItem {
  id: string;
  subjectRefs: readonly string[];
  sourceFindingRefs: readonly string[];
  decisionTopic: string;
  openQuestion: string;
  recommendedAnswer: string;
  rationale: string;
  evidenceRefs: readonly string[];
  blockingReason: string;
  decisionBranches: readonly ReviewDecisionBranch[];
  recommendedDecisionOrder: readonly string[];
  priority: "low" | "medium" | "high" | "critical";
  confidence: number;
  requiredApprovals: readonly ReviewApprovalRequirement[];
}

export interface ReviewSynthesisCapture {
  schemaVersion: typeof SYNTHESIS_SCHEMA_VERSION;
  kind: typeof SYNTHESIS_KIND;
  report: {
    reportId: string;
    profileId: string;
  };
  subjectRefs: readonly string[];
  sourceFindingRefs: readonly string[];
  items: readonly ReviewSynthesisItem[];
}

export interface ReviewFindingSummary {
  ref: string;
  summary: string;
}

export interface RenderReviewSynthesisPromptOptions {
  synthesis: ReviewSynthesisCapture;
  findings?: readonly ReviewFindingSummary[];
}

export interface WorkItemProposalSource {
  reportId: string;
  synthesisId: string;
  profileId: string;
}

export interface WorkItemProposalProvenance {
  reportId: string;
  synthesisId: string;
  profileId: string;
  synthesisItemId: string;
  subjectRefs: readonly string[];
  sourceFindingRefs: readonly string[];
  decisionBranchRefs: readonly string[];
}

export interface WorkItemProposalDraft {
  frontmatter: JsonRecord;
  content: JsonRecord;
  provenance: WorkItemProposalProvenance;
  requiredApprovals: readonly ReviewApprovalRequirement[];
}

export interface WorkItemProposal extends WorkItemProposalDraft {
  dedupeKey: string;
}

export interface WorkItemProposalBatch {
  schemaVersion: typeof PROPOSAL_BATCH_SCHEMA_VERSION;
  kind: typeof PROPOSAL_BATCH_KIND;
  source: WorkItemProposalSource;
  materializationMode: typeof MATERIALIZATION_MODE;
  generatedAt?: string;
  proposals: readonly WorkItemProposal[];
}

export interface BuildWorkItemProposalBatchOptions {
  source: WorkItemProposalSource;
  proposals: readonly WorkItemProposalDraft[];
  generatedAt?: string;
}

type SchemaLike = Record<string, unknown>;

let validationAjvPromise: Promise<Ajv2020> | undefined;

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug : "proposal";
}

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function sortApprovals(approvals: readonly ReviewApprovalRequirement[]): ReviewApprovalRequirement[] {
  return [...approvals]
    .map((approval) => ({
      scope: approval.scope,
      authority: approval.authority,
    }))
    .sort((left, right) => {
      const scope = left.scope.localeCompare(right.scope);
      if (scope !== 0) {
        return scope;
      }
      return left.authority.localeCompare(right.authority);
    });
}

function approvalTuple(approval: ReviewApprovalRequirement): string {
  return `${approval.scope}:${approval.authority}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiresAfkTag(frontmatter: JsonRecord): boolean {
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return tags.map((tag) => tag.trim().toLowerCase()).includes("afk");
}

async function readJsonFile(filePath: string): Promise<SchemaLike> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as SchemaLike;
}

function addSchemaIfMissing(ajv: Ajv2020, schema: SchemaLike): void {
  const schemaId = typeof schema.$id === "string" ? schema.$id : undefined;
  if (schemaId && ajv.getSchema(schemaId)) {
    return;
  }
  ajv.addSchema(schema);
}

function addSchemaAliases(ajv: Ajv2020, schema: SchemaLike): void {
  const schemaId = typeof schema.$id === "string" ? schema.$id : undefined;
  if (!schemaId) {
    return;
  }
  addSchemaIfMissing(ajv, { ...schema, $id: schemaId });
  if (schemaId.endsWith(".json")) {
    addSchemaIfMissing(ajv, { ...schema, $id: schemaId.slice(0, -5) });
  }
  if (
    schemaId.startsWith(
      "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/frontmatter/support/",
    )
  ) {
    addSchemaIfMissing(
      ajv,
      {
        ...schema,
        $id: schemaId.replace(
          "/main/schemas/frontmatter/support/",
          `/` + FRONTMATTER_SUPPORT_COMMIT + `/schemas/frontmatter/support/`,
        ),
      },
    );
  }
}

async function createValidationAjv(): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  for (const schemaPath of VALIDATION_SCHEMA_PATHS) {
    const schema = await readJsonFile(schemaPath);
    addSchemaIfMissing(ajv, schema);
    addSchemaAliases(ajv, schema);
  }

  return ajv;
}

async function getValidationAjv(): Promise<Ajv2020> {
  validationAjvPromise ??= createValidationAjv();
  return validationAjvPromise;
}

async function validateAgainstSchema(
  schemaPath: string,
  value: JsonRecord,
  label: string,
): Promise<void> {
  const [ajv, schema] = await Promise.all([
    getValidationAjv(),
    readJsonFile(schemaPath),
  ]);
  const schemaId = typeof schema.$id === "string" ? schema.$id : undefined;
  const validate = schemaId
    ? ajv.getSchema(schemaId) ?? ajv.compile(schema)
    : ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(
      `${label} failed validation: ${JSON.stringify(validate.errors ?? [], null, 2)}`,
    );
  }
}

async function validateWorkItemProposalDocument(
  frontmatter: JsonRecord,
  content: JsonRecord,
): Promise<void> {
  await validateAgainstSchema(
    WORK_ITEM_FRONTMATTER_SCHEMA_PATH,
    frontmatter,
    "Proposal frontmatter",
  );
  await validateAgainstSchema(
    WORK_ITEM_CONTENT_SCHEMA_PATH,
    content,
    "Proposal content",
  );
}

function canonicalApprovalTuples(
  approvals: readonly ReviewApprovalRequirement[],
): string[] {
  return sortApprovals(approvals).map(approvalTuple);
}

function canonicalStringList(values: readonly string[]): string[] {
  return sortUnique(values).map((value) => normalizeText(value));
}

function extractAcceptanceCriterionText(criterion: unknown): string | undefined {
  if (!criterion || typeof criterion !== "object") {
    return undefined;
  }

  const text = (criterion as Record<string, unknown>).text;
  return typeof text === "string" ? normalizeText(text) : undefined;
}

function buildDedupePreimage(
  source: WorkItemProposalSource,
  proposal: WorkItemProposalDraft,
): string {
  const frontmatter = proposal.frontmatter;
  const content = proposal.content;
  const title = normalizeText(asString(frontmatter.title) ?? "");
  const goal = normalizeText(asString(content.goal) ?? "");
  const subtype = asString(frontmatter.subtype) ?? "";
  const acceptanceCriteria = Array.isArray(content.acceptanceCriteria)
    ? content.acceptanceCriteria
        .map(extractAcceptanceCriterionText)
        .filter((criterion): criterion is string => criterion !== undefined)
        .sort((left, right) => left.localeCompare(right))
    : [];
  return JSON.stringify({
    schemaVersion: PROPOSAL_BATCH_SCHEMA_VERSION,
    sourceReportId: source.reportId,
    sourceFindingRefs: canonicalStringList(proposal.provenance.sourceFindingRefs),
    synthesisItemIds: canonicalStringList([proposal.provenance.synthesisItemId]),
    subjectRefs: canonicalStringList(proposal.provenance.subjectRefs),
    proposalSubtype: subtype,
    normalizedTitle: title,
    normalizedGoal: goal,
    acceptanceCriteria,
    requiredApprovalTuples: canonicalApprovalTuples(proposal.requiredApprovals),
  });
}

function deriveProvisionalWorkItemId(
  title: string,
  dedupeKey: string,
  usedIds: Set<string>,
): string {
  const baseId = `work-item:${slugify(title)}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  const hashSource = dedupeKey.slice("sha256:".length);
  for (const size of [8, 12, 16, 20, 24, 32]) {
    const candidate = `${baseId}-${hashSource.slice(0, size)}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Unable to derive a unique provisional id for '${title}'.`);
}

function normalizeFrontmatter(
  frontmatter: JsonRecord,
  provisionalId: string,
): JsonRecord {
  return {
    ...cloneJson(frontmatter),
    id: provisionalId,
  };
}

function normalizeContent(content: JsonRecord): JsonRecord {
  return cloneJson(content);
}

function normalizeProposalDraft(
  source: WorkItemProposalSource,
  proposal: WorkItemProposalDraft,
  usedIds: Set<string>,
): WorkItemProposal {
  const dedupePreimage = buildDedupePreimage(source, proposal);
  const dedupeKey = `sha256:${sha256Hex(dedupePreimage)}`;
  const title = normalizeText(asString(proposal.frontmatter.title) ?? "");
  const provisionalId = deriveProvisionalWorkItemId(title, dedupeKey, usedIds);
  const frontmatter = normalizeFrontmatter(proposal.frontmatter, provisionalId);
  const content = normalizeContent(proposal.content);

  return {
    frontmatter,
    content,
    provenance: {
      reportId: source.reportId,
      synthesisId: source.synthesisId,
      profileId: source.profileId,
      synthesisItemId: proposal.provenance.synthesisItemId,
      subjectRefs: canonicalStringList(proposal.provenance.subjectRefs),
      sourceFindingRefs: canonicalStringList(
        proposal.provenance.sourceFindingRefs,
      ),
      decisionBranchRefs: canonicalStringList(
        proposal.provenance.decisionBranchRefs,
      ),
    },
    requiredApprovals: sortApprovals(proposal.requiredApprovals),
    dedupeKey,
  };
}

function ensureNoAfkWithApprovals(proposal: WorkItemProposal): void {
  if (
    proposal.requiredApprovals.length > 0 &&
    requiresAfkTag(proposal.frontmatter)
  ) {
    throw new Error(
      "Proposals with required approvals must not include the afk tag.",
    );
  }
}

function ensureUniqueFieldValues(
  values: readonly string[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} '${value}'.`);
    }
    seen.add(value);
  }
}

function sortProposals(proposals: readonly WorkItemProposal[]): WorkItemProposal[] {
  return [...proposals].sort((left, right) => {
    const leftId = asString(left.frontmatter.id) ?? "";
    const rightId = asString(right.frontmatter.id) ?? "";
    return leftId.localeCompare(rightId) || left.dedupeKey.localeCompare(right.dedupeKey);
  });
}

export function createReviewSynthesisCapture(
  input: Omit<ReviewSynthesisCapture, "schemaVersion" | "kind">,
): ReviewSynthesisCapture {
  return {
    schemaVersion: SYNTHESIS_SCHEMA_VERSION,
    kind: SYNTHESIS_KIND,
    report: {
      reportId: input.report.reportId.trim(),
      profileId: input.report.profileId.trim(),
    },
    subjectRefs: canonicalStringList(input.subjectRefs),
    sourceFindingRefs: canonicalStringList(input.sourceFindingRefs),
    items: input.items.map((item) => ({
      ...item,
      subjectRefs: canonicalStringList(item.subjectRefs),
      sourceFindingRefs: canonicalStringList(item.sourceFindingRefs),
      evidenceRefs: canonicalStringList(item.evidenceRefs),
      decisionBranches: item.decisionBranches.map((branch) => ({
        id: branch.id.trim(),
        label: branch.label.trim(),
        summary: branch.summary.trim(),
      })),
      recommendedDecisionOrder: canonicalStringList(item.recommendedDecisionOrder),
      requiredApprovals: sortApprovals(item.requiredApprovals),
      decisionTopic: normalizeText(item.decisionTopic),
      openQuestion: normalizeText(item.openQuestion),
      recommendedAnswer: normalizeText(item.recommendedAnswer),
      rationale: normalizeText(item.rationale),
      blockingReason: normalizeText(item.blockingReason),
      priority: item.priority,
      confidence: item.confidence,
      id: item.id.trim(),
    })),
  };
}

export function formatBacklogReviewSynthesisJson(
  capture: ReviewSynthesisCapture,
): string {
  return JSON.stringify(capture, null, 2);
}

export function formatBacklogReviewSynthesisText(
  capture: ReviewSynthesisCapture,
  findings: readonly ReviewFindingSummary[] = [],
): string {
  const findingMap = new Map(
    findings.map((finding) => [finding.ref, finding.summary] as const),
  );
  const lines: string[] = [];
  lines.push("Backlog Review Synthesis");
  lines.push(`  Report   : ${capture.report.reportId}`);
  lines.push(`  Profile  : ${capture.report.profileId}`);
  lines.push(`  Subjects : ${capture.subjectRefs.join(", ") || "none"}`);
  lines.push(`  Findings : ${capture.sourceFindingRefs.join(", ") || "none"}`);
  lines.push("");

  for (const item of capture.items) {
    lines.push(`${item.id} | ${item.decisionTopic}`);
    lines.push(`  Open Question : ${item.openQuestion}`);
    lines.push(`  Recommended   : ${item.recommendedAnswer}`);
    lines.push(`  Rationale     : ${item.rationale}`);
    lines.push(`  Blocking      : ${item.blockingReason}`);
    lines.push(`  Confidence    : ${item.confidence}`);
    lines.push(`  Priority      : ${item.priority}`);
    lines.push(`  Subjects      : ${item.subjectRefs.join(", ") || "none"}`);
    lines.push(`  Findings      : ${item.sourceFindingRefs.join(", ") || "none"}`);

    if (item.evidenceRefs.length > 0) {
      lines.push(`  Evidence      : ${item.evidenceRefs.join(", ")}`);
    }

    if (item.requiredApprovals.length > 0) {
      lines.push(
        `  Required Approvals: ${item.requiredApprovals
          .map((approval) => `${approval.scope}/${approval.authority}`)
          .join(", ")}`,
      );
    }

    if (item.decisionBranches.length > 0) {
      lines.push("  Decision Branches:");
      for (const branch of item.decisionBranches) {
        lines.push(`    - ${branch.id}: ${branch.label} :: ${branch.summary}`);
      }
    }

    if (item.recommendedDecisionOrder.length > 0) {
      lines.push(
        `  Recommended Order: ${item.recommendedDecisionOrder.join(" -> ")}`,
      );
    }

    for (const ref of item.sourceFindingRefs) {
      const summary = findingMap.get(ref);
      if (summary) {
        lines.push(`  Finding ${ref}: ${summary}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatWorkItemProposalBatchJson(
  batch: WorkItemProposalBatch,
): string {
  return JSON.stringify(batch, null, 2);
}

export function formatWorkItemProposalBatchText(
  batch: WorkItemProposalBatch,
): string {
  const lines: string[] = [];
  lines.push("Work Item Proposal Batch");
  lines.push(`  Report          : ${batch.source.reportId}`);
  lines.push(`  Synthesis       : ${batch.source.synthesisId}`);
  lines.push(`  Profile         : ${batch.source.profileId}`);
  lines.push(`  Materialization : ${batch.materializationMode}`);
  if (batch.generatedAt) {
    lines.push(`  Generated At    : ${batch.generatedAt}`);
  }
  lines.push("");

  for (const proposal of batch.proposals) {
    lines.push(`${asString(proposal.frontmatter.id) ?? "(missing id)"} | ${asString(proposal.frontmatter.title) ?? "(missing title)"}`);
    lines.push(`  Dedupe Key  : ${proposal.dedupeKey}`);
    lines.push(`  Provenance  : ${proposal.provenance.synthesisItemId}`);
    lines.push(`  Subjects    : ${proposal.provenance.subjectRefs.join(", ") || "none"}`);
    lines.push(
      `  Findings    : ${proposal.provenance.sourceFindingRefs.join(", ") || "none"}`,
    );
    lines.push(
      `  Branches    : ${proposal.provenance.decisionBranchRefs.join(", ") || "none"}`,
    );
    if (proposal.requiredApprovals.length > 0) {
      lines.push(
        `  Approvals   : ${proposal.requiredApprovals
          .map((approval) => `${approval.scope}/${approval.authority}`)
          .join(", ")}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export async function buildWorkItemProposalBatch(
  options: BuildWorkItemProposalBatchOptions,
): Promise<WorkItemProposalBatch> {
  const usedIds = new Set<string>();
  const proposals = options.proposals.map((proposal) =>
    normalizeProposalDraft(options.source, proposal, usedIds),
  );

  for (const proposal of proposals) {
    await validateWorkItemProposalDocument(proposal.frontmatter, proposal.content);
    ensureNoAfkWithApprovals(proposal);
  }

  ensureUniqueFieldValues(
    proposals.map((proposal) => asString(proposal.frontmatter.id) ?? ""),
    "proposal frontmatter.id",
  );
  ensureUniqueFieldValues(
    proposals.map((proposal) => proposal.dedupeKey),
    "proposal dedupeKey",
  );

  return {
    schemaVersion: PROPOSAL_BATCH_SCHEMA_VERSION,
    kind: PROPOSAL_BATCH_KIND,
    source: {
      reportId: options.source.reportId.trim(),
      synthesisId: options.source.synthesisId.trim(),
      profileId: options.source.profileId.trim(),
    },
    materializationMode: MATERIALIZATION_MODE,
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    proposals: sortProposals(proposals),
  };
}

export async function validateWorkItemProposalBatch(
  batch: WorkItemProposalBatch,
): Promise<void> {
  await validateAgainstSchema(
    WORK_ITEM_PROPOSAL_BATCH_SCHEMA_PATH,
    batch as unknown as JsonRecord,
    "Proposal batch",
  );
  ensureUniqueFieldValues(
    batch.proposals.map((proposal) => asString(proposal.frontmatter.id) ?? ""),
    "proposal frontmatter.id",
  );
  ensureUniqueFieldValues(
    batch.proposals.map((proposal) => proposal.dedupeKey),
    "proposal dedupeKey",
  );
  for (const proposal of batch.proposals) {
    await validateWorkItemProposalDocument(
      proposal.frontmatter,
      proposal.content,
    );
    ensureNoAfkWithApprovals(proposal);
  }
}
