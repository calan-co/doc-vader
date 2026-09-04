import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const repoRoot = path.resolve(__dirname, "..");
const schemasRoot = path.join(repoRoot, "schemas");

type Schema = Record<string, unknown>;

function versionedSchemas(directory: string): Array<{ file: string; version: string; schema: Schema }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return versionedSchemas(file);
    if (!entry.isFile()) return [];

    const match = /^(\d+\.\d+\.\d+)\.json$/.exec(entry.name);
    if (!match) return [];

    return [{
      file,
      version: match[1],
      schema: JSON.parse(readFileSync(file, "utf8")) as Schema,
    }];
  });
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!value || typeof value !== "object") return [];

  const schema = value as Schema;
  return [
    ...(typeof schema.$ref === "string" ? [schema.$ref] : []),
    ...Object.entries(schema)
      .filter(([key]) => key !== "$ref")
      .flatMap(([, entry]) => refs(entry)),
  ];
}

describe("finalized schema lifecycle", () => {
  it("uses immutable IDs and references in every versioned schema", () => {
    for (const { file, version, schema } of versionedSchemas(schemasRoot)) {
      expect(schema.$id, file).toEqual(expect.stringMatching(new RegExp(`/${version}$`)));
      expect(refs(schema), file).not.toContainEqual(expect.stringMatching(/\/current(?:#|$)/));
    }
  });

  it("resolves the finalized work-item schema graph", () => {
    const schemas = versionedSchemas(schemasRoot);
    const ajv = new Ajv2020({ strict: false });
    for (const { schema } of schemas) ajv.addSchema(schema);

    const workItem = schemas.find(({ file }) =>
      file.endsWith("frontmatter/by-type/work-item/1.0.0.json"),
    );
    expect(workItem).toBeDefined();
    expect(() => ajv.compile(workItem!.schema)).not.toThrow();
  });
});
