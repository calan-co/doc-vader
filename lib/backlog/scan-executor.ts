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
import { SubjectResolverChain, type SubjectResolverContext } from "./resolver.js";
import { getProviderForForge } from "./provider-registry.js";
import type { BacklogAutomationProvider } from "./provider.js";
import { createRecord, linkWorkItem } from "../work-management/index.js";

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

async function collectMarkdownFiles(
  dir: string,
  includeArchive: boolean,
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
      if (!includeArchive && entry.name === "archive") continue;
      files.push(...(await collectMarkdownFiles(full, includeArchive)));
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
  resolverOrder: ReturnType<typeof normalizeResolverOrder>,
  provider: BacklogAutomationProvider,
): WorkItemScanResult {
  let data: Record<string, unknown>;
  try {
    const parsed = matter(content);
    data = parsed.data as Record<string, unknown>;
  } catch (err) {
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
          message: `Failed to parse frontmatter: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    };
  }

  const { conditions, errors } = evaluateConditions(data);

  // For Phase B, we'll compute subject resolution asynchronously later
  // Return a partial result and resolve subjects in the executor loop

  return {
    file,
    id: typeof data["id"] === "string" ? data["id"] : null,
    status: typeof data["status"] === "string" ? data["status"] : null,
    lifecycle: typeof data["lifecycle"] === "string" ? data["lifecycle"] : null,
    title: typeof data["title"] === "string" ? data["title"] : null,
    conditions,
    errors,
    // Placeholder - will be filled in by resolver chain in async context
    subjectResolution: undefined,
  };
}

function toWorkItemSlug(id: string): string {
  return id.replace(/^work-item:/, "");
}

function formatEvidenceTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

function extractRecordIdFromEvidenceLink(link: string): string | null {
  const match = link.match(/^\[\[record-([^\]]+)\]\]$/);
  if (!match) {
    return null;
  }
  return `record:${match[1]}`;
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
  },
): Promise<NonNullable<WorkItemScanResult["evidenceGeneration"]>> {
  if (!item.id || !item.id.startsWith("work-item:")) {
    return {
      created: false,
      recordIds: [],
      errors: [],
    };
  }

  const resolvedSubjects = item.subjectResolution?.subjects ?? [];
  if (!resolvedSubjects.includes(item.id)) {
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
    return {
      created: false,
      recordIds: [existingRecordId],
      errors: [],
    };
  }

  const workItemSlug = toWorkItemSlug(item.id);
  const linkedAt = new Date().toISOString();
  const recordSlug = `${formatEvidenceTimestamp(new Date(linkedAt))}-${workItemSlug}`;
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
  const dryRun = options.dryRun ?? false;
  const consumerConfig = options.consumerConfig;
  const resolverOrder = normalizeResolverOrder(options.resolverOrder);

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

  const files = await collectMarkdownFiles(backlogDir, includeArchive);
  const items: WorkItemScanResult[] = [];

  for (const file of files) {
    const rel = toPosix(path.relative(rootDir, file));
    try {
      const content = await fs.readFile(file, "utf8");
      const result = parseWorkItem(rel, content, resolverOrder, provider);

      // Phase B: Resolve subjects using the resolver chain (now async)
      if (!result.conditions.find((c) => c.code === "file_parsed" && !c.value)) {
        const data = matter(content).data as Record<string, unknown>;
        const context: SubjectResolverContext = {
          content,
          data,
          id: result.id,
          provider,
        };

        result.subjectResolution = await resolverChain.resolveSubjects(context, resolverOrder);

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
        });
        result.evidenceGeneration = evidenceGeneration;
        for (const message of evidenceGeneration.errors) {
          result.errors.push({
            code: "evidence_generation_failed",
            message,
          });
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
      count + (item.evidenceGeneration?.created ? item.evidenceGeneration.recordIds.length : 0),
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
      resolverOrder,
    },
    summary: {
      totalFiles: items.length,
      filesWithErrors,
      errorCount: allErrors.length,
      evidenceRecordsCreated,
    },
    items,
    exitCode,
  };
}
