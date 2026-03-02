import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";

type ValidateFrontmatterType = typeof import("../validate-frontmatter");

const realSchemasDir = path.resolve("./schemas");
let docsDir = "";
let schemaDir = "";

let validateFrontmatter: ValidateFrontmatterType["validateFrontmatter"];
let loadSchema: ValidateFrontmatterType["loadSchema"];
let getVersionedName: ValidateFrontmatterType["getVersionedName"];

beforeAll(async () => {
  docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-"));
  schemaDir = path.join(docsDir, "schemas");

  process.env.LINKITY_DOCS_DIR = docsDir;
  vi.stubEnv("LINKITY_DOCS_DIR", docsDir);

  const module =
    await vi.importActual<ValidateFrontmatterType>("../validate-frontmatter");
  validateFrontmatter = module.validateFrontmatter;
  loadSchema = module.loadSchema;
  getVersionedName = module.getVersionedName;
});

afterAll(async () => {
  delete process.env.LINKITY_DOCS_DIR;
  vi.unstubAllEnvs();
  await fs.rm(docsDir, { recursive: true, force: true });
});

describe("getVersionedName", () => {
  function makeVersionedName(version: string, ext = ""): string {
    return `document.${version}.frontmatter.schema${ext ? `.${ext}` : ""}`;
  }

  const latestFile = makeVersionedName("latest", "json");
  const latestFilePath = () => path.join(schemaDir, latestFile);
  const v1File = makeVersionedName("v1", "json");
  const v2File = makeVersionedName("v2", "json");
  const v3File = makeVersionedName("v3", "json");

  beforeEach(async () => {
    await fs.rm(schemaDir, { recursive: true, force: true });
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(path.join(schemaDir, v1File), JSON.stringify({ $id: "v1" }));
    await fs.writeFile(path.join(schemaDir, v2File), JSON.stringify({ $id: "v2" }));
    await fs.writeFile(path.join(schemaDir, v3File), JSON.stringify({ $id: "v3" }));
    await fs.symlink(v3File, latestFilePath());
  });

  it("returns symlink target for .latest schema", async () => {
    const result = await getVersionedName(latestFile);
    expect(result).toBe(v3File);
  });

  it("returns highest versioned file when latest is not a symlink", async () => {
    await fs.unlink(latestFilePath());
    await fs.writeFile(latestFilePath(), "{}");
    const result = await getVersionedName(latestFile);
    expect(result).toBe(v3File);
  });

  it("throws when latest cannot be resolved", async () => {
    await expect(
      getVersionedName("nonexistent.frontmatter.schema.json")
    ).rejects.toThrow("Cannot resolve latest schema");
  });
});

describe("loadSchema", () => {
  const testSchemaName = "test.frontmatter.schema.json";
  const testSchemaPath = () => path.join(schemaDir, testSchemaName);
  const testSchemaContent = JSON.stringify({ $id: "test", type: "object" });

  beforeEach(async () => {
    await fs.rm(schemaDir, { recursive: true, force: true });
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(testSchemaPath(), testSchemaContent, "utf8");
  });

  it("loads a schema by name", async () => {
    const schema = await loadSchema(testSchemaName);
    expect(schema.$id).toBe("test");
    expect(schema.type).toBe("object");
  });

  it("returns cached schema on second load", async () => {
    const first = await loadSchema(testSchemaName);
    const second = await loadSchema(testSchemaName);
    expect(second).toBe(first);
  });

  it("resolves .latest to a versioned schema", async () => {
    const latestName = "test.latest.frontmatter.schema.json";
    await fs.symlink(testSchemaName, path.join(schemaDir, latestName));
    const schema = await loadSchema(latestName);
    expect(schema.$id).toBe("test");
  });

  it("throws for missing schema file", async () => {
    await expect(loadSchema("missing.frontmatter.schema.json")).rejects.toThrow();
  });
});

describe("validateFrontmatter", () => {
  beforeEach(async () => {
    await fs.rm(schemaDir, { recursive: true, force: true });
    await syncSchemaFiles(realSchemasDir, schemaDir);
  });

  const goodV1Frontmatter = `---\n# yaml-language-server: $schema=/frontmatter/document/1.0.0.json\n'$schema': /frontmatter/document/1.0.0\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  const goodLatestFrontmatter = `---\n# yaml-language-server: $schema=/frontmatter/document/latest.json\n'$schema': /frontmatter/document/\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  const badSchemaDirective = `---\n# yaml-language-server: $schema=/99.99.99.json\n'$schema': /99.99.99\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;

  it("passes for valid doc with explicit version schema", async () => {
    const result = await validateFrontmatter({ content: goodV1Frontmatter });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes for valid doc using default/latest schema resolution", async () => {
    const result = await validateFrontmatter({ content: goodLatestFrontmatter });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails for unknown schema directive", async () => {
    const result = await validateFrontmatter({ content: badSchemaDirective });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Schema not found")
    );
  });

  it("warns (non-strict) when frontmatter is missing", async () => {
    const result = await validateFrontmatter({
      filePath: "docs/explanation/missing.md",
      content: "No frontmatter here",
      strictMissing: false,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("fails (strict) when frontmatter is missing", async () => {
    const result = await validateFrontmatter({
      filePath: "docs/explanation/missing.md",
      content: "No frontmatter here",
      strictMissing: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Missing frontmatter or no `type` specified")
    );
  });
});

async function syncSchemaFiles(srcSchemaDir: string, destSchemaDir: string) {
  const schemaFiles = await fs.readdir(srcSchemaDir);
  await fs.mkdir(destSchemaDir, { recursive: true });

  for (const file of schemaFiles) {
    const srcFullPath = path.join(srcSchemaDir, file);
    const destFullPath = path.join(destSchemaDir, file);
    const fileStats = await fs.lstat(srcFullPath);

    if (fileStats.isDirectory()) {
      await syncSchemaFiles(srcFullPath, destFullPath);
      continue;
    }

    if (fileStats.isSymbolicLink()) {
      const srcLinkTarget = await fs.readlink(srcFullPath);
      await fs.symlink(srcLinkTarget, destFullPath);
      continue;
    }

    const content = await fs.readFile(srcFullPath, "utf8");
    await fs.writeFile(destFullPath, content, "utf8");
  }
}
