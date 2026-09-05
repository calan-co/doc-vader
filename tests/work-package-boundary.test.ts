import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  collectModuleSpecifiers,
  findRelativeImportBoundaryViolations,
} from "../lib/work/package-boundary.js";

const tempDirs: string[] = [];
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE_DIRS = ["cli", "lib"] as const;
const CORE_WORK_PACK_FILES = [
  "lib/work/projection.ts",
  "lib/work/claim-verification.ts",
  "lib/work/format-adapter.ts",
  "lib/work/scope-ref.ts",
] as const;
const CORE_WORK_BOUNDARY_ROOT = path.join("lib", "work");
const CORE_WORK_ALLOWED_IMPORT_ROOTS = [
  "lib/runtime",
  "lib/runtime-claim",
  "lib/task",
] as const;
const WORK_FORMAT_ADAPTER_IMPORT = "../work/format-adapter.js";

async function createTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `doc-vader-work-package-boundary-${randomUUID()}`,
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function collectTypeScriptFiles(dirPath: string): Promise<string[]> {
  await mkdir(dirPath, { recursive: true });
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }

    const isProductionTypeScriptFile =
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts");

    if (isProductionTypeScriptFile) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function readWorkRelativeImports(filePath: string): Promise<string[]> {
  return collectModuleSpecifiers(await readFile(filePath, "utf8")).filter((specifier) =>
    specifier.startsWith("../work/"),
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work package boundary guard", () => {
  it("collects static module specifiers from import, export, require, and dynamic import forms", () => {
    expect(
      collectModuleSpecifiers(`
import { x } from "../lib/work/index.js";
export { y } from "../../context-graph/src/index.js";
import "../setup.js";
const z = require("../../semantify/src/index.js");
await import("../runtime/index.js");
`),
    ).toEqual([
      "../lib/work/index.js",
      "../../context-graph/src/index.js",
      "../setup.js",
      "../../semantify/src/index.js",
      "../runtime/index.js",
    ]);
  });

  it("ignores import-like text inside comments and string literals", () => {
    expect(
      collectModuleSpecifiers(`
// import "../commented.js";
/* export { x } from "../block-commented.js"; */
const example = "require('../string-literal.js')";
import "../real.js";
await import("../dynamic.js");
const actual = require("../actual-require.js");
`),
    ).toEqual(["../real.js", "../dynamic.js", "../actual-require.js"]);
  });

  it("collects module specifiers inside template literal expressions only", () => {
    expect(
      collectModuleSpecifiers(
        [
          'const ignored = `import "../template-text.js"`;',
          'const actual = `module: ${require("../template-expression.js")}`;',
        ].join("\n"),
      ),
    ).toEqual(["../template-expression.js"]);
  });

  it("flags relative imports that resolve outside the repository root", async () => {
    const repoRoot = await createTempDir();
    const filePath = path.join(repoRoot, "lib", "work", "projection.ts");

    await writeTextFile(
      filePath,
      `import { keep } from "../runtime/index.js";
import { badGraph } from "../../../context-graph/src/index.js";
import { badCatalog } from "../../../semantify/src/index.js";
`,
    );

    const violations = findRelativeImportBoundaryViolations({
      repoRoot,
      filePath,
      sourceText: await readFile(filePath, "utf8"),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        filePath,
        specifier: "../../../context-graph/src/index.js",
      }),
      expect.objectContaining({
        filePath,
        specifier: "../../../semantify/src/index.js",
      }),
    ]);
  });

  it("flags cross-pack imports that escape the core work boundary unless explicitly allowed", async () => {
    const repoRoot = await createTempDir();
    const filePath = path.join(repoRoot, "lib", "work", "projection.ts");

    await writeTextFile(
      filePath,
      `import { keepLocal } from "./scope-ref.js";
import { keepRuntime } from "../runtime/index.js";
import { keepTask } from "../task/show.js";
import { badBacklog } from "../backlog/provider.js";
`,
    );

    const violations = findRelativeImportBoundaryViolations({
      repoRoot,
      boundaryRoot: path.join(repoRoot, CORE_WORK_BOUNDARY_ROOT),
      allowedInternalPathPrefixes: CORE_WORK_ALLOWED_IMPORT_ROOTS,
      filePath,
      sourceText: await readFile(filePath, "utf8"),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        filePath,
        specifier: "../backlog/provider.js",
      }),
    ]);
  });

  it("keeps production source package-neutral within the repository boundary", async () => {
    const repoRoot = path.resolve(TEST_DIR, "..");
    const productionFiles = (
      await Promise.all(
        PRODUCTION_SOURCE_DIRS.map((dirName) =>
          collectTypeScriptFiles(path.join(repoRoot, dirName)),
        ),
      )
    ).flat();

    const violations = (
      await Promise.all(
        productionFiles.map(async (filePath) =>
          findRelativeImportBoundaryViolations({
            repoRoot,
            filePath,
            sourceText: await readFile(filePath, "utf8"),
          }),
        ),
      )
    ).flat();

    expect(violations).toEqual([]);
  });

  it("keeps the core work pack within local, Runtime Claim, runtime, and task boundaries", async () => {
    const repoRoot = path.resolve(TEST_DIR, "..");

    const violations = (
      await Promise.all(
        CORE_WORK_PACK_FILES.map(async (relativePath) => {
          const filePath = path.join(repoRoot, relativePath);
          return findRelativeImportBoundaryViolations({
            repoRoot,
            boundaryRoot: path.join(repoRoot, CORE_WORK_BOUNDARY_ROOT),
            allowedInternalPathPrefixes: CORE_WORK_ALLOWED_IMPORT_ROOTS,
            filePath,
            sourceText: await readFile(filePath, "utf8"),
          });
        }),
      )
    ).flat();

    expect(violations).toEqual([]);
  });

  it("routes task work imports through the format adapter seam", async () => {
    const repoRoot = path.resolve(TEST_DIR, "..");
    const taskFiles = [
      { relativePath: path.join("lib", "task", "ready.ts"), expected: [WORK_FORMAT_ADAPTER_IMPORT] },
      { relativePath: path.join("lib", "task", "show.ts"), expected: [WORK_FORMAT_ADAPTER_IMPORT] },
      { relativePath: path.join("lib", "task", "status.ts"), expected: [WORK_FORMAT_ADAPTER_IMPORT] },
      { relativePath: path.join("lib", "task", "prompt.ts"), expected: [] },
    ] as const;

    const importResults = await Promise.all(
      taskFiles.map(async ({ relativePath, expected }) => ({
        relativePath,
        expected,
        imports: await readWorkRelativeImports(path.join(repoRoot, relativePath)),
      })),
    );

    for (const { relativePath, expected, imports } of importResults) {
      expect(imports, relativePath).toEqual(expected);
    }
  });
});
