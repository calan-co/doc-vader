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

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "audit") continue;
      files.push(...(await collectMarkdownFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function parseWorkItem(file: string, content: string): WorkItemScanResult {
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
          message: `Failed to parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const { conditions, errors } = evaluateConditions(data);

  return {
    file,
    id: typeof data["id"] === "string" ? data["id"] : null,
    status: typeof data["status"] === "string" ? data["status"] : null,
    lifecycle: typeof data["lifecycle"] === "string" ? data["lifecycle"] : null,
    title: typeof data["title"] === "string" ? data["title"] : null,
    conditions,
    errors,
  };
}

export async function scanBacklog(options: BacklogScanOptions = {}): Promise<BacklogScanReport> {
  const scanId = randomUUID();
  const generatedAt = new Date().toISOString();

  const rootDir = options.rootDir ?? process.cwd();
  const backlogDir = path.resolve(rootDir, options.backlogDir ?? "backlog");
  const reportFormat = options.reportFormat ?? "text";
  const strict = options.strict ?? false;
  const debug = options.debug ?? false;

  if (debug) {
    process.stderr.write(`[backlog scan] scanning ${backlogDir}\n`);
  }

  const files = await collectMarkdownFiles(backlogDir);
  const items: WorkItemScanResult[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const rel = path.relative(rootDir, file);
    const result = parseWorkItem(rel, content);
    items.push(result);
  }

  const allErrors: ScanError[] = items.flatMap((i) => i.errors);
  const filesWithErrors = items.filter((i) => i.errors.length > 0).length;

  const exitCode = strict && allErrors.length > 0 ? 1 : 0;

  return {
    scanId,
    generatedAt,
    options: { backlogDir: path.relative(rootDir, backlogDir), reportFormat, strict, debug },
    summary: {
      totalFiles: items.length,
      filesWithErrors,
      errorCount: allErrors.length,
    },
    items,
    exitCode,
  };
}
