import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import {
  BacklogConfigSchema,
  DocVaderConfigSchema,
  SchemaMapConfigSchema,
  ValidationConfigSchema,
  VocabularyConfigSchema,
} from "../lib/config/schema.js";

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

describe("config schema", () => {
  it("emits canonical JSON Schema 2020-12 metadata", () => {
    expect(SchemaMapConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(ValidationConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(BacklogConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(VocabularyConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(DocVaderConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
  });

  it("accepts extends as either a string or an array of strings", () => {
    const extendsSchema = DocVaderConfigSchema.properties?.extends;
    expect(extendsSchema).toBeDefined();
    expect(extendsSchema).toMatchObject({
      description:
        "One or more base configuration files or npm package names to extend. Resolved in order; later entries override earlier ones; the local config overrides all.",
    });
    expect(extendsSchema?.anyOf?.[0]).toMatchObject({ type: "string" });
    expect(extendsSchema?.anyOf?.[1]).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
  });

  it("compiles and validates a minimal config", () => {
    const ajv = createAjv();
    const validate = ajv.compile(DocVaderConfigSchema);

    expect(validate({})).toBe(true);
  });

  it("rejects unknown top-level properties", () => {
    const ajv = createAjv();
    const validate = ajv.compile(DocVaderConfigSchema);

    expect(
      validate({
        unexpected: true,
      }),
    ).toBe(false);
    expect(validate.errors?.[0]?.instancePath).toBe("");
  });

  it("accepts the repository root .doc.json fixture", async () => {
    const ajv = createAjv();
    const validate = ajv.compile(DocVaderConfigSchema);
    const raw = JSON.parse(await readFile(".doc.json", "utf8"));

    expect(validate(raw)).toBe(true);
  });
});
