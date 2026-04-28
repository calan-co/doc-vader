import { Linter, Fixer } from "../interfaces/ruleset";
import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import { ValidateResult } from "./utils.js";
import path from "node:path";
import semver from "semver";

// Frontmatter linter implementation example
export class FrontmatterLinter implements Linter<string | object, object> {
  lint(input: string | object): object {
    // TODO: Implement actual lint logic
    return {};
  }
}

// Frontmatter fixer implementation example
export class FrontmatterFixer implements Fixer<string | object, object> {
  async fix(input: string | object): Promise<object> {
    // TODO: Implement actual fix logic
    return {};
  }
}

export function formatAjvErrors(errors: ErrorObject[] = []): string[] {
  return errors.map(
    (e) => `${(e as any).instancePath || "(root)"} ${e.message}`
  );
}

export interface ValidateFrontmatterOptions {
  filePath?: string;
  content?: string;
  strictMissing?: boolean;
  schemaDir: string;
  ajv: InstanceType<typeof Ajv>;
}

export async function validateFrontmatter({
  filePath = "",
  content = "",
  strictMissing = true,
  schemaDir,
  ajv,
}: ValidateFrontmatterOptions): Promise<ValidateResult> {
  const raw = content ?? (filePath ? await fs.readFile(filePath, "utf8") : "");
  const fm = matter(raw);
  const data = fm.data;

  if (!data || Object.keys(data).length === 0 || !data.type) {
    const msg = "Missing frontmatter or no `type` specified";
    return {
      file: filePath ?? "(string)",
      ok: !strictMissing,
      errors: strictMissing ? [msg] : [],
      warnings: strictMissing ? [] : [`${msg} (warning)`],
    };
  }

  let baseSchemaId =
    data.$schema || data.schema || `/frontmatter/${data.type}/`;

  if (path.basename(baseSchemaId) === "latest")
    baseSchemaId = path.dirname(baseSchemaId);
  if (path.basename(baseSchemaId) === data.type)
    baseSchemaId = path.posix.join(baseSchemaId, "*");
  // Naive lookup of existing schema file
  let validate = ajv.getSchema(baseSchemaId) as ValidateFunction | undefined;
  if (!validate) {
    // That didn't work, let's see if we can resolve as semver to specific version
    const { schemaId, schemaPath } = await resolveSchemaPath(
      baseSchemaId,
      schemaDir
    );
    validate = ajv.getSchema(schemaId);

    // Still nothing. One last try: load schema from file
    if (!validate) {
      // Doesn't exist, bail out
      if (!(await fs.stat(schemaPath).catch(() => false))) {
        return {
          file: filePath ?? "(string)",
          ok: false,
          errors: [`Schema not found: ${baseSchemaId}`],
          warnings: [],
        };
      }
      const rawSchema = await fs.readFile(schemaPath, "utf8");
      const schema = JSON.parse(rawSchema);
      if (schema)
        validate =
          ajv.getSchema(schema.$id) || (await ajv.compileAsync(schema));
    }
  }
  if (!validate) throw new Error(`Could not find schema: ${baseSchemaId}`);
  const errors = validate(data)
    ? []
    : formatAjvErrors((validate.errors ?? []) as ErrorObject[]);
  // checkSchemaDirective will be called from check.ts
  return {
    file: filePath ?? "(string)",
    ok: errors.length === 0,
    errors,
    warnings: [],
  };
}
async function resolveSchemaPath(
  schemaId: string,
  schemaDir: string
): Promise<{ schemaId: string; schemaPath: string }> {
  // Match semver range in schemaId
  const semverMatch = path.posix.parse(schemaId);
  if (!semverMatch) return { schemaId, schemaPath: schemaId };

  const basePath = semverMatch.dir;
  // if only base path, default to latest. Otherwise, if invalid range, return as is
  const range =
    semver.validRange(semverMatch.base || "*") ||
    semver.validRange(semverMatch.name || "*");
  if (!range) return { schemaId, schemaPath: schemaId };

  // Read available versions from schemaDir
  let availableVersions: string[] = [];
  try {
    const osBasePath = basePath.split("/").filter(Boolean);
    const files = await fs.readdir(path.join(schemaDir, ...osBasePath), {
      recursive: true,
      withFileTypes: true,
    });
    availableVersions = files
      .filter(
        (f) =>
          f.isFile() && semver.satisfies(path.basename(f.name, ".json"), range)
      )
      .map((f) => path.join(f.parentPath || "", f.name));
  } catch {}

  // get the highest version that matches the range
  const resolvedPath = availableVersions
    .sort((a, b) =>
      semver.rcompare(path.basename(a, ".json"), path.basename(b, ".json"))
    )
    .at(0);

  // If no version matches, return the original schemaId
  if (!resolvedPath) return { schemaId, schemaPath: schemaId };
  return {
    // prepend basePath to resolved schemaId
    schemaId: path.posix.join(basePath, path.basename(resolvedPath, ".json")),
    schemaPath: resolvedPath,
  };
}
