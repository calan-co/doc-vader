import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import {
  BacklogConfigSchema,
  DocVaderConfigSchema,
  DocumentRoutingConfigSchema,
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

function compileDocVaderConfigSchema() {
  return createAjv().compile(DocVaderConfigSchema);
}

describe("config schema", () => {
  it("emits canonical JSON Schema 2020-12 metadata", () => {
    expect(SchemaMapConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(ValidationConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(BacklogConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(VocabularyConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(DocVaderConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(DocumentRoutingConfigSchema.$schema).toBe(JSON_SCHEMA_2020_12);
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
    expect(compileDocVaderConfigSchema()({})).toBe(true);
  });

  it("accepts configured document-type-pack manifest locators", () => {
    const validate = compileDocVaderConfigSchema();
    expect(validate({ documentTypePacks: ["./packs/work.json"] })).toBe(true);
    expect(validate({ documentTypePacks: [42] })).toBe(false);
  });

  it("accepts dv.yaml document routing defaults", () => {
    const validate = compileDocVaderConfigSchema();

    expect(
      validate({
        namespace: "doc-vader.work-management",
        defaultType: "work-item",
        document: {
          defaultSubtype: "task",
          schemaMap: {
            byType: {
              "work-item": "schemas/work-management/metadata/work-item.json",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects invalid namespace and type routing tokens", () => {
    const validate = compileDocVaderConfigSchema();

    expect(
      validate({
        namespace: "Doc Vader",
        defaultType: "WorkItem",
      }),
    ).toBe(false);
    expect(validate.errors?.map((error) => error.instancePath)).toEqual(
      expect.arrayContaining(["/namespace", "/defaultType"]),
    );
  });

  it("rejects unknown top-level properties", () => {
    const validate = compileDocVaderConfigSchema();

    expect(
      validate({
        unexpected: true,
      }),
    ).toBe(false);
    expect(validate.errors?.[0]?.instancePath).toBe("");
  });

  it("accepts the repository root .doc.json fixture", async () => {
    const validate = compileDocVaderConfigSchema();
    const raw = JSON.parse(await readFile(".doc.json", "utf8"));

    expect(validate(raw)).toBe(true);
  });

  it("validates canonical metadata and document type pack schema files", async () => {
    const ajv = createAjv();
    const metadataSchema = JSON.parse(
      await readFile("schemas/metadata/base.json", "utf8"),
    );
    const configSchema = JSON.parse(
      await readFile("schemas/doc-vader/config.json", "utf8"),
    );
    const packSchema = JSON.parse(
      await readFile("schemas/doc-vader/document-type-pack.json", "utf8"),
    );
    ajv.addSchema(configSchema, "/doc-vader/config");

    expect(ajv.compile(metadataSchema)({
      namespace: "example.decisions",
      type: "decision",
    })).toBe(true);
    expect(ajv.compile(metadataSchema)({ type: "decision" })).toBe(false);

    const validatePack = ajv.compile(packSchema);
    expect(
      validatePack({
        schemaVersion: "doc-vader/document-type-pack/v1",
        name: "Example Decisions",
        namespace: "example.decisions",
        documentTypes: [
          {
            type: "decision",
            subtypes: ["adr"],
            metadataSchema: "schemas/example/metadata/decision.json",
            contentSchema: "schemas/example/content/decision.json",
          },
        ],
        templates: [
          {
            path: "templates/example/decision.md.tpl",
            type: "decision",
            subtype: "adr",
          },
        ],
        configDefaults: {
          namespace: "example.decisions",
          defaultType: "decision",
        },
      }),
    ).toBe(true);

    expect(
      validatePack({
        schemaVersion: "doc-vader/document-type-pack/v1",
        namespace: "example.work",
        documentTypes: [{ type: "work-item", metadataSchema: "work.json" }],
        checklistDefinitions: [
          { id: "delivery", heading: "Delivery" },
          { id: "proof", heading: "Proof" },
        ],
      }),
    ).toBe(true);
  });

  it("rejects duplicate checklist IDs through pack resolution", async () => {
    const { resolveChecklistDefinitions } = await import(
      "../lib/work-management/checklist-definitions.js"
    );
    expect(() =>
      resolveChecklistDefinitions({
        schemaVersion: "doc-vader/document-type-pack/v1",
        namespace: "example.work",
        documentTypes: [{ type: "work-item" }],
        checklistDefinitions: [
          { id: "delivery", heading: "Delivery" },
          { id: "delivery", heading: "Proof" },
        ],
      }),
    ).toThrow("Duplicate checklist definition id 'delivery'.");
  });
});
