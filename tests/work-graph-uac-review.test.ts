import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  stageWorkGraphUacFixture,
  workGraphUacExpectedDir,
} from "./helpers/work-graph-uac-fixture";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

const tempDirs: string[] = [];

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

function runCli(rootDir: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work graph UAC review fixture", () => {
  it("stages the documented review fixture with stable JSON and DOT outputs", async () => {
    const rootDir = await createTempRoot();
    await mkdir(rootDir, { recursive: true });

    await stageWorkGraphUacFixture(rootDir);
    const before = await snapshotFiles(rootDir);

    const nodes = runCli(rootDir, ["work", "graph", "nodes", "--format", "json"]);
    const edges = runCli(rootDir, ["work", "graph", "edges", "--format", "json"]);
    const inspect = runCli(rootDir, [
      "work",
      "graph",
      "inspect",
      "wi:70001",
      "--format",
      "json",
    ]);
    const dot = runCli(rootDir, [
      "work",
      "graph",
      "inspect",
      "wi:70001",
      "--format",
      "dot",
    ]);

    expect(nodes).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "nodes.json"), "utf8"),
    );
    expect(edges).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "edges.json"), "utf8"),
    );
    expect(inspect).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "inspect-wi-70001.json"), "utf8"),
    );
    expect(dot).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "inspect-wi-70001.dot"), "utf8"),
    );

    const parsedNodes = JSON.parse(nodes) as {
      nodes: Array<{ type: string }>;
    };
    const parsedEdges = JSON.parse(edges) as {
      edges: Array<{ type: string }>;
    };

    expect(new Set(parsedNodes.nodes.map((node) => node.type))).toEqual(
      new Set(["work-item", "claim", "record", "scope"]),
    );
    expect(new Set(parsedEdges.edges.map((edge) => edge.type))).toEqual(
      new Set(["depends_on", "belongs_to", "implements", "locks", "records"]),
    );
    expect(parsedEdges.edges.some((edge) => edge.type === "blocks")).toBe(false);
    expect(parsedEdges.edges.some((edge) => edge.type === "relates_to")).toBe(false);
    expect(dot.startsWith("digraph WorkGraph {\n")).toBe(true);

    const after = await snapshotFiles(rootDir);
    expect(after).toEqual(before);
  }, 15000);
});
