import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePullRequestWorkItems } from "../lib/work/merge-gate.js";

function value(name: string): string | undefined {
  const result = process.env[name]?.trim();
  return result || undefined;
}

const ROOT_DIR = path.resolve(
  value("DOC_VADER_ROOT") ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

function requiredPullRequestUrl(): string {
  const explicit = value("DOC_VADER_PULL_REQUEST_URL");
  if (explicit) return explicit;

  const repository = value("GITHUB_REPOSITORY");
  const number = value("DOC_VADER_PULL_REQUEST_NUMBER");
  if (!repository || !number || !/^\d+$/.test(number)) {
    throw new Error(
      "PR merge gate requires DOC_VADER_PULL_REQUEST_URL or GITHUB_REPOSITORY and DOC_VADER_PULL_REQUEST_NUMBER.",
    );
  }
  return `https://github.com/${repository}/pull/${number}`;
}

function parseChangedPaths(serialized: string, source: string): string[] {
  const parsed: unknown = JSON.parse(serialized);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${source} must contain a JSON array of file paths.`);
  }
  return parsed;
}

function changedPaths(): string[] {
  const configured = value("DOC_VADER_CHANGED_PATHS");
  const configuredFile = value("DOC_VADER_CHANGED_PATHS_FILE");
  if (configured && configuredFile) {
    throw new Error(
      "Use either DOC_VADER_CHANGED_PATHS or DOC_VADER_CHANGED_PATHS_FILE, not both.",
    );
  }
  if (configured)
    return parseChangedPaths(configured, "DOC_VADER_CHANGED_PATHS");
  if (configuredFile) {
    return parseChangedPaths(
      readFileSync(configuredFile, "utf8"),
      "DOC_VADER_CHANGED_PATHS_FILE",
    );
  }

  const base = value("DOC_VADER_BASE_SHA");
  const head = value("DOC_VADER_HEAD_SHA");
  if (!base || !head) {
    throw new Error(
      "PR merge gate requires DOC_VADER_CHANGED_PATHS or DOC_VADER_BASE_SHA and DOC_VADER_HEAD_SHA.",
    );
  }

  return execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRDT", base, head],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
    },
  )
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

function collectMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main(): void {
  const backlogDirectory = path.join(ROOT_DIR, "backlog");
  const errors = validatePullRequestWorkItems({
    pullRequestUrl: requiredPullRequestUrl(),
    changedPaths: changedPaths(),
    workItems: collectMarkdownFiles(backlogDirectory)
      .map((filePath) => ({
        fullPath: filePath,
        filePath: path.relative(ROOT_DIR, filePath).split(path.sep).join("/"),
      }))
      .filter(
        ({ filePath }) =>
          !["backlog/archive/", "backlog/records/", "backlog/audit/"].some(
            (directory) => filePath.startsWith(directory),
          ),
      )
      .map(({ fullPath, filePath }) => ({
        filePath,
        content: readFileSync(fullPath, "utf8"),
      })),
  }).errors;

  if (errors.length > 0) {
    console.error("pull-request(work-item): validation failed");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("pull-request(work-item): validation passed.");
}

try {
  main();
} catch (error) {
  console.error(
    `pull-request(work-item): unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
