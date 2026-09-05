import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dv-selection-transport-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.writeFile(path.join(root, "backlog", "001-ready.md"), `---
id: wi-001
title: Ready item
summary: Transport fixture
type: work-item
subtype: task
lifecycle: active
status: ready
tags:
  - afk
---
`, "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "transport@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Transport Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  return root;
}

describe("publisher work selection CLI transport", () => {
  it("keeps removed adapter routes unavailable", async () => {
    const root = await fixture();
    for (const args of [["work", "capabilities", "--json"], ["work", "select", "--request", "-", "--json"]]) {
      expect(() => execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
        cwd: root,
        encoding: "utf8",
      })).toThrow(/unknown command/);
    }
  });
});
