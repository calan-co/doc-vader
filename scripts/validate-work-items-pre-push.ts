import matter from "gray-matter";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type SeveritySetting = "none" | "info" | "warn" | "error";

interface ValidationIssue {
  severity: Exclude<SeveritySetting, "none">;
  message: string;
}

interface ValidationConfig {
  baselineSchema: string;
  changedSchema: string;
  archiveSchema: string;
  baselineSeverity: SeveritySetting;
  changedSeverity: SeveritySetting;
  archiveSeverity: SeveritySetting;
  checklistSeverity: SeveritySetting;
}

interface ConsumerPrePushValidationConfig {
  schemas?: {
    baseline?: string;
    changed?: string;
    archive?: string;
  };
  severity?: {
    baseline?: string;
    changed?: string;
    archive?: string;
    checklist?: string;
  };
}

const ROOT_DIR = process.cwd();

const DEFAULT_CONFIG: ValidationConfig = {
  baselineSchema: "schemas/frontmatter/work-item/1.0.0.json",
  changedSchema: "schemas/frontmatter/work-item/latest.json",
  archiveSchema: "schemas/frontmatter/work-item/1.0.0.json",
  baselineSeverity: "error",
  changedSeverity: "error",
  archiveSeverity: "warn",
  checklistSeverity: "error",
};

function normalizeSeverity(raw: string | undefined, fallback: SeveritySetting): SeveritySetting {
  if (!raw) {
    return fallback;
  }

  const value = raw.trim().toLowerCase();
  if (value === "none") return "none";
  if (value === "info") return "info";
  if (value === "warn" || value === "warning") return "warn";
  if (value === "error") return "error";
  return fallback;
}

function readConsumerPrePushValidationConfig(): ConsumerPrePushValidationConfig {
  const consumerConfigPath =
    process.env.DOC_VADER_PREPUSH_CONSUMER_CONFIG ||
    path.resolve(ROOT_DIR, ".doc-vader/backlog-consumer.json");

  try {
    const raw = readFileSync(consumerConfigPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const automation =
      typeof parsed.automation === "object" && parsed.automation !== null
        ? (parsed.automation as Record<string, unknown>)
        : null;

    if (!automation) {
      return {};
    }

    const direct =
      typeof automation.prePushValidation === "object" &&
      automation.prePushValidation !== null
        ? (automation.prePushValidation as Record<string, unknown>)
        : null;

    const nestedValidation =
      typeof automation.validation === "object" && automation.validation !== null
        ? (automation.validation as Record<string, unknown>)
        : null;

    const nested =
      nestedValidation &&
      typeof nestedValidation.prePush === "object" &&
      nestedValidation.prePush !== null
        ? (nestedValidation.prePush as Record<string, unknown>)
        : null;

    const candidate = direct ?? nested;
    if (!candidate) {
      return {};
    }

    return {
      schemas:
        typeof candidate.schemas === "object" && candidate.schemas !== null
          ? (candidate.schemas as ConsumerPrePushValidationConfig["schemas"])
          : undefined,
      severity:
        typeof candidate.severity === "object" && candidate.severity !== null
          ? (candidate.severity as ConsumerPrePushValidationConfig["severity"])
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/i.test(message)) {
      return {};
    }
    throw error;
  }
}

function loadConfig(): ValidationConfig {
  const consumerConfig = readConsumerPrePushValidationConfig();

  const baselineSchema =
    process.env.DOC_VADER_PREPUSH_SCHEMA_BASELINE ||
    consumerConfig.schemas?.baseline ||
    DEFAULT_CONFIG.baselineSchema;
  const changedSchema =
    process.env.DOC_VADER_PREPUSH_SCHEMA_CHANGED ||
    consumerConfig.schemas?.changed ||
    DEFAULT_CONFIG.changedSchema;
  const archiveSchema =
    process.env.DOC_VADER_PREPUSH_SCHEMA_ARCHIVE ||
    consumerConfig.schemas?.archive ||
    DEFAULT_CONFIG.archiveSchema;

  const baselineSeverity = normalizeSeverity(
    process.env.DOC_VADER_PREPUSH_SEVERITY_BASELINE ||
      consumerConfig.severity?.baseline,
    DEFAULT_CONFIG.baselineSeverity,
  );
  const changedSeverity = normalizeSeverity(
    process.env.DOC_VADER_PREPUSH_SEVERITY_CHANGED ||
      consumerConfig.severity?.changed,
    DEFAULT_CONFIG.changedSeverity,
  );
  const checklistSeverity = normalizeSeverity(
    process.env.DOC_VADER_PREPUSH_SEVERITY_CHECKLIST ||
      consumerConfig.severity?.checklist,
    DEFAULT_CONFIG.checklistSeverity,
  );

  const archiveSeverity = normalizeSeverity(
    consumerConfig.severity?.archive,
    DEFAULT_CONFIG.archiveSeverity,
  );

  return {
    baselineSchema,
    changedSchema,
    archiveSchema,
    baselineSeverity,
    changedSeverity,
    archiveSeverity,
    checklistSeverity,
  };
}

function resolveSchemaSpec(spec: string): string {
  if (/^https?:\/\//i.test(spec)) {
    return spec;
  }

  if (spec.startsWith("file://")) {
    return new URL(spec).pathname;
  }

  if (spec.startsWith("/frontmatter/")) {
    return path.resolve(ROOT_DIR, "schemas", spec.replace(/^\//, "") + (spec.endsWith(".json") ? "" : ".json"));
  }

  if (path.isAbsolute(spec)) {
    return spec;
  }

  return path.resolve(ROOT_DIR, spec);
}

async function loadSchemaObject(spec: string): Promise<Record<string, unknown>> {
  if (/^https?:\/\//i.test(spec)) {
    const response = await fetch(spec);
    if (!response.ok) {
      throw new Error(`failed to load schema URL ${spec}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  const resolved = resolveSchemaSpec(spec);
  return JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
}

async function buildValidators(config: ValidationConfig) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  // Support /frontmatter/document/1.0.0 refs used by local work-item schemas.
  const documentSchemaPath = path.resolve(ROOT_DIR, "schemas/frontmatter/document/1.0.0.json");
  if (existsSync(documentSchemaPath)) {
    const documentSchema = JSON.parse(readFileSync(documentSchemaPath, "utf8")) as Record<string, unknown>;
    ajv.addSchema(documentSchema, "/frontmatter/document/1.0.0");
  }

  const compiled = new Map<string, ReturnType<Ajv2020["compile"]>>();
  const uniqueSpecs = new Set([
    config.baselineSchema,
    config.changedSchema,
    config.archiveSchema,
  ]);

  for (const spec of uniqueSpecs) {
    const schema = await loadSchemaObject(spec);
    compiled.set(spec, ajv.compile(schema));
  }

  return compiled;
}

function runGit(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryRunGit(args: string[]): string | null {
  try {
    return runGit(args);
  } catch {
    return null;
  }
}

function changedFilesForPush(): string[] {
  const upstream =
    tryRunGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]) ??
    "origin/staging";
  const mergeBase = runGit(["merge-base", "HEAD", upstream]);
  const output = runGit([
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    `${mergeBase}...HEAD`,
  ]);

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function sectionBody(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));

  if (headingIndex < 0) {
    return null;
  }

  const bodyLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? "")) {
      break;
    }
    bodyLines.push(lines[i] ?? "");
  }

  return bodyLines.join("\n");
}

function uncheckedChecklistMessages(filePath: string, markdown: string): string[] {
  const errors: string[] = [];
  const sections = ["Tasks", "Acceptance Criteria"];

  for (const section of sections) {
    const body = sectionBody(markdown, section);
    if (body === null) {
      errors.push(`${filePath}: missing section '## ${section}'.`);
      continue;
    }

    const checklistMatches = [...body.matchAll(/^\s*-\s*\[([ xX])\]\s+/gm)];
    if (checklistMatches.length === 0) {
      errors.push(`${filePath}: section '## ${section}' has no checklist items.`);
      continue;
    }

    const unchecked = checklistMatches.filter((match) => match[1] === " ");
    if (unchecked.length > 0) {
      errors.push(
        `${filePath}: section '## ${section}' has ${unchecked.length} unchecked checklist item(s).`,
      );
    }
  }

  return errors;
}

function isArchiveFile(filePath: string): boolean {
  return filePath.startsWith("backlog/archive/");
}

function emitIssue(
  issues: ValidationIssue[],
  severity: SeveritySetting,
  message: string,
): void {
  if (severity === "none") {
    return;
  }

  issues.push({
    severity,
    message,
  });
}

function validateWorkItem(
  filePath: string,
  validators: Map<string, ReturnType<Ajv2020["compile"]>>,
  config: ValidationConfig,
): ValidationIssue[] {
  const content = readFileSync(filePath, "utf8");
  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;

  if (frontmatter.type !== "work-item") {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const status = typeof frontmatter.status === "string" ? frontmatter.status : "";

  const archived = isArchiveFile(filePath);
  const validationSpecs = archived
    ? [{ spec: config.archiveSchema, severity: config.archiveSeverity }]
    : [
        { spec: config.baselineSchema, severity: config.baselineSeverity },
        { spec: config.changedSchema, severity: config.changedSeverity },
      ];

  for (const { spec, severity } of validationSpecs) {
    if (severity === "none") {
      continue;
    }

    const validate = validators.get(spec);
    if (!validate) {
      emitIssue(issues, severity, `${filePath}: missing validator for schema '${spec}'.`);
      continue;
    }

    const ok = validate(frontmatter);
    if (!ok) {
      for (const issue of validate.errors ?? []) {
        const where = issue.instancePath || "(root)";
        emitIssue(
          issues,
          severity,
          `${filePath}: schema '${spec}' ${where} ${issue.message ?? "invalid"}.`,
        );
      }
    }
  }

  if (status === "ready-for-review" || status === "closed") {
    const checklistSeverity =
      archived && config.archiveSeverity !== "none" ? config.archiveSeverity : config.checklistSeverity;
    const checklistIssues: ValidationIssue[] = uncheckedChecklistMessages(filePath, parsed.content)
      .map((message) => {
        if (checklistSeverity === "none") {
          return null;
        }
        return {
          severity: checklistSeverity,
          message,
        };
      })
      .filter((entry): entry is ValidationIssue => entry !== null);
    issues.push(...checklistIssues);
  }

  return issues;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const validators = await buildValidators(config);

  const files = changedFilesForPush();
  const candidateFiles = files.filter((file) => {
    return file.startsWith("backlog/") && file.endsWith(".md") && existsSync(file);
  });

  if (candidateFiles.length === 0) {
    console.log("pre-push(work-item): no changed backlog markdown files detected.");
    return;
  }

  const issues = candidateFiles.flatMap((file) => validateWorkItem(file, validators, config));
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warn");
  const infos = issues.filter((issue) => issue.severity === "info");

  if (infos.length > 0) {
    console.log("pre-push(work-item): info");
    for (const info of infos) {
      console.log(`- ${info.message}`);
    }
  }

  if (warnings.length > 0) {
    console.warn("pre-push(work-item): warnings");
    for (const warning of warnings) {
      console.warn(`- ${warning.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("pre-push(work-item): validation failed");
    for (const error of errors) {
      console.error(`- ${error.message}`);
    }
    process.exit(1);
  }

  console.log("pre-push(work-item): validation passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pre-push(work-item): unexpected error: ${message}`);
  process.exit(1);
});
