import fsSync, { NestedDirectoryJSON, vol } from "memfs";
import { toTreeSync } from "memfs/lib/print";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach } from "node:test";
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

const realDocsDir = path.resolve("./");
const realSchemasDir = path.join(realDocsDir, "schemas");
let validateFrontmatter: ValidateFrontmatterType["validateFrontmatter"];
let loadSchema: ValidateFrontmatterType["loadSchema"];
let getVersionedName: ValidateFrontmatterType["getVersionedName"];

const docsDir = "/tmp/tmp-docs-test/";
const schemaDir = path.join(docsDir, "schemas");

beforeAll(async () => {
  process.env.LINKITY_DOCS_DIR = docsDir;
  vi.stubEnv("LINKITY_DOCS_DIR", docsDir);

  const validateFrontmatter_lib =
    await vi.importActual<ValidateFrontmatterType>("../validate-frontmatter");
  validateFrontmatter = validateFrontmatter_lib.validateFrontmatter;
  loadSchema = validateFrontmatter_lib.loadSchema;
  getVersionedName = validateFrontmatter_lib.getVersionedName;
});
afterAll(async () => {
  delete process.env.LINKITY_DOCS_DIR;
  vi.unstubAllEnvs();
});
describe("getVersionedName", () => {
  function makeVersionedName(version: string, ext: string = ""): string {
    return `document.${version}.frontmatter.schema${ext ? `.${ext}` : ""}`;
  }
  const latestName = makeVersionedName("latest");
  const latestFile = makeVersionedName("latest", "json");
  const latestFilePath = path.join(schemaDir, latestFile);
  const v1Name = makeVersionedName("v1");
  const v1File = makeVersionedName("v1", "json");
  const v1FilePath = path.join(schemaDir, v1File);
  const v2Name = makeVersionedName("v2");
  const v2File = makeVersionedName("v2", "json");
  const v2FilePath = path.join(schemaDir, v2File);
  const v3Name = makeVersionedName("v3");
  const v3File = makeVersionedName("v3", "json");
  const v3FilePath = path.join(schemaDir, v3File);

  const dirStructure: NestedDirectoryJSON = {};
  dirStructure[schemaDir] = {
    [v1File]: JSON.stringify({ $id: "v1" }),
    [v2File]: JSON.stringify({ $id: "v2" }),
    [v3File]: JSON.stringify({ $id: "v3" }),
  };
  beforeEach(async () => {
    vol.fromNestedJSON(dirStructure);
    console.log(toTreeSync(fsSync as any));

    // not sure why vol.reset() doesn't clear symlinks but this is all going to be deleted soon anyway.
    fsSync.fs.existsSync(latestFilePath) &&
      fsSync.fs.unlinkSync(latestFilePath);

    // latest is a symlink to v3
    vol.symlinkSync(v3FilePath, latestFilePath);
    console.log(vol.toJSON());
    console.log(vol.toTree());
  });
  afterEach(async () => {
    vol.reset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns symlink target for .latest schema", async () => {
    const result = await getVersionedName(latestFile);
    expect(result).toBe(v3File);
  });

  it("returns latest versioned file if no symlink", async () => {
    // Remove symlink, leave files
    await fs.unlink(latestFilePath);
    await fs.writeFile(latestFilePath, "");
    const result = await getVersionedName(latestFile);
    expect(result).toMatch(/document\.v3\.frontmatter\.schema\.json$/);
  });

  it("throws if it can't resolve .latest to a versioned schema", async () => {
    const latestFile = "nonexistent.frontmatter.schema.json";
    await expect(loadSchema(latestFile)).rejects.toThrow(
      `ENOENT: no such file or directory, open '${path.join(
        schemaDir,
        latestFile
      )}'`
    );
  });
});
describe("loadSchema", () => {
  const schemaDir = path.join(docsDir, "schemas");
  const testSchemaName = "test.frontmatter.schema.json";
  const testSchemaPath = path.join(schemaDir, testSchemaName);
  const testSchemaContent = JSON.stringify({ $id: "test", type: "object" });

  beforeEach(async () => {
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(testSchemaPath, testSchemaContent, "utf8");
  });

  it("loads a schema by name", async () => {
    const schema = await loadSchema(testSchemaName);
    expect(schema).toBeDefined();
    expect(schema.$id).toBe("test");
    expect(schema.type).toBe("object");
  });

  it("returns cached schema on second load", async () => {
    const first = await loadSchema(testSchemaName);
    const second = await loadSchema(testSchemaName);
    expect(second).toBe(first);
  });

  it("resolves .latest to versioned schema", async () => {
    const latestName = "test.latest.frontmatter.schema.json";
    const latestPath = path.join(schemaDir, latestName);
    await fs.symlink(testSchemaName, latestPath);
    const schema = await loadSchema(latestName);
    expect(schema.$id).toBe("test");
  });

  it("throws if it can't resolve .latest to a versioned schema", async () => {
    const latestName = "nonexistent.frontmatter.schema.json";
    await expect(loadSchema(latestName)).rejects.toThrow(
      `ENOENT: no such file or directory, open '${path.join(
        schemaDir,
        latestName
      )}'`
    );
  });

  it("throws for missing schema file", async () => {
    await expect(
      loadSchema("missing.frontmatter.schema.json")
    ).rejects.toThrow();
  });
});

describe("validateFrontmatter", () => {
  beforeEach(async () => {
    // Load memfs with actual schema files from disk
    const realFs = await vi.importActual<typeof import("fs/promises")>(
      "fs/promises"
    );
    const sourceSchemaDir = realSchemasDir;
    const targetSchemaDir = schemaDir;
    await syncSchemaFiles(sourceSchemaDir, targetSchemaDir, realFs);
    console.log(toTreeSync(fsSync as any));
  });
  afterEach(async () => {
    vol.reset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });
  const goodV1Frontmatter = `---\n# yaml-language-server: $schema=/frontmatter/document/1.0.0.json\n'$schema': /frontmatter/document/1.0.0\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  const goodLatestFrontmatter = `---\n# yaml-language-server: $schema=/frontmatter/document/latest.json\n'$schema': /frontmatter/document/\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  const badSchemaDirective = `---\n# yaml-language-server: $schema=/99.99.99.json\n'$schema': /99.99.99\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: explanation\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  const folderMismatch = `---\n# yaml-language-server: $schema=/frontmatter/document/latest.json\n'$schema': /frontmatter/document\nid: docs-abc\ntitle: Example Doc\ntype: document\nsubtype: sample\nlifecycle: active\nstatus: accepted\nclassification:\n  diataxis: tutorial\n  sensitivity: public\ntags: [linkity]\n---\n\nContent here.`;
  it("passes for valid doc in matching folder", async () => {
    const result = await validateFrontmatter({
      content: goodV1Frontmatter,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  it("passes for valid doc using latest schema in matching folder", async () => {
    const result = await validateFrontmatter({
      content: goodLatestFrontmatter,
    });
    if (result.errors.length > 0) {
      throw new Error(`Unexpected errors: ${result.errors.join(", \n")}`);
    }
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails for wrong schema directive", async () => {
    const result = await validateFrontmatter({
      content: badSchemaDirective,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Schema directive filename mismatch")
      )
    ).toBe(true);
  });

  it.skip("fails for diataxis folder mismatch", async () => {
    const result = await validateFrontmatter({
      filePath: "docs/explanation/tutorial-intro.md",
      content: folderMismatch,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Diataxis folder mismatch"))
    ).toBe(true);
  });

  it("warns (non-strict) when frontmatter missing", async () => {
    const content = "No frontmatter here";
    const result = await validateFrontmatter({
      filePath: "docs/explanation/missing.md",
      content,
      strictMissing: false,
    });
    expect(result.ok).toBe(true); // passes non-strict
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("fails (strict) when frontmatter missing", async () => {
    const content = "No frontmatter here";
    const result = await validateFrontmatter({
      filePath: "docs/explanation/missing.md",
      content,
      strictMissing: true,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Missing frontmatter or no `type` specified")
      )
    ).toBe(true);
  });
});
async function syncSchemaFiles(
  srcSchemaDir: string,
  destSchemaDir: string,
  srcFs: typeof import("fs/promises")
) {
  const schemaFiles = await srcFs.readdir(srcSchemaDir);
  await fs.mkdir(destSchemaDir, { recursive: true });
  for (const file of schemaFiles) {
    const srcFullPath = path.join(srcSchemaDir, file);
    const destFullPath = path.join(destSchemaDir, file);
    const fileStats = await srcFs.stat(srcFullPath);
    if (fileStats.isDirectory()) {
      await syncSchemaFiles(srcFullPath, path.join(destSchemaDir, file), srcFs);
      continue;
    }
    if (fileStats.isSymbolicLink()) {
      const srcLinkTarget = await srcFs.readlink(srcFullPath);
      const destLinkTarget = path.isAbsolute(srcLinkTarget)
        ? path.join(destSchemaDir, path.relative(srcSchemaDir, srcLinkTarget))
        : srcLinkTarget;
      await fs.symlink(destLinkTarget, destFullPath);
      continue;
    }
    const content = await srcFs.readFile(srcFullPath, "utf8");
    await fs.writeFile(destFullPath, content, "utf8");
  }
}
