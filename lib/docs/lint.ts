import { Linter, Fixer } from "../interfaces/ruleset";
import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import { promises as fs } from "node:fs";
import matter from "gray-matter";
import path from "node:path";

// Docs linter implementation example
export class DocsLinter implements Linter<string | object, object> {
  lint(input: string | object): object {
    // TODO: Implement actual lint logic
    return {};
  }
}

// Docs fixer implementation example
export class DocsFixer implements Fixer<string | object, object> {
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

export interface ValidateDocsOptions {
  filePath: string;
  schemaDir: string;
  ajv: InstanceType<typeof Ajv>;
}

export async function lintDocs({
  filePath,
  schemaDir,
  ajv,
}: ValidateDocsOptions): Promise<{ file: string; errors: string[] }> {
  const raw = await fs.readFile(filePath, "utf8");
  const fm = matter(raw);
  const data = fm.data;
  if (!data || Object.keys(data).length === 0 || !data.type) {
    return {
      file: filePath,
      errors: ["Missing frontmatter or no `type` specified"],
    };
  }
  const schemaName = `${data.type}.frontmatter.schema.json`;
  let validate = ajv.getSchema(schemaName) as ValidateFunction | undefined;
  if (!validate) {
    const schemaPath = path.join(schemaDir, schemaName);
    const rawSchema = await fs.readFile(schemaPath, "utf8");
    const schema = JSON.parse(rawSchema);
    validate = await ajv.compileAsync(schema);
  }
  if (!validate) throw new Error(`Could not compile schema: ${schemaName}`);
  const errors = validate(data)
    ? []
    : formatAjvErrors((validate.errors ?? []) as ErrorObject[]);
  return {
    file: filePath,
    errors,
  };
}
