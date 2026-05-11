import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BacklogScanOptions,
  BacklogScanReport,
  WorkItemScanResult,
  ScanError,
} from "./scan-types.js";
import { evaluateConditions } from "./scan-conditions.js";
import { normalizeResolverOrder, resolveSubjects } from "./scan-resolver.js";
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
  const subjectResolution = resolveSubjects(content, data, resolverOrder);

  return {
    file,
    id: typeof data["id"] === "string" ? data["id"] : null,
    status: typeof data["status"] === "string" ? data["status"] : null,
    lifecycle: typeof data["lifecycle"] === "string" ? data["lifecycle"] : null,
    title: typeof data["title"] === "string" ? data["title"] : null,
    conditions,
    errors,
    subjectResolution,
  };
}

function toWorkItemSlug(id: string): string {
  return id.replace(/^work-item:/, "");
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

  const workItemSlug = toWorkItemSlug(item.id);
  const recordSlug = `scan-${workItemSlug}`;
  const recordId = `record:${recordSlug}`;
  const recordBasename = `record-${recordSlug}`;
  const linkedAt = new Date().toISOString();

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
      const result = parseWorkItem(rel, content, resolverOrder);
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
