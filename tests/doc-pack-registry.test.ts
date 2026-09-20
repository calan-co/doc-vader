import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as docVader from "../lib/index.js";

type DocPackManifest = Record<string, unknown>;

type ValidationReport = {
  valid: boolean;
  diagnostics: Array<{ code: string }>;
};

type DocPackRegistry = {
  validate(manifest: DocPackManifest): ValidationReport;
  register(manifest: DocPackManifest): ValidationReport;
  get(id: string): DocPackManifest | undefined;
  list(): readonly DocPackManifest[];
  resolve(logicalReference: string): unknown | undefined;
};

type DocPackRegistryModule = {
  DocPackRegistry: new () => DocPackRegistry;
};

async function loadFixture(name: string): Promise<DocPackManifest> {
  return JSON.parse(
    await readFile(`tests/fixtures/doc-packs/${name}.json`, "utf8"),
  ) as DocPackManifest;
}

async function createRegistry(): Promise<DocPackRegistry> {
  const module = (await import(
    new URL("../lib/doc-pack/index.js", import.meta.url).href
  )) as DocPackRegistryModule;
  return new module.DocPackRegistry();
}

describe("DocPackRegistry public contract", () => {
  it("exposes the catalog-only registry from the root public entry point", () => {
    const registry = new docVader.docPack.DocPackRegistry();

    expect(registry.list()).toEqual([]);
  });

  it("registers immutable catalog snapshots without loading packs", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");

    expect(registry.register(core)).toEqual({ valid: true, diagnostics: [] });
    const cataloged = registry.get("core");

    expect(cataloged).toEqual(core);
    expect(cataloged).not.toBe(core);
    expect(Object.isFrozen(cataloged)).toBe(true);
    expect(Object.isFrozen(cataloged?.artifacts)).toBe(true);
    expect(Object.isFrozen(cataloged?.artifacts?.[0])).toBe(true);

    (core.artifacts as Array<{ id: string }>)[0]!.id = "mutated";

    expect(registry.resolve("core:metadata/base")).toBe(
      "schemas/metadata/base.json",
    );
    expect(registry.list()).toEqual([cataloged]);
  });

  it("resolves registered artifact and document-type-pack declarations to their opaque refs", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");

    registry.register(core);

    expect(registry.resolve("core:metadata/base")).toBe(
      "schemas/metadata/base.json",
    );
    expect(registry.resolve("core:core-documents")).toBe(
      "packs/core/document-type-pack.json",
    );
  });

  it("rejects manifests that violate the declared schema", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");

    expect(registry.register({ ...core, unexpected: true })).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "invalid-schema" }),
      ]),
    });
  });

  it("rejects pack IDs that cannot be represented in logical references", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");

    expect(registry.register({ ...core, id: "core:invalid" })).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "invalid-pack-id" }),
      ]),
    });
  });

  it("rejects artifacts without a declared kind", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");
    const invalid = structuredClone(core) as {
      artifacts: Array<Record<string, unknown>>;
    };

    invalid.artifacts = [{
      id: "metadata/base",
      ref: "schemas/metadata/base.json",
    }];

    expect(registry.register(invalid)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "invalid-schema" }),
        expect.objectContaining({ code: "invalid-artifact-declaration" }),
      ]),
    });
  });

  it("resolves a referenced extension by logical reference and rejects a colliding artifact ID", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");
    const colliding = structuredClone(core) as {
      artifacts: Array<Record<string, unknown>>;
    };

    expect(registry.register(core)).toEqual({ valid: true, diagnostics: [] });
    expect(registry.resolve("core:core.lint")).toBe("extensions/core-lint.json");

    colliding.id = "colliding";
    colliding.namespace = "doc-vader.colliding";
    colliding.artifacts.push({
      id: "core.lint",
      kind: "metadata-model",
      ref: "schemas/metadata/lint.json",
    });

    expect(registry.register(colliding)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-logical-reference-id" }),
      ]),
    });
  });

  it("rejects a document-type-pack logical ID that collides with an artifact", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");
    const colliding = structuredClone(core) as {
      id: string;
      namespace: string;
      documentTypePacks: Array<Record<string, unknown>>;
    };

    colliding.id = "document-type-collision";
    colliding.namespace = "doc-vader.document-type-collision";
    colliding.documentTypePacks[0]!.id = "metadata/base";

    expect(registry.register(colliding)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-logical-reference-id" }),
      ]),
    });
  });

  it("reports an unresolved dependency and does not register the dependent pack", async () => {
    const registry = await createRegistry();
    const sdlcCore = await loadFixture("sdlc-core");

    expect(registry.register(sdlcCore)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unresolved-dependency" }),
      ]),
    });
    expect(registry.get("sdlc-core")).toBeUndefined();

    expect(registry.register(await loadFixture("core"))).toEqual({
      valid: true,
      diagnostics: [],
    });
    expect(registry.register(sdlcCore)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("reports malformed in-pack and extension declarations without executing them", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");
    const invalid = structuredClone(core) as {
      artifacts: Array<{ id: string; kind: string; ref: string }>;
      extensions: Array<Record<string, unknown>>;
    };

    invalid.artifacts.push({
      id: "metadata/base",
      kind: "metadata-model",
      ref: "schemas/metadata/duplicate.json",
    });
    invalid.extensions.push({
      id: "missing-reference",
      kind: "referenced",
    });
    invalid.extensions.push({
      id: "missing-declaration",
      kind: "embedded",
    });

    expect(registry.validate(invalid)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-artifact-id" }),
        expect.objectContaining({ code: "invalid-extension-reference" }),
        expect.objectContaining({ code: "invalid-embedded-extension" }),
      ]),
    });
  });

  it("rejects a duplicate pack identity without replacing the registered pack", async () => {
    const registry = await createRegistry();
    const core = await loadFixture("core");

    registry.register(core);

    expect(registry.register({ ...core, namespace: "other.core" })).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-pack-id" }),
      ]),
    });
    expect(registry.get("core")).toEqual(core);
  });
});
