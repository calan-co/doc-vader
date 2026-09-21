import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { PassThrough } from "node:stream";
import { runInit } from "../lib/init/index.js";
import { createTerminalInitPrompt } from "../lib/init/prompt.js";
import { registerInitCommand } from "../lib/init/command.js";

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

  it("case-folds reserved .git and dv.yaml output paths", async () => {
    const root = await fixture(false);
    for (const [packageName, id, output] of [
      ["case-git", "case-git", ".GIT/managed"],
      ["case-config", "case-config", "DV.YAML/managed"],
    ]) {
      const packageRoot = path.join(root, "node_modules", packageName);
      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        docVader: { documentTypePacks: [{ id, manifest: "pack.json" }] },
      }));
      await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify({
        schemaVersion: "doc-vader/document-type-pack/v1",
        namespace: `${packageName}.example`,
        documentTypes: [{ type: "example", metadataSchema: "metadata.json" }],
        name: packageName,
        init: { outputs: [{ path: output, content: "" }] },
      }));
    }
    const prompt = { isTTY: false, select: async () => [], confirm: async () => true };

    await expect(runInit({ dir: root, packIds: ["case-git"], yes: true, prompt })).rejects.toThrow("Unsafe init path");
    await expect(runInit({ dir: root, packIds: ["case-config"], yes: true, prompt })).rejects.toThrow("Init config and output paths collide");
  });

  it("ignores unsafe descriptor paths and schema-invalid installed manifests", async () => {
    const root = await fixture(false);
    for (const [packageName, id, manifestPath, manifest] of [
      ["unsafe-descriptor", "unsafe", "../pack.json", undefined],
      ["invalid-manifest", "invalid", "pack.json", {
        schemaVersion: "doc-vader/document-type-pack/v1",
        namespace: "Invalid Namespace",
        documentTypes: [{ type: "Invalid Type", metadataSchema: "metadata.json" }],
        name: "Invalid",
        init: { outputs: [{ path: "invalid/.gitkeep", content: "" }] },
      }],
    ] as const) {
      const packageRoot = path.join(root, "node_modules", packageName);
      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        docVader: { documentTypePacks: [{ id, manifest: manifestPath }] },
      }));
      if (manifest) await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify(manifest));
    }
    const prompt = { isTTY: false, select: async () => [], confirm: async () => true };

    await expect(runInit({ dir: root, packIds: ["unsafe"], yes: true, prompt })).rejects.toThrow("Unknown init pack");
    await expect(runInit({ dir: root, packIds: ["invalid"], yes: true, prompt })).rejects.toThrow("Unknown init pack");
    await expect(runInit({ dir: root, packIds: ["work"], yes: true, prompt })).resolves.toMatchObject({ applied: ["work"] });
  });

  it("discovers a valid package linked under node_modules", async () => {
    const root = await fixture(false);
    const packageSource = await fixture(false);
    await fs.writeFile(path.join(packageSource, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: [{ id: "linked-package", manifest: "pack.json" }] },
    }));
    await fs.writeFile(path.join(packageSource, "pack.json"), JSON.stringify({
      schemaVersion: "doc-vader/document-type-pack/v1",
      namespace: "linked-package.example",
      documentTypes: [{ type: "example", metadataSchema: "metadata.json" }],
      name: "Linked package",
      init: { outputs: [{ path: "linked-package/.gitkeep", content: "" }] },
    }));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.symlink(packageSource, path.join(root, "node_modules", "linked-package"));

    await expect(runInit({
      dir: root,
      packIds: ["linked-package"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    })).resolves.toMatchObject({ applied: ["linked-package"] });
  });

  it("ignores descriptor manifests symlinked outside their package root", async () => {
    const root = await fixture(false);
    const outside = path.join(await fixture(false), "external-pack.json");
    const packageRoot = path.join(root, "node_modules", "linked-descriptor");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: [{ id: "linked", manifest: "link.json" }] },
    }));
    await fs.writeFile(outside, JSON.stringify({
      schemaVersion: "doc-vader/document-type-pack/v1",
      namespace: "linked.example",
      documentTypes: [{ type: "example", metadataSchema: "metadata.json" }],
      name: "Linked",
      init: { outputs: [{ path: "linked/.gitkeep", content: "" }] },
    }));
    await fs.symlink(outside, path.join(packageRoot, "link.json"));
    const prompt = { isTTY: false, select: async () => [], confirm: async () => true };

    await expect(runInit({ dir: root, packIds: ["linked"], yes: true, prompt })).rejects.toThrow("Unknown init pack");
    await expect(runInit({ dir: root, packIds: ["work"], yes: true, prompt })).resolves.toMatchObject({ applied: ["work"] });
  });

  it("reserves dv.yaml for Work config and rejects cross-pack ancestor outputs", async () => {
    const root = await fixture(false);
    const packageRoot = path.join(root, "node_modules", "config-interferer");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: [{ id: "interferer", manifest: "pack.json" }] },
    }));
    await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify({
      schemaVersion: "doc-vader/document-type-pack/v1",
      namespace: "interferer.example",
      documentTypes: [{ type: "example", metadataSchema: "metadata.json" }],
      name: "Interferer",
      init: { outputs: [{ path: "dv.yaml/managed", content: "" }] },
    }));
    const prompt = { isTTY: false, select: async () => [], confirm: async () => true };

    await expect(runInit({ dir: root, packIds: ["interferer", "work"], yes: true, prompt }))
      .rejects.toThrow("Init config and output paths collide");
    await expect(fs.lstat(path.join(root, "dv.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(path.join(root, "backlog"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("normalizes output collisions and rejects dv.yaml descendants when config is claimed", async () => {
    const root = await fixture(false);
    for (const [packageName, id, output, config] of [
      ["one", "one", "managed//file", undefined],
      ["two", "two", "managed/file", undefined],
      ["ancestor", "ancestor", "managed", undefined],
      ["config-collision", "config-collision", "dv.yaml/managed", { claims: ["backlog.dir"], values: { backlog: { dir: "backlog" } } }],
    ] as const) {
      const packageRoot = path.join(root, "node_modules", packageName);
      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        docVader: { documentTypePacks: [{ id, manifest: "pack.json" }] },
      }));
      await fs.writeFile(path.join(packageRoot, "pack.json"), JSON.stringify({
        schemaVersion: "doc-vader/document-type-pack/v1",
        namespace: `${packageName}.example`,
        documentTypes: [{ type: "example", metadataSchema: "metadata.json" }],
        name: packageName,
        init: { outputs: [{ path: output, content: "" }], ...(config ? { config } : {}) },
      }));
    }
    const prompt = { isTTY: false, select: async () => [], confirm: async () => true };

    await expect(runInit({ dir: root, packIds: ["one", "two"], yes: true, prompt }))
      .rejects.toThrow("Selected packs collide");
    await expect(runInit({ dir: root, packIds: ["one", "ancestor"], yes: true, prompt }))
      .rejects.toThrow("Selected packs collide");
    await expect(runInit({ dir: root, packIds: ["config-collision"], yes: true, prompt }))
      .rejects.toThrow("Init config and output paths collide");
  });

  it("ignores malformed installed extension descriptors", async () => {
    const root = await fixture(false);
    const packageRoot = path.join(root, "node_modules", "malformed");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      docVader: { documentTypePacks: { id: "not-an-array" } },
    }));

    const result = await runInit({
      dir: root,
      packIds: ["work"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    });

    expect(result.applied).toEqual(["work"]);
  });

  it("rejects a final output symlink without writing through it", async () => {
    const root = await fixture(false);
    const outside = path.join(await fixture(false), "outside");
    await fs.mkdir(path.join(root, "backlog"));
    await fs.writeFile(outside, "unchanged");
    await fs.symlink(outside, path.join(root, "backlog", ".gitkeep"));

    const result = await runInit({
      dir: root,
      packIds: ["work"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    });

    expect(result.failed).toHaveLength(1);
    await expect(fs.readFile(outside, "utf8")).resolves.toBe("unchanged");
  });

  it("rejects a dangling dv.yaml symlink and rolls back its new output directory", async () => {
    const root = await fixture(false);
    const outside = path.join(await fixture(false), "missing.yaml");
    await fs.symlink(outside, path.join(root, "dv.yaml"));

    const result = await runInit({
      dir: root,
      packIds: ["work"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    });

    expect(result.failed).toHaveLength(1);
    await expect(fs.lstat(path.join(root, "backlog"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(outside)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves unrelated YAML formatting byte-for-byte", async () => {
    const root = await fixture(false);
    const source = "# heading\nnamespace: \"example.docs\" # inline\nvalidation: { failOn: warning, allowUnknownProperties: true } # flow\nlist: [one, two]\nquoted: 'keep spaces'\n";
    await fs.writeFile(path.join(root, "dv.yaml"), source);

    await runInit({
      dir: root,
      packIds: ["work"],
      yes: true,
      prompt: { isTTY: false, select: async () => [], confirm: async () => true },
    });

    await expect(fs.readFile(path.join(root, "dv.yaml"), "utf8")).resolves.toBe(`${source}backlog:\n  dir: backlog\n`);
  });

  it("keeps interactive prompt output off the JSON result stream", async () => {
    const input = new PassThrough();
    const promptOutput = new PassThrough();
    let rendered = "";
    promptOutput.on("data", (chunk: Buffer) => { rendered += chunk.toString(); });
    const prompt = createTerminalInitPrompt(input, promptOutput, true);
    input.write("work\n");
    expect(await prompt.select([{ id: "work", name: "Work", init: { outputs: [] } }])).toEqual(["work"]);
    input.write("yes\n");
    expect(await prompt.confirm([{ id: "work", name: "Work", init: { outputs: [] } }])).toBe(true);
    input.end();
    expect(rendered).toContain("work: Work");
  });

  it("wires interactive JSON prompts to stderr and emits one stdout JSON result", async () => {
    const root = await fixture(false);
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const stdout = Object.assign(new PassThrough(), { isTTY: true });
    const stderr = new PassThrough();
    let output = "";
    let prompts = "";
    stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    let selected = false;
    let confirmed = false;
    stderr.on("data", (chunk: Buffer) => {
      prompts += chunk.toString();
      if (!selected && prompts.includes("Pack IDs")) {
        selected = true;
        input.write("work\n");
      }
      if (!confirmed && prompts.includes("Initialize work")) {
        confirmed = true;
        input.write("yes\n");
      }
    });
    const program = new Command().name("dv");
    registerInitCommand(program, { input, output: stdout, error: stderr });

    await program.parseAsync(["node", "dv", "init", "--dir", root, "--json"], { from: "node" });
    input.end();

    expect(JSON.parse(output)).toMatchObject({ applied: ["work"] });
    expect(output).not.toContain("Pack IDs");
    expect(prompts).toContain("Pack IDs");
    expect(prompts).toContain("Initialize work");
  });

  it("uses --dir as an explicit subdirectory target inside Git", async () => {
    const root = await fixture();
    const target = path.join(root, "nested", "target");
    await fs.mkdir(target, { recursive: true });

    expect(invoke(root, ["--dir", target, "--pack", "work", "--yes", "--json"])).toMatchObject({
      rootDir: target,
      applied: ["work"],
    });
    await expect(fs.stat(path.join(target, "backlog", ".gitkeep"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, "backlog"))).rejects.toMatchObject({ code: "ENOENT" });
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
