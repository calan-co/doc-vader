import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

type DocPackManifest = Record<string, unknown>;

async function loadJson(path: string): Promise<DocPackManifest> {
  return JSON.parse(await readFile(path, "utf8")) as DocPackManifest;
}

describe("doc-pack manifest conformance", () => {
  it("documents the distinct doc-pack manifest and catalog-only registry boundary", async () => {
    const reference = await readFile(
      "docs/reference/document-type-packs.md",
      "utf8",
    );

    expect(reference).toContain("## Doc-Pack Manifest and Registry");
    expect(reference).toContain("schemas/doc-vader/doc-pack.json");
    expect(reference).toContain("artifact, document-type contribution, or referenced extension");
    expect(reference).toContain("does not source, load, execute, host, activate");
  });

  it("accepts the syntax-agnostic manifest fixture with pack-owned declarations", async () => {
    const schema = await loadJson("schemas/doc-vader/doc-pack.json");
    const core = await loadJson("tests/fixtures/doc-packs/core.json");
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      schema,
    );

    expect(validate(core)).toBe(true);
  });

  it("requires stable pack identity", async () => {
    const schema = await loadJson("schemas/doc-vader/doc-pack.json");
    const invalid = await loadJson(
      "tests/fixtures/doc-packs/invalid-missing-id.json",
    );
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      schema,
    );

    expect(validate(invalid)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "required", params: { missingProperty: "id" } }),
      ]),
    );
  });

  it("rejects incomplete declarations while preserving opaque references", async () => {
    const schema = await loadJson("schemas/doc-vader/doc-pack.json");
    const core = await loadJson("tests/fixtures/doc-packs/core.json");
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      schema,
    );
    const invalid = structuredClone(core) as {
      artifacts: unknown[];
      documentTypePacks: unknown[];
      extensions: unknown[];
      tests: unknown[];
      fixtures: unknown[];
    };

    invalid.artifacts = [{}];
    invalid.documentTypePacks = [{}];
    invalid.extensions = [{}];
    invalid.tests = [null];
    invalid.fixtures = [{}];

    expect(validate(invalid)).toBe(false);
  });

});
