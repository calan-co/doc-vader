import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "cli", "doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(rootDir);
  return rootDir;
}

const sandcastleExtensionPackagePath = path.join(
  repoRoot,
  "extensions",
  "dv-sandcastle-issue-tracker",
);
const sandcastleExtensionScriptPath = path.join(
  sandcastleExtensionPackagePath,
  "index.mjs",
);

function runCli(args: readonly string[], cwd = repoRoot): string {
  return execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: process.env.TMPDIR ?? "/tmp" },
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true }),
    ),
  );
});

describe("Doc-Vader extension command surface", () => {
  it("requires install targets to be Node packages instead of script files", async () => {
    const workspaceRoot = await createTempDir("dv-extension-script-reject-");

    expect(() =>
      runCli(
        ["extensions", "install", sandcastleExtensionScriptPath, "--json"],
        workspaceRoot,
      ),
    ).toThrow(/Node package name or package directory/);
  });

  it("loads legacy manifests that stored extension script paths and skips duplicate entrypoints", async () => {
    const workspaceRoot = await createTempDir("dv-extension-legacy-script-");
    await mkdir(path.join(workspaceRoot, ".doc-vader", "extensions"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".doc-vader", "extensions", "manifest.json"),
      `${JSON.stringify({
        schemaVersion: "doc-vader/extensions/v1",
        extensions: [
          {
            name: "@calan-co/dv-sandcastle-issue-tracker",
            packageName: "@calan-co/dv-sandcastle-issue-tracker",
            packageSpecifier: sandcastleExtensionPackagePath,
            entrypoint: "./index.mjs",
            enabled: true,
            installedAt: "2026-07-08T05:53:34.404Z",
          },
          {
            name: "dv-sandcastle-issue-tracker",
            packageName: "dv-sandcastle-issue-tracker",
            packageSpecifier: sandcastleExtensionScriptPath,
            entrypoint: sandcastleExtensionScriptPath,
            enabled: true,
            installedAt: "2026-07-06T17:43:09.665Z",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const output = runCli([
      "sandcastle",
      "init",
      "--root",
      workspaceRoot,
      "--dry-run",
      "--json",
    ], workspaceRoot);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      root: workspaceRoot,
      dryRun: true,
      sandcastleInit: {
        requested: false,
      },
    });
  });

  it("installs extensions into .doc-vader and loads them into the single dv command surface", async () => {
    const workspaceRoot = await createTempDir("dv-extension-sandcastle-");

    const installOutput = runCli(
      ["extensions", "install", sandcastleExtensionPackagePath, "--json"],
      workspaceRoot,
    );
    const installed = JSON.parse(installOutput);
    expect(installed.extension).toMatchObject({
      name: "@calan-co/dv-sandcastle-issue-tracker",
      packageName: "@calan-co/dv-sandcastle-issue-tracker",
      entrypoint: "./index.mjs",
      enabled: true,
    });

    const output = runCli([
      "sandcastle",
      "init",
      "--root",
      workspaceRoot,
      "--dry-run",
      "--json",
    ], workspaceRoot);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      root: workspaceRoot,
      dryRun: true,
      sandcastleInit: {
        requested: false,
      },
    });
    expect(parsed.changes.map((change: { path: string }) => change.path)).toContain(
      ".sandcastle/dv4sandcastle.mjs",
    );
  });

  it("normalizes ready candidates with canonical and generated work item IDs", async () => {
    const workspaceRoot = await createTempDir("dv-extension-ready-list-");
    const fakeDvPath = path.join(workspaceRoot, "fake-dv.mjs");
    await writeFile(
      fakeDvPath,
      `console.log(JSON.stringify({ candidates: [
  { id: "external-task", numericId: 42, title: "External ID" },
  { numericId: 43, title: "Numeric ID" },
  { number: 44, title: "Number ID" },
] }));\n`,
      "utf8",
    );

    runCli(
      ["extensions", "install", sandcastleExtensionPackagePath, "--json"],
      workspaceRoot,
    );
    runCli(["sandcastle", "init", "--root", workspaceRoot], workspaceRoot);

    const output = execFileSync(
      process.execPath,
      [path.join(workspaceRoot, ".sandcastle", "dv4sandcastle.mjs"), "list"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: { ...process.env, DV_COMMAND: `${process.execPath} ${fakeDvPath}` },
      },
    );

    expect(JSON.parse(output).map((candidate: { id: string }) => candidate.id)).toEqual([
      "external-task",
      "wi-43",
      "wi-44",
    ]);
  });

  it("allows the Sandcastle extension to patch an initialized scaffold", async () => {
    const workspaceRoot = await createTempDir("dv-extension-sandcastle-write-");
    await mkdir(path.join(workspaceRoot, ".sandcastle"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".sandcastle", "plan-prompt.md"),
      "!`echo 'No issue tracker configured — run .sandcastle/SETUP_ISSUE_TRACKER.md through your coding agent.' >&2; exit 1`\n<view command — see .sandcastle/SETUP_ISSUE_TRACKER.md>\n<close command — see .sandcastle/SETUP_ISSUE_TRACKER.md>\n",
      "utf8",
    );

    runCli(
      ["extensions", "install", sandcastleExtensionPackagePath, "--json"],
      workspaceRoot,
    );

    runCli(["sandcastle", "init", "--root", workspaceRoot], workspaceRoot);

    const [adapter, closeTask, setupGuide, planPrompt] = await Promise.all([
      readFile(path.join(workspaceRoot, ".sandcastle", "dv4sandcastle.mjs"), "utf8"),
      readFile(path.join(workspaceRoot, ".sandcastle", "close.mjs"), "utf8"),
      readFile(
        path.join(workspaceRoot, ".sandcastle", "SETUP_ISSUE_TRACKER.md"),
        "utf8",
      ),
      readFile(path.join(workspaceRoot, ".sandcastle", "plan-prompt.md"), "utf8"),
    ]);

    expect(adapter).toContain("dvCommand");
    expect(closeTask).toContain('"work",\n      numericId,\n      "update"');
    expect(closeTask).toContain('"--input",\n      JSON.stringify({ status: "completed", statusReason: "completed" })');
    expect(closeTask).toContain("...extraArgs");
    expect(setupGuide).toContain("Doc-Vader Sandcastle Issue Tracker");
    expect(setupGuide).toContain("- Validate close readiness: `node .sandcastle/dv4sandcastle.mjs validate <task-id>`");
    expect(setupGuide).toContain("- Close work: `node .sandcastle/dv4sandcastle.mjs close <task-id>`");
    expect(adapter).toContain('case "validate"');
    expect(adapter).toContain('case "claim"');
    expect(adapter).toContain('case "recover"');
    expect(adapter).toContain('case "record"');
    expect(adapter).toContain('case "close"');
    expect(adapter).toContain('runDv(["work", args[0], "status", ...args.slice(1)])');
    expect(planPrompt).toContain("node .sandcastle/dv4sandcastle.mjs list");
    expect(planPrompt).toContain("node .sandcastle/dv4sandcastle.mjs view");
    expect(planPrompt).toContain("node .sandcastle/dv4sandcastle.mjs close");
  });
});
