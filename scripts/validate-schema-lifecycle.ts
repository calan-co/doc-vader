#!/usr/bin/env tsx
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

type JsonObject = Record<string, unknown>;

interface Finding {
  file: string;
  message: string;
}

interface CliOptions {
  allowCurrentRefs: boolean;
}

const ROOT_DIR = process.cwd();
const SCHEMAS_ROOT = join(ROOT_DIR, "schemas");
const DOC_VADER_RAW_BASE =
  "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/";
const LEGACY_RAW_BASE =
  "https://raw.githubusercontent.com/templjs/templ.js/main/schemas/";

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function collectJsonFiles(dirPath: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function collectStrings(value: unknown, strings: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, strings);
    }
    return strings;
  }

  if (!value || typeof value !== "object") {
    return strings;
  }

  const record = value as JsonObject;
  for (const entry of Object.values(record)) {
    collectStrings(entry, strings);
  }

  return strings;
}

function hasEmptyEnum(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasEmptyEnum(entry));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as JsonObject;
  if (Array.isArray(record.enum) && record.enum.length === 0) {
    return true;
  }

  return Object.values(record).some((entry) => hasEmptyEnum(entry));
}

function normalizeSchemaUri(value: string): string {
  return value
    .replaceAll(LEGACY_RAW_BASE, DOC_VADER_RAW_BASE)
    .replace(/\/current\.json(?=([#?]|$))/g, "/current")
    .replace(/\/latest\.json(?=([#?]|$))/g, "/latest")
    .replace(/\/(\d+\.\d+\.\d+)\.json(?=([#?]|$))/g, "/$1");
}

function expectedIdSuffix(fileName: string): string | null {
  if (!fileName.endsWith(".json")) {
    return null;
  }

  return `/${fileName.slice(0, -5)}`;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  return {
    allowCurrentRefs:
      argv.includes("--allow-current-refs") ||
      process.env.DOC_VADER_SCHEMA_POLICY_ALLOW_CURRENT_REFS === "1",
  };
}

function run(): number {
  const options = parseCliOptions(process.argv.slice(2));
  const schemaFiles = collectJsonFiles(SCHEMAS_ROOT).sort();
  const findings: Finding[] = [];
  const schemaIds = new Map<string, string>();

  for (const schemaFile of schemaFiles) {
    const relativePath = toPosixPath(relative(ROOT_DIR, schemaFile));
    const fileName = schemaFile.split("/").at(-1) ?? "";

    let document: JsonObject;
    try {
      document = parseJson(schemaFile);
    } catch (error) {
      findings.push({
        file: relativePath,
        message: `invalid JSON: ${(error as Error).message}`,
      });
      continue;
    }

    if (hasEmptyEnum(document)) {
      findings.push({
        file: relativePath,
        message:
          "contains enum: [] (Ajv rejects empty enums); use a bounded constraint or unsatisfiable branch instead",
      });
    }

    const schemaId = typeof document.$id === "string" ? document.$id : null;
    if (schemaId) {
      const normalizedId = normalizeSchemaUri(schemaId);
      if (normalizedId !== schemaId) {
        findings.push({
          file: relativePath,
          message: `$id must use the doc-vader namespace and extensionless schema URI form: ${schemaId}`,
        });
      }

      const existingPath = schemaIds.get(schemaId);
      if (existingPath && existingPath !== relativePath) {
        findings.push({
          file: relativePath,
          message: `duplicates $id used by ${existingPath}: ${schemaId}`,
        });
      } else {
        schemaIds.set(schemaId, relativePath);
      }

      const suffix = expectedIdSuffix(fileName);
      if (suffix && !schemaId.endsWith(suffix)) {
        findings.push({
          file: relativePath,
          message: `$id must end with '${suffix}' for ${fileName}`,
        });
      }

      if (schemaId.includes(LEGACY_RAW_BASE)) {
        findings.push({
          file: relativePath,
          message: `$id must not use the legacy templjs namespace: ${schemaId}`,
        });
      }

      if (schemaId.includes(".json")) {
        findings.push({
          file: relativePath,
          message: `$id must be extensionless: ${schemaId}`,
        });
      }
    }

    if (fileName !== "current.json" && !options.allowCurrentRefs) {
      for (const ref of collectStrings(document)) {
        if (typeof ref === "string" && ref.includes("/current")) {
          findings.push({
            file: relativePath,
            message:
              "schema references current schema via $ref (editing artifact not allowed in finalized graph): " +
              ref,
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error("Schema lifecycle policy violations:\n");
    for (const finding of findings) {
      console.error(`- ${finding.file}: ${finding.message}`);
    }
    console.error("\nFix these violations before running validation.");
    console.error(
      "For local drafting only, rerun with '--allow-current-refs' or set DOC_VADER_SCHEMA_POLICY_ALLOW_CURRENT_REFS=1."
    );
    return 1;
  }

  console.log(`Schema lifecycle policy check passed (${schemaFiles.length} files).`);
  return 0;
}

process.exit(run());