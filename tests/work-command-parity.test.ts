import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORK_COMMAND_ALIASES,
  WORK_COMMAND_INVENTORY,
} from "../lib/work/command-inventory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.resolve(repoRoot, "cli/doc-vader.ts");

function runCli(args: string[]): string {
  return execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

function runHelp(args: string[]): string {
  return runCli([...args, "--help"]);
}

describe("work command cutover", () => {
  it("publishes only canonical resource-first work routes", () => {
    expect(WORK_COMMAND_ALIASES).toEqual(["work"]);
    expect(WORK_COMMAND_INVENTORY.map((entry) => entry.name)).toEqual(["list", "ready", "<work-item-id>"]);

    expect(runHelp(["work"])).toContain("<work-item-id>");
    const resourceHelp = runHelp(["work", "wi-60482"]);
    expect(resourceHelp).toContain("update");
    expect(resourceHelp).toContain("checklist");
    expect(resourceHelp).not.toContain("qualifier");
    expect(resourceHelp).not.toContain("attest");
  });

  it("documents the canonical command grammar", async () => {
    const contents = await fs.readFile(
      path.resolve(repoRoot, "docs/reference/work-management/work-item-lifecycle-commands.md"),
      "utf8",
    );
    expect(contents).toContain("dv work <work-item-id> show");
    expect(contents).toContain("unavailable");
  });

  it("executes resource-first show and structured update routes", () => {
    expect(JSON.parse(runCli(["work", "wi-60498", "show", "--json"]))).toMatchObject({ id: "wi-60498" });
    expect(JSON.parse(runCli(["work", "wi-60498", "update", "--input", '{"status":"ready"}', "--dry-run", "--json"]))).toMatchObject({ id: "wi-60498", dryRun: true });
    expect(JSON.parse(runCli(["work", "wi-60498", "update", "--input", '{"status":"ready","clearEstimated":true}', "--dry-run", "--json"]))).toMatchObject({ id: "wi-60498", dryRun: true });
  });

  it("requires evidence on canonical check completion", () => {
    const result = spawnSync(process.execPath, ["--import", tsxImport, cliPath, "work", "wi-60498", "checklist", "tasks", "check", "example", "complete", "--claim", "claim"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("required option '--evidence <reference|json|->' not specified");
  });

  it("rejects legacy roots and verb-first routes", () => {
    for (const args of [["wi", "list"], ["task", "list"], ["work-item", "transition"], ["work", "show", "wi-60498"], ["work", "resource", "--work-item-id", "wi-60498", "show"], ["work", "wi-60498", "qualifiers"], ["work", "wi-60498", "attest"], ["work", "capabilities", "--json"], ["work", "select", "--request", "-", "json"], ["work", "graph", "summary"]]) {
      expect(spawnSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
        cwd: repoRoot,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      }).status).not.toBe(0);
    }
  });
});
