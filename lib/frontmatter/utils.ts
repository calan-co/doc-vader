import Ajv, { ValidateFunction } from "ajv";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Classifier } from "../interfaces/ruleset";
export { validateFrontmatter, formatAjvErrors } from "./lint.js";
export { checkSchemaDirective } from "./check.js";

export interface ValidateResult {
  file: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// Frontmatter classifier implementation example
export class FrontmatterClassifier implements Classifier<string, object> {
  classify(input: string): object {
    // TODO: Implement actual classification logic
    return {};
  }
}

// Frontmatter utility functions
export function parseFrontmatter(input: string): object {
  // TODO: Move logic from scripts/frontmatter-utils.ts here
  return {};
}

export async function readMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "schemas") continue;
      files.push(...(await readMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}
//TODO: use gray-matter instead?
export function extractFrontmatterBlock(raw: string): string {
  if (typeof raw === "string" && raw.startsWith("---")) {
    return raw.replace(/^---\s*/, "").replace(/\s*---\s*$/, "");
  }
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}
//TODO: Refactor solution to delete everything below this line.
export async function getVersionedName(
  name: string,
  schemaDir: string
): Promise<string> {
  const latestPath = path.join(schemaDir, name);
  let target: string = name;
  try {
    const stat = await fs.lstat(latestPath);
    if (stat.isSymbolicLink()) {
      const resolved = await fs.readlink(latestPath);
      target = path.posix.basename(resolved);
    } else {
      const files = await fs.readdir(schemaDir);
      const baseNamePattern = new RegExp(
        name.replaceAll(".", "\\.").replace(".latest\\.", "..*\\.")
      );
      const versionedFiles = files
        .filter((f) => baseNamePattern.test(f) && f !== name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (versionedFiles.length > 0) {
        versionedFiles.sort((a, b) => {
          const versionRegex = /(\d+\.\d+\.\d+)/;
          const verA = a.match(versionRegex);
          const verB = b.match(versionRegex);
          return verB && verA
            ? verB[1].localeCompare(verA[1], undefined, { numeric: true })
            : 0;
        });
        target = versionedFiles[0];
      }
    }
  } catch (e) {
    // TODO: log error?
    console.log(`Error resolving latest schema for ${name}:`, e);
  }
  if (target === name) {
    throw new Error(`Cannot resolve latest schema for ${name}`);
  }
  return target;
}

const schemaCache = new Map<string, any>();

export async function loadSchema(
  nameOrUri: string,
  schemaDir: string,
  baseDir?: string
): Promise<any> {
  return loadDefaultSchemaByType(nameOrUri, schemaDir, baseDir);
}

function resolveSchemaPath(
  nameOrUri: string,
  schemaDir: string,
  baseDir?: string
): string {
  if (/^https?:\/\//i.test(nameOrUri)) {
    const pathname = new URL(nameOrUri).pathname;
    const schemaIndex = pathname.indexOf("/schemas/");
    if (schemaIndex < 0) {
      return nameOrUri;
    }

    // Callers can override baseDir when schemaDir is not the schemas root.
    const schemaRelative = pathname.slice(schemaIndex + "/schemas/".length);
    const localBaseDir = baseDir ?? schemaDir;
    const localPath = path.join(localBaseDir, schemaRelative);
    return localPath.endsWith(".json") ? localPath : `${localPath}.json`;
  }

  if (path.isAbsolute(nameOrUri)) {
    return nameOrUri.endsWith(".json") ? nameOrUri : `${nameOrUri}.json`;
  }

  const localPath = path.join(schemaDir, nameOrUri);
  return localPath.endsWith(".json") ? localPath : `${localPath}.json`;
}

async function loadDefaultSchemaByType(
  nameOrUri: string,
  schemaDir: string,
  baseDir?: string
) {
  const name = path.posix.basename(nameOrUri);
  if (name.includes("latest")) {
    let target = await getVersionedName(name, schemaDir);
    return loadSchema(target, schemaDir, baseDir);
  }
  if (schemaCache.has(nameOrUri)) return schemaCache.get(nameOrUri);
  if (schemaCache.has(name)) return schemaCache.get(name);
  const schemaPath = resolveSchemaPath(nameOrUri, schemaDir, baseDir);
  const raw = await fs.readFile(schemaPath, "utf8");
  const json = JSON.parse(raw);
  schemaCache.set(nameOrUri, json);
  schemaCache.set(name, json);
  return json;
}
export async function getValidator(
  schemaName: string,
  schemaDir: string,
  ajv: InstanceType<typeof Ajv>,
  baseDir?: string
): Promise<ValidateFunction> {
  let validate = ajv.getSchema(schemaName) as ValidateFunction | undefined;
  if (!validate) {
    const schema = await loadSchema(schemaName, schemaDir, baseDir);
    await preloadSupportSchemas(ajv, path.join(schemaDir, "support"));
    validate = await ajv.compileAsync(schema);
  }
  if (!validate) throw new Error(`Could not compile schema: ${schemaName}`);
  return validate;
}

async function preloadSupportSchemas(
  ajv: InstanceType<typeof Ajv>,
  supportDir: string
): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const schema = JSON.parse(await fs.readFile(fullPath, "utf8"));
        if (schema?.$id && !ajv.getSchema(schema.$id)) {
          ajv.addSchema(schema, schema.$id);
        }
      }
    }
  }

  await walk(supportDir);
}
