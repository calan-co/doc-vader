import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BacklogScanOptions,
  BacklogScanReport,
  WorkItemScanResult,
  ScanError,
  SubjectResolverName,
} from "./scan-types.js";
import { evaluateConditions } from "./scan-conditions.js";
import { normalizeResolverOrder } from "./scan-resolver.js";
import {
  SubjectResolverChain,
  type SubjectResolverContext,
} from "./resolver.js";
import {
  matchesWorkItemId,
  normalizeWorkItemMatchPatterns,
} from "./configurable-rules.js";
import { getProviderForForge } from "./provider-registry.js";
import {
  createRecord,
  finalizeWorkItem,
  linkWorkItem,
  loadConsumerConfig,
  transitionWorkItem,
} from "../work-management/index.js";
import {
  parseWorkItemContext,
  validateArchiveReadiness,
  validateClosedWorkItemEvidence,
} from "../plugins/work-item-validation.js";

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function isWithinPath(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function collectMarkdownFiles(
  dir: string,
  includeArchive: boolean,
  archiveDir?: string,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "audit") continue;
      if (!includeArchive && archiveDir && isWithinPath(full, archiveDir)) {
        continue;
      }
      files.push(...(await collectMarkdownFiles(full, includeArchive, archiveDir)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function parseWorkItem(
  file: string,
  content: string,
  generatedAt: string,
  pullRequestPath?: string,
): WorkItemScanResult {
  let data: Record<string, unknown>;
  try {
    const parsed = matter(content);
    data = parsed.data as Record<string, unknown>;
  } catch (err) {
    const parseMessage =
      err instanceof Error ? err.message : String(err);
    const { errors } = evaluateConditions({}, { pullRequestPath });
    return {
      file,
      id: null,
      status: null,
      lifecycle: null,
      title: null,
      conditions: [{ code: "file_parsed", value: false }],
      errors: [
        {
          code: "parse_failed",
          message: `Frontmatter parsing failed: ${parseMessage}`,
        },
        ...errors,
      ],
    };
  }

  const { conditions, errors } = evaluateConditions(data, { pullRequestPath });

  // For Phase B, we'll compute subject resolution asynchronously later
  // Return a partial result and resolve subjects in the executor loop

  return {
    file,
    id: typeof data["id"] === "string" ? data["id"] : null,
    status: typeof data["status"] === "string" ? data["status"] : null,
    lifecycle: typeof data["lifecycle"] === "string" ? data["lifecycle"] : null,
    title: typeof data["title"] === "string" ? data["title"] : null,
    eventMetadata: {
      id: typeof data["id"] === "string" ? data["id"] : file,
      type: "work_item",
      timestamp: generatedAt,
    },
    conditions,
    errors,
    // Placeholder - will be filled in by resolver chain in async context
    subjectResolution: undefined,
  };
}

function toWorkItemSlug(id: string, patterns?: string[]): string {
  const normalizedPatterns = normalizeWorkItemMatchPatterns(patterns);
  const matchedPrefix = normalizedPatterns.find((pattern) =>
    id.toLowerCase().startsWith(pattern.toLowerCase()),
  );

  if (!matchedPrefix) {
    return id;
  }

  return id.slice(matchedPrefix.length);
}

function isEvidenceEligibleWorkItemId(id: string, patterns?: string[]): boolean {
  return matchesWorkItemId(id, patterns);
}

function extractWikiTargets(content: string): string[] {
  const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)];
  return links
    .map((match) => (typeof match[1] === "string" ? match[1] : ""))
    .map((target) => target.split("|")[0].split("#")[0].trim())
    .filter((target) => target.length > 0)
    .map((target) => target.replace(/\.md$/i, ""));
}

/**
 * Resolve a wikilink target to the best matching file in the known file pool.
 *
 * Matching is basename-only (strip extension, strip path prefix from target).
 * When multiple files share the same basename, they are sorted by:
 *   1. Depth distance from source file (primary) — nearest-by-depth wins
 *   2. Alphabetical path order (secondary tiebreaker)
 *
 * Only files present in `allRelFiles` are candidates (archive files are included
 * in the pool so links to them resolve correctly rather than falling through to
 * an active file of the same name).
 */
function resolveWikiLink(
  target: string,
  sourceRelPath: string,
  allRelFiles: string[],
): string | null {
  const targetBasename = path.posix.basename(target.replace(/\.md$/i, ""));

  const matches = allRelFiles.filter(
    (f) => path.posix.basename(f.replace(/\.md$/i, "")) === targetBasename,
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sourceDir = path.posix.dirname(sourceRelPath);
  const sourceDepth = sourceDir === "." ? 0 : sourceDir.split("/").length;

  return (
    [...matches].sort((a, b) => {
      // Primary: absolute depth distance from source (nearest wins)
      const aDir = path.posix.dirname(a);
      const bDir = path.posix.dirname(b);
      const distA = Math.abs(
        (aDir === "." ? 0 : aDir.split("/").length) - sourceDepth,
      );
      const distB = Math.abs(
        (bDir === "." ? 0 : bDir.split("/").length) - sourceDepth,
      );
      if (distA !== distB) return distA - distB;
      // Secondary: alphabetical tiebreaker
      return a.localeCompare(b);
    })[0] ?? null
  );
}

function formatEvidenceTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function extractRecordIdFromEvidenceLink(link: string): string | null {
  const match = link.match(/^\[\[([^\]]+)\]\]$/);
  if (!match || typeof match[1] !== "string") {
    return null;
  }

  const target = match[1].split("|")[0].split("#")[0].trim();

  if (target.length === 0) {
    return null;
  }

  const basename = target.split("/").pop() ?? "";
  const withoutExtension = basename.replace(/\.md$/i, "");

  if (!withoutExtension.startsWith("record-")) {
    return null;
  }

  const slug = withoutExtension.slice("record-".length);
  if (slug.length === 0) {
    return null;
  }

  return `record:${slug}`;
}

async function findExistingEvidenceRecordId(
  workItemFilePath: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(workItemFilePath, "utf8");
    const frontmatter = matter(content).data as Record<string, unknown>;
    const links = frontmatter["links"];

    // Handle object shape: links: { evidence: ["[[record-...]]"] }
    if (typeof links === "object" && links !== null && !Array.isArray(links)) {
      const evidence = (links as Record<string, unknown>)["evidence"];
      if (Array.isArray(evidence)) {
        for (const value of evidence) {
          if (typeof value !== "string") {
            continue;
          }
          const recordId = extractRecordIdFromEvidenceLink(value);
          if (recordId) {
            return recordId;
          }
        }
      }
    }

    // Handle list-of-maps shape: links: [{ evidence: "[[record-...]]" }]
    if (Array.isArray(links)) {
      for (const entry of links) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const evidence = (entry as Record<string, unknown>)["evidence"];
        if (typeof evidence !== "string") {
          continue;
        }
        const recordId = extractRecordIdFromEvidenceLink(evidence);
        if (recordId) {
          return recordId;
        }
      }
    }
  } catch {
    // Best effort check; fall through to record creation.
  }

  return null;
}

async function generateEvidenceForItem(
  item: WorkItemScanResult,
  options: Required<Pick<BacklogScanOptions, "rootDir">> & {
    consumerConfig?: string;
    dryRun: boolean;
    force?: boolean;
    workItemMatchPatterns?: string[];
  },
): Promise<NonNullable<WorkItemScanResult["evidenceGeneration"]>> {
  if (!item.id || !isEvidenceEligibleWorkItemId(item.id, options.workItemMatchPatterns)) {
    return {
      created: false,
      recordIds: [],
      errors: [],
    };
  }

  const resolvedSubjects = item.subjectResolution?.subjects ?? [];
  if (!options.force && !resolvedSubjects.includes(item.id)) {
    return {
      created: false,
      recordIds: [],
      errors: [],
    };
  }

  const existingRecordId = await findExistingEvidenceRecordId(
    path.resolve(options.rootDir, item.file),
  );
  if (existingRecordId) {
    const linkedAt = new Date().toISOString();
    const existingRecordSlug = existingRecordId.replace(/^record:/, "");
    const existingRecordBasename = `record-${existingRecordSlug}`;

    try {
      // Ensure canonical links.evidence array exists for downstream archive/finalize validators.
      await linkWorkItem({
        rootDir: options.rootDir,
        consumerConfig: options.consumerConfig,
        id: item.id,
        kind: "evidence",
        value: `[[${existingRecordBasename}]]`,
        dryRun: options.dryRun,
      });
    } catch (error) {
      return {
        created: false,
        recordIds: [existingRecordId],
        linkedAt,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    return {
      created: false,
      recordIds: [existingRecordId],
      linkedAt,
      errors: [],
    };
  }

  const workItemSlug = toWorkItemSlug(item.id, options.workItemMatchPatterns);
  const linkedAt = new Date().toISOString();
  const recordSlug = `${formatEvidenceTimestamp(
    new Date(linkedAt),
  )}-${workItemSlug}`;
  const recordId = `record:${recordSlug}`;
  const recordBasename = `record-${recordSlug}`;

  try {
    const record = await createRecord({
      rootDir: options.rootDir,
      consumerConfig: options.consumerConfig,
      id: recordId,
      summary: `Backlog scan evidence for ${item.id}`,
      subtype: "evidence",
      status: "ready",
      statusReason: "recorded",
      outcome: item.errors.length > 0 ? "mixed" : "noted",
      recordedAt: linkedAt,
      observation:
        item.errors.length > 0
          ? `Backlog scan found ${item.errors.length} issue(s) in ${item.file}.`
          : `Backlog scan completed without errors for ${item.file}.`,
      findings: item.errors.map((error) => `[${error.code}] ${error.message}`),
      subjects: [`[[work-item-${workItemSlug}]]`],
      supportingRefs: [item.file],
      dryRun: options.dryRun,
    });

    await linkWorkItem({
      rootDir: options.rootDir,
      consumerConfig: options.consumerConfig,
      id: item.id,
      kind: "evidence",
      value: `[[${recordBasename}]]`,
      dryRun: options.dryRun,
    });

    return {
      created: !options.dryRun,
      recordIds: [record.id],
      linkedAt,
      errors: [],
    };
  } catch (error) {
    return {
      created: false,
      recordIds: [],
      linkedAt,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function hasEvidenceLinks(frontmatter: Record<string, unknown>): boolean {
  const links = frontmatter["links"];

  // Handle object shape: links: { evidence: ["[[record-...]]"] }
  if (typeof links === "object" && links !== null && !Array.isArray(links)) {
    const evidence = (links as Record<string, unknown>)["evidence"];
    if (Array.isArray(evidence)) {
      return evidence.some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
    }
  }

  return false;
}

export async function scanBacklog(
  options: BacklogScanOptions = {},
): Promise<BacklogScanReport> {
  const scanId = randomUUID();
  const generatedAt = new Date().toISOString();

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = path.resolve(rootDir, options.backlogDir ?? "backlog");
  const includeArchive = options.includeArchive ?? false;
  const reportFormat = options.reportFormat ?? "text";
  const strict = options.strict ?? false;
  const debug = options.debug ?? false;
  const generateEvidence = options.generateEvidence ?? false;
  const validateArchiveCandidates = options.validateArchiveCandidates ?? false;
  const dryRun = options.dryRun ?? false;
  const consumerConfig = options.consumerConfig;

  const loadedConfig = await loadConsumerConfig(rootDir, consumerConfig);
  const archiveDir = path.resolve(rootDir, loadedConfig.roots.archive);

  // Resolve resolver order: CLI flag > consumer config > default
  let resolverOrder: ReturnType<typeof normalizeResolverOrder>;
  if (options.resolverOrder && options.resolverOrder.length > 0) {
    resolverOrder = normalizeResolverOrder(options.resolverOrder);
  } else {
    resolverOrder = normalizeResolverOrder(
      loadedConfig.automation.subjectResolutionOrder,
    );
  }

  const shouldValidateArchiveCandidates =
    validateArchiveCandidates ||
    loadedConfig.automation.validateArchiveCandidates;
  const invalidCandidateStatus = options.invalidCandidateStatus;
  const configuredInvalidStatus =
    loadedConfig.automation.invalidCandidateStatus;
  const effectiveInvalidStatus =
    typeof invalidCandidateStatus === "string"
      ? invalidCandidateStatus
      : configuredInvalidStatus;

  let candidateItemsEvaluated = 0;
  let candidatesArchived = 0;
  let candidateDiscrepancies = 0;
  let invalidStatusUpdates = 0;

  if (debug) {
    process.stderr.write(`[backlog scan] scanning ${backlogDir}\n`);
  }

  // Initialize provider for vendor-specific operations (Phase B)
  const provider = getProviderForForge("github");
  const resolverChain = new SubjectResolverChain();

  try {
    const stat = await fs.stat(backlogDir);
    if (!stat.isDirectory()) {
      throw new Error(`Backlog path is not a directory: ${backlogDir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Backlog directory not found: ${backlogDir}`);
    }
    throw err;
  }

  const files = await collectMarkdownFiles(backlogDir, includeArchive, archiveDir);
  const relFiles = files.map((file) => toPosix(path.relative(rootDir, file)));
  const items: WorkItemScanResult[] = [];

  for (const file of files) {
    const rel = toPosix(path.relative(rootDir, file));
    try {
      const content = await fs.readFile(file, "utf8");
      const result = parseWorkItem(
        rel,
        content,
        generatedAt,
        loadedConfig.automation.pullRequestPath,
      );

      // Phase B: Resolve subjects using the resolver chain (now async)
      if (
        !result.conditions.find((c) => c.code === "file_parsed" && !c.value)
      ) {
        const data = matter(content).data as Record<string, unknown>;
        const context: SubjectResolverContext = {
          content,
          data,
          id: result.id,
          provider,
          workItemMatchPatterns:
            loadedConfig.automation.workItemMatchPatterns,
          pullRequestPath: loadedConfig.automation.pullRequestPath,
        };

        result.subjectResolution = await resolverChain.resolveSubjects(
          context,
          resolverOrder,
        );

        const subjectResolved = result.subjectResolution.subjects.length > 0;
        result.conditions.push({
          code: "subject_resolved",
          value: subjectResolved,
        });

        // Only propagate attempt errors when overall resolution failed.
        // Intermediate failures followed by a successful strategy are informational only.
        if (!subjectResolved) {
          for (const attempt of result.subjectResolution.attempts) {
            if (!attempt.error) {
              continue;
            }
            result.errors.push({
              code:
                attempt.strategy === "linked_pull_requests"
                  ? "fetch_pr_metadata_failed"
                  : "resolve_subject_failed",
              message: attempt.error,
            });
          }
        }

        if (debug && result.subjectResolution.strategyUsed) {
          process.stderr.write(
            `[backlog scan] Resolved ${result.id} using strategy: ${result.subjectResolution.strategyUsed}\n`,
          );
        }
      }

      if (generateEvidence) {
        const evidenceGeneration = await generateEvidenceForItem(result, {
          rootDir,
          consumerConfig,
          dryRun,
          workItemMatchPatterns:
            loadedConfig.automation.workItemMatchPatterns,
        });
        result.evidenceGeneration = evidenceGeneration;
        for (const message of evidenceGeneration.errors) {
          result.errors.push({
            code: "evidence_generation_failed",
            message,
          });
        }
      }

      if (shouldValidateArchiveCandidates) {
        let contentForCandidateValidation = content;
        if (generateEvidence && !dryRun) {
          try {
            contentForCandidateValidation = await fs.readFile(
              path.resolve(rootDir, rel),
              "utf8",
            );
          } catch (err) {
            result.errors.push({
              code: "candidate_validation_failed",
              message: `[candidate-validation] Failed to reload file after evidence generation: ${
                err instanceof Error ? err.message : String(err)
              }`,
            });
          }
        }

        const context = parseWorkItemContext({
          path: path.resolve(rootDir, rel),
          value: contentForCandidateValidation,
        }, {
          backlogRoot: backlogDir,
          archiveRoot: archiveDir,
        });
        const shouldEvaluate =
          context.isActiveBacklogWorkItem &&
          context.status === "completed";

        if (shouldEvaluate) {
          // Candidate sweep should backfill missing evidence links before archive checks,
          // even when subject resolution didn't map this item from event payloads.
          if (
            generateEvidence &&
            result.id &&
            !hasEvidenceLinks(context.frontmatter)
          ) {
            const forcedEvidenceGeneration = await generateEvidenceForItem(
              result,
              {
                rootDir,
                consumerConfig,
                dryRun,
                force: true,
                workItemMatchPatterns:
                  loadedConfig.automation.workItemMatchPatterns,
              },
            );
            result.evidenceGeneration = forcedEvidenceGeneration;
            for (const message of forcedEvidenceGeneration.errors) {
              result.errors.push({
                code: "evidence_generation_failed",
                message,
              });
            }

            if (!dryRun) {
              try {
                contentForCandidateValidation = await fs.readFile(
                  path.resolve(rootDir, rel),
                  "utf8",
                );
                context.frontmatter = matter(contentForCandidateValidation)
                  .data as Record<string, unknown>;
              } catch (err) {
                result.errors.push({
                  code: "candidate_validation_failed",
                  message: `[candidate-validation] Failed to reload file after forced evidence generation: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                });
              }
            }
          }

          candidateItemsEvaluated += 1;
          const issues = [
            ...validateArchiveReadiness(context, ["completed"], {
              pullRequestPath: loadedConfig.automation.pullRequestPath,
              requiredFields: loadedConfig.automation.requiredCandidateFields,
            }),
            ...validateClosedWorkItemEvidence(context),
          ];

          if (issues.length === 0 && result.id) {
            try {
              await finalizeWorkItem({
                rootDir,
                consumerConfig,
                id: result.id,
                dryRun,
                pullRequestPath: loadedConfig.automation.pullRequestPath,
                provider,
              });
              result.candidateValidation = {
                eligible: true,
                archived: !dryRun,
                discrepancies: [],
              };
              candidatesArchived += 1;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              result.errors.push({
                code: "candidate_validation_failed",
                message: `[candidate-validation] ${message}`,
              });
              result.candidateValidation = {
                eligible: false,
                archived: false,
                discrepancies: [message],
              };
              candidateDiscrepancies +=
                result.candidateValidation.discrepancies.length;
            }
          } else {
            const discrepancies = issues.map((issue) => issue.message);
            result.candidateValidation = {
              eligible: false,
              archived: false,
              discrepancies,
            };
            candidateDiscrepancies += discrepancies.length;
            for (const discrepancy of discrepancies) {
              result.errors.push({
                code: "candidate_validation_failed",
                message: discrepancy,
              });
            }

            if (
              result.id &&
              typeof effectiveInvalidStatus === "string" &&
              effectiveInvalidStatus.trim().length > 0 &&
              effectiveInvalidStatus !== "none"
            ) {
              try {
                await transitionWorkItem({
                  rootDir,
                  consumerConfig,
                  id: result.id,
                  status: effectiveInvalidStatus,
                  statusReason: "validation-failed",
                  dryRun,
                });
                result.candidateValidation.updatedStatus =
                  effectiveInvalidStatus;
                invalidStatusUpdates += 1;
              } catch (err) {
                result.errors.push({
                  code: "candidate_status_update_failed",
                  message: `[candidate-validation] Failed to update invalid status: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                });
              }
            }
          }
        }
      }

      items.push(result);
    } catch (err) {
      items.push({
        file: rel,
        id: null,
        status: null,
        lifecycle: null,
        title: null,
        conditions: [{ code: "file_parsed", value: false }],
        errors: [
          {
            code: "parse_failed",
            message: `Failed to read file: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      });
    }
  }

  const allErrors: ScanError[] = items.flatMap((i) => i.errors);
  const filesWithErrors = items.filter((i) => i.errors.length > 0).length;
  const evidenceRecordsCreated = items.reduce(
    (count, item) =>
      count +
      (item.evidenceGeneration?.created
        ? item.evidenceGeneration.recordIds.length
        : 0),
    0,
  );

  const exitCode = strict && allErrors.length > 0 ? 1 : 0;

  return {
    scanId,
    generatedAt,
    options: {
      backlogDir: toPosix(path.relative(rootDir, backlogDir)),
      reportFormat,
      strict,
      debug,
      validateArchiveCandidates: shouldValidateArchiveCandidates,
      invalidCandidateStatus: effectiveInvalidStatus ?? null,
      resolverOrder,
    },
    summary: {
      totalFiles: items.length,
      filesWithErrors,
      errorCount: allErrors.length,
      evidenceRecordsCreated,
      candidateItemsEvaluated,
      candidatesArchived,
      candidateDiscrepancies,
      invalidStatusUpdates,
    },
    items,
    exitCode,
  };
}
