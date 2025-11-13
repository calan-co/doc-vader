import { Linter, Fixer } from "../interfaces/ruleset";
import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import { getVersionedName, ValidateResult } from "./utils.js";
import path from "node:path";

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
  // if frontmatter has the schema directive, it will be validated using checkSchemaDirective
  if (data.schema) {
    return {
      file: filePath ?? "(string)",
      ok: true,
      errors: [],
      warnings: [],
    };
  }

  if (!data || Object.keys(data).length === 0 || !data.type) {
    const msg = "Missing frontmatter or no `type` specified";
    return {
      file: filePath ?? "(string)",
      ok: !strictMissing,
      errors: strictMissing ? [msg] : [],
      warnings: strictMissing ? [] : [`${msg} (warning)`],
    };
  }

  const schemaPath = path.join(
    schemaDir,
    "frontmatter",
    `${data.type}`,
    "current.json"
  );

  const schemaId = `/frontmatter/${data.type}/1.0.0`;
  // const schemaName = await getVersionedName(
  //   `${data.type}.frontmatter.schema.json`,
  //   schemaDir
  // );
  let validate = ajv.getSchema(schemaId) as ValidateFunction | undefined;
  if (!validate) {
    // getValidator logic inline
    const rawSchema = await fs.readFile(schemaPath, "utf8");
    const schema = JSON.parse(rawSchema);
    validate = await ajv.compileAsync(schema);
  }
  if (!validate) throw new Error(`Could not compile schema: ${schemaId}`);
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
