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
  schemaDir: string
): Promise<any> {
  return loadDefaultSchemaByType(nameOrUri, schemaDir);
}

async function loadDefaultSchemaByType(nameOrUri: string, schemaDir: string) {
  const name = path.posix.basename(nameOrUri);
  if (name.includes("latest")) {
    let target = await getVersionedName(name, schemaDir);
    return loadSchema(target, schemaDir);
  }
  if (schemaCache.has(name)) return schemaCache.get(name);
  const schemaPath = path.join(schemaDir, name);
  const raw = await fs.readFile(schemaPath, "utf8");
  const json = JSON.parse(raw);
  schemaCache.set(name, json);
  return json;
}
export async function getValidator(
  schemaName: string,
  schemaDir: string,
  ajv: InstanceType<typeof Ajv>
): Promise<ValidateFunction> {
  let validate = ajv.getSchema(schemaName) as ValidateFunction | undefined;
  if (!validate) {
    await loadSchema(schemaName, schemaDir);
    validate = await ajv.compileAsync(schemaCache.get(schemaName));
  }
  if (!validate) throw new Error(`Could not compile schema: ${schemaName}`);
  return validate;
}
