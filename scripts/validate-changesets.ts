#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";

type ReleaseType = "major" | "minor" | "patch";

interface ChangesetEntry {
  packageName: string;
  releaseType: ReleaseType;
}

export interface ChangesetFileValidation {
  filePath: string;
  entries: ChangesetEntry[];
  errors: string[];
}

export interface RequirementEvaluation {
  changedFiles: string[];
  releaseRelevantFiles: string[];
  changesetFiles: string[];
  requiresChangeset: boolean;
  errors: string[];
}

const DEFAULT_EXEMPT_PREFIXES = [
  "docs/",
  "backlog/",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  ".github/",
  ".doc-vader/",
  "AGENTS.md",
];

const RELEASE_TYPES = new Set(["major", "minor", "patch"]);
const GIT_LOCAL_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
];

function toPosix(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isExemptPath(filePath: string, exemptPrefixes: readonly string[]): boolean {
  const normalized = toPosix(filePath);
  return exemptPrefixes.some((prefix) => {
    const normalizedPrefix = toPosix(prefix);
    return normalized === normalizedPrefix || normalized.startsWith(normalizedPrefix);
  });
}

function isChangesetPath(filePath: string): boolean {
  const normalized = toPosix(filePath);
  return normalized.startsWith(".changeset/") && normalized.endsWith(".md");
}

function readConfiguredBaseBranch(rootDir: string): string {
  const configPath = path.resolve(rootDir, ".changeset/config.json");
  if (!existsSync(configPath)) {
    return "main";
  }

  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    baseBranch?: unknown;
  };
  return typeof config.baseBranch === "string" && config.baseBranch.length > 0
    ? config.baseBranch
    : "main";
}

function readCiChangesetExemptPrefixes(rootDir: string): string[] {
  const workflowPath = path.resolve(rootDir, ".github/workflows/ci.yml");
  if (!existsSync(workflowPath)) {
    return [...DEFAULT_EXEMPT_PREFIXES];
  }

  const workflow = readFileSync(workflowPath, "utf8");
  const match = workflow.match(/^\s*changeset-exempt-path-prefixes:\s*['"]([^'"]+)['"]\s*$/m);
  if (!match?.[1]) {
    return [...DEFAULT_EXEMPT_PREFIXES];
  }

  return match[1].split(/\s+/).filter(Boolean);
}

export function evaluateChangesetRequirement(
  changedFiles: readonly string[],
  exemptPrefixes: readonly string[] = DEFAULT_EXEMPT_PREFIXES,
): RequirementEvaluation {
  const normalizedChangedFiles = changedFiles.map(toPosix).filter(Boolean).sort();
  const releaseRelevantFiles = normalizedChangedFiles.filter(
    (filePath) => !isExemptPath(filePath, exemptPrefixes),
  );
  const changesetFiles = normalizedChangedFiles.filter(isChangesetPath);
  const requiresChangeset = releaseRelevantFiles.length > 0;
  const errors: string[] = [];

  if (requiresChangeset && changesetFiles.length === 0) {
    errors.push(
      [
        "Release-relevant files changed without a changeset.",
        "Add a .changeset/*.md file with `pnpm changeset`, or update the exemption list if this change is intentionally release-neutral.",
        `Release-relevant files: ${releaseRelevantFiles.join(", ")}`,
      ].join("\n"),
    );
  }

  return {
    changedFiles: normalizedChangedFiles,
    releaseRelevantFiles,
    changesetFiles,
    requiresChangeset,
    errors,
  };
}

export function validateChangesetFile(
  filePath: string,
  content: string,
  validPackageNames: readonly string[],
): ChangesetFileValidation {
  const errors: string[] = [];
  const entries: ChangesetEntry[] = [];
  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(content);
  } catch (error) {
    return {
      filePath,
      entries,
      errors: [`invalid changeset frontmatter: ${(error as Error).message}`],
    };
  }

  for (const [packageName, releaseType] of Object.entries(parsed.data)) {
    if (!validPackageNames.includes(packageName)) {
      errors.push(
        `unknown package '${packageName}'; expected one of: ${validPackageNames.join(", ")}`,
      );
      continue;
    }

    if (typeof releaseType !== "string" || !RELEASE_TYPES.has(releaseType)) {
      errors.push(
        `package '${packageName}' has invalid release type '${String(releaseType)}'; expected major, minor, or patch`,
      );
      continue;
    }

    entries.push({
      packageName,
      releaseType: releaseType as ReleaseType,
    });
  }

  if (entries.length === 0 && errors.length === 0) {
    errors.push("changeset has no package release entries");
  }

  return {
    filePath,
    entries,
    errors,
  };
}

export function validateChangesetFiles(
  files: readonly { filePath: string; content: string }[],
  validPackageNames: readonly string[],
): ChangesetFileValidation[] {
  return files.map((file) =>
    validateChangesetFile(file.filePath, file.content, validPackageNames),
  );
}

function readPackageName(rootDir: string): string {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(rootDir, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
    throw new Error("package.json must define a non-empty package name.");
  }
  return packageJson.name;
}

function listChangesetFiles(rootDir: string): { filePath: string; content: string }[] {
  const changesetDir = path.resolve(rootDir, ".changeset");
  if (!existsSync(changesetDir)) {
    return [];
  }

  return readdirSync(changesetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const absolutePath = path.join(changesetDir, entry.name);
      return {
        filePath: toPosix(path.relative(rootDir, absolutePath)),
        content: readFileSync(absolutePath, "utf8"),
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function resolveSinceRef(rootDir: string, baseBranch: string): string {
  const candidates = [
    process.env.DOC_VADER_CHANGESET_SINCE,
    `origin/${baseBranch}`,
    baseBranch,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      git(rootDir, ["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    `Unable to resolve changeset base ref. Tried: ${candidates.join(", ")}`,
  );
}

function changedFilesSince(rootDir: string, sinceRef: string): string[] {
  let base = sinceRef;
  try {
    base = git(rootDir, ["merge-base", "HEAD", sinceRef]);
  } catch {
    // Fall back to the provided ref. Git diff will report a clear error if invalid.
  }

  const output = git(rootDir, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRT",
    `${base}...HEAD`,
  ]);
  return output.split(/\r?\n/).filter(Boolean);
}

export function changesetStatusEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitizedEnv = { ...env };
  for (const name of GIT_LOCAL_ENV_VARS) {
    delete sanitizedEnv[name];
  }
  return sanitizedEnv;
}

function runChangesetStatus(rootDir: string, sinceRef: string): void {
  execFileSync("pnpm", ["changeset", "status", `--since=${sinceRef}`], {
    cwd: rootDir,
    env: changesetStatusEnv(),
    stdio: "inherit",
  });
}

function parseArgs(
  argv: readonly string[],
  defaultBaseBranch: string,
): { since?: string; baseBranch: string } {
  let since: string | undefined;
  let baseBranch = defaultBaseBranch;

  for (const arg of argv) {
    if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length);
      continue;
    }
    if (arg.startsWith("--base-branch=")) {
      baseBranch = arg.slice("--base-branch=".length);
    }
  }

  return { since, baseBranch };
}

export function formatValidationErrors(
  validations: readonly ChangesetFileValidation[],
): string[] {
  return validations.flatMap((validation) =>
    validation.errors.map((error) => `${validation.filePath}: ${error}`),
  );
}

async function main(): Promise<number> {
  const rootDir = process.cwd();
  const { since, baseBranch } = parseArgs(
    process.argv.slice(2),
    readConfiguredBaseBranch(rootDir),
  );
  const sinceRef = since ?? resolveSinceRef(rootDir, baseBranch);
  const packageName = readPackageName(rootDir);
  const changedFiles = changedFilesSince(rootDir, sinceRef);
  const requirement = evaluateChangesetRequirement(
    changedFiles,
    readCiChangesetExemptPrefixes(rootDir),
  );
  const changesetFiles = listChangesetFiles(rootDir);
  const changesetValidations = validateChangesetFiles(changesetFiles, [packageName]);
  const changesetErrors = formatValidationErrors(changesetValidations);
  const errors = [...requirement.errors, ...changesetErrors];

  if (errors.length > 0) {
    console.error("Changeset validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error("\nFix these issues before pushing.");
    return 1;
  }

  if (requirement.requiresChangeset) {
    runChangesetStatus(rootDir, sinceRef);
  } else {
    console.log("Changeset check passed: no release-relevant files changed.");
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
