import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stageWorkGraphUacFixture } from "./helpers/work-graph-uac-fixture";
import { WORK_COMMAND_ALIASES } from "../lib/work/command-inventory.js";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

const tempDirs: string[] = [];

type WorkAliasReadModelOutputs = {
  list: string;
  show: string;
  ready: string;
  prompt: string;
  status: string;
};

async function stagePromptTemplate(rootDir: string): Promise<void> {
  const templateDir = path.join(rootDir, "templates", "reference", "task");
  await mkdir(templateDir, { recursive: true });
  await copyFile(
    path.resolve(__dirname, "../templates/reference/task/sandcastle-prompt.md.tpl"),
    path.join(templateDir, "sandcastle-prompt.md.tpl"),
  );
}

async function createTempRoot(): Promise<string> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `doc-vader-work-graph-uac-${randomUUID()}-`),
  );
  tempDirs.push(rootDir);
  return rootDir;
}

async function snapshotFiles(rootDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const relativePath = path.relative(rootDir, entryPath);
      snapshot.set(relativePath, await readFile(entryPath, "utf8"));
    }
  }

  await walk(rootDir);
  return snapshot;
}

function runCli(
  rootDir: string,
  args: string[],
  options: {
    input?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string {
  return execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
  });
}

function runAliasReadModelCommands(
  rootDir: string,
  alias: string,
): WorkAliasReadModelOutputs {
  return {
    list: runCli(rootDir, [alias, "list", "--json"]),
    show: runCli(rootDir, [alias, "70001", "show", "--json"]),
    ready: runCli(rootDir, [alias, "ready", "--json"]),
    prompt: runCli(rootDir, [alias, "70001", "prompt"]),
    status: runCli(rootDir, [alias, "70001", "status", "--json"]),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work graph UAC review fixture", () => {
  it("renders graph-backed prompt context across work aliases without mutating runtime or documents", async () => {
    const rootDir = await createTempRoot();
    await mkdir(rootDir, { recursive: true });

    await stageWorkGraphUacFixture(rootDir);
    await stagePromptTemplate(rootDir);
    const before = await snapshotFiles(rootDir);
    const [canonicalAlias, ...compatibilityAliases] = WORK_COMMAND_ALIASES;
    const canonicalPrompt = runCli(rootDir, [canonicalAlias, "70001", "prompt"]);

    expect(canonicalPrompt).toContain("## Dependencies");
    expect(canonicalPrompt).toContain("- `depends_on`: [[wi-70002]]");
    expect(canonicalPrompt).toContain("## Relationships");
    expect(canonicalPrompt).toContain(
      "- `belongs_to`: [[project-work-graph-uac-review]]",
    );
    expect(canonicalPrompt).toContain(
      "- `implements`: [[../docs/how-to/implementation-plans/work-graph-uac-review-prd.md]]",
    );
    expect(canonicalPrompt).not.toContain("### Relationships");
    expect(canonicalPrompt).not.toContain("`blocks`");
    expect(canonicalPrompt).not.toContain("`relates_to`");
    expect(canonicalPrompt).not.toContain("`references`");

    for (const alias of compatibilityAliases) {
      expect(runCli(rootDir, [alias, "70001", "prompt"])).toBe(canonicalPrompt);
    }

    const after = await snapshotFiles(rootDir);
    expect(after).toEqual(before);
  }, 15000);

  it("keeps list, show, ready, prompt, and status alias outputs aligned without mutating the fixture", async () => {
    const rootDir = await createTempRoot();
    await mkdir(rootDir, { recursive: true });

    await stageWorkGraphUacFixture(rootDir);
    await stagePromptTemplate(rootDir);
    const before = await snapshotFiles(rootDir);
    const [canonicalAlias, ...compatibilityAliases] = WORK_COMMAND_ALIASES;
    const canonicalOutputs = runAliasReadModelCommands(rootDir, canonicalAlias);

    expect(canonicalOutputs.list).toContain('"id": "wi-70001"');
    expect(canonicalOutputs.show).toContain('"id": "wi-70001"');
    expect(canonicalOutputs.ready).toContain('"schemaVersion": "task-ready/v1"');
    expect(canonicalOutputs.prompt).toContain("# Sandcastle Work Item: wi-70001");
    expect(canonicalOutputs.status).toContain('"id": "wi-70001"');

    for (const alias of compatibilityAliases) {
      expect(runAliasReadModelCommands(rootDir, alias)).toEqual(canonicalOutputs);
    }

    const after = await snapshotFiles(rootDir);
    expect(after).toEqual(before);
  }, 60000);

  it("keeps the removed graph route unavailable without mutating the fixture", async () => {
    const rootDir = await createTempRoot();
    await stageWorkGraphUacFixture(rootDir);
    const before = await snapshotFiles(rootDir);

    expect(() => runCli(rootDir, ["work", "graph", "summary"])).toThrow(
      /unknown command 'graph'/,
    );
    expect(await snapshotFiles(rootDir)).toEqual(before);
  });

});
