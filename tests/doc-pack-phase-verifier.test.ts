import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const verifier = path.join(root, "scripts/verify-doc-pack-phase.ts");
const tsxLoader = path.join(root, "node_modules/tsx/dist/loader.mjs");
const temporaryDirectories: string[] = [];

async function createPhaseWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "doc-pack-phase-"));
  temporaryDirectories.push(workspace);
  await mkdir(path.join(workspace, "schemas/doc-vader"), { recursive: true });
  await mkdir(path.join(workspace, "docs/reference"), { recursive: true });
  await cp(
    path.join(root, "schemas/doc-vader/doc-pack.json"),
    path.join(workspace, "schemas/doc-vader/doc-pack.json"),
  );
  await writeFile(
    path.join(workspace, "docs/reference/document-type-packs.md"),
    "# document type packs\n",
  );
  await writeFile(
    path.join(workspace, "docs/reference/doc-pack-inventory.md"),
    "# inventory\n",
  );
  return workspace;
}

function runVerifier(workspace: string, phase: "1" | "2") {
  return spawnSync(
    "node",
    ["--import", tsxLoader, verifier, "--phase", phase],
    { cwd: workspace, encoding: "utf8" },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("doc-pack phase verifier", () => {
  it("fails phase 1 when a required manifest field is absent", async () => {
    const workspace = await createPhaseWorkspace();
    const schemaPath = path.join(workspace, "schemas/doc-vader/doc-pack.json");
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
      required: string[];
    };
    schema.required = schema.required.filter((field) => field !== "fixtures");
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");

    const result = runVerifier(workspace, "1");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing a required contract field");
  });

  it("fails phase 1 when an artifact declaration field is absent", async () => {
    const workspace = await createPhaseWorkspace();
    const schemaPath = path.join(workspace, "schemas/doc-vader/doc-pack.json");
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
      $defs: { artifactDeclaration: { required: string[] } };
    };
    schema.$defs.artifactDeclaration.required = schema.$defs.artifactDeclaration.required.filter(
      (field) => field !== "kind",
    );
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");

    const result = runVerifier(workspace, "1");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing a required declaration field");
  });

  it("fails phase 2 when the registry implementation is absent", async () => {
    const workspace = await createPhaseWorkspace();

    const result = runVerifier(workspace, "2");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("lib/doc-pack/index.ts");
  });
});
