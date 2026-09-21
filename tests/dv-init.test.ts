import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../lib/init/index.js";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(git = true): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dv-init-"));
  roots.push(root);
  if (git) {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  }
  return root;
}

function invoke(cwd: string, args: string[]): unknown {
  return JSON.parse(execFileSync(process.execPath, ["--import", tsxImport, cliPath, "init", ...args], {
    cwd,
    encoding: "utf8",
  }));
}

describe("dv init", () => {
  it("initializes the Git root from a nested cwd and preserves unrelated dv.yaml text", async () => {
    const root = await fixture();
    const nested = path.join(root, "nested", "cwd");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(root, "dv.yaml"), "# keep this comment\nnamespace: example.docs\n", "utf8");

    expect(invoke(nested, ["--pack", "work", "--yes", "--json"])).toMatchObject({
      rootDir: await fs.realpath(root),
      applied: ["work"],
    });
    expect(await fs.readFile(path.join(root, "dv.yaml"), "utf8")).toBe(
      "# keep this comment\nnamespace: example.docs\nbacklog:\n  dir: backlog\n",
    );
    expect(await fs.stat(path.join(root, "backlog", ".gitkeep"))).toBeDefined();
  });

  it("requires an explicit pack outside a TTY and previews without writes", async () => {
    const root = await fixture(false);

    expect(() => invoke(root, ["--dry-run", "--json"])).toThrow();
    expect(() => invoke(root, ["--pack", "work", "--json"])).toThrow();
    expect(invoke(root, ["--pack", "work", "--dry-run", "--json"])).toMatchObject({
      rootDir: await fs.realpath(root),
      dryRun: true,
      applied: [],
      planned: ["work"],
    });
    await expect(fs.stat(path.join(root, "backlog"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the injected TTY prompt instead of a subprocess TTY", async () => {
    const root = await fixture(false);
    const result = await runInit({
      dir: root,
      prompt: {
        isTTY: true,
        select: async () => ["work"],
        confirm: async () => true,
      },
    });

    expect(result.applied).toEqual(["work"]);
    await expect(fs.stat(path.join(root, "backlog", ".gitkeep"))).resolves.toBeDefined();
  });

  it("rejects an installed static recipe that escapes through a symlink", async () => {
    const root = await fixture(false);
    const outside = await fixture(false);
    const packageRoot = path.join(root, "node_modules", "evil-pack");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.symlink(outside, path.join(root, "escape"));
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: [{ id: "evil", manifest: "pack.json" }] },
    }));
    await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify({
      schemaVersion: "doc-vader/document-type-pack/v1",
      namespace: "evil.example",
      documentTypes: [{ type: "evil", metadataSchema: "metadata.json" }],
      name: "Evil",
      init: { outputs: [{ path: "escape/nope", content: "no" }] },
    }));

    const result = await runInit({
      dir: root,
      packIds: ["evil"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    });

    expect(result.failed).toHaveLength(1);
    await expect(fs.stat(path.join(outside, "nope"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects static recipes with config writes outside their claims", async () => {
    const root = await fixture(false);
    const packageRoot = path.join(root, "node_modules", "bad-config");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: [{ id: "bad-config", manifest: "pack.json" }] },
    }));
    await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify({
      schemaVersion: "doc-vader/document-type-pack/v1",
      namespace: "bad.example",
      documentTypes: [{ type: "bad", metadataSchema: "metadata.json" }],
      name: "Bad config",
      init: { outputs: [], config: { claims: ["backlog.dir"], values: { backlog: { profiles: [] } } } },
    }));

    await expect(runInit({
      dir: root,
      packIds: ["bad-config"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    })).rejects.toThrow("Init config values must exactly match declared claims.");
  });

  it("uses --dir over Git discovery", async () => {
    const gitRoot = await fixture();
    const target = await fixture(false);

    expect(invoke(gitRoot, ["--dir", target, "--pack", "work", "--yes", "--json"])).toMatchObject({
      rootDir: target,
      applied: ["work"],
    });
    await expect(fs.stat(path.join(target, "backlog", ".gitkeep"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(gitRoot, "backlog"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
